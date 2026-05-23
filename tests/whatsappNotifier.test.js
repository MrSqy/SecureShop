const WHATSAPP_ENV_KEYS = [
  'WHATSAPP_NOTIFICATIONS_ENABLED',
  'WHATSAPP_GRAPH_API_VERSION',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TO_PHONE_NUMBER',
  'WHATSAPP_MOCK_SEND',
];

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

const sampleOrder = {
  orderId: 123,
  userId: 4,
  totalAmount: 2099.95,
  status: 'pending',
};

const resetWhatsAppEnv = () => {
  for (const key of WHATSAPP_ENV_KEYS) delete process.env[key];
};

const loadNotifier = () => {
  jest.resetModules();
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    security: jest.fn(),
  };
  jest.doMock('../src/utils/logger', () => logger);
  const notifier = require('../src/services/whatsappNotifier');
  return { ...notifier, logger };
};

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetWhatsAppEnv();
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('whatsappNotifier', () => {
  test('order notifications disabled returns skipped result', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
    const { sendOrderNotification } = loadNotifier();

    await expect(sendOrderNotification(sampleOrder)).resolves.toEqual({ enabled: false, skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('order notifications enabled but missing config fails safely', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    const { sendOrderNotification, logger } = loadNotifier();

    const result = await sendOrderNotification(sampleOrder);

    expect(result).toEqual({ enabled: true, sent: false, error: 'Missing WhatsApp notification configuration.' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'WhatsApp message skipped: missing configuration',
      expect.objectContaining({
        missingKeys: expect.arrayContaining(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TO_PHONE_NUMBER']),
        orderId: 123,
        purpose: 'order-notification',
      })
    );
  });

  test('order notifications enabled with mocked fetch success sends correct URL headers and payload', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v20.0';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_TO_PHONE_NUMBER = '15551234567';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.abc123' }] }) });
    const { sendOrderNotification } = loadNotifier();

    const result = await sendOrderNotification(sampleOrder);

    expect(result).toEqual({ enabled: true, sent: true, messageId: 'wamid.abc123' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/1234567890/messages');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ Authorization: 'Bearer secret-access-token', 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '15551234567',
      type: 'text',
      text: { preview_url: false, body: 'New order #123 created. User ID: 4. Total: $2099.95. Status: pending.' },
    });
  });

  test('token appears only in Authorization header', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'very-sensitive-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id';
    process.env.WHATSAPP_TO_PHONE_NUMBER = '15551234567';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.secure' }] }) });
    const { sendOrderNotification, logger } = loadNotifier();

    const result = await sendOrderNotification(sampleOrder);
    const [url, options] = global.fetch.mock.calls[0];

    expect(options.headers.Authorization).toBe('Bearer very-sensitive-token');
    expect(url).not.toContain('very-sensitive-token');
    expect(options.body).not.toContain('very-sensitive-token');
    expect(JSON.stringify(result)).not.toContain('very-sensitive-token');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('very-sensitive-token');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('very-sensitive-token');
  });

  test('mocked fetch failure returns sent false and does not throw', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_TO_PHONE_NUMBER = '15551234567';
    global.fetch.mockRejectedValue(new Error('network down'));
    const { sendOrderNotification } = loadNotifier();

    await expect(sendOrderNotification(sampleOrder)).resolves.toEqual({ enabled: true, sent: false, error: 'network down' });
  });

  test('HTTP failure returns sent false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_TO_PHONE_NUMBER = '15551234567';
    global.fetch.mockResolvedValue({ ok: false, status: 400, json: jest.fn().mockResolvedValue({ error: { message: 'bad request' } }) });
    const { sendOrderNotification } = loadNotifier();

    await expect(sendOrderNotification(sampleOrder)).resolves.toEqual({
      enabled: true,
      sent: false,
      error: 'WhatsApp API request failed with status 400.',
    });
  });

  test('sendOtpCode uses mock mode in test without real network', async () => {
    process.env.NODE_ENV = 'test';
    const { sendOtpCode } = loadNotifier();

    const result = await sendOtpCode('+905555555555', '241414');

    expect(result).toEqual({ enabled: true, sent: true, mocked: true, messageId: 'mocked-whatsapp-message' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sendOtpCode logs OTP code in development mock mode', async () => {
    process.env.NODE_ENV = 'development';
    const { sendOtpCode, logger } = loadNotifier();

    await sendOtpCode('+905555555555', '241414');

    expect(logger.warn).toHaveBeenCalledWith('LOCAL MOCK WhatsApp OTP code', {
      purpose: 'otp-login',
      to: '+905555555555',
      otpCode: '241414',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sendOtpCode does not log OTP code in production mock mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_MOCK_SEND = 'true';
    const { sendOtpCode, logger } = loadNotifier();

    await sendOtpCode('+905555555555', '241414');

    expect(logger.warn).not.toHaveBeenCalledWith('LOCAL MOCK WhatsApp OTP code', expect.anything());
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('241414');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('241414');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sendOtpCode sends required Turkish OTP wording in production payload', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.otp' }] }) });
    const { sendOtpCode } = loadNotifier();

    const result = await sendOtpCode('+905555555555', '241414');

    expect(result).toEqual({ enabled: true, sent: true, messageId: 'wamid.otp' });
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '+905555555555',
      type: 'text',
      text: { preview_url: false, body: '6 haneli doğrulama kodunuz: 241414' },
    });
  });

  test('sendOtpCode never includes password wording', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.otp' }] }) });
    const { sendOtpCode } = loadNotifier();

    await sendOtpCode('+905555555555', '241414');
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.stringify(JSON.parse(options.body)).toLowerCase()).not.toContain('password');
  });

  test('sendOtpCode missing production config fails safely without fetch', async () => {
    process.env.NODE_ENV = 'production';
    const { sendOtpCode } = loadNotifier();

    const result = await sendOtpCode('+905555555555', '241414');

    expect(result).toEqual({ enabled: true, sent: false, error: 'Missing WhatsApp notification configuration.' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
