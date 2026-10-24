// Автосохранение карты на сервер (ТЗ 7.2, п. 47): правки уходят через короткую паузу, с номером ревизии.
// Кто-то сохранил раньше нас (телефон снял панораму, пока на сайте правили план) — правки сливаются сами
// (`mergeDocuments`) и сохраняются поверх. Окно «чью версию оставить» — только если свести не удалось.
import { mergeDocuments, type MapDocument } from '@space-map/map-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, venuesApi } from '../api.ts';

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; publishedVersion: number | null }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; updatedBy: string | null };

const DEBOUNCE_MS = 700;
/** Как часто спрашивать, не сохранил ли кто-то после нас (общий доступ — правят вдвоём-втроём). */
const SYNC_MS = 4000;
const RETRY_MS = 5000;

/**
 * @param onRemote показать документ с чужими правками: `merged` — false, если у нас ничего не ждало сохранения
 *   и мы просто взяли чужой; true — свои правки слиты с чужими и уйдут следующим сохранением.
 */
export function useServerSave(
  venueId: string | null,
  initialRevision: number,
  doc: MapDocument,
  onRemote?: (doc: MapDocument, updatedBy: string | null, merged: boolean) => void,
) {
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const revision = useRef(initialRevision);
  const latest = useRef(doc);
  latest.current = doc;
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const blocked = useRef(false); // конфликт: ждём решения
  const skipDoc = useRef<MapDocument | null>(doc); // этот документ уже на сервере — не сохранять
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;

  /**
   * Сохранение отклонено — на сервере новее. Слить отправленное с серверным поверх общей базы; правки,
   * сделанные уже после отправки, — поверх слитого. Документ уходит в редактор, сохранение запустит эффект ниже.
   */
  const mergeRemote = useCallback(
    async (sending: MapDocument): Promise<boolean> => {
      if (!venueId) return false;
      try {
        const draft = await venuesApi.draft(venueId);
        const merged = mergeDocuments(skipDoc.current ?? sending, sending, draft.doc);
        if (!merged) return false;
        const now = latest.current;
        const shown = now === sending ? merged : (mergeDocuments(sending, now, merged) ?? merged);
        revision.current = draft.revision;
        skipDoc.current = draft.doc;
        onRemoteRef.current?.(shown, draft.updatedBy, true);
        return true;
      } catch {
        return false;
      }
    },
    [venueId],
  );

  const flush = useCallback(async (): Promise<void> => {
    if (!venueId || blocked.current) return;
    clearTimeout(timer.current);
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    inFlight.current = true;
    dirty.current = false;
    const sending = latest.current;
    setStatus({ kind: 'saving' });
    try {
      const res = await venuesApi.saveDraft(venueId, revision.current, sending);
      revision.current = res.revision;
      skipDoc.current = sending;
      setStatus(dirty.current ? { kind: 'pending' } : { kind: 'saved', publishedVersion: res.publishedVersion });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'revision_conflict') {
        if (!(await mergeRemote(sending))) {
          blocked.current = true;
          setStatus({ kind: 'conflict', updatedBy: (err.details as { updatedBy?: string | null } | undefined)?.updatedBy ?? null });
        }
      } else {
        const message = err instanceof ApiError && err.code !== 'offline' ? err.message : 'Нет связи — сохраним, когда появится';
        setStatus({ kind: 'error', message });
        timer.current = setTimeout(() => void flush(), RETRY_MS);
      }
    } finally {
      inFlight.current = false;
    }
    if (dirty.current && !blocked.current) void flush();
  }, [venueId, mergeRemote]);

  // Каждая правка — сохранение через паузу.
  useEffect(() => {
    if (!venueId || doc === skipDoc.current || blocked.current) return;
    setStatus((s) => (s.kind === 'saving' ? s : { kind: 'pending' }));
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [doc, venueId, flush]);

  // Уход со страницы или сворачивание на телефоне — сохраняем сразу, а с несохранённым — предупреждаем.
  useEffect(() => {
    if (!venueId) return;
    const unsaved = () => latest.current !== skipDoc.current;
    const onHide = () => {
      if (document.visibilityState === 'hidden' && unsaved()) void flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved()) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(timer.current);
    };
  }, [venueId, flush]);

  // Чужие сохранения: раз в несколько секунд — только номер ревизии; весь документ — когда он вырос
  // и у нас всё сохранено. Вкладка в фоне не спрашивает, при возвращении — спрашивает сразу.
  useEffect(() => {
    if (!venueId) return;
    let stopped = false;
    const clean = () => !inFlight.current && !blocked.current && latest.current === skipDoc.current;
    const check = async () => {
      if (document.visibilityState !== 'visible' || !clean()) return;
      try {
        const remote = await venuesApi.draftRevision(venueId);
        if (stopped || remote.revision <= revision.current || !clean()) return;
        const draft = await venuesApi.draft(venueId);
        if (stopped || !clean()) return;
        revision.current = draft.revision;
        skipDoc.current = draft.doc;
        onRemoteRef.current?.(draft.doc, draft.updatedBy, false);
      } catch {
        // Нет связи — спросим в следующий раз.
      }
    };
    const id = setInterval(() => void check(), SYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [venueId]);

  /** Конфликт: «оставить мою» — сохранить поверх новой ревизии; «взять их» — вернуть документ с сервера. */
  const resolveConflict = useCallback(
    async (keep: 'mine' | 'theirs'): Promise<MapDocument | null> => {
      if (!venueId) return null;
      const draft = await venuesApi.draft(venueId);
      revision.current = draft.revision;
      blocked.current = false;
      if (keep === 'theirs') {
        skipDoc.current = draft.doc;
        setStatus({ kind: 'saved', publishedVersion: null });
        return draft.doc;
      }
      await flush();
      return null;
    },
    [venueId, flush],
  );

  return { status, flush, resolveConflict };
}
