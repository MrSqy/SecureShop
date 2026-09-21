const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-more-than-32-chars';
process.env.DB_MOCK = 'true';

const mockSentOtpByPhone = new Map();

jest.mock('../src/services/whatsappNotifier', () => ({
  sendOtpCode: jest.fn(async (phoneNumber, otpCode) => {
    mockSentOtpByPhone.set(phoneNumber, otpCode);
    return { enabled: true, sent: true, mocked: true, messageId: 'otp-test' };
  }),
  sendOrderNotification: jest.fn(async () => ({ enabled: false, skipped: true })),
}));

const app = require('../src/app');
const db = require('../src/models/db');
const authRouter = require('../src/routes/auth');
const { sendOrderNotification } = require('../src/services/whatsappNotifier');

const getCsrf = async (agent) => {
  const response = await agent.get('/api/csrf-token').expect(200);
  return response.body.csrfToken;
};

const postWithCsrf = async (agent, url, body) => {
  const csrfToken = await getCsrf(agent);
  return agent.post(url).set('Idempotency-Key', require('node:crypto').randomUUID()).set('X-CSRF-Token', csrfToken).send(body);
};

const registerAndLogin = async (username, phoneNumber) => {
  const agent = request.agent(app);
  expect((await postWithCsrf(agent, '/api/auth/register', {
    username,
    phoneNumber,
    password: 'Strong@123',
  })).status).toBe(201);
  expect((await postWithCsrf(agent, '/api/auth/login', {
    username,
    password: 'Strong@123',
  })).status).toBe(200);
  const otpCode = mockSentOtpByPhone.get(phoneNumber);
  expect((await postWithCsrf(agent, '/api/auth/verify-otp', {
    username,
    otpCode,
  })).status).toBe(200);
  return agent;
};

const validOrder = {
  items: [{ productId: 1, quantity: 1 }],
  shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
};

beforeEach(() => {
  db._resetMockDb();
  authRouter._pendingOtps.clear();
  authRouter._resetAuthLockouts();
  mockSentOtpByPhone.clear();
  jest.clearAllMocks();
  sendOrderNotification.mockResolvedValue({ enabled: false, skipped: true });
});

