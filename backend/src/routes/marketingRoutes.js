const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');
const authMiddleware = require('../middleware/authMiddleware');

// Standard Marketing Routes
router.post('/campaign/start', authMiddleware, marketingController.startCampaign);
router.get('/campaign/:id', authMiddleware, marketingController.getCampaignStatus);
router.get('/campaigns', authMiddleware, marketingController.listCampaigns);

module.exports = router;