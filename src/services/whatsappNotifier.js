const logger = require('../utils/logger');

const DEFAULT_GRAPH_API_VERSION = 'v20.0';
const MAX_MESSAGE_LENGTH = 512;

const getConfig = () => ({
  enabled: process.env.WHATSAPP_NOTIFICATIONS_ENABLED === 'true',
  mockSend: process.env.NODE_ENV !== 'production' || process.env.WHATSAPP_MOCK_SEND === 'true',
  apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
});

const isLocalDevelopmentRuntime = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development';
};

const getMissingConfigKeys = (config) => {
  const missing = [];
  if (!config.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  return missing;
};

const getOrderRecipient = () => process.env.WHATSAPP_TO_PHONE_NUMBER || '';

const formatTotal = (totalAmount) => {
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toFixed(2);
};

const limitMessage = (message) => message.length > MAX_MESSAGE_LENGTH
  ? message.slice(0, MAX_MESSAGE_LENGTH)
  : message;

const buildOrderMessage = (order) => {
  const safeOrder = order || {};
  return limitMessage([
    'New order #' + safeOrder.orderId + ' created.',
    'User ID: ' + safeOrder.userId + '.',
    'Total: $' + formatTotal(safeOrder.totalAmount) + '.',
    'Status: ' + (safeOrder.status || 'pending') + '.',
  ].join(' '));
};

const buildOtpMessage = (otpCode) => limitMessage('6 haneli doğrulama kodunuz: ' + otpCode);

const parseMessageId = (responseBody) => {
  if (!responseBody || typeof responseBody !== 'object') return null;
  return responseBody.messages?.[0]?.id || null;
};

const safeErrorMessage = (err) => {
  if (!err) return 'WhatsApp notification failed.';
  if (typeof err === 'string') return err;
  return err.message || 'WhatsApp notification failed.';
};

const postWhatsAppMessage = async ({ to, body, orderId, purpose, otpCode }) => {
  const config = getConfig();

  if (config.mockSend) {
    logger.info('WhatsApp mock send', { to, orderId, purpose });
    if (purpose === 'otp-login' && isLocalDevelopmentRuntime()) {
      logger.warn('LOCAL MOCK WhatsApp OTP code', {
        purpose,
        to,
        otpCode,
      });
    }
    return { enabled: true, sent: true, mocked: true, messageId: 'mocked-whatsapp-message' };
  }

  const missingKeys = getMissingConfigKeys(config);
  if (!to) missingKeys.push('WHATSAPP_TO_PHONE_NUMBER');

  if (missingKeys.length > 0) {
    logger.warn('WhatsApp message skipped: missing configuration', {
      missingKeys,
      orderId,
      purpose,
    });
    return {
      enabled: true,
      sent: false,
      error: 'Missing WhatsApp notification configuration.',
    };
  }

  if (typeof fetch !== 'function') {
    logger.warn('WhatsApp message skipped: fetch is unavailable', { orderId, purpose });
    return {
      enabled: true,
      sent: false,
      error: 'Fetch API is unavailable.',
    };
  }

  const endpoint = 'https://graph.facebook.com/' + encodeURIComponent(config.apiVersion) + '/' + encodeURIComponent(config.phoneNumberId) + '/messages';
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch (err) {
      responseBody = null;
    }

    if (!response.ok) {
      logger.warn('WhatsApp message failed', { status: response.status, orderId, purpose });
      return {
        enabled: true,
        sent: false,
        error: 'WhatsApp API request failed with status ' + response.status + '.',
      };
    }

    const messageId = parseMessageId(responseBody);
    logger.info('WhatsApp message sent', { orderId, messageId, purpose });
    return { enabled: true, sent: true, messageId };
  } catch (err) {
    logger.warn('WhatsApp message failed safely', { orderId, purpose, error: safeErrorMessage(err) });
    return { enabled: true, sent: false, error: safeErrorMessage(err) };
  }
};

const sendOrderNotification = async (order) => {
  if (process.env.WHATSAPP_NOTIFICATIONS_ENABLED !== 'true') {
    return { enabled: false, skipped: true };
  }

  return postWhatsAppMessage({
    to: getOrderRecipient(),
    body: buildOrderMessage(order),
    orderId: order?.orderId,
    purpose: 'order-notification',
  });
};

const sendOtpCode = async (phoneNumber, otpCode) => {
  return postWhatsAppMessage({
    to: phoneNumber,
    body: buildOtpMessage(otpCode),
    purpose: 'otp-login',
    otpCode,
  });
};

module.exports = {
  sendOrderNotification,
  sendOtpCode,
};
