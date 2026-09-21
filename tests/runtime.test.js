const { readRuntime, readDatabase } = require('../src/config/runtime');
const { toCents, fromCents } = require('../src/utils/money');
const { redact } = require('../src/utils/logger');
const { createLimiter } = require('../src/middleware/rateLimiter');
const request = require('supertest');
const express = require('express');
const production = { NODE_ENV: 'production', SESSION_SECRET: 'a-unique-long-test-only-session-secret', ALLOW_MEMORY_STORE_IN_PRODUCTION: 'true', ALLOWED_ORIGINS: 'https://shop.example' };
test('production guards reject missing secrets, implicit MemoryStore, insecure origins and mock delivery', () => {
  for (const change of [{ SESSION_SECRET: '' }, { SESSION_SECRET: 'CHANGE_ME_' + 'a'.repeat(32) }, { ALLOW_MEMORY_STORE_IN_PRODUCTION: 'false' }, { ALLOWED_ORIGINS: 'http://shop.example' }, { ALLOWED_ORIGINS: '' }, { WHATSAPP_MOCK_SEND: 'true' }]) expect(() => readRuntime({ ...production, ...change })).toThrow();
  expect(readRuntime(production)).toMatchObject({ production: true, trustProxy: 0, sessionMs: 3600000 });
});
test('invalid numeric and boolean settings fail early', () => {
  for (const change of [{ PORT: '0' }, { TRUST_PROXY_HOPS: 'all' }, { SESSION_TTL_MS: '-1' }, { NODE_ENV: 'prod' }, { ALLOWED_ORIGINS: 'https://shop.example/path' }]) expect(() => readRuntime(change)).toThrow();
  expect(() => readDatabase({ DB_MOCK: 'yes' })).toThrow();
});
test('DB configuration is explicit: localhost is real MySQL and never fallback mock', () => {
  expect(() => readDatabase({})).toThrow('Missing database');
  expect(readDatabase({ DB_MOCK: 'true' })).toEqual({ mock: true });
  const env = { NODE_ENV: 'development', DB_HOST: 'localhost', DB_USER: 'local', DB_PASSWORD: 'password', DB_NAME: 'shop' };
  expect(readDatabase(env).mock).toBe(false);
  expect(() => readDatabase({ ...env, NODE_ENV: 'production' })).toThrow('localhost');
  expect(() => readDatabase({ ...env, NODE_ENV: 'production', DB_MOCK: 'true' })).toThrow('mock DB');
  expect(() => readDatabase({ ...env, NODE_ENV: 'production', DB_HOST: 'db.example', DB_TLS: 'false' })).toThrow('DB_TLS');
  expect(readDatabase({ ...env, NODE_ENV: 'production', DB_HOST: 'db.example' }).options.ssl.rejectUnauthorized).toBe(true);
});
test('cent conversion rejects rounding, exponent, negative and overflow values', () => {
  expect(toCents('0.10') * 3).toBe(30); expect(fromCents(30)).toBe('0.30');
  for (const price of ['1.005', '1e2', '-1', '100000000', Infinity, null]) expect(() => toCents(price)).toThrow();
});
test('nested sensitive fields are removed from structured logs', () => {
  expect(redact({ requestId: 'safe', nested: { password: 'private', otpCode: '123456', address: 'home', phone_number: 'phone', token: 'secret' } })).toEqual({ requestId: 'safe', nested: { password: '[REDACTED]', otpCode: '[REDACTED]', address: '[REDACTED]', phone_number: '[REDACTED]', token: '[REDACTED]' } });
});
test('IP limiter returns 429, code, and retry timing', async () => {
  const app = express(); app.use(createLimiter(2, 60000, 'TEST_LIMIT')); app.get('/', (req, res) => res.json({ ok: true }));
  await request(app).get('/').expect(200); await request(app).get('/').expect(200);
  const response = await request(app).get('/').expect(429);
  expect(response.body.code).toBe('TEST_LIMIT'); expect(response.body.retryAfter).toBeGreaterThan(0);
});

test('a failed SQL rollback discards the connection instead of returning an open transaction to the pool', async () => {
  const mysql = require('mysql2/promise');
  const raw = { rollback: jest.fn().mockRejectedValue(new Error('connection failed')), destroy: jest.fn(), release: jest.fn() };
  const spy = jest.spyOn(mysql, 'createPool').mockReturnValue({ getConnection: async () => raw, end: async () => {} });
  try {
    const { createMysqlDatabase } = require('../src/models/mysql');
    const connection = await createMysqlDatabase({}).getConnection();
    await expect(connection.rollback()).rejects.toThrow('connection failed'); connection.release();
    expect(raw.destroy).toHaveBeenCalledTimes(1); expect(raw.release).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
