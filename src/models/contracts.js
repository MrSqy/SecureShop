const { AppError } = require('../utils/errors');
const { toCents, fromCents } = require('../utils/money');
function normalizeProduct(product) {
  try {
    if (typeof product.name !== 'string' || !product.name.trim() || product.name.trim().length > 255 ||
        typeof product.description !== 'string' || product.description.length > 2000 ||
        !Number.isInteger(product.stock) || product.stock < 0 || product.stock > 1000000 ||
        !Number.isInteger(product.categoryId) || product.categoryId < 1 || toCents(product.price) <= 0) throw new Error('invalid');
    return { ...product, name: product.name.trim(), price: fromCents(toCents(product.price)) };
  } catch { throw new AppError(400, 'INVALID_PRODUCT', 'Invalid product.'); }
}
function validatePagination(page, pageSize) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid pagination');
}
module.exports = { normalizeProduct, validatePagination };
