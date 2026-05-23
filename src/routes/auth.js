/**
 * auth.js — Kimlik Doğrulama Route'ları
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../models/db');
const logger = require('../utils/logger');
const { SESSION_COOKIE_NAME } = require('../config/session');
const { sendOtpCode } = require('../services/whatsappNotifier');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');
const { validateLogin, validateRegister, validateOtpVerify } = require('../middleware/validation');
const {
  getPasswordLockStatus,
  recordPasswordFailure,
  clearPasswordFailures,
  getOtpLockStatus,
  recordOtpFailure,
  clearOtpFailures,
  _resetAuthLockouts,
} = require('../services/authLockout');

const LOCKED_PASSWORD_ERROR = 'Too many failed attempts. Try again later.';
const LOCKED_OTP_ERROR = 'Too many failed verification attempts. Try again later.';

const router = express.Router();
const OTP_TTL_MS = 5 * 60 * 1000;
const pendingOtps = new Map();

const generateOtpCode = () => String(Math.floor(100000 + Math.random() * 900000));

const buildUserResponse = (user) => ({
  id: user.id,
  username: user.username,
  phoneNumber: user.phoneNumber || user.phone_number,
});

const createAuthenticatedSession = (req, user, next, res) => {
  req.session.regenerate((err) => {
    if (err) return next(err);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.loginTime = Date.now();

    logger.info('User logged in after OTP verification', { userId: user.id, ip: req.ip });
    return res.json({
      message: 'Login successful.',
      user: buildUserResponse(user),
    });
  });
};

router.post('/register', registerLimiter, validateRegister, async (req, res, next) => {
  try {
    const { username, phoneNumber, password } = req.body;

    const [existing] = await db.execute(
      'SELECT id FROM users WHERE username = ? OR phone_number = ?',
      [username, phoneNumber]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Registration failed. Please try different credentials.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await db.execute(
      'INSERT INTO users (username, phone_number, password_hash, created_at) VALUES (?, ?, ?, NOW())',
      [username, phoneNumber, passwordHash]
    );

    logger.info('New user registered', { userId: result.insertId, ip: req.ip });
    res.status(201).json({ message: 'Account created successfully.' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, validateLogin, async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const lockStatus = getPasswordLockStatus(username);
    if (lockStatus.locked) {
      logger.security('LOGIN_LOCKED', { username, ip: req.ip, retryAfter: lockStatus.retryAfter });
      return res.status(429).json({ error: LOCKED_PASSWORD_ERROR, retryAfter: lockStatus.retryAfter });
    }

    const [rows] = await db.execute(
      'SELECT id, username, phone_number, password_hash, is_active FROM users WHERE username = ?',
      [username]
    );

    const dummyHash = '$2a$12$8JpqaA51i2Yq7fbAvY6O4e6A2Ep77ZLy1C14dShbTMbprjA6v6/bK';
    const storedHash = rows.length > 0 ? rows[0].password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, storedHash);

    if (rows.length === 0 || !passwordMatch || !rows[0].is_active) {
      logger.security('LOGIN_FAILED', { username, ip: req.ip });
      const failure = recordPasswordFailure(username);
      if (failure.locked) {
        logger.security('LOGIN_LOCKOUT_TRIGGERED', { username, ip: req.ip, retryAfter: failure.retryAfter });
        return res.status(429).json({ error: LOCKED_PASSWORD_ERROR, retryAfter: failure.retryAfter });
      }
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    clearPasswordFailures(username);

    const user = rows[0];
    const otpCode = generateOtpCode();
    const otpHash = await bcrypt.hash(otpCode, 10);

    pendingOtps.set(user.username, {
      user: {
        id: user.id,
        username: user.username,
        phoneNumber: user.phone_number,
      },
      otpHash,
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    const sendResult = await sendOtpCode(user.phone_number, otpCode);
    if (!sendResult.sent) {
      pendingOtps.delete(user.username);
      logger.warn('OTP delivery failed', { userId: user.id, username: user.username });
      return res.status(503).json({ error: 'Verification code could not be sent.' });
    }

    logger.info('OTP verification code sent', { userId: user.id, username: user.username });
    return res.json({ otpRequired: true, message: 'Verification code sent.' });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-otp', loginLimiter, validateOtpVerify, async (req, res, next) => {
  try {
    const { username, otpCode } = req.body;

    const lockStatus = getOtpLockStatus(username);
    if (lockStatus.locked) {
      logger.security('OTP_LOCKED', { username, ip: req.ip, retryAfter: lockStatus.retryAfter });
      return res.status(429).json({ error: LOCKED_OTP_ERROR, retryAfter: lockStatus.retryAfter });
    }

    const pending = pendingOtps.get(username);

    if (!pending) {
      return res.status(401).json({ error: 'Invalid or expired verification code.' });
    }

    if (Date.now() > pending.expiresAt) {
      pendingOtps.delete(username);
      logger.security('OTP_EXPIRED', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid or expired verification code.' });
    }

    const otpMatch = await bcrypt.compare(otpCode, pending.otpHash);
    if (!otpMatch) {
      logger.security('OTP_FAILED', { username, ip: req.ip });
      const failure = recordOtpFailure(username);
      if (failure.locked) {
        logger.security('OTP_LOCKOUT_TRIGGERED', { username, ip: req.ip, retryAfter: failure.retryAfter });
        return res.status(429).json({ error: LOCKED_OTP_ERROR, retryAfter: failure.retryAfter });
      }
      return res.status(401).json({ error: 'Invalid or expired verification code.' });
    }

    pendingOtps.delete(username);
    clearOtpFailures(username);
    clearPasswordFailures(username);
    return createAuthenticatedSession(req, pending.user, next, res);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  const userId = req.session?.userId;

  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE_NAME);
    logger.info('User logged out', { userId, ip: req.ip });
    res.json({ message: 'Logged out successfully.' });
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  res.json({
    userId: req.session.userId,
    username: req.session.username,
  });
});

router._pendingOtps = pendingOtps;
router._OTP_TTL_MS = OTP_TTL_MS;
router._resetAuthLockouts = _resetAuthLockouts;

module.exports = router;
