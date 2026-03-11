const aiService = require('../services/aiService');

async function optimizePrompt(req, res) {
    try {
        const { promptText } = req.body;
        
        if (!promptText) {
            return res.status(400).json({ error: "Prompt text is required" });
        }

        const optimizedText = await aiService.optimizeSystemPrompt(promptText);
        
        return res.json({ 
            success: true, 
            optimizedPrompt: optimizedText 
        });

    } catch (error) {
        console.error("Optimization Controller Error:", error);
        const brandedError = aiService.formatBrandedError(error);
        return res.status(brandedError.code).json({ 
            error: brandedError.message,
            type: brandedError.type,
            details: error.message 
        });
    }
}

async function ingestKnowledge(req, res) {
    try {
        const { pageId, promptText } = req.body;
        
        if (!pageId || !promptText) {
            return res.status(400).json({ error: "Page ID and Text required" });
        }

        // Run ingestion in background (don't block response)
        // RAG REMOVED BY USER REQUEST
        
        return res.json({ success: true, message: "Ingestion skipped (RAG Disabled)" });

    } catch (error) {
        console.error("Ingestion Controller Error:", error);
        const brandedError = aiService.formatBrandedError(error);
        return res.status(brandedError.code).json({ 
            error: brandedError.message,
            type: brandedError.type
        });
    }
}

module.exports = {
    optimizePrompt,
    ingestKnowledge
};
