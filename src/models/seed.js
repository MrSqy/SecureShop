const bcrypt = require('bcryptjs');

const createSeed = () => ({
  users: [
    {
      id: 1,
      username: 'admin',
      phone_number: '+905555555555',
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

module.exports = { createSeed };
