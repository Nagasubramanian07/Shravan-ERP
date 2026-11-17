import { currentUser, route, send } from '../lib/db.js';

export default route(async (req, res) => {
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in' });
  send(res, 200, { user: me.u, role: me.r });
});
