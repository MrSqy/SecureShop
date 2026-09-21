const request = require('supertest');
const mysql = require('mysql2/promise');
const { randomUUID } = require('node:crypto');
const mockCodes = new Map();
jest.mock('../../src/services/whatsappNotifier', () => ({ sendOtpCode: jest.fn(async (phone, code) => { mockCodes.set(phone, code); return { sent: true }; }), sendOrderNotification: jest.fn(async () => ({ enabled: false })) }));
const db = require('../../src/models/db');
const app = require('../../src/app');
const { readDatabase } = require('../../src/config/runtime');
const { initializeDatabase } = require('../../scripts/db-init');
const { dataContract } = require('../data-contract');
let sql;
beforeAll(async () => { expect(db.mode).toBe('mysql'); sql = await mysql.createConnection(readDatabase().options); });
afterAll(async () => { await sql.end(); await db.close(); app.locals.dispose(); });
describe('real MySQL data contract', () => dataContract(() => db));
const csrf = async agent => (await agent.get('/api/csrf-token').expect(200)).body.csrfToken;
const post = async (agent, path, body, key = randomUUID()) => { const token = await csrf(agent); return agent.post(path).set('X-CSRF-Token', token).set('Idempotency-Key', key).send(body); };
async function customer(username, phoneNumber) {
  const agent = request.agent(app);
  expect((await post(agent, '/api/auth/register', { username, phoneNumber, password: 'Strong@123' })).status).toBe(201);
  expect((await post(agent, '/api/auth/login', { username, password: 'Strong@123' })).status).toBe(200);
  expect((await post(agent, '/api/auth/verify-otp', { username, otpCode: mockCodes.get(phoneNumber) })).status).toBe(200);
  return agent;
}
test('initialization refuses existing tables without deleting data', async () => {
  await expect(initializeDatabase(readDatabase().options)).rejects.toThrow('not empty');
  expect((await db.getProduct(1)).stock).toBe(50);
});
test('SQL constraints reject invalid prices, stock and item quantities', async () => {
  for (const statement of ['UPDATE products SET price = 0 WHERE id = 1', 'UPDATE products SET stock = -1 WHERE id = 1', 'UPDATE products SET stock = 1000001 WHERE id = 1', 'UPDATE products SET name = "" WHERE id = 1', 'UPDATE order_items SET quantity = 0']) {
    await expect(sql.query(statement)).rejects.toBeDefined();
  }
});
test('parallel duplicate HTTP requests commit one order; reused key with altered data conflicts', async () => {
  const agent = await customer('MysqlBuyer', '+905550002222'), key = randomUUID(), token = await csrf(agent);
  const body = { items: [{ productId: 1, quantity: 1 }], shippingAddress: { street: "O'Connor 27\" <b>Ev</b>", city: 'İzmir' } };
  const send = () => agent.post('/api/checkout').set('X-CSRF-Token', token).set('Idempotency-Key', key).send(body);
  const responses = await Promise.all([send(), send(), send()]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
  expect(new Set(responses.map(r => r.body.orderId)).size).toBe(1);
  expect((await db.getProduct(1)).stock).toBe(49);
  const details = await agent.get('/api/checkout/orders/' + responses[0].body.orderId).expect(200);
  expect(details.body.shipping_address).toEqual(body.shippingAddress);
  expect((await post(agent, '/api/checkout', { ...body, items: [{ productId: 2, quantity: 1 }] }, key)).status).toBe(409);
});
test('two distinct buyers racing for the last stock never oversell', async () => {
  const id = await db.createProduct({ name: 'Last stock', description: '', price: '0.10', stock: 1, categoryId: 1 });
  const first = await customer('StockA', '+905550003333'), second = await customer('StockB', '+905550004444');
  const body = { items: [{ productId: id, quantity: 1 }], shippingAddress: { street: 'Test street', city: 'Ankara' } };
  const responses = await Promise.all([post(first, '/api/checkout', body), post(second, '/api/checkout', body)]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
  expect((await db.getProduct(id)).stock).toBe(0);
  const winner = responses[0].status === 201 ? first : second, loser = winner === first ? second : first;
  const idOrder = responses.find(r => r.status === 201).body.orderId;
  await loser.get('/api/checkout/orders/' + idOrder).expect(404);
  expect((await winner.get('/api/checkout/orders/' + idOrder)).body.total_amount).toBe(0.1);
});
test('real transaction rolls back a late failure and the same key can then succeed', async () => {
  const agent = await customer('RollbackBuyer', '+905550005555'), key = randomUUID();
  const body = { items: [{ productId: 2, quantity: 2 }], shippingAddress: { street: 'Rollback street', city: 'Ankara' } };
  const before = (await db.getProduct(2)).stock, original = db.getConnection.bind(db);
  const spy = jest.spyOn(db, 'getConnection').mockImplementationOnce(async () => {
    const conn = await original();
    return { ...conn, decreaseStock: async (...args) => { await conn.decreaseStock(...args); throw new Error('Injected after SQL writes'); } };
  });
  expect((await post(agent, '/api/checkout', body, key)).status).toBe(500);
  spy.mockRestore();
  expect((await db.getProduct(2)).stock).toBe(before);
  expect((await agent.get('/api/checkout/orders')).body).toHaveLength(0);
  expect((await post(agent, '/api/checkout', body, key)).status).toBe(201);
  expect((await db.getProduct(2)).stock).toBe(before - 2);
});
