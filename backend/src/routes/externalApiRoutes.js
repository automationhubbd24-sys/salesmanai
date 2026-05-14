const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApiController');
const authMiddleware = require('../middleware/authMiddleware');
const developerAuthMiddleware = require('../middleware/developerAuthMiddleware');

// Public API Endpoint (Protected by Bearer Token in Header)
router.post('/v1/chat/completions', externalApiController.handleChatCompletion);
router.post('/v1/audio/transcriptions', externalApiController.transcribeAudio);
router.get('/v1/models', externalApiController.listModels);

// Management Endpoints (Protected by User Auth AND Developer Approval)
router.get('/key', authMiddleware, developerAuthMiddleware, externalApiController.getApiKey);
router.post('/key/regenerate', authMiddleware, developerAuthMiddleware, externalApiController.regenerateApiKey);
router.get('/usage', authMiddleware, developerAuthMiddleware, externalApiController.getUsageStats);
router.post('/user-config', authMiddleware, developerAuthMiddleware, externalApiController.updateUserConfig);
router.get('/user-config', authMiddleware, developerAuthMiddleware, externalApiController.getUserConfig);

module.exports = router;