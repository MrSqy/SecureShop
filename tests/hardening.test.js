const request = require('supertest');
const { randomUUID } = require('node:crypto');
const mockCodes = new Map();
jest.mock('../src/services/whatsappNotifier', () => ({
  sendOtpCode: jest.fn(async (phone, code) => { mockCodes.set(phone, code); return { sent: true }; }),
  sendOrderNotification: jest.fn(async () => ({ enabled: false })),
}));
const app = require('../src/app');
const db = require('../src/models/db');
const auth = require('../src/routes/auth');
const notifier = require('../src/services/whatsappNotifier');
const csrf = async agent => (await agent.get('/api/csrf-token').expect(200)).body.csrfToken;
const post = async (agent, path, body = {}, key = randomUUID()) => { const token = await csrf(agent); return agent.post(path).set('X-CSRF-Token', token).set('Idempotency-Key', key).send(body); };
const start = async agent => post(agent, '/api/auth/login', { username: 'ADMIN', password: 'Admin@123!' });
const verify = async (agent, code = mockCodes.get('+905555555555')) => post(agent, '/api/auth/verify-otp', { username: 'admin', otpCode: code });
async function login() { const agent = request.agent(app); expect((await start(agent)).status).toBe(200); expect((await verify(agent)).status).toBe(200); return agent; }
const order = { items: [{ productId: 1, quantity: 1 }], shippingAddress: { street: "O'Connor <b>İstanbul</b>", city: 'İstanbul' } };
beforeEach(() => { jest.restoreAllMocks(); db._resetMockDb(); auth._resetAuthLockouts(); mockCodes.clear(); notifier.sendOtpCode.mockClear(); notifier.sendOrderNotification.mockClear(); });
afterAll(() => app.locals.dispose());

