const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const controller = require('../controllers/shopifyController');
const router = express.Router();

router.get('/connect', authMiddleware, controller.connect);
router.get('/callback', controller.callback);
router.get('/status', authMiddleware, controller.status);
router.post('/sync', authMiddleware, controller.sync);
router.delete('/', authMiddleware, controller.disconnect);

module.exports = router;
