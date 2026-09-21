const rateLimit = require('express-rate-limit');
function createLimiter(max, windowMs, code = 'RATE_LIMIT_EXCEEDED') {
  return rateLimit({ max, windowMs, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter)).status(429).json({ error: 'Çok fazla istek. Lütfen bekleyin.', code, retryAfter });
    } });
}
const production = process.env.NODE_ENV === 'production';
const loginLimiter = createLimiter(production ? 10 : 100, production ? 900000 : 60000);
const otpLimiter = createLimiter(production ? 30 : 300, production ? 900000 : 60000);
const registerLimiter = createLimiter(production ? 3 : 100, production ? 3600000 : 60000);
const apiLimiter = createLimiter(process.env.NODE_ENV === 'test' ? 5000 : 300, 900000);
module.exports = { loginLimiter, otpLimiter, registerLimiter, apiLimiter, createLimiter };
