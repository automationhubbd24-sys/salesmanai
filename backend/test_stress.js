
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// const API_KEY = process.env.OPENROUTER_API_KEY;
const API_KEY = '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';
// const MODEL = 'arcee-ai/trinity-large-preview:free'; 
// const MODEL = 'upstage/solar-pro-3:free';
// const MODEL = 'liquid/lfm-2.5-1.2b-instruct:free';
const MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

const MAX_REQUESTS = 100;
const CONCURRENCY = 5; // Send 5 requests at a time

async function sendRequest(i) {
    try {
        const start = Date.now();
        await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: MODEL,
                messages: [{ role: 'user', content: 'Hi' }],
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'StressTest'
                },
                timeout: 10000 
            }
        );
        const duration = Date.now() - start;
        console.log(`✅ Request #${i}: Success (${duration}ms)`);
        return { success: true, duration };
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.log(`❌ Request #${i}: RATE LIMIT HIT (429)!`);
            return { success: false, status: 429 };
        } else {
            console.log(`⚠️ Request #${i}: Error ${error.response ? error.response.status : error.message}`);
            return { success: false, status: error.response ? error.response.status : 500 };
        }
    }
}

async function runStressTest() {
    console.log(`🧪 STARTING HEAVY STRESS TEST FOR: ${MODEL}`);
    console.log(`🎯 Goal: Send up to ${MAX_REQUESTS} requests (Concurrency: ${CONCURRENCY}) until 429.`);
    
    let successCount = 0;
    let limitHit = false;

    for (let i = 1; i <= MAX_REQUESTS; i += CONCURRENCY) {
        if (limitHit) break;

        const batch = [];
        for (let j = 0; j < CONCURRENCY && (i + j) <= MAX_REQUESTS; j++) {
            batch.push(sendRequest(i + j));
        }

        const results = await Promise.all(batch);
        
        for (const res of results) {
            if (res.success) {
                successCount++;
            } else if (res.status === 429) {
                limitHit = true;
                break; // Stop counting
            }
        }
        
        if (limitHit) {
            console.log('\n🛑 STOPPING TEST: Rate limit reached.');
            break;
        }

        // Small delay to be polite-ish but still stressful
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n---------------------------------------------');
    console.log(`📊 RESULTS for ${MODEL}`);
    console.log(`✅ Successful Requests: ${successCount}`);
    if (limitHit) {
        console.log(`❌ Rate Limit Hit at Request #${successCount + 1}`);
    } else {
        console.log(`🎉 Survived ${MAX_REQUESTS} requests without 429! -> CONSIDER UNLIMITED`);
    }
    console.log('---------------------------------------------');
}

runStressTest();
