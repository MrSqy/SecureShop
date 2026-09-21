const router = require('express').Router();
const { createHash } = require('node:crypto');
const db = require('../models/db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/requireAuth');
const { validateOrder, validateIdParam } = require('../middleware/validation');
const { sendOrderNotification } = require('../services/whatsappNotifier');
const { AppError } = require('../utils/errors');
const { MAX_CENTS, toCents, fromCents } = require('../utils/money');
function aggregateOrderItems(items) {
  const map = new Map();
  for (const item of items) map.set(Number(item.productId), (map.get(Number(item.productId)) || 0) + Number(item.quantity));
  return Array.from(map, ([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId - b.productId);
}
router.use(requireAuth);
router.post('/', validateOrder, async (req, res, next) => {
  let conn, transaction = false, result, replay = false;
  try {
    const items = aggregateOrderItems(req.body.items);
    const shippingAddress = { street: req.body.shippingAddress.street, city: req.body.shippingAddress.city };
    const hash = createHash('sha256').update(JSON.stringify({ items, shippingAddress })).digest('hex');
    conn = await db.getConnection();
    await conn.beginTransaction(); transaction = true;
    if (!await conn.lockUser(req.user.id)) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
    const previous = await conn.findOrderByKey(req.user.id, req.get('Idempotency-Key'));
    if (previous) {
      if (previous.request_hash !== hash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Bu işlem anahtarı farklı bir sipariş için kullanılmış.');
      result = { orderId: previous.id, totalAmount: Number(previous.total_amount), message: 'Order placed successfully.' };
      replay = true;
    } else {
      const products = await conn.getProductsForUpdate(items.map(i => i.productId));
      const byId = new Map(products.map(p => [p.id, p]));
      let cents = 0;
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) throw new AppError(400, 'PRODUCT_NOT_FOUND', 'Product ' + item.productId + ' not found.');
        if (product.stock < item.quantity) throw new AppError(400, 'INSUFFICIENT_STOCK', 'Insufficient stock for product ' + item.productId + '.');
        cents += toCents(product.price) * item.quantity;
        if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new AppError(400, 'TOTAL_LIMIT', 'Sipariş tutarı sınırı aşıldı.');
      }
      const orderId = await conn.insertOrder({ user_id: req.user.id, total_amount: fromCents(cents), shipping_address: JSON.stringify(shippingAddress), request_key: req.get('Idempotency-Key'), request_hash: hash });
      for (const item of items) {
        await conn.insertItem(orderId, item.productId, item.quantity, fromCents(toCents(byId.get(item.productId).price)));
        await conn.decreaseStock(item.productId, item.quantity);
      }
      result = { orderId, totalAmount: Number(fromCents(cents)), message: 'Order placed successfully.' };
    }
    await conn.commit(); transaction = false;
  } catch (error) {
    if (transaction) {
      try { await conn.rollback(); } catch { logger.error('Order rollback failed', { requestId: req.id }); }
    }
    return next(error);
  } finally {
    if (conn) { try { conn.release(); } catch { logger.error('Order connection release failed', { requestId: req.id }); } }
  }
  if (!replay) {
    try {
      const notification = await sendOrderNotification({ orderId: result.orderId, userId: req.user.id, totalAmount: result.totalAmount, status: 'pending' });
      if (notification.enabled && !notification.sent) logger.warn('Order notification failed', { orderId: result.orderId, requestId: req.id });
    } catch { logger.warn('Order notification failed', { orderId: result.orderId, requestId: req.id }); }
  }
  res.status(replay ? 200 : 201).json(replay ? { ...result, replayed: true } : result);
});
router.get('/orders', async (req, res, next) => {
  try { res.json(await db.getOrders(req.user.id)); } catch (error) { next(error); }
});
router.get('/orders/:id', validateIdParam, async (req, res, next) => {
  try {
    const order = await db.getOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found.', code: 'ORDER_NOT_FOUND' });
    res.json(order);
  } catch (error) { next(error); }
});
router._aggregateOrderItems = aggregateOrderItems;
module.exports = router;
