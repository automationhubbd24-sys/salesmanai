const express = require('express');
const router = express.Router();
const apiListController = require('../controllers/apiListController');
const dbService = require('../services/dbService');
const keyService = require('../services/keyService');
const aiService = require('../services/aiService');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// Force Refresh API Cache
router.post('/refresh-cache', adminAuthMiddleware, async (req, res) => {
    try {
        if (keyService.forceUpdateKeyCache) {
            await keyService.forceUpdateKeyCache();
        } else {
            await keyService.updateKeyCache(true);
        }
        res.json({ success: true, message: 'API Key Cache refreshed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/refresh-global-config-cache', adminAuthMiddleware, async (req, res) => {
    try {
        const provider = req.body?.provider || null;
        await aiService.refreshGlobalEngineConfigCache(provider);
        res.json({ success: true, message: 'Global engine config cache refreshed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', adminAuthMiddleware, apiListController.list);
router.post('/', adminAuthMiddleware, apiListController.create);
router.delete('/:id', adminAuthMiddleware, apiListController.remove);

// Global Engine Config Routes
router.get('/config', adminAuthMiddleware, apiListController.getGlobalConfigs);
router.post('/config', adminAuthMiddleware, apiListController.saveGlobalConfig);

module.exports = router;
