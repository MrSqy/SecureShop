require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const cors = require('cors');
const { csrfSync } = require('csrf-sync');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readRuntime } = require('./config/runtime');
const { AppError } = require('./utils/errors');
const { SESSION_COOKIE_NAME } = require('./config/session');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, csrfErrorHandler, globalErrorHandler } = require('./middleware/errorHandler');
const config = readRuntime();
const db = require('./models/db');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.locals.config = config;
app.locals.shuttingDown = false;
app.use((req, res, next) => { req.id = randomUUID(); res.set('X-Request-ID', req.id); next(); });
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"], styleSrc: ["'self'"], styleSrcAttr: ["'none'"],
  imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"],
  upgradeInsecureRequests: config.production ? [] : null,
} }, strictTransportSecurity: config.production ? { maxAge: 31536000, includeSubDomains: true } : false }));
app.use((req, res, next) => cors({
  origin(origin, callback) {
    // Local same-origin development supports a custom port without trusting arbitrary Host headers.
    let local = false;
    if (origin && !config.production) {
      try { const url = new URL(origin); local = url.origin === origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && origin === `${req.protocol}://${req.get('host')}`; } catch {}
    }
    if (!origin || local || config.origins.includes(origin)) callback(null, true);
    else callback(new AppError(403, 'ORIGIN_REJECTED', 'Bu kaynaktan yapılan istek kabul edilmedi.'));
  }, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
})(req, res, next));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.get('/health', (req, res) => res.status(app.locals.shuttingDown ? 503 : 200).json({ status: app.locals.shuttingDown ? 'stopping' : 'alive' }));
app.get('/ready', async (req, res) => {
  try { if (app.locals.shuttingDown) throw new Error('stopping'); await db.ready(); res.json({ status: 'ready', database: db.mode }); }
  catch { res.status(503).json({ status: 'not-ready' }); }
});
app.use(express.static(path.join(__dirname, '../public')));
const store = new session.MemoryStore();
app.locals.sessionStore = store;
const cleanupSessions = setInterval(() => store.all(() => {}), 60000);
cleanupSessions.unref();
app.locals.dispose = () => clearInterval(cleanupSessions);
app.use('/api', apiLimiter, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(session({ name: SESSION_COOKIE_NAME, secret: config.secret, store, resave: false, saveUninitialized: false,
  cookie: { path: '/', httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: config.sessionMs } }));
const { generateToken, csrfSynchronisedProtection } = csrfSync({ size: 32 });
app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: generateToken(req) }));
app.use('/api', csrfSynchronisedProtection);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/checkout', require('./routes/checkout'));
app.use(notFoundHandler);
app.use(csrfErrorHandler);
app.use(globalErrorHandler);
module.exports = app;
