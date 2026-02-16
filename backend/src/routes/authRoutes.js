const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route: POST /api/auth/facebook/exchange-token
router.post('/facebook/exchange-token', authController.exchangeToken);

// Route: POST /api/auth/admin/topup
router.post('/admin/topup', authController.adminTopup);

module.exports = router;
