const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
function integer(env, key, fallback, min, max) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
function boolean(env, key, fallback = false) {
  if (env[key] === undefined || env[key] === '') return fallback;
  if (!['true', 'false'].includes(env[key])) throw new Error(`Invalid ${key}; use true or false`);
  return env[key] === 'true';
}
function readRuntime(env = process.env) {
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  const production = mode === 'production';
  const secret = env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (production && !secret) throw new Error('SESSION_SECRET is required in production.');
  if (production && (secret.length < 32 || /CHANGE_ME|local-development|dev-secret/i.test(secret))) throw new Error('SESSION_SECRET must be a non-placeholder secret of at least 32 characters in production.');
  if (production && !boolean(env, 'ALLOW_MEMORY_STORE_IN_PRODUCTION')) throw new Error('Production refuses express-session MemoryStore. This demo requires a shared state design before a real production deployment.');
  if (production && boolean(env, 'WHATSAPP_MOCK_SEND')) throw new Error('Production refuses WHATSAPP_MOCK_SEND=true.');
  const origins = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) throw new Error('ALLOWED_ORIGINS must contain exact origins (HTTPS in production).');
  }
  if (production && origins.length === 0) throw new Error('ALLOWED_ORIGINS is required in production.');
  return { mode, production, secret, origins,
    port: integer(env, 'PORT', 3000, 1, 65535), host: env.HOST || '127.0.0.1',
    trustProxy: integer(env, 'TRUST_PROXY_HOPS', 0, 0, 5),
    sessionMs: integer(env, 'SESSION_TTL_MS', 3600000, 1000, 86400000) };
}
function readDatabase(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const mock = boolean(env, 'DB_MOCK');
  if (production && mock) throw new Error('Production cannot start with DB_MOCK=true; mock DB is local demo only.');
  if (mock) return { mock: true };
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(k => !env[k]);
  if (missing.length) throw new Error('Missing database configuration: ' + missing.join(', ') + '. Set DB_MOCK=true only for the local demo.');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(env.DB_HOST.toLowerCase());
  if (production && local && !boolean(env, 'ALLOW_LOCALHOST_DB_IN_PRODUCTION')) throw new Error('Production database host must not be localhost unless ALLOW_LOCALHOST_DB_IN_PRODUCTION=true.');
  const tls = boolean(env, 'DB_TLS', production);
  if (production && !tls) throw new Error('Production requires DB_TLS=true.');
  return { mock: false, options: {
    host: env.DB_HOST, port: integer(env, 'DB_PORT', 3306, 1, 65535), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
    connectionLimit: 5, queueLimit: 20, waitForConnections: true, connectTimeout: 5000,
    ssl: tls ? { rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: readFileSync(env.DB_SSL_CA) } : {}) } : undefined } };
}
module.exports = { readRuntime, readDatabase, integer, boolean };
