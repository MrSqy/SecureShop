const { body, param, query, header, validationResult } = require('express-validator');
const { toCents } = require('../utils/money');
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_FAILED', details: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  next();
};
const username = () => body('username').isString().bail().trim().isLength({ min: 1, max: 50 }).matches(/^[a-zA-Z0-9]+$/).withMessage('Kullanıcı adı yalnız harf ve rakam içermeli.');
const password = (registration = false) => body('password').isString().bail().isLength({ min: registration ? 8 : 1, max: 128 }).withMessage('Şifre en az 8 karakter olmalı.').bail()
  .custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage('Şifre UTF-8 biçiminde en fazla 72 bayt olabilir.');
const validateRegister = [username(), body('username').isLength({ min: 3 }).withMessage('Kullanıcı adı en az 3 karakter olmalı.'),
  body('phoneNumber').isString().bail().trim().matches(/^\+[1-9]\d{9,14}$/).withMessage('Telefonu +905555555555 biçiminde yazın.'),
  password(true), body('password').matches(/[A-Z]/).withMessage('Şifre büyük harf içermeli.').matches(/[a-z]/).withMessage('Şifre küçük harf içermeli.').matches(/\d/).withMessage('Şifre rakam içermeli.').matches(/[@$!%*?&]/).withMessage('Şifre @$!%*?& karakterlerinden birini içermeli.'), handleValidationErrors];
const validateLogin = [username(), password(), handleValidationErrors];
const validateOtpVerify = [username(), body('otpCode').isString().bail().trim().matches(/^\d{6}$/).withMessage('Doğrulama kodu 6 rakam olmalı.'), handleValidationErrors];
const validateSearch = [query('q').optional().isString().bail().trim().isLength({ max: 200 }).withMessage('Arama en fazla 200 karakter olabilir.'),
  query('category').optional().isString().bail().trim().matches(/^[a-z0-9-]+$/).isLength({ max: 100 }).withMessage('Kategori geçersiz.'),
  query('page').optional().isInt({ min: 1, max: 1000 }).withMessage('Sayfa numarası geçersiz.').toInt(), handleValidationErrors];
const validateIdParam = [param('id').isInt({ min: 1, max: 4294967295 }).withMessage('Kimlik geçersiz.').toInt(), handleValidationErrors];
const validateOrder = [
  header('Idempotency-Key').isUUID(4).withMessage('Sipariş denemesi için geçerli bir işlem anahtarı gerekli.'),
  body('items').isArray({ min: 1, max: 50 }).withMessage('Sipariş 1–50 satır içermeli.'),
  body('items.*.productId').isInt({ min: 1, max: 4294967295 }).withMessage('Ürün kimliği geçersiz.').toInt(),
  body('items.*.quantity').isInt({ min: 1, max: 99 }).withMessage('Satır adedi 1–99 olmalı.').toInt(),
  body('shippingAddress').isObject({ strict: true }).withMessage('Adres gerekli.'),
  body('shippingAddress.street').isString().bail().trim().isLength({ min: 5, max: 200 }).withMessage('Adres 5–200 karakter olmalı.'),
  body('shippingAddress.city').isString().bail().trim().isLength({ min: 2, max: 100 }).withMessage('Şehir 2–100 karakter olmalı.'), handleValidationErrors];
const validateProduct = [
  body('name').isString().bail().trim().isLength({ min: 1, max: 255 }).withMessage('Ürün adı 1–255 karakter olmalı.'),
  body('description').optional().isString().bail().trim().isLength({ max: 2000 }).withMessage('Açıklama en fazla 2000 karakter olabilir.'),
  body('price').custom(value => (typeof value === 'string' || typeof value === 'number') && toCents(value) > 0).withMessage('Fiyat pozitif ve en fazla iki ondalıklı olmalı.'),
  body('stock').isInt({ min: 0, max: 1000000 }).withMessage('Stok 0–1000000 arasında olmalı.').toInt(),
  body('categoryId').isInt({ min: 1, max: 4294967295 }).withMessage('Kategori geçersiz.').toInt(), handleValidationErrors];
module.exports = { validateRegister, validateLogin, validateOtpVerify, validateSearch, validateIdParam, validateOrder, validateProduct, handleValidationErrors };
