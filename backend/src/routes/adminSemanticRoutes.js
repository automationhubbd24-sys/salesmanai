const express = require('express');
const router = express.Router();
const adminSemanticController = require('../controllers/adminSemanticController');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// Get all semantic cache entries (Query: page_id, session_name, limit, offset)
router.get('/entries', adminAuthMiddleware, adminSemanticController.getEntries);

// Add a manual entry (Golden Response)
router.post('/add', adminAuthMiddleware, adminSemanticController.addEntry);

// Update an existing entry
router.put('/update/:id', adminAuthMiddleware, adminSemanticController.updateEntry);

// Delete an entry
router.delete('/delete/:id', adminAuthMiddleware, adminSemanticController.deleteEntry);

module.exports = router;
