const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// GET /api/products/status?user_id=...
router.get('/status', productController.checkStatus);

// GET /api/products?user_id=...&page=1
router.get('/', productController.getProducts);

// POST /api/products (multipart/form-data)
router.post('/', productController.uploadMiddleware, productController.createProduct);

// PUT /api/products/:id (multipart/form-data)
router.put('/:id', productController.uploadMiddleware, productController.updateProduct);

// DELETE /api/products/:id
router.delete('/:id', productController.deleteProduct);

// WooCommerce Import
router.post('/import-woocommerce', productController.importWooCommerce);

module.exports = router;
