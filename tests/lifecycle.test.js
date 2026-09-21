const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const cwd = path.join(__dirname, '..');
const base = { ...process.env, NODE_ENV: 'test', DB_MOCK: 'true', HOST: '127.0.0.1' };
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
test('real HTTP process serves readiness and terminates cleanly on SIGTERM', async () => {
  const port = await freePort(), child = spawn(process.execPath, ['src/server.js'], { cwd, env: { ...base, PORT: String(port) }, stdio: 'pipe' });
  const exit = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  try {
    let ready;
    for (let i = 0; i < 60; i++) {
      try { ready = await fetch(`http://127.0.0.1:${port}/ready`); if (ready.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready?.status).toBe(200); expect(await ready.json()).toEqual({ status: 'ready', database: 'mock' });
    child.kill('SIGTERM'); expect(await exit).toEqual({ code: 0, signal: null });
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
test('missing DB config and refused DB connection exit without silent mock fallback', () => {
  for (const env of [{ DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '' }, { DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'missing', DB_USER: 'test', DB_PASSWORD: 'test' }]) {
    const result = spawnSync(process.execPath, ['src/server.js'], { cwd, env: { ...base, DB_MOCK: 'false', ...env }, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1); expect(result.error).toBeUndefined();
  }
});
test('production proxy produces Secure cookies only over trusted forwarded HTTPS', () => {
  const script = `const app=require('./src/app'); const request=require('supertest');
    (async()=>{const a=await request(app).get('/api/csrf-token'); const b=await request(app).get('/api/csrf-token').set('X-Forwarded-Proto','https'); console.log(JSON.stringify({plain:a.headers['set-cookie']||[],https:b.headers['set-cookie']||[]})); app.locals.dispose(); await require('./src/models/db').close();})().catch(()=>process.exit(1));`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd, encoding: 'utf8', timeout: 10000, env: { ...base, NODE_ENV: 'production', DB_MOCK: 'false', DB_HOST: 'db.example', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test', DB_TLS: 'true', SESSION_SECRET: 'production-test-only-secret-at-least-32-characters', ALLOW_MEMORY_STORE_IN_PRODUCTION: 'true', ALLOWED_ORIGINS: 'https://shop.example', TRUST_PROXY_HOPS: '1', WHATSAPP_MOCK_SEND: 'false' } });
  expect(result.status).toBe(0);
  const cookies = JSON.parse(result.stdout.trim()); expect(cookies.plain).toEqual([]);
  expect(cookies.https[0]).toContain('Secure'); expect(cookies.https[0]).toContain('HttpOnly'); expect(cookies.https[0]).toContain('SameSite=Strict');
});
