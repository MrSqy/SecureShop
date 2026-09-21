const { randomInt, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { AppError } = require('../utils/errors');
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10000;
const pending = new Map();
const bySession = new Map();
const sendState = new Map();
const pepper = randomBytes(32);
const keyFor = username => username.toLowerCase();
const digest = (id, code) => createHmac('sha256', pepper).update(id + ':' + code).digest();
function remove(id) {
  const entry = pending.get(id);
  if (entry && bySession.get(entry.sessionId) === id) bySession.delete(entry.sessionId);
  pending.delete(id);
}
function cleanup() {
  const now = Date.now();
  for (const [id, entry] of pending) if (entry.expiresAt <= now) remove(id);
  for (const [key, entry] of sendState) if (entry.until <= now) sendState.delete(key);
}
const timer = setInterval(cleanup, 60000);
timer.unref();
function cancelSession(sessionId) { remove(bySession.get(sessionId)); }
function reserve(user, sessionId) {
  cleanup();
  const key = keyFor(user.username);
  const now = Date.now();
  const state = sendState.get(key) || { count: 0, until: now + WINDOW_MS, next: 0 };
  if (state.next > now || state.count >= 5) {
    const until = state.count >= 5 ? state.until : state.next;
    const error = new AppError(429, 'OTP_SEND_LIMIT', 'Doğrulama kodu için lütfen bekleyin.');
    error.retryAfter = Math.ceil((until - now) / 1000);
    throw error;
  }
  if (pending.size >= MAX_ENTRIES || (!sendState.has(key) && sendState.size >= MAX_ENTRIES)) throw new AppError(503, 'AUTH_BUSY', 'Giriş hizmeti meşgul.');
  state.count += 1; state.next = now + RESEND_MS; sendState.set(key, state);
  cancelSession(sessionId);
  const id = randomBytes(32).toString('hex');
  const code = String(randomInt(100000, 1000000));
  const entry = { id, sessionId, userId: user.id, username: user.username, phoneNumber: user.phone_number,
    hash: digest(id, code), expiresAt: now + OTP_TTL_MS, resendAt: state.next, delivered: false };
  pending.set(id, entry); bySession.set(sessionId, id);
  return { entry, code };
}
function forSession(sessionId, username) {
  cleanup();
  const entry = pending.get(bySession.get(sessionId));
  return entry && (!username || keyFor(entry.username) === keyFor(username)) ? entry : null;
}
function confirmDelivery(entry) {
  if (pending.get(entry.id) !== entry || entry.expiresAt <= Date.now()) return false;
  entry.delivered = true;
  return true;
}
function consume(sessionId, username, code) {
  const entry = forSession(sessionId, username);
  if (!entry?.delivered) return null;
  if (!timingSafeEqual(entry.hash, digest(entry.id, code))) return false;
  // No await between the check and deletion: at most one request can claim it.
  remove(entry.id);
  return entry;
}
function reset() { pending.clear(); bySession.clear(); sendState.clear(); }
module.exports = { OTP_TTL_MS, RESEND_MS, reserve, forSession, consume, confirmDelivery, remove, cancelSession, cleanup, reset, pending };
