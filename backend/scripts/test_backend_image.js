require('dotenv').config();
const { analyzeAndMatchIncomingImage, formatImageAnalysisBlock } = require('../src/services/incomingImageAnalysisService');

async function test() {
    try {
        const result = await analyzeAndMatchIncomingImage({
            platform: 'messenger',
            pageId: '658762267328000',
            senderId: 'test_user',
            imageUrl: "https://scontent-sea5-1.xx.fbcdn.net/v/t1.15752-9/750255672_37001905662786555_6795699590536581825_n.jpg?_nc_cat=110&ccb=1-7&_nc_sid=eb2e90&_nc_ohc=lYZg_GZvq4QQ7kNvwF9jIMP&_nc_oc=Ado4ySZiQ5Vdf9gPWWyquyNMXqiQtx9jDzg9E5kTz2sUesLNbNNrI7794Ch8HKnUEWpl8ngSIaReTVGINb_9ZGGI&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=scontent-sea5-1.xx&oh=03_Q7cD5wEOS_63n24xz5wpjbrBy4Y0lwuHhzrZlHPKQZxAzeVdHg&oe=6A8132BD",
            imageIndex: 1,
            batchId: 'test_batch_1',
            pageConfig: {},
            prompt: ''
        });

        console.log("\n--- FORMATTED BLOCK FOR LLM ---");
        const block = formatImageAnalysisBlock(result);
        console.log(block);
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();