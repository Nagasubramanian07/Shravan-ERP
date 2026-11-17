import { route, send } from '../lib/db.js';

export default route(async (req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  send(res, 200, { ok: true });
});
