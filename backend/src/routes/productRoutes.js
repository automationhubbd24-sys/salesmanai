const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// GET /api/products/status?user_id=...
router.get('/status', productController.checkStatus);

// GET /api/products?user_id=...&page=1
router.get('/', productController.getProducts);

// POST /api/products (multipart/form-data)
router.post('/', productController.uploadMiddleware, productController.createProduct);

// POST /api/products/extract-visuals
router.post('/extract-visuals', productController.extractVisuals);

// POST /api/products/import-json
router.post('/import-json', productController.importJson);

// POST /api/products/bulk-delete
router.post('/bulk-delete', productController.bulkDelete);

// PUT /api/products/:id (multipart/form-data)
router.put('/:id', productController.uploadMiddleware, productController.updateProduct);

// DELETE /api/products/:id
router.delete('/:id', productController.deleteProduct);

// WooCommerce Import
router.post('/import-woocommerce', productController.importWooCommerce);

// Standalone Upload Endpoints for Variant Media
router.post('/upload/image', productController.uploadVariantImage);
router.post('/upload/video', productController.uploadVariantVideo);

module.exports = router;