test('OTP cannot cross browser sessions even when the code is known', async () => {
  const first = request.agent(app), second = request.agent(app);
  await start(first);
  expect((await verify(second)).status).toBe(401);
  expect((await verify(first)).status).toBe(200);
});
test('concurrent OTP verification consumes the challenge before any async user lookup', async () => {
  const agent = request.agent(app); await start(agent);
  const token = await csrf(agent), code = mockCodes.get('+905555555555');
  const original = db.findUserById.bind(db);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const checkpoint = new Promise(resolve => { entered = resolve; });
  jest.spyOn(db, 'findUserById').mockImplementationOnce(async id => { entered(); await gate; return original(id); });
  const send = () => agent.post('/api/auth/verify-otp').set('X-CSRF-Token', token).send({ username: 'admin', otpCode: code });
  const first = send().then(r => r);
  await checkpoint;
  const second = await send();
  release();
  expect([second.status, (await first).status]).toEqual([401, 200]);
});
test('OTP resend cooldown, replacement and account-wide send budget', async () => {
  const agent = request.agent(app); await start(agent);
  const oldEntry = [...auth._pendingOtps.values()][0];
  expect((await post(agent, '/api/auth/resend-otp')).status).toBe(429);
  const base = Date.now();
  const clock = jest.spyOn(Date, 'now');
  for (let i = 1; i < 5; i++) { clock.mockReturnValue(base + i * 31000); expect((await post(agent, '/api/auth/resend-otp')).status).toBe(200); }
  expect(auth._pendingOtps.has(oldEntry.id)).toBe(false);
  expect(auth._pendingOtps.size).toBe(1);
  clock.mockReturnValue(base + 155000);
  expect((await start(request.agent(app))).status).toBe(429);
  expect(notifier.sendOtpCode).toHaveBeenCalledTimes(5);
});
test('delivery failure leaves no usable challenge', async () => {
  const agent = request.agent(app);
  notifier.sendOtpCode.mockResolvedValueOnce({ sent: false });
  expect((await start(agent)).status).toBe(503);
  expect(auth._pendingOtps.size).toBe(0);
  expect((await verify(agent, '123456')).status).toBe(401);
});
test('bcrypt limit counts UTF-8 bytes on registration and login', async () => {
  const agent = request.agent(app);
  const password = 'Aa1!' + 'ş'.repeat(35); // 74 bytes, only 39 characters
  expect((await post(agent, '/api/auth/register', { username: 'utf8user', phoneNumber: '+905550001111', password })).status).toBe(400);
  expect((await post(agent, '/api/auth/login', { username: 'admin', password })).status).toBe(400);
});
test('session and CSRF rotate after OTP, old token fails, logout invalidates session', async () => {
  const agent = request.agent(app); await start(agent);
  const oldToken = await csrf(agent);
  const result = await verify(agent);
  expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(result.headers['set-cookie'][0]).toContain('SameSite=Strict');
  await agent.post('/api/auth/logout').set('X-CSRF-Token', oldToken).expect(403);
  expect((await post(agent, '/api/auth/logout')).status).toBe(200);
  await agent.get('/api/auth/me').expect(401);
});
test('revoked account cannot keep using an existing session', async () => {
  const agent = await login();
  jest.spyOn(db, 'findUserById').mockResolvedValueOnce({ id: 1, is_active: 0 });
  await agent.get('/api/checkout/orders').expect(401);
  await agent.get('/api/auth/me').expect(401);
});
test('same key concurrent checkout creates one order and one stock decrement', async () => {
  const agent = await login(), key = randomUUID();
  const token = await csrf(agent);
  const send = () => agent.post('/api/checkout').set('X-CSRF-Token', token).set('Idempotency-Key', key).send(order);
  const results = await Promise.all([send(), send()]);
  expect(results.map(r => r.status).sort()).toEqual([200, 201]);
  expect(results[0].body.orderId).toBe(results[1].body.orderId);
  expect(await db.getOrders(1)).toHaveLength(1); expect((await db.getProduct(1)).stock).toBe(49);
  expect(notifier.sendOrderNotification).toHaveBeenCalledTimes(1);
  expect((await post(agent, '/api/checkout', { ...order, shippingAddress: { street: 'Different street', city: 'İzmir' } }, key)).status).toBe(409);
});
test('connection acquisition failure is a safe response and the process continues', async () => {
  const agent = await login();
  jest.spyOn(db, 'getConnection').mockRejectedValueOnce(Object.assign(new Error('private SQL/password details'), { code: 'ECONNREFUSED' }));
  const failed = await post(agent, '/api/checkout', order);
  expect(failed.status).toBe(503); expect(JSON.stringify(failed.body)).not.toContain('private');
  expect((await post(agent, '/api/checkout', order)).status).toBe(201);
});
test('failure after an item write rolls back all state and releases the connection', async () => {
  const agent = await login(), original = db.getConnection.bind(db);
  const release = jest.fn();
  jest.spyOn(db, 'getConnection').mockImplementationOnce(async () => {
    const conn = await original();
    return { ...conn, decreaseStock: async () => { throw new Error('injected item failure'); }, release: () => { conn.release(); release(); } };
  });
  expect((await post(agent, '/api/checkout', order)).status).toBe(500);
  expect(await db.getOrders(1)).toHaveLength(0); expect((await db.getProduct(1)).stock).toBe(50); expect(release).toHaveBeenCalledTimes(1);
  expect((await post(agent, '/api/checkout', order)).status).toBe(201);
});
test('connection is released before notification; notification failure does not cancel order', async () => {
  const agent = await login(), original = db.getConnection.bind(db); let released = false;
  jest.spyOn(db, 'getConnection').mockImplementationOnce(async () => { const conn = await original(); return { ...conn, release: () => { conn.release(); released = true; } }; });
  notifier.sendOrderNotification.mockImplementationOnce(async () => { expect(released).toBe(true); throw new Error('network'); });
  const response = await post(agent, '/api/checkout', order); expect(response.status).toBe(201);
  expect((await db.getOrder(response.body.orderId, 1)).shipping_address).toEqual(order.shippingAddress);
});
test('money uses cents, aggregate retains existing stock-based rule and rejects overflow', async () => {
  const agent = await login();
  const id = await db.createProduct({ name: 'Penny', description: '', price: '0.10', stock: 500, categoryId: 1 });
  const response = await post(agent, '/api/checkout', { ...order, items: [{ productId: id, quantity: 51 }, { productId: id, quantity: 52 }] });
  expect(response.status).toBe(201); expect(response.body.totalAmount).toBe(10.3);
  const expensive = await db.createProduct({ name: 'Limit', description: '', price: '99999999.99', stock: 2, categoryId: 1 });
  expect((await post(agent, '/api/checkout', { ...order, items: [{ productId: expensive, quantity: 2 }] })).status).toBe(400);
});
test('API product insert validates fields, persists and is admin-only', async () => {
  const agent = await login();
  const product = { name: "O'Connor monitor", description: '', price: '1.23', stock: 1, categoryId: 1 };
  const created = await post(agent, '/api/products', product); expect(created.status).toBe(201);
  expect((await agent.get('/api/products/' + created.body.id)).body.name).toBe(product.name);
  for (const price of [-1, 0, '1.234', {}]) expect((await post(agent, '/api/products', { ...product, price })).status).toBe(400);
  expect((await post(request.agent(app), '/api/products', product)).status).toBe(401);
  jest.spyOn(db, 'findUserById').mockResolvedValueOnce({ id: 1, is_active: 1, role: 'customer' });
  expect((await post(agent, '/api/products', product)).status).toBe(403);
});
test('API 404, readiness failure and malformed JSON remain structured', async () => {
  expect((await request(app).get('/api/missing').expect(404)).body.code).toBe('NOT_FOUND');
  await request(app).get('/health').expect(200); await request(app).get('/ready').expect(200);
  jest.spyOn(db, 'ready').mockRejectedValueOnce(new Error('secret database failure'));
  expect((await request(app).get('/ready').expect(503)).body).toEqual({ status: 'not-ready' });
  await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
});
test('CSP disallows inline code, local same origin accepts arbitrary port, other origin rejects', async () => {
  const response = await request(app).get('/').expect(200);
  expect(response.headers['content-security-policy']).not.toContain('unsafe-inline');
  await request(app).get('/api/products').set('Host', '127.0.0.1:3217').set('Origin', 'http://127.0.0.1:3217').expect(200);
  await request(app).get('/api/products').set('Origin', 'https://evil.example').expect(403);
});

test('a late obsolete OTP delivery cannot confirm or remove a replacement challenge', () => {
  const challenges = require('../src/services/otpChallenges');
  const first = challenges.reserve({ id: 1, username: 'First', phone_number: '+905550000001' }, 'same-session');
  const second = challenges.reserve({ id: 2, username: 'Second', phone_number: '+905550000002' }, 'same-session');
  expect(challenges.confirmDelivery(first.entry)).toBe(false);
  challenges.remove(first.entry.id);
  expect(challenges.confirmDelivery(second.entry)).toBe(true);
  expect(challenges.consume('same-session', 'second', second.code).userId).toBe(2);
  expect(challenges.consume('same-session', 'second', second.code)).toBeNull();
});
