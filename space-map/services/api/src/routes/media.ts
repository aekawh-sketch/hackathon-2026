// Панорамы (готовые 2:1) и серии кадров для склейки (ТЗ 5.4, 5.5, 9).
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import { requireUser } from '../auth.ts';
import { captureFrames, captures, jobs, mapDrafts, panoramas } from '../db/schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { processFrame, processPanorama } from '../images.ts';
import { isUuid, ownedVenue } from '../venues.ts';

export const MIN_FRAMES = 6;
export const MAX_FRAMES = 48;

const VenueId = Type.Object({ id: Type.String() });
const CaptureParams = Type.Object({ id: Type.String(), cid: Type.String() });

async function readUpload(req: FastifyRequest, maxBytes: number): Promise<{ file: Buffer; fields: Record<string, string> }> {
  let file: Buffer | null = null;
  const fields: Record<string, string> = {};
  for await (const part of req.parts({ limits: { fileSize: maxBytes, files: 1, fields: 5 } })) {
    if (part.type === 'file') {
      file = await part.toBuffer();
      if (part.file.truncated) throw new ApiError(413, 'too_large', `Файл больше ${Math.round(maxBytes / 1e6)} МБ`);
    } else {
      fields[part.fieldname] = String(part.value).slice(0, 2000);
    }
  }
  if (!file) throw new ApiError(400, 'no_file', 'Нет файла');
  return { file, fields };
}

