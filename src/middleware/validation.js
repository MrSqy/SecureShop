/**
 * validation.js — Merkezi Input Validation Middleware
 */
const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
    .isAlphanumeric().withMessage('Username must be alphanumeric only')
    .escape(),

  body('phoneNumber')
    .trim()
    .matches(/^\+[1-9]\d{9,14}$/).withMessage('Phone number must use international format, for example +905555555555')
    .isLength({ max: 16 }),

  body('password')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
    .matches(/[A-Z]/).withMessage('Password must contain uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain lowercase letter')
    .matches(/\d/).withMessage('Password must contain a number')
    .matches(/[@$!%*?&]/).withMessage('Password must contain special character (@$!%*?&)'),

  handleValidationErrors,
];

const validateLogin = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Username required')
    .escape(),

  body('password')
    .isLength({ min: 1, max: 128 }).withMessage('Password required'),

  handleValidationErrors,
];

const validateOtpVerify = [
  body('username')
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Username required')
    .escape(),

  body('otpCode')
    .trim()
    .matches(/^\d{6}$/).withMessage('Verification code must be 6 digits'),

  handleValidationErrors,
];

const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Search query too long')
    .escape(),

  query('category')
    .optional()
    .trim()
    .isAlphanumeric().withMessage('Invalid category')
    .escape(),

  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 }).withMessage('Invalid page number')
    .toInt(),

  handleValidationErrors,
];

const validateOrder = [
  body('items')
    .isArray({ min: 1, max: 50 }).withMessage('Order must have 1-50 items'),

  body('items.*.productId')
    .isInt({ min: 1 }).withMessage('Invalid product ID')
    .toInt(),

  body('items.*.quantity')
    .isInt({ min: 1, max: 99 }).withMessage('Quantity must be 1-99')
    .toInt(),

  body('shippingAddress.street')
    .trim()
    .isLength({ min: 5, max: 200 }).withMessage('Invalid street address')
    .escape(),

  body('shippingAddress.city')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Invalid city')
    .escape(),

  handleValidationErrors,
];

const validateIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('Invalid ID parameter')
    .toInt(),

  handleValidationErrors,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateOtpVerify,
  validateSearch,
  validateOrder,
  validateIdParam,
  handleValidationErrors,
};
