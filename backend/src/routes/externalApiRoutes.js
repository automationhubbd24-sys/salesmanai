const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApiController');
const authMiddleware = require('../middleware/authMiddleware');
const developerAuthMiddleware = require('../middleware/developerAuthMiddleware');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// Public API Endpoint (Protected by Bearer Token in Header)
router.post('/chat/completions', externalApiController.handleChatCompletion);
router.post('/audio/transcriptions', externalApiController.transcribeAudio);
router.get('/models', externalApiController.listModels);
router.get(/^\/models\/(.+)$/, (req, res) => {
    req.params.modelId = req.params[0];
    return externalApiController.getModelDetails(req, res);
});

// Management Endpoints (Protected by User Auth AND Developer Approval)
router.get('/key', authMiddleware, developerAuthMiddleware, externalApiController.getApiKey);
router.post('/key/regenerate', authMiddleware, developerAuthMiddleware, externalApiController.regenerateApiKey);
router.get('/keys', authMiddleware, developerAuthMiddleware, externalApiController.getApiKeys);
router.post('/keys', authMiddleware, developerAuthMiddleware, externalApiController.createApiKey);
router.patch('/keys/:keyId/toggle', authMiddleware, developerAuthMiddleware, externalApiController.disableApiKey);
router.delete('/keys/:keyId', authMiddleware, developerAuthMiddleware, externalApiController.deleteApiKey);
router.get('/usage', authMiddleware, developerAuthMiddleware, externalApiController.getUsageStats);
router.post('/user-config', authMiddleware, developerAuthMiddleware, externalApiController.updateUserConfig);
router.get('/user-config', authMiddleware, developerAuthMiddleware, externalApiController.getUserConfig);

// Admin developer API control
router.get('/admin/models', adminAuthMiddleware, externalApiController.adminListModels);
router.post('/admin/models', adminAuthMiddleware, externalApiController.createModel);
router.delete(/^\/admin\/models\/(.+)$/, adminAuthMiddleware, (req, res) => {
    req.params.modelId = req.params[0];
    return externalApiController.deleteModel(req, res);
});
router.get('/admin/servers', adminAuthMiddleware, externalApiController.adminListServers);
router.post('/admin/servers', adminAuthMiddleware, externalApiController.upsertServer);
router.delete('/admin/servers/:serverId', adminAuthMiddleware, externalApiController.deleteServer);

module.exports = router;