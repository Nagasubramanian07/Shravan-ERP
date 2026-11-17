import { currentUser, db, route, send } from '../lib/db.js';

// The whole ERP data set is stored as one JSON document with a version number.
// A save sends the version it last saw. If someone else saved in between, the
// server answers 409 with the latest data so nothing is silently overwritten.
export default route(async (req, res) => {
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in' });
  const q = db();

  if (req.method === 'GET') {
    const r = await q`SELECT data, version FROM app_state WHERE id = 1`;
    return send(res, 200, { data: r[0].data, version: r[0].version });
  }

  if (req.method === 'PUT') {
    const { data, version } = req.body || {};
    if (!data || !Array.isArray(data.items) || !Number.isInteger(version)) {
      return send(res, 400, { error: 'Bad request' });
    }
    const r = await q`UPDATE app_state
                      SET data = ${JSON.stringify(data)}::jsonb,
                          version = version + 1, updated_at = now(), updated_by = ${me.u}
                      WHERE id = 1 AND version = ${version}
                      RETURNING version`;
    if (!r.length) {
      const c = await q`SELECT data, version FROM app_state WHERE id = 1`;
      return send(res, 409, { error: 'Changed by someone else', data: c[0].data, version: c[0].version });
    }
    return send(res, 200, { version: r[0].version });
  }

  send(res, 405, { error: 'Method not allowed' });
});