describe('checkout security regression tests', () => {
  test('checkout with CSRF but without login returns 401', async () => {
    const agent = request.agent(app);
    const response = await postWithCsrf(agent, '/api/checkout', validOrder);
    expect(response.status).toBe(401);
  });

  test('checkout without CSRF returns 403', async () => {
    const agent = await registerAndLogin('noccsrf', '+905556000001');
    await agent.post('/api/checkout').send(validOrder).expect(403);
  });

  test('invalid checkout body returns validation error', async () => {
    const agent = await registerAndLogin('invalidcheckout', '+905556000002');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [],
      shippingAddress: { street: 'x', city: 'x' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  test('authenticated checkout creates order', async () => {
    const agent = await registerAndLogin('buyerone', '+905556000003');
    const response = await postWithCsrf(agent, '/api/checkout', validOrder);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ orderId: 1, totalAmount: 1299.99, message: 'Order placed successfully.' });
  });

  test('created order appears for correct user', async () => {
    const agent = await registerAndLogin('ownorders', '+905556000004');
    expect((await postWithCsrf(agent, '/api/checkout', validOrder)).status).toBe(201);
    const response = await agent.get('/api/checkout/orders').expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(1);
  });

  test('created order does not appear for another user', async () => {
    const first = await registerAndLogin('firstbuyer', '+905556000005');
    expect((await postWithCsrf(first, '/api/checkout', validOrder)).status).toBe(201);
    const second = await registerAndLogin('secondbuyer', '+905556000006');
    const response = await second.get('/api/checkout/orders').expect(200);
    expect(response.body).toEqual([]);
  });

  test('quantity less than or equal to zero fails validation', async () => {
    const agent = await registerAndLogin('zeroqty', '+905556000007');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 1, quantity: 0 }],
      shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
    });
    expect(response.status).toBe(400);
  });

  test('non-existing productId fails', async () => {
    const agent = await registerAndLogin('missingproduct', '+905556000008');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 999, quantity: 1 }],
      shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Product 999 not found.');
  });

  test('quantity greater than stock fails', async () => {
    const agent = await registerAndLogin('stockfail', '+905556000009');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 4, quantity: 99 }],
      shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Insufficient stock for product 4.');
  });

  test('unsafe-looking shipping address and city do not crash', async () => {
    const agent = await registerAndLogin('safeaddress', '+905556000010');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 2, quantity: 1 }],
      shippingAddress: { street: '<script>alert(1)</script> Secure Street', city: '<b>Izmir</b>' },
    });
    expect(response.status).toBe(201);
  });

  test('duplicate productId entries are aggregated before stock validation', async () => {
    const agent = await registerAndLogin('dupfail', '+905556000011');
    const response = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 4, quantity: 40 }, { productId: 4, quantity: 40 }],
      shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Insufficient stock for product 4.');
  });

  test('valid duplicate productId entries are stored as one combined order item', async () => {
    const agent = await registerAndLogin('dupsuccess', '+905556000012');
    const create = await postWithCsrf(agent, '/api/checkout', {
      items: [{ productId: 4, quantity: 1 }, { productId: 4, quantity: 2 }],
      shippingAddress: { street: '123 Secure Street', city: 'Istanbul' },
    });
    expect(create.status).toBe(201);
    const detail = await agent.get('/api/checkout/orders/' + create.body.orderId).expect(200);
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0].quantity).toBe(3);
  });

  test('order notification disabled does not break checkout', async () => {
    const agent = await registerAndLogin('notifydisabled', '+905556000013');
    sendOrderNotification.mockResolvedValueOnce({ enabled: false, skipped: true });
    const response = await postWithCsrf(agent, '/api/checkout', validOrder);
    expect(response.status).toBe(201);
    expect(sendOrderNotification).toHaveBeenCalledWith({ orderId: 1, userId: expect.any(Number), totalAmount: 1299.99, status: 'pending' });
  });

  test('order notification failure does not rollback order', async () => {
    const agent = await registerAndLogin('notifyfail', '+905556000014');
    sendOrderNotification.mockRejectedValueOnce(new Error('network down'));
    const create = await postWithCsrf(agent, '/api/checkout', validOrder);
    expect(create.status).toBe(201);
    const orders = await agent.get('/api/checkout/orders').expect(200);
    expect(orders.body).toHaveLength(1);
  });

  test('unauthenticated order detail request returns 401', async () => {
    const anon = request.agent(app);
    const response = await anon.get('/api/checkout/orders/1');
    expect(response.status).toBe(401);
  });

  test('authenticated user can view own order details', async () => {
    const agent = await registerAndLogin('ownerdetail', '+905556000015');
    const create = await postWithCsrf(agent, '/api/checkout', validOrder);
    expect(create.status).toBe(201);
    const detail = await agent.get('/api/checkout/orders/' + create.body.orderId).expect(200);
    expect(detail.body.id).toBe(create.body.orderId);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.total_amount).toBe(1299.99);
    expect(detail.body.created_at).toBeDefined();
    expect(Array.isArray(detail.body.items)).toBe(true);
    expect(detail.body.items[0]).toEqual(expect.objectContaining({
      product_id: 1,
      product_name: expect.any(String),
      quantity: 1,
      unit_price: expect.any(Number),
    }));
  });

  test('another user cannot view someone elses order details (IDOR)', async () => {
    const owner = await registerAndLogin('idorowner', '+905556000016');
    const create = await postWithCsrf(owner, '/api/checkout', validOrder);
    expect(create.status).toBe(201);
    const orderId = create.body.orderId;

    const attacker = await registerAndLogin('idorattacker', '+905556000017');
    const response = await attacker.get('/api/checkout/orders/' + orderId);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Order not found.');
  });

  test('non-existing order id fails safely', async () => {
    const agent = await registerAndLogin('missingorder', '+905556000018');
    const response = await agent.get('/api/checkout/orders/9999');
    expect(response.status).toBe(404);
  });

  test('invalid order id parameter fails validation', async () => {
    const agent = await registerAndLogin('badorderid', '+905556000019');
    const response = await agent.get('/api/checkout/orders/notanumber');
    expect(response.status).toBe(400);
  });
});

describe('product catalog richness', () => {
  test('product list returns the expanded demo catalog', async () => {
    const response = await request.agent(app).get('/api/products').expect(200);
    expect(Array.isArray(response.body.products)).toBe(true);
    expect(response.body.products.length).toBeGreaterThanOrEqual(15);
  });

  test('product search still returns safe JSON', async () => {
    const response = await request.agent(app).get('/api/products?q=keyboard').expect(200);
    expect(Array.isArray(response.body.products)).toBe(true);
    const names = response.body.products.map(p => p.name.toLowerCase());
    expect(names.some(n => n.includes('keyboard'))).toBe(true);
  });
});
