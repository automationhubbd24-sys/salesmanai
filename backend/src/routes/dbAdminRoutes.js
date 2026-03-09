const express = require('express');
const router = express.Router();
const dbAdminController = require('../controllers/dbAdminController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');
const abcAdminMiddleware = require('../middleware/abcAdminMiddleware');

router.get('/tables', adminAuthMiddleware, dbAdminController.listTables);
router.get('/cache-configs', adminAuthMiddleware, dbAdminController.getSemanticCacheConfigs);
router.post('/cache-configs/update', adminAuthMiddleware, dbAdminController.updateSemanticCacheConfig);

// Semantic Cache Entries Management (Superadmin Only)
router.get('/semantic-cache/entries', adminAuthMiddleware, abcAdminMiddleware, dbAdminController.getSemanticCacheEntries);
router.post('/semantic-cache/add', adminAuthMiddleware, abcAdminMiddleware, dbAdminController.addSemanticCacheEntry);
router.put('/semantic-cache/update/:id', adminAuthMiddleware, abcAdminMiddleware, dbAdminController.updateSemanticCacheEntry);
router.delete('/semantic-cache/delete/:id', adminAuthMiddleware, abcAdminMiddleware, dbAdminController.deleteSemanticCacheEntry);

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
