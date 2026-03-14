
require('dotenv').config();
const engine = require('./src/services/openrouterEngineService');

async function main() {
    console.log('🚀 Starting Real Model Picker Test (Gemini AI Judge)...');
    
    // engine is already an instance and has likely started its auto-update cycle in background.
    // We will just use its methods.
    
    try {
        // 1. Fetch Models
        console.log('📡 Fetching models from OpenRouter...');
        const allModels = await engine.fetchOpenRouterModels();
        
        // 2. Filter Free Models (Logic from service)
        const EXCLUDED_MODELS = [
            'qwen/qwen3-next-80b-a3b-instruct',
            'nousresearch/hermes-3-llama-3.1-405b:free',
            // Add any others we added in the file
        ];

        const freeModels = allModels.filter(m => 
            m.pricing && 
            (m.pricing.prompt === "0" || m.pricing.prompt === 0) && 
            (m.pricing.completion === "0" || m.pricing.completion === 0) &&
            !EXCLUDED_MODELS.some(ex => m.id.includes(ex))
        );

        console.log(`🆓 Found ${freeModels.length} Valid Free Models.`);

        // 3. Call AI Judge
        console.log('⚖️  Calling AI Judge (Gemini) to select best models...');
        // Note: selectBestModels uses keyService to get a Gemini key. 
        // Ensure keyService has a valid key in DB/Env.
        
        const selection = await engine.selectBestModels(freeModels);

        console.log('\n🏆 AI JUDGE SELECTION:');
        console.log(JSON.stringify(selection, null, 2));
        
        console.log('\n✅ Test Complete.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Test Failed:', error);
        process.exit(1);
    }
}

main();
