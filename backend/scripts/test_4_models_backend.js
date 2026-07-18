require('dotenv').config();
const { analyzeAndMatchIncomingImage, formatImageAnalysisBlock } = require('../src/services/incomingImageAnalysisService');

process.env.DATABASE_URL = "postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres";
process.env.VISION_BASE_URL = "https://gemini.salesmanchatbot.online/v1";
process.env.VISION_API_KEY = "sk-fa8d1997a7838fdc6fdb1f51c763bd36ae0bbec5d153d555";
process.env.GEMINI_API_KEY = "AIzaSyAxV45HkNGsWTO7mRBgkFhmIW7cPxdBGdk";
process.env.PROXY = "";
process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";

const models = [
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash"
];

const imageUrl = "https://scontent-sea5-1.xx.fbcdn.net/v/t1.15752-9/750255672_37001905662786555_6795699590536581825_n.jpg?_nc_cat=110&ccb=1-7&_nc_sid=eb2e90&_nc_ohc=lYZg_GZvq4QQ7kNvwF9jIMP&_nc_oc=Ado4ySZiQ5Vdf9gPWWyquyNMXqiQtx9jDzg9E5kTz2sUesLNbNNrI7794Ch8HKnUEWpl8ngSIaReTVGINb_9ZGGI&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=scontent-sea5-1.xx&oh=03_Q7cD5wEOS_63n24xz5wpjbrBy4Y0lwuHhzrZlHPKQZxAzeVdHg&oe=6A8132BD";

async function run() {
    for (const model of models) {
        console.log(`\n======================================================`);
        console.log(`TESTING MODEL ON BACKEND SERVICE: ${model}`);
        console.log(`======================================================`);
        try {
            const result = await analyzeAndMatchIncomingImage({
                platform: 'messenger',
                pageId: '658762267328000',
                senderId: 'test_user',
                imageUrl: imageUrl,
                imageIndex: 1,
                batchId: 'test_batch_' + model,
                pageConfig: { vision_model: model },
                prompt: ''
            });

            console.log("\n--- RESULTING PROMPT BLOCK FOR LLM ---");
            const block = formatImageAnalysisBlock(result);
            console.log(block);
        } catch (err) {
            console.error("Error:", err.message);
        }
    }
    process.exit(0);
}
run();