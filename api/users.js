import { currentUser, db, route, send } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

// Admin only. GET lists users. POST creates a user or resets a password and role.
export default route(async (req, res) => {
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in' });
  if (me.r !== 'admin') return send(res, 403, { error: 'Admin only' });
  const q = db();

  if (req.method === 'GET') {
    const rows = await q`SELECT username, role, created_at FROM users ORDER BY id`;
    return send(res, 200, { users: rows });
  }

  if (req.method === 'POST') {
    const { username, password, role } = req.body || {};
    const name = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(name)) {
      return send(res, 400, { error: 'Username: 3 to 30 letters, digits, dot, dash or underscore.' });
    }
    if (String(password || '').length < 8) {
      return send(res, 400, { error: 'Password must be at least 8 characters.' });
    }
    const r = role === 'admin' ? 'admin' : 'user';
    if (name === me.u && r !== 'admin') {
      return send(res, 400, { error: 'You cannot remove your own admin role.' });
    }
    await q`INSERT INTO users (username, password_hash, role)
            VALUES (${name}, ${hashPassword(String(password))}, ${r})
            ON CONFLICT (username)
            DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`;
    return send(res, 200, { ok: true });
  }

  send(res, 405, { error: 'Method not allowed' });
});
