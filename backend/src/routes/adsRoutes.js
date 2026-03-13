const express = require('express');
const router = express.Router();
const adsController = require('../controllers/adsController');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/ads?user_id=...&team_owner=...
router.get('/', adsController.getAds);

// POST /api/ads
router.post('/', adsController.saveAd);

// DELETE /api/ads?ad_id=...&page_id=...
router.delete('/', adsController.deleteAd);

module.exports = router;
