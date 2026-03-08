const express = require('express');
const router = express.Router();
const dbAdminController = require('../controllers/dbAdminController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

router.get('/tables', adminAuthMiddleware, dbAdminController.listTables);
router.get('/cache-configs', adminAuthMiddleware, dbAdminController.getSemanticCacheConfigs);
router.post('/cache-configs/update', adminAuthMiddleware, dbAdminController.updateSemanticCacheConfig);
router.get('/table/:table', adminAuthMiddleware, dbAdminController.getTableData);
router.get('/embedding-config', adminAuthMiddleware, dbAdminController.getEmbeddingGlobalConfig);
router.post('/embedding-config', adminAuthMiddleware, dbAdminController.saveEmbeddingGlobalConfig);
router.post('/table', adminAuthMiddleware, dbAdminController.createTable);
router.post('/table/:table/insert', adminAuthMiddleware, dbAdminController.insertRow);
router.post('/table/:table/update', adminAuthMiddleware, dbAdminController.updateRow);
router.post('/table/:table/delete', adminAuthMiddleware, dbAdminController.deleteRow);
router.post('/table/:table/column', adminAuthMiddleware, dbAdminController.addColumn);
router.post('/sql', adminAuthMiddleware, dbAdminController.runSql);

module.exports = router;
