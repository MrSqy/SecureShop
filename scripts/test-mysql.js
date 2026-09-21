const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const { initializeDatabase } = require('./db-init');
const { readDatabase } = require('../src/config/runtime');
const name = 'secureshop-test-' + randomUUID();
let ownsContainer = false;
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function cleanup() {
  if (ownsContainer) { ownsContainer = false; try { docker('rm', '-f', name); } catch { console.error('Remove the test container manually:', name); } }
}
async function waitForDatabase(options) {
  for (let i = 0; i < 90; i++) {
    let connection;
    try { connection = await mysql.createConnection({ ...options, connectTimeout: 1000 }); await connection.query('SELECT 1'); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    finally { if (connection) await connection.end(); }
  }
  throw new Error('MySQL did not become ready within 90 seconds.');
}
async function main() {
  let env = { ...process.env, NODE_ENV: 'test', DB_MOCK: 'false', DB_TLS: 'false' };
  if (process.env.MYSQL_TEST_EXISTING !== 'true') {
    docker('run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::3306', '--env', 'MYSQL_DATABASE=secureshop_test', '--env', 'MYSQL_USER=shoptest', '--env', 'MYSQL_PASSWORD=test-only-password', '--env', 'MYSQL_ROOT_PASSWORD=test-only-root-password', '--tmpfs', '/var/lib/mysql:rw', 'mysql:8.4');
    ownsContainer = true;
    env = { ...env, DB_HOST: '127.0.0.1', DB_PORT: docker('port', name, '3306/tcp').split(':').pop(), DB_NAME: 'secureshop_test', DB_USER: 'shoptest', DB_PASSWORD: 'test-only-password' };
  }
  if (!env.DB_NAME?.endsWith('_test')) throw new Error('Integration database name must end in _test.');
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('Integration database must be local.');
  const { options } = readDatabase(env);
  await waitForDatabase(options);
  await initializeDatabase(options); // Refuses any nonempty existing database.
  const config = { testEnvironment: 'node', testMatch: ['**/tests/mysql/**/*.test.js'], setupFiles: ['<rootDir>/tests/setup.js'], testTimeout: 20000 };
  const child = spawn(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--config', JSON.stringify(config)], { env, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
