const express = require('express');
const router = express.Router();
const apiListController = require('../controllers/apiListController');
const dbService = require('../services/dbService');
const keyService = require('../services/keyService');
const aiService = require('../services/aiService');
const authMiddleware = require('../middleware/authMiddleware');

// Force Refresh API Cache
router.post('/refresh-cache', authMiddleware, async (req, res) => {
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

router.post('/refresh-global-config-cache', authMiddleware, async (req, res) => {
    try {
        const provider = req.body?.provider || null;
        await aiService.refreshGlobalEngineConfigCache(provider);
        res.json({ success: true, message: 'Global engine config cache refreshed successfully' });
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

// Embedding Config Routes
router.get('/embedding-config', authMiddleware, apiListController.getEmbeddingConfig);
router.post('/embedding-config', authMiddleware, apiListController.saveEmbeddingConfig);

module.exports = router;
