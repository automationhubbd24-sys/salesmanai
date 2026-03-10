const { OpenAI } = require('openai');

/**
 * এই স্ক্রিপ্টটি সরাসরি অফিসিয়াল 'openai' লাইব্রেরি ব্যবহার করে 
 * আমাদের এপিআই এন্ডপয়েন্ট টেস্ট করবে। এটি প্রমাণ করবে যে আমাদের 
 * এপিআই এখন পুরোপুরি OpenAI Compatible.
 */

const API_KEY = 'salesmanchatbot-2eacc0b72391c9436e02fc45245262229953778b314b0acf';
const BASE_URL = 'https://api.salesmanchatbot.online/api/external/v1';

async function testOpenAICompatibility() {
    console.log("--- OpenAI SDK Compatibility Test ---");
    console.log(`Using Base URL: ${BASE_URL}`);
    
    // অফিসিয়াল OpenAI ক্লায়েন্ট কনফিগারেশন
    const client = new OpenAI({
        apiKey: API_KEY,
        baseURL: BASE_URL
    });

    try {
        console.log(`\n[Step 1] Sending "hi" using OpenAI SDK...`);
        
        const response = await client.chat.completions.create({
            model: "salesmanchatbot-pro",
            messages: [
                { role: "user", content: "hi" }
            ],
            stream: false
        });

        console.log("\n✅ SUCCESS: OpenAI SDK received response!");
        console.log("-----------------------------------------");
        console.log(`Model Used: ${response.model}`);
        console.log(`AI Reply: ${response.choices[0].message.content}`);
        console.log(`Total Tokens: ${response.usage.total_tokens}`);
        console.log("-----------------------------------------");

    } catch (error) {
        console.log("\n❌ SDK TEST FAILED:");
        if (error.response) {
            console.log(`Status: ${error.status}`);
            console.log("Error Data:", JSON.stringify(error.body, null, 2));
        } else {
            console.log("Message:", error.message);
        }
        
        console.log("\nপরামর্শ: যদি ৪২৯ (Rate Limit) আসে, তবে আপনার জেমিনি কী পরিবর্তন করুন।");
    }
}

testOpenAICompatibility();
