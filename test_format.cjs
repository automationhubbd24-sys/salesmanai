const { formatImageAnalysisBlock } = require('./backend/src/services/incomingImageAnalysisService');

const result1 = {
    imageIndex: 1,
    analysisText: "Analyzer Summary: User wants a blue bag.",
    matchedProducts: [
        { product_id: '522', name: 'billow ocean', match_score: 68.43 }
    ],
    matchDecision: {
        vision_reasoning_text: "```json\n{\n  \"status\": \"no_match\",\n  \"best_product_id\": null,\n  \"best_product_name\": null,\n  \"confidence\": \"high\",\n  \"reasoning\": \"The user's image shows a light blue denim tote bag. None match.\",\n  \"per_image_match\": []\n}\n```"
    }
};

const result2 = {
    imageIndex: 2,
    analysisText: "Analyzer Summary: User wants a red bag.",
    matchedProducts: [
        { product_id: '517', name: 'Deep sea solid', match_score: 88.0 }
    ],
    matchDecision: {
        vision_reasoning_text: "I am a vision model and I think this is a red bag. No json."
    }
};

const result3 = {
    imageIndex: 3,
    analysisText: "Analyzer Summary: User wants a green bag.",
    matchedProducts: [
        { product_id: '520', name: 'bow bag', match_score: 95.0 }
    ],
    matchDecision: {}
};

console.log("=== SCENARIO 1 (Valid New JSON) ===");
console.log(formatImageAnalysisBlock(result1));
console.log("\n=== SCENARIO 2 (Plain Text / JSON Failed) ===");
console.log(formatImageAnalysisBlock(result2));
console.log("\n=== SCENARIO 3 (No Reasoning Text) ===");
console.log(formatImageAnalysisBlock(result3));
