-- The API creates these tables automatically on first use.
-- This file is for reference, or if you prefer to run it in the Neon SQL editor.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state (
  id INT PRIMARY KEY,
  data JSONB,
  version INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO app_state (id, data, version) VALUES (1, NULL, 0) ON CONFLICT (id) DO NOTHING;
