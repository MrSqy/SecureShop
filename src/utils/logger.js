const winston = require('winston');
const path = require('node:path');
const fs = require('node:fs');
const hidden = /password|secret|token|authorization|cookie|otp|phone|address|body|hash/i;
function redact(value, depth = 0) {
  if (depth > 8) return '[depth limit]';
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = hidden.test(key) ? '[REDACTED]' : redact(item, depth + 1);
    return out;
  }
  return value;
}
const sanitize = winston.format(info => Object.assign(info, redact(info)));
const transports = [];
if (process.env.LOG_DIR) {
  const directory = path.resolve(process.env.LOG_DIR);
  fs.mkdirSync(directory, { recursive: true });
  transports.push(new winston.transports.File({ filename: path.join(directory, 'app.log'), maxsize: 5242880, maxFiles: 3 }));
}
if (process.env.NODE_ENV !== 'test') transports.push(new winston.transports.Console());
// A silent transport keeps test imports free of files and console noise.
if (!transports.length) transports.push(new winston.transports.Console({ silent: true }));
const logger = winston.createLogger({ level: 'info', format: winston.format.combine(sanitize(), winston.format.timestamp(), winston.format.json()), transports });
logger.security = (event, meta = {}) => logger.warn('SECURITY::' + event, redact(meta));
logger.localOtp = (phone, code) => {
  if ((process.env.NODE_ENV || 'development') === 'development') {
    // Deliberately console only: never route the development code into file transports.
    process.stderr.write(`[YEREL DEMO] Sonu ${String(phone).slice(-4)} olan numara için kod: ${code}\n`);
  }
};
logger.redact = redact;
module.exports = logger;
