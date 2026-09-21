const app = require('./app');
const db = require('./models/db');
const logger = require('./utils/logger');
const { host, port } = app.locals.config;
let server, stopping = false;
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true; app.locals.shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  try { await db.close(); } catch { exitCode = 1; }
  app.locals.dispose(); clearTimeout(deadline);
  process.exit(exitCode);
}
async function start() {
  await db.ready();
  server = app.listen(port, host, () => logger.info(`SecureShop: http://${host}:${port}`, { database: db.mode }));
  server.on('error', () => { logger.error('HTTP listener failed'); void shutdown(1); });
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('uncaughtException', () => { logger.error('Unexpected process error'); void shutdown(1); });
process.on('unhandledRejection', () => { logger.error('Unexpected promise rejection'); void shutdown(1); });
start().catch(() => { logger.error('Database is not ready; server was not started.'); void shutdown(1); });
