const db = require('../models/db');
async function requireAuth(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    const user = await db.findUserById(req.session.userId);
    if (!user?.is_active) {
      return req.session.destroy(error => error ? next(error) : res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }));
    }
    req.user = user;
    next();
  } catch (error) { next(error); }
}
module.exports = { requireAuth };
