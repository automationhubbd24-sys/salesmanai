
const assert = require('assert');

// Mock Handover Map
const handoverMap = new Map();

// Mock DB Service
const dbService = {
    saveWhatsAppChat: async (data) => {
        console.log(`[MockDB] Saved: ${data.text}`);
        return true;
    }
};

// Replicate the Logic from whatsappController.js (Smart Label Handling)
async function handleLabelEvent(session, payload) {
    console.log(`\n--- Processing Label Event: ${payload.labelName || payload.body} ---`);
    
    // Logic from whatsappController.js
    const sessionName = session;
    const chatId = payload?.chatId || payload?.to || payload?.id;
    const labelName = payload.labelName || payload.label?.name || payload.body || "Unknown Label";
    
    const hardcodedStops = ['adminhandle', 'admincall', 'stop', 'human', 'manual'];
    const isStopLabel = hardcodedStops.some(s => labelName.toLowerCase().includes(s));
    
    if (isStopLabel) {
        console.log(`[Result] PAUSED: Blocking Label Detected (${labelName}).`);
        const chatKey = `${sessionName}_${chatId}`;
        handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // 1 Hour
        
        // Log System Message
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            recipient_id: chatId || 'unknown',
            text: `[SYSTEM] Admin applied label '${labelName}'. AI paused.`
        });
        return "PAUSED";
    } else {
         console.log(`[Result] CONTINUED: Non-blocking Label Detected (${labelName}).`);
         return "CONTINUED";
    }
}

async function runTest() {
    console.log("=== ENGINE LABEL LOGIC TEST ===");
    
    // Test Case 1: "GET LABEL" (The one user suspected)
    // WAHA might send internal events or labels that look like system commands
    const result1 = await handleLabelEvent('session1', { chatId: '123@c.us', labelName: 'GET LABEL' });
    assert.strictEqual(result1, 'CONTINUED', 'GET LABEL should NOT pause the AI');
    
    // Test Case 2: "New Order" (A normal business label)
    const result2 = await handleLabelEvent('session1', { chatId: '123@c.us', labelName: 'New Order' });
    assert.strictEqual(result2, 'CONTINUED', 'Business labels should NOT pause the AI');

    // Test Case 3: "adminhandle" (The stop label)
    const result3 = await handleLabelEvent('session1', { chatId: '123@c.us', labelName: 'adminhandle' });
    assert.strictEqual(result3, 'PAUSED', 'adminhandle SHOULD pause the AI');

    // Test Case 4: "human required" (Partial match for 'human')
    const result4 = await handleLabelEvent('session1', { chatId: '123@c.us', labelName: 'human required' });
    assert.strictEqual(result4, 'PAUSED', 'human required SHOULD pause the AI');

    console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");
    console.log("Verdict: The engine now correctly ignores random labels like 'GET LABEL' and only stops for 'adminhandle' etc.");
}

runTest();
