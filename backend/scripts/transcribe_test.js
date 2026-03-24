require('dotenv').config({ path: '.env' });
const aiService = require('../src/services/aiService');
const dbService = require('../src/services/dbService');

const sessionName = process.env.WHATSAPP_SESSION || 'bottow_wh03lz';
const audioUrl = process.env.AUDIO_URL || 'https://wahubbd.salesmanchatbot.online/api/files/bottow_wh03lz/A50DA852A16A9E9F36FEE92E8FC43587.mp3';

const run = async () => {
    const config = await dbService.getWhatsAppConfig(sessionName);
    const result = await aiService.transcribeAudio(audioUrl, config || {});
    console.log('TRANSCRIBE_RESULT:', result);
};

run().catch(err => {
    console.error('TRANSCRIBE_ERROR:', err.message);
    process.exit(1);
});
