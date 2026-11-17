import { db, route, secret, send } from '../lib/db.js';
import { verifyPassword, signSession } from '../lib/auth.js';

export default route(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const { username, password } = req.body || {};
  const rows = await db()`SELECT username, password_hash, role FROM users
                          WHERE username = ${String(username || '').trim().toLowerCase()}`;
  const u = rows[0];
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    await new Promise((r) => setTimeout(r, 500));
    return send(res, 401, { error: 'Wrong username or password.' });
  }
  const token = signSession({ u: u.username, r: u.role, exp: Date.now() + 7 * 864e5 }, secret());
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
  send(res, 200, { user: u.username, role: u.role });
});
