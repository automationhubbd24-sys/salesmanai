const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

router.post('/facebook/exchange-token', authController.exchangeToken);
router.post('/facebook/messenger/complete-code', authMiddleware, authController.completeMessengerCode);

router.post('/admin/login', authController.adminLogin);
router.post('/admin/topup', adminAuthMiddleware, authController.adminTopup);
router.get('/admin/transactions', adminAuthMiddleware, authController.listTransactions);
router.post('/admin/transactions/:id/approve', adminAuthMiddleware, authController.approveTransaction);
router.post('/admin/transactions/:id/reject', adminAuthMiddleware, authController.rejectTransaction);
router.get('/admin/coupons', adminAuthMiddleware, authController.listCoupons);
router.post('/admin/coupons', adminAuthMiddleware, authController.createCoupon);
router.post('/admin/coupons/:id/status', adminAuthMiddleware, authController.updateCouponStatus);

router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.registerWithPassword);
router.post('/login', authController.loginWithPassword);
router.post('/password/reset/request', authController.requestPasswordReset);
router.post('/password/reset/verify', authController.verifyPasswordResetCode);
router.post('/password/reset/complete', authController.completePasswordReset);
router.post('/password/change', authMiddleware, authController.changePassword);

router.get('/payments/me', authMiddleware, authController.getMyPayments);
router.post('/payments/deposit', authMiddleware, authController.createDepositRequest);
router.post('/payments/redeem', authMiddleware, authController.redeemCoupon);
router.post('/payments/buy-credits', authMiddleware, authController.buyCredits);
router.post('/payments/buy-plan', authMiddleware, authController.buyPlan);

// --- DEVELOPER API SYSTEM ROUTES ---
router.post('/developer/register', authMiddleware, authController.registerDeveloper);
router.post('/developer/login', authMiddleware, authController.verifyDeveloperLogin);
router.get('/developer/stats/:userId', authMiddleware, authController.getDeveloperStats);

// Admin Developer Routes
router.get('/admin/developer/requests', adminAuthMiddleware, authController.listDeveloperRequests);
router.post('/admin/developer/requests/:id/approve', adminAuthMiddleware, authController.approveDeveloper);

module.exports = router;
