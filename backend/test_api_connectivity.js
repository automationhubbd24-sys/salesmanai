
const { Pool } = require('pg');
const OpenAI = require('openai');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false
});

async function testGroqKey(apiKey) {
    try {
        const groq = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.groq.com/openai/v1'
        });
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 5
        });
        console.log(` ✅ SUCCESS (Model: ${completion.model})`);
        return { success: true };
    } catch (e) {
        console.log(` ❌ FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function testOpenRouterKey(apiKey) {
    try {
        const openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: apiKey,
        });
        const completion = await openai.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5
        });
        console.log(` ✅ SUCCESS (Model: ${completion.model})`);
        return { success: true };
    } catch (e) {
        console.log(` ❌ FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function testGeminiKey(apiKey) {
    try {
        const openai = new OpenAI({ 
            apiKey: apiKey, 
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' 
        });

        const completion = await openai.chat.completions.create({
            model: 'gemini-2.0-flash',
            messages: [{ role: 'user', content: 'hi from SalesmanChatbot key test' }],
            max_tokens: 8
        });
        console.log(` ✅ SUCCESS (Model: ${completion.model})`);
        return { success: true };
    } catch (e) {
        console.log(` ❌ FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function runTests() {
    console.log('--- API Key Connectivity Test (PostgreSQL) ---');

    try {
        // 1. Groq (Lite Engine)
        console.log('\n[Lite Engine - Groq]');
        const liteRes = await pool.query("SELECT * FROM lite_engine_keys WHERE status = 'active'");
        const liteKeys = liteRes.rows;
        
        if (!liteKeys || liteKeys.length === 0) {
            console.log('❌ No active keys in lite_engine_keys');
        } else {
            for (const k of liteKeys) {
                process.stdout.write(`Testing Key ${k.id}... (${k.api_key.substring(0, 8)}...): `);
                await testGroqKey(k.api_key);
            }
        }

        // 2. OpenRouter
        console.log('\n[OpenRouter Engine]');
        const orRes = await pool.query("SELECT * FROM openrouter_engine_keys WHERE is_active = true");
        const orKeys = orRes.rows;

        if (!orKeys || orKeys.length === 0) {
            console.log('❌ No active keys in openrouter_engine_keys');
        } else {
            for (const k of orKeys) {
                process.stdout.write(`Testing Key ${k.id}... (${k.api_key.substring(0, 8)}...): `);
                await testOpenRouterKey(k.api_key);
            }
        }

        // 3. Gemini (Pro Engine)
        console.log('\n[Pro Engine - Gemini]');
        const proRes = await pool.query("SELECT * FROM api_list");
        const proKeys = proRes.rows;

        if (!proKeys || proKeys.length === 0) {
            console.log('❌ No keys in api_list');
        } else {
            for (const k of proKeys) {
                process.stdout.write(`Testing Key ${k.id}... (${k.api_key.substring(0, 8)}...): `);
                await testGeminiKey(k.api_key);
            }
        }

    } catch (err) {
        console.error("Error running tests:", err);
    } finally {
        await pool.end();
    }
}

runTests();
