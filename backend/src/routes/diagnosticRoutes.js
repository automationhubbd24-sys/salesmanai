const express = require('express');
const diagnosticController = require('../controllers/diagnosticController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

const router = express.Router();

router.get('/status', diagnosticController.getStatus);
router.post('/messages/:messageId/report', diagnosticController.reportMessage);

router.get('/admin/configs', adminAuthMiddleware, diagnosticController.listConfigs);
router.post('/admin/enable', adminAuthMiddleware, diagnosticController.enableTrace);
router.post('/admin/disable', adminAuthMiddleware, diagnosticController.disableTrace);
router.delete('/admin/configs/:pageId', adminAuthMiddleware, diagnosticController.deleteTraceConfig);
router.get('/admin/reports', adminAuthMiddleware, diagnosticController.listReports);
router.get('/admin/reports/:reportId', adminAuthMiddleware, diagnosticController.getReport);
router.patch('/admin/reports/:reportId', adminAuthMiddleware, diagnosticController.updateReport);
router.get('/admin/traces/:traceId', adminAuthMiddleware, diagnosticController.getTrace);

module.exports = router;
