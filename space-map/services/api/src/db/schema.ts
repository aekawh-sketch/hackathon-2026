// Таблицы для запросов Drizzle. Источник правды по схеме — SQL в migrations/.
import type { MapDocument } from '@space-map/map-core';
import { bigserial, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isGuest: boolean('is_guest').notNull().default(false),
  /** admin — видит и правит все площадки; user — только свои. */
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('public'),
  publishedVersion: integer('published_version'),
  embedDomains: text('embed_domains').array().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mapDrafts = pgTable('map_drafts', {
  venueId: uuid('venue_id').primaryKey(),
  revision: integer('revision').notNull().default(1),
  doc: jsonb('doc').$type<MapDocument>().notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mapVersions = pgTable(
  'map_versions',
  {
    venueId: uuid('venue_id').notNull(),
    version: integer('version').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.venueId, t.version] })],
);

export const panoramas = pgTable('panoramas', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull(),
  source: text('source', { enum: ['upload', 'capture'] }).notNull(),
  status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
  width: integer('width'),
  height: integer('height'),
  error: text('error'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export type CaptureStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled';

export const captures = pgTable('captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull(),
  status: text('status').$type<CaptureStatus>().notNull().default('uploading'),
  stage: text('stage'),
  error: text('error'),
  badFrames: jsonb('bad_frames').$type<string[]>().notNull().default([]),
  panoramaId: uuid('panorama_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const captureFrames = pgTable(
  'capture_frames',
  {
    captureId: uuid('capture_id').notNull(),
    frameId: text('frame_id').notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    orientation: jsonb('orientation').$type<number[] | null>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.captureId, t.frameId] })],
);

export const jobs = pgTable('jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
