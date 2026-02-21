const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Try to load dotenv from backend node_modules if not found in root
try {
    require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
} catch (e) {
    try {
        require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
    } catch (e2) {
        console.error("Could not load dotenv");
    }
}

// Import pgClient from backend
const { query } = require('../backend/src/services/pgClient');

// Config
const PORT = process.env.PORT || 3001;

async function runTest() {
    console.log("1. Setting up Test Environment...");
    
    // 1. Get a valid user
    let userId;
    try {
        const result = await query('SELECT user_id FROM user_configs LIMIT 1');
        if (result.rows.length === 0) {
            console.error("Failed to find a user in user_configs table.");
            return;
        }
        userId = result.rows[0].user_id;
        console.log(`   Using User ID: ${userId}`);
    } catch (e) {
        console.error("Database Error (Get User):", e.message);
        return;
    }

    // 2. Create/Upsert Dummy WhatsApp Session
    const sessionName = 'test_sim_session_v2';
    try {
        // Upsert query for Postgres
        const upsertQuery = `
            INSERT INTO whatsapp_message_database 
            (session_name, user_id, active, status, reply_message, text_prompt, image_detection)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (session_name) 
            DO UPDATE SET 
                user_id = EXCLUDED.user_id,
                active = EXCLUDED.active,
                status = EXCLUDED.status,
                reply_message = EXCLUDED.reply_message,
                text_prompt = EXCLUDED.text_prompt,
                image_detection = EXCLUDED.image_detection
        `;
        
        await query(upsertQuery, [
            sessionName,
            userId,
            true,
            'connected',
            true,
            "You are a helpful assistant.",
            true
        ]);
        console.log(`   Session '${sessionName}' configured.`);
    } catch (e) {
        console.error("Database Error (Upsert Session):", e.message);
        return;
    }

    // 3. Send Webhook Payload
    const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/640px-Image_created_with_a_mobile_phone.png";
    
    const payload = {
        event: "message",
        session: sessionName,
        payload: {
            id: "msg_" + Date.now(),
            timestamp: Math.floor(Date.now() / 1000),
            from: "8801700000000@c.us",
            to: "8801800000000@c.us",
            body: "",
            hasMedia: true,
            mediaUrl: imageUrl,
            mimetype: "image/png",
            _data: { notifyName: "Tester" }
        }
    };

    console.log("2. Sending Webhook...");
    try {
        const response = await axios.post(`http://localhost:${PORT}/whatsapp/webhook`, payload);
        console.log("   Webhook Response:", response.status, response.data);
    } catch (e) {
        console.error("   Webhook Failed:", e.message);
        if (e.code === 'ECONNREFUSED') {
            console.error("   Make sure the backend server is running on port " + PORT);
        }
    }

    console.log("3. Done. Check backend console logs for AI processing output.");
    process.exit(0);
}

runTest();
