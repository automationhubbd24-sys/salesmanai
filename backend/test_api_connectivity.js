
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
            model: 'gemini-2.5-flash-lite',
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
    console.log('--- API Key Connectivity Test ---');

    // 1. Groq (Lite Engine)
    console.log('\n[Lite Engine - Groq]');
    const { data: liteKeys } = await supabase.from('lite_engine_keys').select('*').eq('status', 'active');
    if (!liteKeys || liteKeys.length === 0) {
        console.log('❌ No active keys in lite_engine_keys');
    } else {
        for (const k of liteKeys) {
            process.stdout.write(`Testing Key ${k.id.substring(0,8)}... (${k.api_key.substring(0, 8)}...): `);
            await testGroqKey(k.api_key);
        }
    }

    // 2. OpenRouter
    console.log('\n[OpenRouter Engine]');
    const { data: orKeys } = await supabase.from('openrouter_engine_keys').select('*').eq('is_active', true);
    if (!orKeys || orKeys.length === 0) {
        console.log('❌ No active keys in openrouter_engine_keys');
    } else {
        for (const k of orKeys) {
            process.stdout.write(`Testing Key ${k.id.substring(0,8)}... (${k.api_key.substring(0, 8)}...): `);
            await testOpenRouterKey(k.api_key);
        }
    }

    // 3. Gemini (Pro Engine)
    console.log('\n[Pro Engine - Gemini]');
    const { data: proKeys } = await supabase.from('api_list').select('*');
    if (!proKeys || proKeys.length === 0) {
        console.log('❌ No keys in api_list');
    } else {
        for (const k of proKeys) {
            // Filter out non-gemini keys if provider is known
            if (k.provider && k.provider !== 'google' && k.provider !== 'gemini') continue;
            
            process.stdout.write(`Testing Key ${k.id}... (${k.api.substring(0, 8)}...): `);
            await testGeminiKey(k.api);
        }
    }
}

runTests();
