const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../models/db');
const logger = require('../utils/logger');
const { SESSION_COOKIE_NAME } = require('../config/session');
const { sendOtpCode } = require('../services/whatsappNotifier');
const { loginLimiter, otpLimiter, registerLimiter } = require('../middleware/rateLimiter');
const { validateLogin, validateRegister, validateOtpVerify } = require('../middleware/validation');
const { requireAuth } = require('../middleware/requireAuth');
const locks = require('../services/authLockout');
const challenges = require('../services/otpChallenges');
const { AppError } = require('../utils/errors');
const dummyHash = bcrypt.hashSync('Dummy@Password42', 12);
const userView = user => ({ id: user.id, username: user.username, phoneNumber: user.phone_number });
function rejectLocked(res, status, otp = false) {
  res.set('Retry-After', String(status.retryAfter));
  return res.status(429).json({ error: otp ? 'Too many failed verification attempts. Try again later.' : 'Too many failed attempts. Try again later.', code: otp ? 'OTP_LOCKED' : 'LOGIN_LOCKED', retryAfter: status.retryAfter });
}
async function deliver(user, sessionId) {
  const { entry, code } = challenges.reserve(user, sessionId);
  let result;
  try { result = await sendOtpCode(user.phone_number, code); }
  catch { result = { sent: false }; }
  if (!result.sent || !challenges.confirmDelivery(entry)) {
    challenges.remove(entry.id);
    throw new AppError(503, 'OTP_DELIVERY_FAILED', 'Verification code could not be sent.');
  }
  return { otpRequired: true, message: 'Verification code sent.', expiresAt: entry.expiresAt, resendAt: entry.resendAt };
}
router.post('/register', registerLimiter, validateRegister, async (req, res, next) => {
  try {
    const { username, phoneNumber, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = await db.createUser({ username, phoneNumber, passwordHash });
    logger.info('Account created', { userId, requestId: req.id });
    res.status(201).json({ message: 'Account created successfully.' });
  } catch (error) { next(error); }
});
router.post('/login', loginLimiter, validateLogin, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const status = locks.getPasswordLockStatus(username);
    if (status.locked) return rejectLocked(res, status);
    const user = await db.findUserByUsername(username);
    const matched = await bcrypt.compare(password, user?.password_hash || dummyHash);
    if (!user?.is_active || !matched) {
      const failure = locks.recordPasswordFailure(username);
      logger.security('LOGIN_FAILED', { requestId: req.id });
      if (failure.locked) return rejectLocked(res, failure);
      return res.status(401).json({ error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' });
    }
    locks.clearPasswordFailures(username);
    const result = await deliver(user, req.sessionID);
    // Login's new challenge does not carry authentication for a previous account.
    delete req.session.userId; delete req.session.username;
    res.json(result);
  } catch (error) { next(error); }
});
router.post('/resend-otp', otpLimiter, async (req, res, next) => {
  try {
    const entry = challenges.forSession(req.sessionID);
    if (!entry) throw new AppError(401, 'OTP_INVALID', 'Invalid or expired verification code.');
    const status = locks.getOtpLockStatus(entry.username);
    if (status.locked) return rejectLocked(res, status, true);
    const user = await db.findUserById(entry.userId);
    if (!user?.is_active) { challenges.cancelSession(req.sessionID); throw new AppError(401, 'OTP_INVALID', 'Invalid or expired verification code.'); }
    res.json(await deliver(user, req.sessionID));
  } catch (error) { next(error); }
});
router.post('/verify-otp', otpLimiter, validateOtpVerify, async (req, res, next) => {
  try {
    const { username, otpCode } = req.body;
    const status = locks.getOtpLockStatus(username);
    if (status.locked) return rejectLocked(res, status, true);
    const entry = challenges.consume(req.sessionID, username, otpCode);
    if (!entry) {
      if (entry === false) {
        const failure = locks.recordOtpFailure(username);
        if (failure.locked) return rejectLocked(res, failure, true);
      }
      return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
    }
    const user = await db.findUserById(entry.userId);
    if (!user?.is_active) throw new AppError(401, 'OTP_INVALID', 'Invalid or expired verification code.');
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id; req.session.username = user.username;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        locks.clearOtpFailures(username); locks.clearPasswordFailures(username);
        res.json({ message: 'Login successful.', user: userView(user) });
      });
    });
  } catch (error) { next(error); }
});
router.post('/logout', (req, res, next) => {
  challenges.cancelSession(req.sessionID);
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ message: 'Logged out successfully.' });
  });
});
router.get('/me', requireAuth, (req, res) => res.json({ userId: req.user.id, username: req.user.username }));
router._pendingOtps = challenges.pending;
router._OTP_TTL_MS = challenges.OTP_TTL_MS;
router._resetAuthLockouts = () => { locks._resetAuthLockouts(); challenges.reset(); };
module.exports = router;
