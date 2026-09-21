/**
 * authLockout.js — Progressive brute-force lockout for login and OTP
 *
 * In-memory tracking is acceptable for this local demo project.
 * For multi-instance production deployments, replace these in-memory
 * maps with a Redis or DB-backed store so lockout state is shared.
 */

const PASSWORD_FAILURE_THRESHOLD = 5;
const OTP_FAILURE_THRESHOLD = 3;
const LOCK_DURATIONS_MS = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  30 * 60 * 1000,
];

const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10000;
const passwordState = new Map();
const otpState = new Map();

const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const getLockDurationMs = (lockCount) => {
  const idx = Math.min(Math.max(lockCount, 1), LOCK_DURATIONS_MS.length) - 1;
  return LOCK_DURATIONS_MS[idx];
};

const readStatus = (stateMap, key) => {
  cleanup();
  const entry = stateMap.get(key);
  if (!entry || !entry.lockedUntil) return { locked: false };
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) {
    entry.lockedUntil = 0;
    entry.failures = 0;
    return { locked: false };
  }
  return { locked: true, retryAfter: Math.max(1, Math.ceil(remaining / 1000)) };
};

const recordFailure = (stateMap, key, threshold) => {
  cleanup();
  if (!stateMap.has(key) && stateMap.size >= MAX_ENTRIES) return { locked: true, retryAfter: 60 };
  const entry = stateMap.get(key) || { failures: 0, lockCount: 0, lockedUntil: 0 };
  entry.updatedAt = Date.now();
  entry.failures = (entry.failures || 0) + 1;
  if (entry.failures >= threshold) {
    entry.lockCount = (entry.lockCount || 0) + 1;
    const duration = getLockDurationMs(entry.lockCount);
    entry.lockedUntil = Date.now() + duration;
    entry.failures = 0;
    stateMap.set(key, entry);
    return { locked: true, retryAfter: Math.max(1, Math.ceil(duration / 1000)) };
  }
  stateMap.set(key, entry);
  return { locked: false };
};

function cleanup() {
  for (const map of [passwordState, otpState]) {
    for (const [key, entry] of map) if (Date.now() - entry.updatedAt > STATE_TTL_MS) map.delete(key);
  }
}
const cleanupTimer = setInterval(cleanup, 60000);
cleanupTimer.unref();

const getPasswordLockStatus = (username) => readStatus(passwordState, normalizeKey(username));
const recordPasswordFailure = (username) => recordFailure(passwordState, normalizeKey(username), PASSWORD_FAILURE_THRESHOLD);
const clearPasswordFailures = (username) => { passwordState.delete(normalizeKey(username)); };

const getOtpLockStatus = (username) => readStatus(otpState, normalizeKey(username));
const recordOtpFailure = (username) => recordFailure(otpState, normalizeKey(username), OTP_FAILURE_THRESHOLD);
const clearOtpFailures = (username) => { otpState.delete(normalizeKey(username)); };

const _resetAuthLockouts = () => {
  passwordState.clear();
  otpState.clear();
};

module.exports = {
  PASSWORD_FAILURE_THRESHOLD,
  OTP_FAILURE_THRESHOLD,
  LOCK_DURATIONS_MS,
  getPasswordLockStatus,
  recordPasswordFailure,
  clearPasswordFailures,
  getOtpLockStatus,
  recordOtpFailure,
  clearOtpFailures,
  _resetAuthLockouts,
  _passwordState: passwordState,
  _otpState: otpState,
};