export const mediaRoutes: FastifyPluginAsyncTypebox<AppDeps> = async (app, { db, storage }) => {
  // ── Готовые панорамы ──

  app.get('/:id/panoramas', { schema: { params: VenueId } }, async (req) => {
    const venue = await ownedVenue(db, req.params.id, requireUser(req).id);
    const rows = await db.select().from(panoramas).where(eq(panoramas.venueId, venue.id)).orderBy(desc(panoramas.createdAt));
    return { panoramas: rows.map(panoramaView) };
  });

  app.post('/:id/panoramas', { schema: { params: VenueId } }, async (req, reply) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user.id);
    const { file } = await readUpload(req, 60_000_000);
    const out = await processPanorama(file);
    const [row] = await db
      .insert(panoramas)
      .values({ venueId: venue.id, source: 'upload', status: 'processing', width: out.width, height: out.height, createdBy: user.id })
      .returning();
    await storage.put(`panoramas/${row!.id}/pano.jpg`, out.pano);
    await storage.put(`panoramas/${row!.id}/preview.jpg`, out.preview);
    const [ready] = await db.update(panoramas).set({ status: 'ready' }).where(eq(panoramas.id, row!.id)).returning();
    return reply.status(201).send({ panorama: panoramaView(ready!) });
  });

  app.delete('/:id/panoramas/:pid', { schema: { params: Type.Object({ id: Type.String(), pid: Type.String() }) } }, async (req) => {
    const venue = await ownedVenue(db, req.params.id, requireUser(req).id);
    if (!isUuid(req.params.pid)) throw notFound('Панорама не найдена');
    const [draft] = await db.select({ doc: mapDrafts.doc }).from(mapDrafts).where(eq(mapDrafts.venueId, venue.id));
    if (draft?.doc.panoramas.some((p) => p.pano === req.params.pid)) {
      throw new ApiError(409, 'in_use', 'Панорама стоит на плане — сначала уберите её с карты');
    }
    const deleted = await db
      .delete(panoramas)
      .where(and(eq(panoramas.id, req.params.pid), eq(panoramas.venueId, venue.id)))
      .returning({ id: panoramas.id });
    if (!deleted.length) throw notFound('Панорама не найдена');
    await storage.delete(`panoramas/${req.params.pid}`);
    return { ok: true };
  });

  // ── Серии кадров для склейки ──

  app.get('/:id/captures', { schema: { params: VenueId } }, async (req) => {
    const venue = await ownedVenue(db, req.params.id, requireUser(req).id);
    const rows = await db.select().from(captures).where(eq(captures.venueId, venue.id)).orderBy(desc(captures.createdAt)).limit(50);
    return { captures: await Promise.all(rows.map((c) => captureView(c))) };
  });

  app.post('/:id/captures', { schema: { params: VenueId } }, async (req, reply) => {
    const user = requireUser(req);
    const venue = await ownedVenue(db, req.params.id, user.id);
    const [row] = await db.insert(captures).values({ venueId: venue.id, createdBy: user.id }).returning();
    return reply.status(201).send({ capture: await captureView(row!) });
  });

  app.get('/:id/captures/:cid', { schema: { params: CaptureParams } }, async (req) => {
    const capture = await ownedCapture(req);
    return { capture: await captureView(capture) };
  });

  // Идемпотентно: тот же frameId второй раз не создаёт дубликат (обрывы мобильной связи, ТЗ п. 45).
  app.put(
    '/:id/captures/:cid/frames/:frameId',
    { schema: { params: Type.Object({ id: Type.String(), cid: Type.String(), frameId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }) }) } },
    async (req, reply) => {
      const capture = await ownedCapture(req);
      if (capture.status !== 'uploading') throw new ApiError(409, 'not_uploading', 'Съёмка уже отправлена на склейку');
      const existing = await db
        .select()
        .from(captureFrames)
        .where(and(eq(captureFrames.captureId, capture.id), eq(captureFrames.frameId, req.params.frameId)))
        .limit(1);
      if (existing.length) return { frame: frameView(existing[0]!), duplicate: true };

      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(captureFrames)
        .where(eq(captureFrames.captureId, capture.id));
      if (count >= MAX_FRAMES) throw new ApiError(422, 'too_many_frames', `Не больше ${MAX_FRAMES} кадров в одной съёмке`);

      const { file, fields } = await readUpload(req, 15_000_000);
      const orientation = parseOrientation(fields.orientation);
      const frame = await processFrame(file);
      const storageKey = `captures/${capture.id}/frames/${req.params.frameId}.jpg`;
      await storage.put(storageKey, frame.jpeg);
      const [row] = await db
        .insert(captureFrames)
        .values({ captureId: capture.id, frameId: req.params.frameId, storageKey, width: frame.width, height: frame.height, orientation })
        .onConflictDoNothing()
        .returning();
      return reply.status(201).send({ frame: frameView(row ?? (await getFrame(capture.id, req.params.frameId))) });
    },
  );

  app.post('/:id/captures/:cid/stitch', { schema: { params: CaptureParams } }, async (req) => {
    const capture = await ownedCapture(req);
    if (capture.status === 'queued' || capture.status === 'processing') return { capture: await captureView(capture) };
    if (capture.status !== 'uploading') throw new ApiError(409, 'bad_state', 'Эту съёмку уже нельзя отправить на склейку');
    const frames = await db.select({ id: captureFrames.frameId }).from(captureFrames).where(eq(captureFrames.captureId, capture.id));
    if (frames.length < MIN_FRAMES) {
      throw new ApiError(422, 'too_few_frames', `Для склейки нужно хотя бы ${MIN_FRAMES} кадров, загружено ${frames.length}`);
    }
    return { capture: await captureView(await enqueueStitch(capture.id)) };
  });

  app.post('/:id/captures/:cid/retry', { schema: { params: CaptureParams } }, async (req) => {
    const capture = await ownedCapture(req);
    if (capture.status !== 'failed') throw new ApiError(409, 'bad_state', 'Повторить можно только неудачную склейку');
    return { capture: await captureView(await enqueueStitch(capture.id)) };
  });

  app.post('/:id/captures/:cid/cancel', { schema: { params: CaptureParams } }, async (req) => {
    const capture = await ownedCapture(req);
    if (capture.status === 'ready') throw new ApiError(409, 'bad_state', 'Склейка уже готова');
    const [row] = await db.update(captures).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(captures.id, capture.id)).returning();
    await db
      .update(jobs)
      .set({ status: 'failed', error: 'cancelled', updatedAt: new Date() })
      .where(and(eq(jobs.type, 'stitch'), inArray(jobs.status, ['queued']), sql`${jobs.payload}->>'captureId' = ${capture.id}`));
    return { capture: await captureView(row!) };
  });

  async function ownedCapture(req: FastifyRequest<{ Params: { id: string; cid: string } }>) {
    const venue = await ownedVenue(db, req.params.id, requireUser(req).id);
    if (!isUuid(req.params.cid)) throw notFound('Съёмка не найдена');
    const [capture] = await db
      .select()
      .from(captures)
      .where(and(eq(captures.id, req.params.cid), eq(captures.venueId, venue.id)))
      .limit(1);
    if (!capture) throw notFound('Съёмка не найдена');
    return capture;
  }

  async function enqueueStitch(captureId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(captures)
        .set({ status: 'queued', stage: null, error: null, badFrames: [], updatedAt: new Date() })
        .where(eq(captures.id, captureId))
        .returning();
      await tx.insert(jobs).values({ type: 'stitch', payload: { captureId } });
      return row!;
    });
  }

  async function getFrame(captureId: string, frameId: string) {
    const [row] = await db
      .select()
      .from(captureFrames)
      .where(and(eq(captureFrames.captureId, captureId), eq(captureFrames.frameId, frameId)));
    return row!;
  }

  async function captureView(c: typeof captures.$inferSelect) {
    const frames = await db
      .select({ frameId: captureFrames.frameId })
      .from(captureFrames)
      .where(eq(captureFrames.captureId, c.id))
      .orderBy(asc(captureFrames.createdAt));
    return {
      id: c.id,
      status: c.status,
      stage: c.stage,
      error: c.error,
      badFrames: c.badFrames,
      panoramaId: c.panoramaId,
      frames: frames.map((f) => f.frameId),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
};

function panoramaView(p: typeof panoramas.$inferSelect) {
  return {
    id: p.id,
    source: p.source,
    status: p.status,
    width: p.width,
    height: p.height,
    error: p.error,
    createdAt: p.createdAt,
    urls: p.status === 'ready' ? { image: `/files/panoramas/${p.id}/pano.jpg`, preview: `/files/panoramas/${p.id}/preview.jpg` } : null,
  };
}

function frameView(f: typeof captureFrames.$inferSelect) {
  return { frameId: f.frameId, width: f.width, height: f.height, hasOrientation: f.orientation !== null };
}

/** Кватернион [x, y, z, w] из поля формы или null. */
function parseOrientation(raw: string | undefined): number[] | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as unknown;
    if (Array.isArray(q) && q.length === 4 && q.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.0001)) return q;
  } catch {
    /* ниже — ошибка */
  }
  throw new ApiError(422, 'bad_orientation', 'Ориентация кадра — массив из 4 чисел (кватернион)');
}
