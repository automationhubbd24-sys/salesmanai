const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Client } = require('pg');
const dbService = require('./src/services/dbService');

function parseArgs(argv) {
    const options = {
        session: null,
        page: null,
        productIds: [],
        limit: 20
    };

    for (const arg of argv) {
        if (arg.startsWith('--session=')) options.session = arg.split('=')[1] || null;
        else if (arg.startsWith('--page=')) options.page = arg.split('=')[1] || null;
        else if (arg.startsWith('--products=')) {
            options.productIds = (arg.split('=')[1] || '')
                .split(',')
                .map(v => Number(String(v || '').trim()))
                .filter(v => Number.isInteger(v) && v > 0);
        } else if (arg.startsWith('--limit=')) {
            const parsed = Number(arg.split('=')[1]);
            if (Number.isInteger(parsed) && parsed > 0) options.limit = parsed;
        }
    }

    return options;
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required.');
    }

    const options = parseArgs(process.argv.slice(2));
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        let sql = `
            SELECT *
            FROM products
            WHERE is_active = true
        `;
        const params = [];

        if (options.productIds.length > 0) {
            params.push(options.productIds);
            sql += ` AND id = ANY($${params.length}::int[])`;
        }

        const resourceId = options.session || options.page;
        if (resourceId) {
            params.push(String(resourceId));
            const pIdx = params.length;
            sql += `
                AND (
                    allowed_messenger_ids::jsonb @> jsonb_build_array($${pIdx}::text)
                    OR allowed_wa_sessions::jsonb @> jsonb_build_array($${pIdx}::text)
                )
            `;
        }

        params.push(options.limit);
        sql += ` ORDER BY id DESC LIMIT $${params.length}`;

        const result = await client.query(sql, params);
        console.log(`[Reindex] Found ${result.rows.length} active product(s) to refresh.`);

        for (const row of result.rows) {
            const summary = await dbService.refreshProductEmbeddingsNow(row);
            console.log(`[Reindex] Product ${row.id} | textUpdated=${summary.textUpdated} | imageUpdated=${summary.imageUpdated}`);
        }
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error('[Reindex] Failed:', error.message);
    process.exit(1);
});
