const router = require('express').Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/requireAuth');
const { validateSearch, validateIdParam, validateProduct } = require('../middleware/validation');
router.get('/', validateSearch, async (req, res, next) => {
  try {
    const { q, category, page = 1 } = req.query;
    const pageSize = 20;
    const result = await db.listProducts({ q, category, page, pageSize });
    res.json({ products: result.products, pagination: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) } });
  } catch (error) { next(error); }
});
router.get('/:id', validateIdParam, async (req, res, next) => {
  try {
    const product = await db.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.', code: 'PRODUCT_NOT_FOUND' });
    res.json(product);
  } catch (error) { next(error); }
});
router.post('/', requireAuth, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden.', code: 'FORBIDDEN' });
  next();
}, validateProduct, async (req, res, next) => {
  try {
    const { name, description = '', price, stock, categoryId } = req.body;
    const id = await db.createProduct({ name, description, price, stock, categoryId });
    res.status(201).json({ id, message: 'Product created.' });
  } catch (error) { next(error); }
});
module.exports = router;
