const { randomUUID } = require('node:crypto');
// The same assertions run against the in-memory adapter and an actual MySQL instance.
function dataContract(getDb) {
  let db, userId;
  beforeAll(async () => { db = getDb(); userId = await db.createUser({ username: 'ContractUser', phoneNumber: '+905551234567', passwordHash: 'test-hash-not-used-for-login' }); });
  test('case-insensitive username uniqueness and phone uniqueness', async () => {
    expect((await db.findUserByUsername('CONTRACTuser')).id).toBe(userId);
    expect(await db.findUserById(userId)).not.toHaveProperty('password_hash');
    await expect(db.createUser({ username: 'contractuser', phoneNumber: '+905551234568', passwordHash: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(db.createUser({ username: 'differentuser', phoneNumber: '+905551234567', passwordHash: 'x' })).rejects.toMatchObject({ status: 409 });
  });
  test('correct product, missing product, category, count and pagination', async () => {
    expect((await db.getProduct(2)).name).toBe('Wireless Headphones');
    expect(await db.getProduct(99999)).toBeNull();
    const first = await db.listProducts({ page: 1, pageSize: 10 });
    const second = await db.listProducts({ page: 2, pageSize: 10 });
    expect(first.total).toBe(17); expect(second.products).toHaveLength(7);
    expect(new Set([...first.products, ...second.products].map(p => p.id)).size).toBe(17);
    expect(await db.listProducts({ category: 'missing' })).toEqual({ total: 0, products: [] });
    expect((await db.listProducts({ category: 'books' })).products.map(p => p.id)).toEqual([3]);
    await expect(db.listProducts({ page: -1 })).rejects.toThrow('Invalid pagination');
  });
  test('product insert persists and search treats punctuation as literal text', async () => {
    const name = `O'Connor %_! \\ Türkçe <script>alert(1)</script>`;
    const id = await db.createProduct({ name, description: 'Özgün açıklama', price: '0.10', stock: 7, categoryId: 1 });
    expect(await db.getProduct(id)).toMatchObject({ id, name, price: 0.1, stock: 7, category: 'Electronics' });
    for (const q of ["O'Connor", '%_!', '\\', '<script>']) expect((await db.listProducts({ q })).products.map(p => p.id)).toEqual([id]);
    expect((await db.listProducts({ q: '27"' })).products.map(p => p.id)).toEqual([7]);
  });
  test('invalid product data fails in the adapter as well as the route', async () => {
    const valid = { name: 'Valid', description: '', price: 1, stock: 0, categoryId: 1 };
    for (const change of [{ price: -1 }, { price: 0 }, { price: '1.234' }, { stock: -1 }, { name: ' ' }, { categoryId: 9999 }]) {
      await expect(db.createProduct({ ...valid, ...change })).rejects.toMatchObject({ status: 400 });
    }
  });
  test('rollback restores order, item and stock; release allows the next transaction', async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction(); await conn.lockUser(userId);
      const id = await conn.insertOrder({ user_id: userId, total_amount: '1299.99', shipping_address: '{}', request_key: randomUUID(), request_hash: 'a'.repeat(64) });
      await conn.insertItem(id, 1, 1, '1299.99'); await conn.decreaseStock(1, 1);
      await conn.rollback();
    } finally { conn.release(); }
    expect((await db.getProduct(1)).stock).toBe(50);
    expect(await db.getOrders(userId)).toEqual([]);
    const next = await db.getConnection();
    try { await next.beginTransaction(); await next.rollback(); } finally { next.release(); }
  });
  test('committed orders are newest first, with private columns excluded and original text intact', async () => {
    const ids = [], address = { street: "O'Connor <b>street</b>", city: 'İzmir' };
    for (let i = 0; i < 2; i++) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction(); await conn.lockUser(userId);
        const id = await conn.insertOrder({ user_id: userId, total_amount: '0.30', shipping_address: JSON.stringify(address), request_key: randomUUID(), request_hash: 'b'.repeat(64) });
        await conn.insertItem(id, 2, 3, '0.10'); await conn.commit(); ids.push(id);
      } finally { conn.release(); }
    }
    const orders = await db.getOrders(userId);
    expect(orders.map(o => o.id)).toEqual(ids.reverse());
    expect(Object.keys(orders[0]).sort()).toEqual(['created_at', 'id', 'status', 'total_amount']);
    expect(await db.getOrder(ids[0], userId)).toMatchObject({ total_amount: 0.3, shipping_address: address, items: [{ quantity: 3, unit_price: 0.1, product_id: 2, product_name: 'Wireless Headphones' }] });
    expect(await db.getOrder(ids[0], 1)).toBeNull();
  });
}
module.exports = { dataContract };
