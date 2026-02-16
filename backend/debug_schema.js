
require('dotenv').config();
const { supabase } = require('./src/services/dbService');

async function testSchema() {
    console.log("--- Starting Diagnostics ---");

    // 1. Check whatsapp_message_database columns (lock_emojis)
    console.log("1. Testing whatsapp_message_database columns...");
    try {
        const { data, error } = await supabase
            .from('whatsapp_message_database')
            .select('lock_emojis, unlock_emojis')
            .limit(1);
        
        if (error) {
            console.error("❌ Error selecting emoji columns:", error.message);
            console.error("Hint: The columns 'lock_emojis' and 'unlock_emojis' likely do not exist in 'whatsapp_message_database' table.");
        } else {
            console.log("✅ Columns exist. Data sample:", data);
        }
    } catch (e) {
        console.error("❌ Exception checking message database:", e.message);
    }

    // 2. Check whatsapp_contacts lock update
    console.log("\n2. Testing whatsapp_contacts lock update...");
    const testSession = 'test_session_debug';
    const testPhone = '1234567890@c.us';
    
    try {
        // Try simple update
        const { data, error } = await supabase
            .from('whatsapp_contacts')
            .upsert({
                session_name: testSession,
                phone_number: testPhone,
                is_locked: true,
                name: 'Debug User',
                last_interaction: new Date().toISOString()
            }, { onConflict: 'session_name, phone_number' })
            .select();

        if (error) {
            console.error("❌ Error upserting lock status:", error.message);
            console.error("Full Error:", JSON.stringify(error, null, 2));
        } else {
            console.log("✅ Lock upsert successful:", data);
            
            // Clean up
            await supabase.from('whatsapp_contacts').delete().eq('session_name', testSession).eq('phone_number', testPhone);
        }
    } catch (e) {
        console.error("❌ Exception checking lock status:", e.message);
    }
}

testSchema();
