/**
 * checkout.js — Sipariş ve Ödeme Route'ları
 */
const express = require('express');
const db = require('../models/db');
const logger = require('../utils/logger');
const { apiLimiter } = require('../middleware/rateLimiter');
const { validateOrder, validateIdParam } = require('../middleware/validation');
const { sendOrderNotification } = require('../services/whatsappNotifier');

const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
};

const aggregateOrderItems = (items) => {
  const itemMap = new Map();
  for (const item of items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const existing = itemMap.get(productId) || { productId, quantity: 0 };
    existing.quantity += quantity;
    itemMap.set(productId, existing);
  }
  return Array.from(itemMap.values());
};

router.use(requireAuth);

router.post('/', apiLimiter, validateOrder, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { shippingAddress } = req.body;
    const items = aggregateOrderItems(req.body.items);
    const userId = req.session.userId;

    const productIds = items.map(i => i.productId);
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await conn.execute(
      'SELECT id, price, stock FROM products WHERE id IN (' + placeholders + ') AND is_active = 1 FOR UPDATE',
      productIds
    );

    const productMap = {};
    for (const p of products) productMap[p.id] = p;

    let totalAmount = 0;
    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        await conn.rollback();
        return res.status(400).json({ error: 'Product ' + item.productId + ' not found.' });
      }
      if (product.stock < item.quantity) {
        await conn.rollback();
        return res.status(400).json({ error: 'Insufficient stock for product ' + item.productId + '.' });
      }
      totalAmount += product.price * item.quantity;
    }

    const [orderResult] = await conn.execute(
      "INSERT INTO orders (user_id, total_amount, shipping_address, status, created_at) VALUES (?, ?, ?, 'pending', NOW())",
      [userId, totalAmount, JSON.stringify(shippingAddress)]
    );
    const orderId = orderResult.insertId;

    for (const item of items) {
      const product = productMap[item.productId];

      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderId, item.productId, item.quantity, product.price]
      );

      await conn.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.productId]
      );
    }

    await conn.commit();

    logger.info('Order placed', { orderId, userId, totalAmount, ip: req.ip });
    try {
      const notificationResult = await sendOrderNotification({
        orderId,
        userId,
        totalAmount,
        status: 'pending',
      });

      if (notificationResult.enabled && !notificationResult.sent) {
        logger.warn('Order notification was not sent', {
          orderId,
          userId,
          skipped: notificationResult.skipped || false,
        });
      }
    } catch (notificationErr) {
      logger.warn('Order notification failed after commit', {
        orderId,
        userId,
        error: notificationErr.message,
      });
    }

    res.status(201).json({ orderId, totalAmount, message: 'Order placed successfully.' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/orders', apiLimiter, async (req, res, next) => {
  try {
    const [orders] = await db.execute(
      'SELECT id, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.session.userId]
    );
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', apiLimiter, validateIdParam, async (req, res, next) => {
  try {
    const [orderRows] = await db.execute(
      'SELECT id, total_amount, status, shipping_address, created_at FROM orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const [itemRows] = await db.execute(
      'SELECT oi.product_id, oi.quantity, oi.unit_price, p.name AS product_name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
      [req.params.id]
    );

    const order = orderRows[0];
    let shippingAddress = null;
    if (order.shipping_address) {
      if (typeof order.shipping_address === 'string') {
        try { shippingAddress = JSON.parse(order.shipping_address); } catch (e) { shippingAddress = null; }
      } else {
        shippingAddress = order.shipping_address;
      }
    }

    res.json({
      id: order.id,
      status: order.status,
      total_amount: order.total_amount,
      created_at: order.created_at,
      shipping_address: shippingAddress,
      items: itemRows.map(row => ({
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: row.quantity,
        unit_price: row.unit_price,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router._aggregateOrderItems = aggregateOrderItems;

module.exports = router;
