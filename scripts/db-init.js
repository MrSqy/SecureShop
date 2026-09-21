require('dotenv').config({ quiet: true });
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const mysql = require('mysql2/promise');
const { readDatabase } = require('../src/config/runtime');
const { createSeed } = require('../src/models/seed');

async function initializeDatabase(options) {
  const connection = await mysql.createConnection({ ...options, multipleStatements: false });
  try {
    const [[row]] = await connection.execute('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()');
    if (row.total !== 0) throw new Error('Database is not empty; initialization refused. No existing tables were changed.');
    const schema = readFileSync(join(__dirname, '../aws/schema.sql'), 'utf8');
    // This project-owned schema contains no semicolons inside literals or procedures.
    for (const statement of schema.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)) await connection.query(statement);
    const seed = createSeed();
    await connection.beginTransaction();
    try {
      for (const user of seed.users) await connection.execute('INSERT INTO users (id, username, phone_number, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [user.id, user.username, user.phone_number, user.password_hash, user.role, user.is_active]);
      for (const c of seed.categories) await connection.execute('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)', [c.id, c.name, c.slug]);
      for (const p of seed.products) await connection.execute('INSERT INTO products (id, name, description, price, stock, image_url, category_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [p.id, p.name, p.description, p.price, p.stock, p.image_url, p.category_id, p.is_active, p.created_at]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
  } finally { await connection.end(); }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo initialization is disabled in production.');
  const config = readDatabase();
  if (config.mock) throw new Error('db:init requires DB_MOCK=false and an empty local database.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.options.host)) throw new Error('Demo initialization is restricted to a local database.');
  await initializeDatabase(config.options);
  console.log('Empty database initialized with the local demo catalog and admin account.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { initializeDatabase };
