const express = require('express');
const router = express.Router();
const openrouterEngineController = require('../controllers/openrouterEngineController');
const openrouterConfigController = require('../controllers/openrouterConfigController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

router.post('/chat/completions', openrouterEngineController.handleChatCompletion);
router.post('/update', adminAuthMiddleware, openrouterEngineController.forceUpdate); // Manual trigger for update

// --- Config & Testing Routes ---
router.get('/config', adminAuthMiddleware, openrouterConfigController.getConfig);
router.post('/config', adminAuthMiddleware, openrouterConfigController.saveConfig);
router.post('/test-model', adminAuthMiddleware, openrouterConfigController.testModel);
router.post('/gemini/test-keys', adminAuthMiddleware, openrouterConfigController.testGeminiPool);
router.post('/gemini/delete-keys', adminAuthMiddleware, openrouterConfigController.deleteGeminiKeys);
router.post('/pool/test-keys', adminAuthMiddleware, openrouterConfigController.testApiPool);
router.post('/pool/delete-keys', adminAuthMiddleware, openrouterConfigController.deleteApiKeys);

module.exports = router;
