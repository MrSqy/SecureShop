/**
 * db.js — Güvenli MySQL Bağlantı Havuzu (Otomatik Simülasyon Destekli)
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';
const REQUIRED_PRODUCTION_DB_ENV = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const LOCALHOST_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLocalhostDbHost = (host) => LOCALHOST_DB_HOSTS.has(String(host || '').trim().toLowerCase());

const validateProductionDbConfig = () => {
  if (!isProduction) return;

  if (process.env.DB_MOCK === 'true') {
    throw new Error('Production cannot start with DB_MOCK=true; mock DB is local demo only.');
  }

  const missing = REQUIRED_PRODUCTION_DB_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error('Missing production database configuration: ' + missing.join(', '));
  }

  if (isLocalhostDbHost(process.env.DB_HOST)) {
    if (process.env.ALLOW_LOCALHOST_DB_IN_PRODUCTION === 'true') {
      logger.warn('ALLOW_LOCALHOST_DB_IN_PRODUCTION=true; production database host is localhost for short-lived demo only.');
      return;
    }

    throw new Error('Production database host must not be localhost unless ALLOW_LOCALHOST_DB_IN_PRODUCTION=true.');
  }
};

let pool;
let isMockMode = false;

const createInitialMockDb = () => ({
  users: [
    {
      id: 1,
      username: 'admin',
      phoneNumber: '+905555555555',
      password_hash: bcrypt.hashSync('Admin@123!', 12),
      role: 'admin',
      is_active: 1,
    },
  ],
  categories: [
    { id: 1, name: 'Electronics', slug: 'electronics' },
    { id: 2, name: 'Clothing', slug: 'clothing' },
    { id: 3, name: 'Books', slug: 'books' },
    { id: 4, name: 'Accessories', slug: 'accessories' },
    { id: 5, name: 'Office', slug: 'office' },
    { id: 6, name: 'Gaming', slug: 'gaming' },
    { id: 7, name: 'Mobile', slug: 'mobile' },
  ],
  products: [
    { id: 1, name: 'Laptop Pro 15', description: 'High-performance laptop for professionals', price: 1299.99, stock: 50, category_id: 1, image_url: '💻', is_active: 1, created_at: new Date() },
    { id: 2, name: 'Wireless Headphones', description: 'Noise-cancelling over-ear headphones', price: 199.99, stock: 120, category_id: 1, image_url: '🎧', is_active: 1, created_at: new Date() },
    { id: 3, name: 'Python Programming Book', description: 'Complete guide to Python development', price: 39.99, stock: 200, category_id: 3, image_url: '📘', is_active: 1, created_at: new Date() },
    { id: 4, name: 'Secure Coding T-Shirt', description: '100% cotton developer tee', price: 24.99, stock: 75, category_id: 2, image_url: '👕', is_active: 1, created_at: new Date() },
    { id: 5, name: 'Mechanical Keyboard', description: 'RGB backlit mechanical keyboard with hot-swap switches', price: 129.99, stock: 60, category_id: 1, image_url: '⌨️', is_active: 1, created_at: new Date() },
    { id: 6, name: 'Wireless Mouse', description: 'Ergonomic wireless mouse with silent click', price: 39.99, stock: 150, category_id: 1, image_url: '🖱️', is_active: 1, created_at: new Date() },
    { id: 7, name: '4K Monitor 27"', description: '27-inch 4K UHD IPS monitor', price: 349.99, stock: 35, category_id: 1, image_url: '🖥️', is_active: 1, created_at: new Date() },
    { id: 8, name: 'Smartwatch Series 8', description: 'Fitness tracking smartwatch with heart rate sensor', price: 249.99, stock: 80, category_id: 1, image_url: '⌚', is_active: 1, created_at: new Date() },
    { id: 9, name: 'Travel Backpack', description: 'Water-resistant 25L laptop backpack', price: 59.99, stock: 100, category_id: 4, image_url: '🎒', is_active: 1, created_at: new Date() },
    { id: 10, name: 'Phone Stand', description: 'Adjustable aluminum phone and tablet stand', price: 19.99, stock: 200, category_id: 5, image_url: '📱', is_active: 1, created_at: new Date() },
    { id: 11, name: 'USB-C Hub 7-in-1', description: 'Multi-port USB-C hub with HDMI and SD reader', price: 44.99, stock: 90, category_id: 4, image_url: '🔌', is_active: 1, created_at: new Date() },
    { id: 12, name: 'HD Webcam', description: '1080p webcam with built-in stereo microphone', price: 69.99, stock: 70, category_id: 1, image_url: '📷', is_active: 1, created_at: new Date() },
    { id: 13, name: 'Gaming Chair', description: 'Ergonomic gaming chair with lumbar support', price: 299.99, stock: 25, category_id: 6, image_url: '🪑', is_active: 1, created_at: new Date() },
    { id: 14, name: 'External SSD 1TB', description: 'Portable USB 3.2 external solid state drive', price: 119.99, stock: 110, category_id: 1, image_url: '💾', is_active: 1, created_at: new Date() },
    { id: 15, name: 'Tablet 10"', description: '10-inch Android tablet for media and reading', price: 219.99, stock: 45, category_id: 1, image_url: '📲', is_active: 1, created_at: new Date() },
    { id: 16, name: 'Bluetooth Speaker', description: 'Portable waterproof Bluetooth speaker', price: 79.99, stock: 130, category_id: 1, image_url: '🔊', is_active: 1, created_at: new Date() },
    { id: 17, name: 'Portable Charger 20000mAh', description: 'Fast-charging portable power bank', price: 49.99, stock: 160, category_id: 7, image_url: '🔋', is_active: 1, created_at: new Date() },
  ],
  orders: [],
  orderItems: [],
});

let mockDb = createInitialMockDb();

const getPhoneNumber = (user) => user.phoneNumber || user.phone_number;

class MockConnection {
  async execute(query, params = []) {
    const q = query.trim().replace(/\s+/g, ' ');
    logger.debug('[Simulated DB Query] ' + q + ' | Params: ' + JSON.stringify(params));

    if (q.includes('SELECT id FROM users WHERE username = ? OR phone_number = ?')) {
      const found = mockDb.users.filter(u => u.username === params[0] || getPhoneNumber(u) === params[1]);
      return [found];
    }

    if (q.includes('INSERT INTO users (username, phone_number, password_hash, created_at)')) {
      const newUser = {
        id: mockDb.users.length + 1,
        username: params[0],
        phoneNumber: params[1],
        password_hash: params[2],
        role: 'customer',
        is_active: 1,
      };
      mockDb.users.push(newUser);
      return [{ insertId: newUser.id }];
    }

    if (q.includes('SELECT id, username, phone_number, password_hash, is_active FROM users WHERE username = ?')) {
      const found = mockDb.users
        .filter(u => u.username === params[0])
        .map(u => ({
          id: u.id,
          username: u.username,
          phone_number: getPhoneNumber(u),
          password_hash: u.password_hash,
          is_active: u.is_active,
        }));
      return [found];
    }

    if (q.includes('SELECT role FROM users WHERE id = ?')) {
      const found = mockDb.users.filter(u => u.id === params[0]).map(u => ({ role: u.role }));
      return [found];
    }

    if (q.includes('SELECT p.id, p.name, p.description, p.price, p.stock, p.image_url')) {
      let filtered = mockDb.products.filter(p => p.is_active === 1);
      let paramIdx = 0;
      if (q.includes('AND (p.name LIKE ? OR p.description LIKE ?)')) {
        const searchVal = params[paramIdx] ? params[paramIdx].replace(/%/g, '').toLowerCase() : '';
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchVal) || p.description.toLowerCase().includes(searchVal));
        paramIdx += 2;
      }
      if (q.includes('AND c.slug = ?')) {
        const catSlug = params[paramIdx];
        const cat = mockDb.categories.find(c => c.slug === catSlug);
        if (cat) filtered = filtered.filter(p => p.category_id === cat.id);
      }
      return [filtered];
    }

    if (q.includes('SELECT COUNT(*) AS total FROM products')) {
      let filtered = mockDb.products.filter(p => p.is_active === 1);
      let paramIdx = 0;
      if (q.includes('AND (p.name LIKE ? OR p.description LIKE ?)')) {
        const searchVal = params[paramIdx] ? params[paramIdx].replace(/%/g, '').toLowerCase() : '';
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchVal) || p.description.toLowerCase().includes(searchVal));
        paramIdx += 2;
      }
      if (q.includes('AND c.slug = ?')) {
        const cat = mockDb.categories.find(c => c.slug === params[paramIdx]);
        if (cat) filtered = filtered.filter(p => p.category_id === cat.id);
      }
      return [[{ total: filtered.length }]];
    }

    if (q.includes('SELECT id, price, stock FROM products WHERE id IN')) {
      const found = mockDb.products.filter(p => params.includes(p.id) && p.is_active === 1);
      return [found];
    }

    if (q.includes('INSERT INTO orders (user_id, total_amount, shipping_address')) {
      const newOrder = {
        id: mockDb.orders.length + 1,
        user_id: params[0],
        total_amount: params[1],
        shipping_address: params[2],
        status: 'pending',
        created_at: new Date(),
      };
      mockDb.orders.push(newOrder);
      return [{ insertId: newOrder.id }];
    }

    if (q.includes('INSERT INTO order_items (order_id, product_id, quantity, unit_price)')) {
      const newItem = {
        id: mockDb.orderItems.length + 1,
        order_id: params[0],
        product_id: params[1],
        quantity: params[2],
        unit_price: params[3],
      };
      mockDb.orderItems.push(newItem);
      return [{ insertId: newItem.id }];
    }

    if (q.includes('UPDATE products SET stock = stock - ? WHERE id = ?')) {
      const prod = mockDb.products.find(p => p.id === params[1]);
      if (prod) prod.stock = Math.max(0, prod.stock - params[0]);
      return [{ affectedRows: prod ? 1 : 0 }];
    }

    if (q.includes('SELECT id, total_amount, status, created_at FROM orders WHERE user_id = ?')) {
      const userOrders = mockDb.orders.filter(o => o.user_id === params[0]);
      return [userOrders];
    }

    if (q.includes('SELECT id, total_amount, status, shipping_address, created_at FROM orders WHERE id = ? AND user_id = ?')) {
      const orderId = Number(params[0]);
      const userId = Number(params[1]);
      const order = mockDb.orders.find(o => o.id === orderId && o.user_id === userId);
      if (!order) return [[]];
      return [[{
        id: order.id,
        total_amount: order.total_amount,
        status: order.status,
        shipping_address: order.shipping_address,
        created_at: order.created_at,
      }]];
    }

    if (q.includes('SELECT oi.product_id, oi.quantity, oi.unit_price, p.name AS product_name FROM order_items oi')) {
      const orderId = Number(params[0]);
      const rows = mockDb.orderItems
        .filter(item => item.order_id === orderId)
        .map(item => {
          const product = mockDb.products.find(p => p.id === item.product_id) || {};
          return {
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            product_name: product.name,
          };
        });
      return [rows];
    }

    return [[]];
  }

  async beginTransaction() { logger.debug('[Simulated DB] Transaction started'); }
  async commit() { logger.debug('[Simulated DB] Transaction committed'); }
  async rollback() { logger.debug('[Simulated DB] Transaction rolled back'); }
  release() {}
}

const mockPool = {
  async execute(query, params) {
    const conn = new MockConnection();
    return conn.execute(query, params);
  },
  async getConnection() {
    return new MockConnection();
  },
};

validateProductionDbConfig();

try {
  const useLocalMockDb = !process.env.DB_HOST || process.env.DB_MOCK === 'true' || (isLocalhostDbHost(process.env.DB_HOST) && !isProduction);
  if (useLocalMockDb) {
    throw new Error('Local simulated mode active');
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 5,
    queueLimit: 10,
    waitForConnections: true,
    connectTimeout: 5000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  pool.getConnection()
    .then((conn) => {
      logger.info('Database connection pool initialized successfully');
      conn.release();
    })
    .catch((err) => {
      if (isProduction) {
        logger.error('Production database connection failed; mock DB fallback disabled.', { error: err.message });
        throw err;
      }

      logger.warn('Real MySQL connection failed. Switching to Safe Simulated In-Memory Database Mode.');
      isMockMode = true;
    });
} catch (e) {
  if (isProduction) {
    logger.error('Production database initialization failed; mock DB fallback disabled.', { error: e.message });
    throw e;
  }

  logger.warn('MySQL not configured. Running in Safe Simulated In-Memory Database Mode for local demo.');
  isMockMode = true;
}

module.exports = {
  execute: async (query, params) => {
    if (isMockMode) return mockPool.execute(query, params);
    return pool.execute(query, params);
  },
  getConnection: async () => {
    if (isMockMode) return mockPool.getConnection();
    return pool.getConnection();
  },
  _resetMockDb: () => {
    mockDb = createInitialMockDb();
  },
  _mockDb: mockDb,
};
