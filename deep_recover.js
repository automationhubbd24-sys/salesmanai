const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function run() {
    try {
        await client.connect();
        const res = await client.query("SELECT page_id FROM page_access_token_message WHERE name ILIKE '%বিসমিল্লাহ%' OR name ILIKE '%Bismillah%'");
        if (res.rows.length > 0) {
            const pid = res.rows[0].page_id;
            const chats = await client.query("SELECT text, created_at FROM fb_chats WHERE page_id = $1 AND created_at >= '2026-03-08 00:00:00' AND created_at <= '2026-03-09 23:59:59' ORDER BY created_at DESC", [pid]);
            
            const phones = new Set();
            const bMap = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
            
            chats.rows.forEach(r => {
                let t = (r.text || '').replace(/[০-৯]/g, d => bMap[d]);
                // Standard matches
                (t.match(/(?:01|8801|\+8801)\d{9}/g) || []).forEach(n => {
                    let c = n.replace(/\D/g, '');
                    if (c.startsWith('88')) c = c.slice(2);
                    if (c.length === 11) phones.add(c);
                });
                // Spaced/Manual matches
                (t.match(/01[3-9][\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}/g) || []).forEach(n => {
                    let c = n.replace(/\D/g, '');
                    if (c.length === 11) phones.add(c);
                });
            });

            const list = Array.from(phones).sort();
            console.log("RECOVERY_COUNT:" + list.length);
            list.forEach(p => console.log("PHONE:" + p));
        }
    } catch(e) {
        console.error(e.message);
    } finally {
        await client.end();
    }
}
run();
