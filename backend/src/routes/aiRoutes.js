const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

router.post('/optimize-prompt', aiController.optimizePrompt);
router.post('/ingest', aiController.ingestKnowledge);

module.exports = router;
