const { normalizeProduct, validatePagination } = require('./contracts');
const { createSeed } = require('./seed');
const { AppError } = require('../utils/errors');

function createMockDatabase() {
  let state = createSeed();
  let queue = Promise.resolve();
  async function acquire() {
    const previous = queue;
    let unlock;
    queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    return unlock;
  }
  function productView(product, data = state) {
    if (!product) return null;
    const { id, name, description, price, stock, image_url } = product;
    return { id, name, description, price: Number(price), stock, image_url,
      category: data.categories.find(c => c.id === product.category_id)?.name || null };
  }
  function orderView(order, detail = false) {
    if (!order) return null;
    const { id, status, created_at } = order;
    const result = { id, status, created_at, total_amount: Number(order.total_amount) };
    if (detail) result.shipping_address = JSON.parse(order.shipping_address);
    return result;
  }
  return {
    mode: 'mock',
    async ready() { return true; },
    async close() {},
    async findUserByUsername(username) { return structuredClone(state.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null); },
    async findUserById(id) { const user = state.users.find(u => u.id === Number(id)); if (!user) return null; const { password_hash, ...view } = user; return structuredClone(view); },
    async createUser({ username, phoneNumber, passwordHash }) {
      const unlock = await acquire();
      try {
        if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase() || u.phone_number === phoneNumber)) throw new AppError(409, 'ACCOUNT_EXISTS', 'Registration failed. Please try different credentials.');
        const id = state.users.length + 1;
        state.users.push({ id, username, phone_number: phoneNumber, password_hash: passwordHash, role: 'customer', is_active: 1 });
        return id;
      } finally { unlock(); }
    },
    async listProducts({ q = '', category, page = 1, pageSize = 20 } = {}) {
      validatePagination(page, pageSize);
      const matching = state.products.filter(p => p.is_active === 1 &&
        (!q || (p.name + '\n' + p.description).toLowerCase().includes(q.toLowerCase())) &&
        (!category || state.categories.some(c => c.id === p.category_id && c.slug === category)))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
      return { products: matching.slice((page - 1) * pageSize, page * pageSize).map(p => productView(p)), total: matching.length };
    },
    async getProduct(id) { return productView(state.products.find(p => p.id === Number(id) && p.is_active === 1)); },
    async createProduct(product) {
      product = normalizeProduct(product);
      const unlock = await acquire();
      try {
        if (!state.categories.some(c => c.id === product.categoryId)) throw new AppError(400, 'INVALID_CATEGORY', 'Invalid category.');
        const id = Math.max(0, ...state.products.map(p => p.id)) + 1;
        state.products.push({ id, name: product.name, description: product.description, price: product.price, stock: product.stock, category_id: product.categoryId, image_url: '📦', is_active: 1, created_at: new Date() });
        return id;
      } finally { unlock(); }
    },
    async getOrders(userId) { return state.orders.filter(o => o.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id).slice(0, 50).map(o => orderView(o)); },
    async getOrder(id, userId) {
      const order = state.orders.find(o => o.id === Number(id) && o.user_id === userId);
      if (!order) return null;
      return { ...orderView(order, true), items: state.orderItems.filter(i => i.order_id === order.id).map(i => ({ product_id: i.product_id, product_name: state.products.find(p => p.id === i.product_id)?.name, quantity: i.quantity, unit_price: Number(i.unit_price) })) };
    },
    async getConnection() {
      let working, unlock;
      return {
        async beginTransaction() { unlock = await acquire(); working = structuredClone(state); },
        async lockUser(id) { return working.users.find(u => u.id === id && u.is_active === 1); },
        async findOrderByKey(userId, key) { return working.orders.find(o => o.user_id === userId && o.request_key === key) || null; },
        async getProductsForUpdate(ids) { return working.products.filter(p => ids.includes(p.id) && p.is_active === 1); },
        async insertOrder(order) {
          const id = Math.max(0, ...working.orders.map(o => o.id)) + 1;
          working.orders.push({ id, ...order, status: 'pending', created_at: new Date() });
          return id;
        },
        async insertItem(orderId, productId, quantity, unitPrice) { working.orderItems.push({ order_id: orderId, product_id: productId, quantity, unit_price: unitPrice }); },
        async decreaseStock(productId, quantity) {
          const product = working.products.find(p => p.id === productId);
          if (!product || product.stock < quantity) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed.');
          product.stock -= quantity;
        },
        async commit() { state = working; working = undefined; },
        async rollback() { working = undefined; },
        release() { working = undefined; if (unlock) { unlock(); unlock = undefined; } },
      };
    },
    _resetMockDb() { state = createSeed(); },
  };
}
module.exports = { createMockDatabase };
