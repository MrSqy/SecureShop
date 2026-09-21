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
const { sendOtpCode } = require('../src/services/whatsappNotifier');

const getCsrf = async (agent) => {
  const response = await agent.get('/api/csrf-token').expect(200);
  return response.body.csrfToken;
};

const registerUser = async (agent, user) => {
  const csrfToken = await getCsrf(agent);
  return agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', csrfToken)
    .send(user);
};

const startLogin = async (agent, username, password = 'Strong@123') => {
  const csrfToken = await getCsrf(agent);
  return agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ username, password });
};

const verifyOtp = async (agent, username, otpCode) => {
  const csrfToken = await getCsrf(agent);
  return agent
    .post('/api/auth/verify-otp')
    .set('X-CSRF-Token', csrfToken)
    .send({ username, otpCode });
};

beforeEach(() => {
  db._resetMockDb();
  authRouter._pendingOtps.clear();
  authRouter._resetAuthLockouts();
  mockSentOtpByPhone.clear();
  jest.clearAllMocks();
});

describe('security and OTP auth flow', () => {
  test('GET /api/csrf-token returns token', async () => {
    const agent = request.agent(app);
    const response = await agent.get('/api/csrf-token').expect(200);
    expect(response.body.csrfToken).toEqual(expect.any(String));
  });

  test('POST /api/auth/logout without CSRF returns 403', async () => {
    await request.agent(app).post('/api/auth/logout').expect(403);
  });

  test('GET /api/auth/me returns 401 when unauthenticated', async () => {
    await request.agent(app).get('/api/auth/me').expect(401);
  });

  test('register with phone number succeeds', async () => {
    const agent = request.agent(app);
    const response = await registerUser(agent, {
      username: 'baran',
      phoneNumber: '+905551111111',
      password: 'Strong@123',
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: 'Account created successfully.' });
  });

  test('register with invalid phone number fails', async () => {
    const agent = request.agent(app);
    const response = await registerUser(agent, {
      username: 'badphone',
      phoneNumber: '05551111111',
      password: 'Strong@123',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  test('duplicate phone number registration fails safely', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'firstuser', phoneNumber: '+905552222222', password: 'Strong@123' })).status).toBe(201);
    const response = await registerUser(agent, { username: 'seconduser', phoneNumber: '+905552222222', password: 'Strong@123' });
    expect(response.status).toBe(409);
  });

  test('login step 1 with correct username and password returns otpRequired true', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otpuser', phoneNumber: '+905553333333', password: 'Strong@123' })).status).toBe(201);
    const response = await startLogin(agent, 'otpuser');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ otpRequired: true, message: 'Verification code sent.', expiresAt: expect.any(Number), resendAt: expect.any(Number) }));
    expect(sendOtpCode).toHaveBeenCalledWith('+905553333333', expect.stringMatching(/^\d{6}$/));
    expect(response.body).not.toHaveProperty('otpCode');
    expect(response.body).not.toHaveProperty('code');
  });

  test('/api/auth/me after login step 1 still returns 401', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'halfuser', phoneNumber: '+905554444444', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'halfuser')).status).toBe(200);
    await agent.get('/api/auth/me').expect(401);
  });

  test('wrong login credentials fail', async () => {
    const agent = request.agent(app);
    const response = await startLogin(agent, 'admin', 'Wrong@123');
    expect(response.status).toBe(401);
  });

  test('OTP verification with wrong code fails', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'wrongotp', phoneNumber: '+905555111111', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'wrongotp')).status).toBe(200);
    const response = await verifyOtp(agent, 'wrongotp', '000000');
    expect(response.status).toBe(401);
  });

  test('OTP verification with correct code creates session', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'goodotp', phoneNumber: '+905555222222', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'goodotp')).status).toBe(200);
    const code = mockSentOtpByPhone.get('+905555222222');
    const response = await verifyOtp(agent, 'goodotp', code);
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: expect.any(Number), username: 'goodotp', phoneNumber: '+905555222222' });
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.username).toBe('goodotp');
  });

  test('OTP cannot be reused', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'reuseotp', phoneNumber: '+905555333333', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'reuseotp')).status).toBe(200);
    const code = mockSentOtpByPhone.get('+905555333333');
    expect((await verifyOtp(agent, 'reuseotp', code)).status).toBe(200);
    const secondTry = await verifyOtp(agent, 'reuseotp', code);
    expect(secondTry.status).toBe(401);
  });

  test('expired OTP fails', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'expiredotp', phoneNumber: '+905555444444', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'expiredotp')).status).toBe(200);
    const code = mockSentOtpByPhone.get('+905555444444');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + authRouter._OTP_TTL_MS + 1000);
    const response = await verifyOtp(agent, 'expiredotp', code);
    nowSpy.mockRestore();
    expect(response.status).toBe(401);
  });
});

