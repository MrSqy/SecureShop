/**
 * app.js — Ana Uygulama Giriş Noktası
 *
 * Güvenlik Katmanları (yukarıdan aşağıya):
 * 1. Helmet     — HTTP Security Headers (XSS, Clickjacking, MIME Sniffing)
 * 2. Rate Limit — DDoS / Brute Force koruması
 * 3. CORS       — Cross-Origin Resource Sharing kısıtlaması
 * 4. Session    — Güvenli cookie konfigürasyonu
 * 5. CSRF       — Synchronizer Token Pattern
 * 6. Validation — Input sanitization (her route'da ayrıca)
 * 7. Error      — Güvenli hata yönetimi (stack trace gizleme)
 */
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const logger = require('./utils/logger');
const { SESSION_COOKIE_NAME } = require('./config/session');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, csrfErrorHandler, globalErrorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const MIN_SESSION_SECRET_LENGTH = 32;
const LOCAL_SESSION_SECRET = 'local-development-session-secret-change-me-32';

const getSessionSecret = () => {
  const secret = process.env.SESSION_SECRET;

  if (isProduction) {
    if (!secret) {
      throw new Error('SESSION_SECRET is required in production.');
    }
    if (secret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production.');
    }
    return secret;
  }

  if (!secret) {
    logger.warn('SESSION_SECRET missing; using local development fallback.');
    return LOCAL_SESSION_SECRET;
  }

  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    logger.warn('SESSION_SECRET is shorter than 32 characters; acceptable only for local development/test.');
  }

  return secret;
};

const enforceProductionSessionStore = () => {
  if (!isProduction) return;

  if (process.env.ALLOW_MEMORY_STORE_IN_PRODUCTION === 'true') {
    logger.warn('ALLOW_MEMORY_STORE_IN_PRODUCTION=true; using express-session MemoryStore in production for short-lived demo only.');
    return;
  }

  throw new Error('Production refuses express-session MemoryStore. Configure a production session store or set ALLOW_MEMORY_STORE_IN_PRODUCTION=true only for a short-lived demo.');
};

if (isProduction) {
  app.set('trust proxy', 1);
}

// ─── Log Dizini ────────────────────────────────────────────────────────────
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ─── 1. Helmet — Security Headers ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],               // Inline script izin verildi (dev/demo kolaylığı için)
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],              // Flash/plugin yasak
    },
  },
  hsts: isProduction ? {
    maxAge: 31536000,                     // 1 yıl HTTPS zorunlu (prod)
    includeSubDomains: true,
    preload: true,
  } : {
    maxAge: 0,                            // Geliştirme/yerel ortamda HTTPS zorlamasını sıfırla
    includeSubDomains: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ─── 2. CORS ───────────────────────────────────────────────────────────────
const allowedOrigins = isProduction
  ? ['https://yourdomain.com']            // Production: sadece kendi domain
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.security('CORS_BLOCKED', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,                      // Cookie'lere izin ver
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
}));

// ─── 3. Body Parser ────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // Büyük payload saldırısı koruması
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ─── 4. Session Konfigürasyonu ─────────────────────────────────────────────
const sessionSecret = getSessionSecret();
enforceProductionSessionStore();

app.use(session({
  secret: sessionSecret,
  name: SESSION_COOKIE_NAME,              // Default 'connect.sid' yerine generic isim
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                       // JavaScript'ten erişim engeli (XSS koruması)
    secure: isProduction, // HTTPS zorunlu (production)
    sameSite: 'strict',                   // CSRF koruması (ek katman)
    maxAge: 60 * 60 * 1000,              // 1 saat session süresi
  },
}));

// ─── 5. CSRF Koruması ─────────────────────────────────────────────────────
// Not: API-only kullanımda double-submit cookie pattern tercih edilebilir
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
  },
});

// CSRF token endpoint'i (frontend bunu çekip her POST isteğine ekler)
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ─── 6. Static Files ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── 7. Health Check (ALB için) ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── 8. API Route'ları ────────────────────────────────────────────────────
// Route'lar session guardları kurulduktan sonra yüklenir.
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const checkoutRouter = require('./routes/checkout');

// Auth route'ları da CSRF ile korunur; token endpoint'i önce tanımlıdır.
app.use('/api/auth', csrfProtection, authRouter);

// Diğer API'lar CSRF + rate limit ile korunur
app.use('/api/products', csrfProtection, productsRouter);
app.use('/api/checkout', csrfProtection, checkoutRouter);

// ─── 9. Frontend SPA (catch-all) ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── 10. Error Handlers (sıra önemli!) ────────────────────────────────────
app.use(csrfErrorHandler);
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── Server Başlat ────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`, {
      environment: process.env.NODE_ENV,
      port: PORT,
    });
    console.log('\nSecure E-Commerce Server');
    console.log(`   URL: http://localhost:${PORT}`);
    console.log(`   ENV: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

// Beklenmedik hataları yakala (process çökmesini önle)
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
  process.exit(1);
});

module.exports = app;
