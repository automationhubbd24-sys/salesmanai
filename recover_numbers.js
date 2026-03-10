const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function extractNumbers() {
    try {
        await client.connect();
        console.log("--- Bismillah Homeo Chamber: Deep Search Started ---");

        // Step 1: Find correct Page/Session for Bismillah Homeo Chamber
        const bismillahPages = await client.query(`
            SELECT page_id, name, 'messenger' as platform FROM page_access_token_message WHERE name ILIKE '%বিসমিল্লাহ%' OR name ILIKE '%Bismillah%'
            UNION
            SELECT session_name as page_id, name, 'whatsapp' as platform FROM whatsapp_message_database WHERE name ILIKE '%বিসমিল্লাহ%' OR name ILIKE '%Bismillah%'
        `);

        if (bismillahPages.rows.length === 0) {
            console.log("No Bismillah pages found in database.");
            return;
        }

        console.log("Found Pages:", bismillahPages.rows);

        const allLeads = [];
        const uniquePhones = new Set();

        for (const page of bismillahPages.rows) {
            const pid = page.page_id;
            const platform = page.platform;
            console.log(`\nScanning ${platform} (ID: ${pid})...`);

            let messages = [];
            if (platform === 'messenger') {
                const res = await client.query(`
                    SELECT text, sender_id, created_at as timestamp 
                    FROM fb_chats 
                    WHERE page_id = $1 
                    AND created_at >= '2026-03-08 00:00:00'
                `, [pid]);
                messages = res.rows;
            } else {
                const res = await client.query(`
                    SELECT text, sender_id, to_timestamp(timestamp/1000) as timestamp 
                    FROM whatsapp_chats 
                    WHERE session_name = $1 
                    AND to_timestamp(timestamp/1000) >= '2026-03-08 00:00:00'
                `, [pid]);
                messages = res.rows;
            }

            console.log(`Fetched ${messages.length} messages.`);

            messages.forEach(row => {
                const text = row.text || '';
                // Standard 11 digit BD number detection
                const matches = text.match(/01[3-9]\d{8}/g);
                if (matches) {
                    matches.forEach(num => {
                        if (!uniquePhones.has(num)) {
                            uniquePhones.add(num);
                            allLeads.push({ phone: num, sender: row.sender_id, time: row.timestamp, platform, text: text.substring(0, 100) });
                        }
                    });
                }
                
                // Detection for numbers with spaces or dashes
                const spacedMatches = text.match(/01[3-9][\s-]\d{4}[\s-]\d{4}/g);
                if (spacedMatches) {
                    spacedMatches.forEach(num => {
                        const clean = num.replace(/\D/g, '');
                        if (clean.length === 11 && !uniquePhones.has(clean)) {
                            uniquePhones.add(clean);
                            allLeads.push({ phone: clean, sender: row.sender_id, time: row.timestamp, platform, text: text.substring(0, 100) });
                        }
                    });
                }

                // Bangla digits detection
                const banglaMap = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
                const textWithEnglishDigits = text.replace(/[০-৯]/g, d => banglaMap[d]);
                const banglaMatches = textWithEnglishDigits.match(/01[3-9]\d{8}/g);
                if (banglaMatches) {
                    banglaMatches.forEach(num => {
                        if (!uniquePhones.has(num)) {
                            uniquePhones.add(num);
                            allLeads.push({ phone: num, sender: row.sender_id, time: row.timestamp, platform, text: text.substring(0, 100) });
                        }
                    });
                }
            });
        }

        console.log(`\n--- RECOVERY RESULT: FOUND ${allLeads.length} UNIQUE NUMBERS ---`);
        
        // Output in a format that can be easily read or copied
        allLeads.sort((a, b) => b.time - a.time); // Latest first
        
        allLeads.forEach((lead, i) => {
            console.log(`${i+1}. [${lead.phone}] | Platform: ${lead.platform} | Sender: ${lead.sender} | Time: ${lead.time.toISOString()}`);
            console.log(`   Message: "${lead.text}..."`);
            console.log('----------------------------------------------------');
        });

    } catch (err) {
        console.error("Extraction Failed:", err);
    } finally {
        await client.end();
    }
}

extractNumbers();
