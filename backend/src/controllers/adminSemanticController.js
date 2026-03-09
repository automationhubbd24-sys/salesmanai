const dbService = require('../services/dbService');

/**
 * Get all semantic cache entries for a specific page or session
 */
exports.getEntries = async (req, res) => {
    try {
        const { page_id, session_name, limit, offset } = req.query;
        const entries = await dbService.getSemanticCacheEntries({
            page_id: page_id || null,
            session_name: session_name || null,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });
        res.json({ success: true, entries });
    } catch (error) {
        console.error('[AdminSemantic] getEntries error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Add a manual semantic cache entry (Golden Response)
 */
exports.addEntry = async (req, res) => {
    try {
        const { page_id, session_name, context_id, question, response } = req.body;
        if (!question || !response) {
            return res.status(400).json({ success: false, error: 'Question and response are required' });
        }
        
        await dbService.saveSemanticCacheEntry({
            page_id: page_id || null,
            session_name: session_name || null,
            context_id: context_id || null,
            question,
            response
        });
        
        res.json({ success: true, message: 'Manual cache entry added successfully' });
    } catch (error) {
        console.error('[AdminSemantic] addEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Update an existing semantic cache entry
 */
exports.updateEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const { question, response } = req.body;
        
        const success = await dbService.updateSemanticCacheEntry(id, { question, response });
        if (success) {
            res.json({ success: true, message: 'Cache entry updated' });
        } else {
            res.status(404).json({ success: false, error: 'Entry not found or update failed' });
        }
    } catch (error) {
        console.error('[AdminSemantic] updateEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Delete a semantic cache entry
 */
exports.deleteEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const success = await dbService.deleteSemanticCacheEntry(id);
        if (success) {
            res.json({ success: true, message: 'Cache entry deleted' });
        } else {
            res.status(404).json({ success: false, error: 'Entry not found' });
        }
    } catch (error) {
        console.error('[AdminSemantic] deleteEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
