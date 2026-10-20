-- DAOD database schema
-- Run via: docker exec -i daod-postgres psql -U daod -d daod < src/lib/db/setup.sql

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  clerk_id   TEXT UNIQUE,
  tier       TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── usage ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  scene_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)
);

-- Index for fast daily lookups
CREATE INDEX IF NOT EXISTS usage_user_date_idx ON usage (user_id, date);

-- ─── scene_cache ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scene_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_slug  TEXT UNIQUE NOT NULL,
  topic_label TEXT NOT NULL,
  scene_json  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scene_cache_slug_idx ON scene_cache (topic_slug);

-- ─── ip_usage (for unauthenticated rate limiting) ─────────────────────────────
CREATE TABLE IF NOT EXISTS ip_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address  TEXT NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  scene_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ip_address, date)
);

CREATE INDEX IF NOT EXISTS ip_usage_ip_date_idx ON ip_usage (ip_address, date);
