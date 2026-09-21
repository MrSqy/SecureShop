const { normalizeProduct, validatePagination } = require('./contracts');
const mysql = require('mysql2/promise');
const { AppError } = require('../utils/errors');
const productColumns = 'p.id, p.name, p.description, p.price, p.stock, p.image_url, c.name AS category';
const productJoin = 'FROM products p LEFT JOIN categories c ON p.category_id = c.id';
const numericProduct = row => ({ ...row, price: Number(row.price) });
const numericOrder = row => ({ ...row, total_amount: Number(row.total_amount) });

function createMysqlDatabase(options) {
  const pool = mysql.createPool(options);
  return {
    mode: 'mysql',
    async ready() { await pool.execute('SELECT 1'); return true; },
    async close() { await pool.end(); },
    async findUserByUsername(username) {
      const [rows] = await pool.execute('SELECT id, username, phone_number, password_hash, role, is_active FROM users WHERE username = ?', [username]);
      return rows[0] || null;
    },
    async findUserById(id) {
      const [rows] = await pool.execute('SELECT id, username, phone_number, role, is_active FROM users WHERE id = ?', [id]);
      return rows[0] || null;
    },
    async createUser({ username, phoneNumber, passwordHash }) {
      try {
        const [result] = await pool.execute('INSERT INTO users (username, phone_number, password_hash) VALUES (?, ?, ?)', [username, phoneNumber, passwordHash]);
        return result.insertId;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'ACCOUNT_EXISTS', 'Registration failed. Please try different credentials.');
        throw error;
      }
    },
    async listProducts({ q = '', category, page = 1, pageSize = 20 } = {}) {
      validatePagination(page, pageSize);
      let where = 'WHERE p.is_active = 1';
      const params = [];
      if (q) {
        const literal = q.replace(/[!%_]/g, '!$&');
        where += " AND (p.name LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!')";
        params.push('%' + literal + '%', '%' + literal + '%');
      }
      if (category) { where += ' AND c.slug = ?'; params.push(category); }
      const [rows] = await pool.execute(`SELECT ${productColumns} ${productJoin} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${productJoin} ${where}`, params);
      return { products: rows.map(numericProduct), total: count.total };
    },
    async getProduct(id) {
      const [rows] = await pool.execute(`SELECT ${productColumns} ${productJoin} WHERE p.id = ? AND p.is_active = 1`, [id]);
      return rows[0] ? numericProduct(rows[0]) : null;
    },
    async createProduct(product) {
      product = normalizeProduct(product);
      try {
        const [result] = await pool.execute('INSERT INTO products (name, description, price, stock, category_id, image_url) VALUES (?, ?, ?, ?, ?, ?)', [product.name, product.description, product.price, product.stock, product.categoryId, '📦']);
        return result.insertId;
      } catch (error) {
        if (error.code === 'ER_NO_REFERENCED_ROW_2') throw new AppError(400, 'INVALID_CATEGORY', 'Invalid category.');
        throw error;
      }
    },
    async getOrders(userId) {
      const [rows] = await pool.execute('SELECT id, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [userId]);
      return rows.map(numericOrder);
    },
    async getOrder(id, userId) {
      const [rows] = await pool.execute('SELECT id, total_amount, status, shipping_address, created_at FROM orders WHERE id = ? AND user_id = ?', [id, userId]);
      if (!rows[0]) return null;
      const [items] = await pool.execute('SELECT oi.product_id, oi.quantity, oi.unit_price, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id', [id]);
      const order = numericOrder(rows[0]);
      if (typeof order.shipping_address === 'string') order.shipping_address = JSON.parse(order.shipping_address);
      return { ...order, items: items.map(i => ({ ...i, unit_price: Number(i.unit_price) })) };
    },
    async getConnection() {
      const connection = await pool.getConnection();
      let discarded = false;
      return {
        async beginTransaction() {
          // User-row locks serialize a buyer's request keys. READ COMMITTED avoids
          // unnecessary gap locks on absent keys of unrelated buyers.
          await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
          await connection.beginTransaction();
        },
        async lockUser(id) {
          const [rows] = await connection.execute('SELECT id FROM users WHERE id = ? AND is_active = 1 FOR UPDATE', [id]);
          return rows[0];
        },
        async findOrderByKey(userId, key) {
          const [rows] = await connection.execute('SELECT id, total_amount, request_hash FROM orders WHERE user_id = ? AND request_key = ? FOR UPDATE', [userId, key]);
          return rows[0] || null;
        },
        async getProductsForUpdate(ids) {
          const [rows] = await connection.execute(`SELECT id, price, stock FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1 ORDER BY id FOR UPDATE`, ids);
          return rows;
        },
        async insertOrder(order) {
          const [result] = await connection.execute('INSERT INTO orders (user_id, total_amount, shipping_address, request_key, request_hash) VALUES (?, ?, ?, ?, ?)', [order.user_id, order.total_amount, order.shipping_address, order.request_key, order.request_hash]);
          return result.insertId;
        },
        async insertItem(orderId, productId, quantity, unitPrice) {
          await connection.execute('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [orderId, productId, quantity, unitPrice]);
        },
        async decreaseStock(productId, quantity) {
          const [result] = await connection.execute('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [quantity, productId, quantity]);
          if (result.affectedRows !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed.');
        },
        async commit() { await connection.commit(); },
        async rollback() {
          try { await connection.rollback(); }
          catch (error) { discarded = true; connection.destroy(); throw error; }
        },
        release() { if (!discarded) connection.release(); },
      };
    },
  };
}
module.exports = { createMysqlDatabase };
