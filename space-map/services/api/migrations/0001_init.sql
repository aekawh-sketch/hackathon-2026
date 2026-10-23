-- Схема К1 (ТЗ 10.1). Геометрия карты — один JSON-документ с ревизией, а не таблица на фигуру.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Храним только хэш токена: утечка таблицы не даёт войти.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE venues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  visibility        text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  published_version integer,
  embed_domains     text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_owner_idx ON venues(owner_id);

CREATE TABLE map_drafts (
  venue_id   uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  revision   integer NOT NULL DEFAULT 1,
  doc        jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Снимок версии лежит в хранилище файлом (versions/<venue>/<n>.json); здесь — учёт.
CREATE TABLE map_versions (
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  sha256     text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, version)
);

CREATE TABLE panoramas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('upload', 'capture')),
  status     text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  width      integer,
  height     integer,
  error      text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX panoramas_venue_idx ON panoramas(venue_id);

-- Серия кадров одной точки: загружается частями, склеивается воркером.
CREATE TABLE captures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'uploading'
              CHECK (status IN ('uploading', 'queued', 'processing', 'ready', 'failed', 'cancelled')),
  stage       text,
  error       text,
  bad_frames  jsonb NOT NULL DEFAULT '[]',
  panorama_id uuid REFERENCES panoramas(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX captures_venue_idx ON captures(venue_id);

CREATE TABLE capture_frames (
  capture_id  uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  frame_id    text NOT NULL CHECK (frame_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  storage_key text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  orientation jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capture_id, frame_id)
);

-- Очередь фоновых задач: воркер берёт задачу через SELECT … FOR UPDATE SKIP LOCKED и продлевает аренду.
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  error       text,
  lease_until timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs(status, created_at) WHERE status IN ('queued', 'running');
