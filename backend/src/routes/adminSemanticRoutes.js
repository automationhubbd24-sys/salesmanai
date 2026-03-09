const express = require('express');
const router = express.Router();
const adminSemanticController = require('../controllers/adminSemanticController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');
const abcAdminMiddleware = require('../middleware/abcAdminMiddleware');

// Get all semantic cache entries (Query: page_id, session_name, limit, offset)
router.get('/entries', adminAuthMiddleware, abcAdminMiddleware, adminSemanticController.getEntries);

// Add a manual entry (Golden Response)
router.post('/add', adminAuthMiddleware, abcAdminMiddleware, adminSemanticController.addEntry);

// Update an existing entry
router.put('/update/:id', adminAuthMiddleware, abcAdminMiddleware, adminSemanticController.updateEntry);

// Delete an entry
router.delete('/delete/:id', adminAuthMiddleware, abcAdminMiddleware, adminSemanticController.deleteEntry);

module.exports = router;
