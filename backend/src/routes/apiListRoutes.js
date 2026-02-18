const express = require('express');
const router = express.Router();
const apiListController = require('../controllers/apiListController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, apiListController.list);
router.post('/', authMiddleware, apiListController.create);
router.delete('/:id', authMiddleware, apiListController.remove);

module.exports = router;

