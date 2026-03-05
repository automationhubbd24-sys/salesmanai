
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pgClient = require('../src/services/pgClient');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

async function testVoiceProcessing() {
    try {
        console.log("Starting Voice Test...");
        const audioUrl = 'https://cdn.fbsbx.com/v/t59.3654-21/641621865_2352137571927372_3690889597954407438_n.mp4/audioclip-1772033010000-2218.mp4?sdl=1&_nc_cat=110&ccb=1-7&_nc_sid=d61c36&_nc_ohc=Q-brSOWYVvAQ7kNvwFXJ9k9&_nc_oc=AdnWnaRn3hAAQ4_P-krg2fqBxrL7WdnhtZGLWFwzOCzeRN4LPK2yHIYN-plvgdBRDMNWPIPQ3XklwRwzO_w51ZQy&_nc_zt=28&_nc_ht=cdn.fbsbx.com&_nc_gid=sQUSByAPO2XlptjPHzRV0g&oh=03_Q7cD4gHGyfCSuMDPQCcfrpQu-VDuXFmDYg-RtR20aUinytGxdA&oe=69A0E870';
        
        // 1. Fetch ALL Groq Keys for Rotation (Avoid using same key repeatedly)
        const keysRes = await pgClient.query("SELECT api FROM api_list WHERE provider = 'groq' AND status = 'active'");
        const keys = keysRes.rows.map(r => r.api);
        
        if (keys.length === 0) {
            console.error("❌ No active Groq keys found!");
            process.exit(1);
        }

        // Randomly select a key to avoid hitting the same one
        const selectedKey = keys[Math.floor(Math.random() * keys.length)];
        console.log(`Using Groq Key: ${selectedKey.substring(0, 10)}... (Rotation Active)`);

        // 2. Download Audio File
        console.log("Downloading audio...");
        const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const fileName = `test_audio_${Date.now()}.mp4`;
        const filePath = path.join(__dirname, fileName);
        
        fs.writeFileSync(filePath, buffer);
        console.log(`Audio saved to ${filePath}`);

        // 3. Send to Groq Whisper
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('model', 'whisper-large-v3');
        form.append('response_format', 'verbose_json');

        console.log("Transcribing with Groq Whisper...");
        const transRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: {
                'Authorization': `Bearer ${selectedKey}`,
                ...form.getHeaders()
            },
            timeout: 30000
        });

        console.log("\n✅ Transcription Success:");
        console.log("Text:", transRes.data.text);
        console.log("Language:", transRes.data.language);
        console.log("Duration:", transRes.data.duration);

        // Cleanup
        fs.unlinkSync(filePath);
        process.exit(0);

    } catch (err) {
        console.error("❌ Transcription Failed:", err.response?.data || err.message);
        process.exit(1);
    }
}

testVoiceProcessing();
