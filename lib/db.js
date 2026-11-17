import { neon } from '@neondatabase/serverless';
import { hashPassword, readSession, parseCookies } from './auth.js';

let sql;
let ready;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return sql || (sql = neon(process.env.DATABASE_URL));
}

export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16 or more characters)');
  return s;
}

// Creates the tables on first use and creates the first admin user
// from ADMIN_PASSWORD when the users table is empty.
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const q = db();
      await q`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await q`CREATE TABLE IF NOT EXISTS app_state (
        id INT PRIMARY KEY,
        data JSONB,
        version INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by TEXT
      )`;
      await q`INSERT INTO app_state (id, data, version) VALUES (1, NULL, 0) ON CONFLICT (id) DO NOTHING`;
      const n = await q`SELECT count(*)::int AS n FROM users`;
      if (n[0].n === 0 && process.env.ADMIN_PASSWORD) {
        await q`INSERT INTO users (username, password_hash, role)
                VALUES ('admin', ${hashPassword(process.env.ADMIN_PASSWORD)}, 'admin')`;
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export function currentUser(req) {
  return readSession(parseCookies(req.headers.cookie).sid, secret());
}

export function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(obj);
}

export function route(handler) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await handler(req, res);
    } catch (e) {
      console.error(e);
      send(res, 500, { error: 'Server error. Check the function logs in Vercel.' });
    }
  };
}
