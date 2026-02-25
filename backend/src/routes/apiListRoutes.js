const express = require('express');
const router = express.Router();
const apiListController = require('../controllers/apiListController');
const dbService = require('../services/dbService');
const keyService = require('../services/keyService');
const authMiddleware = require('../middleware/authMiddleware');

// Force Refresh API Cache
router.post('/refresh-cache', authMiddleware, async (req, res) => {
    try {
        await keyService.updateKeyCache(true);
        res.json({ success: true, message: 'API Key Cache refreshed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', authMiddleware, apiListController.list);
router.post('/', authMiddleware, apiListController.create);
router.delete('/:id', authMiddleware, apiListController.remove);

// Global Engine Config Routes
router.get('/config', authMiddleware, apiListController.getGlobalConfigs);
router.post('/config', authMiddleware, apiListController.saveGlobalConfig);

module.exports = router;

