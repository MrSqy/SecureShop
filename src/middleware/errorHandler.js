const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const notFoundHandler = (req, res) => res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
function csrfErrorHandler(error, req, res, next) {
  if (error.code !== 'EBADCSRFTOKEN') return next(error);
  res.status(403).json({ error: 'Invalid or missing CSRF token. Request rejected.', code: 'CSRF_INVALID' });
}
function globalErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error instanceof AppError ? error.status : (error.status === 400 || error.status === 413 ? error.status : 500);
  const unavailable = ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code);
  if (unavailable) status = 503;
  logger.error('Request failed', { requestId: req.id, status, code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' });
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  const code = error instanceof AppError ? error.code : (unavailable ? 'SERVICE_UNAVAILABLE' : status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR');
  res.status(status).json({ error: error instanceof AppError ? error.message : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.', code, requestId: req.id,
    ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}), ...(error.details ? { details: error.details } : {}) });
}
module.exports = { notFoundHandler, csrfErrorHandler, globalErrorHandler };
