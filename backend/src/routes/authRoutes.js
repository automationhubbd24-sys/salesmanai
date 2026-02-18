const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/facebook/exchange-token', authController.exchangeToken);
router.post('/admin/topup', authController.adminTopup);

router.post('/admin/login', authController.adminLogin);
router.get('/admin/transactions', authController.listTransactions);
router.post('/admin/transactions/:id/approve', authController.approveTransaction);
router.post('/admin/transactions/:id/reject', authController.rejectTransaction);
router.get('/admin/coupons', authController.listCoupons);
router.post('/admin/coupons', authController.createCoupon);
router.post('/admin/coupons/:id/status', authController.updateCouponStatus);

router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);

router.get('/payments/me', authMiddleware, authController.getMyPayments);
router.post('/payments/deposit', authMiddleware, authController.createDepositRequest);
router.post('/payments/redeem', authMiddleware, authController.redeemCoupon);

module.exports = router;