describe('progressive brute-force lockout', () => {
  test('5 wrong password attempts trigger lockout with retryAfter', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'lockuser', phoneNumber: '+905557000001', password: 'Strong@123' })).status).toBe(201);
    for (let i = 0; i < 4; i++) {
      const response = await startLogin(agent, 'lockuser', 'Wrong@123');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials.');
    }
    const fifth = await startLogin(agent, 'lockuser', 'Wrong@123');
    expect(fifth.status).toBe(429);
    expect(fifth.body.error).toBe('Too many failed attempts. Try again later.');
    expect(fifth.body.retryAfter).toBeGreaterThan(0);
    expect(fifth.body.retryAfter).toBeLessThanOrEqual(30);
  });

  test('locked password login keeps returning 429 with correct password too', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'lockblock', phoneNumber: '+905557000002', password: 'Strong@123' })).status).toBe(201);
    for (let i = 0; i < 5; i++) {
      await startLogin(agent, 'lockblock', 'Wrong@123');
    }
    const correct = await startLogin(agent, 'lockblock', 'Strong@123');
    expect(correct.status).toBe(429);
    expect(correct.body.retryAfter).toBeGreaterThan(0);
  });

  test('successful password verification resets failed password attempts', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'pwreset', phoneNumber: '+905557000003', password: 'Strong@123' })).status).toBe(201);
    for (let i = 0; i < 4; i++) {
      const response = await startLogin(agent, 'pwreset', 'Wrong@123');
      expect(response.status).toBe(401);
    }
    const ok = await startLogin(agent, 'pwreset', 'Strong@123');
    expect(ok.status).toBe(200);
    expect(ok.body.otpRequired).toBe(true);
    for (let i = 0; i < 4; i++) {
      const response = await startLogin(agent, 'pwreset', 'Wrong@123');
      expect(response.status).toBe(401);
    }
  });

  test('password lockout expires after the lock window', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'pwexpire', phoneNumber: '+905557000004', password: 'Strong@123' })).status).toBe(201);
    for (let i = 0; i < 5; i++) {
      await startLogin(agent, 'pwexpire', 'Wrong@123');
    }
    expect((await startLogin(agent, 'pwexpire', 'Strong@123')).status).toBe(429);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 1000);
    const response = await startLogin(agent, 'pwexpire', 'Strong@123');
    nowSpy.mockRestore();
    expect(response.status).toBe(200);
    expect(response.body.otpRequired).toBe(true);
  });

  test('3 wrong OTP attempts trigger lockout with retryAfter', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otplock', phoneNumber: '+905557000005', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'otplock')).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const response = await verifyOtp(agent, 'otplock', '000000');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid or expired verification code.');
    }
    const third = await verifyOtp(agent, 'otplock', '000000');
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('Too many failed verification attempts. Try again later.');
    expect(third.body.retryAfter).toBeGreaterThan(0);
  });

  test('locked OTP verification rejects even the correct code', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otpblock', phoneNumber: '+905557000006', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'otpblock')).status).toBe(200);
    const correctCode = mockSentOtpByPhone.get('+905557000006');
    for (let i = 0; i < 3; i++) {
      await verifyOtp(agent, 'otpblock', '000000');
    }
    const response = await verifyOtp(agent, 'otpblock', correctCode);
    expect(response.status).toBe(429);
    expect(response.body.retryAfter).toBeGreaterThan(0);
  });

  test('correct OTP after wrong attempts (below threshold) still works', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otprecover', phoneNumber: '+905557000007', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'otprecover')).status).toBe(200);
    const correctCode = mockSentOtpByPhone.get('+905557000007');
    expect((await verifyOtp(agent, 'otprecover', '000000')).status).toBe(401);
    expect((await verifyOtp(agent, 'otprecover', '000001')).status).toBe(401);
    const response = await verifyOtp(agent, 'otprecover', correctCode);
    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe('otprecover');
  });

  test('successful OTP clears OTP failure state for next login', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otpclear', phoneNumber: '+905557000008', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'otpclear')).status).toBe(200);
    expect((await verifyOtp(agent, 'otpclear', '000000')).status).toBe(401);
    expect((await verifyOtp(agent, 'otpclear', mockSentOtpByPhone.get('+905557000008'))).status).toBe(200);

    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    expect((await startLogin(agent, 'otpclear')).status).toBe(200);
    clock.mockRestore();
    for (let i = 0; i < 2; i++) {
      expect((await verifyOtp(agent, 'otpclear', '000000')).status).toBe(401);
    }
  });

  test('password lockout response never contains the password', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'pwleak', phoneNumber: '+905557000009', password: 'Strong@123' })).status).toBe(201);
    for (let i = 0; i < 5; i++) {
      const response = await startLogin(agent, 'pwleak', 'SuperSecretGuess!1');
      expect(JSON.stringify(response.body)).not.toContain('SuperSecretGuess');
    }
  });

  test('OTP lockout response never exposes OTP value', async () => {
    const agent = request.agent(app);
    expect((await registerUser(agent, { username: 'otpleak', phoneNumber: '+905557000010', password: 'Strong@123' })).status).toBe(201);
    expect((await startLogin(agent, 'otpleak')).status).toBe(200);
    const correctCode = mockSentOtpByPhone.get('+905557000010');
    for (let i = 0; i < 3; i++) {
      const response = await verifyOtp(agent, 'otpleak', '000000');
      expect(JSON.stringify(response.body)).not.toContain(correctCode);
    }
  });
});
