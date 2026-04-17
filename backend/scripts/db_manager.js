const { getPool } = require('../src/services/pgClient');
require('dotenv').config();

const args = process.argv.slice(2);
const command = args[0];
const param1 = args[1];

function printHelp() {
    console.log(`
Usage: node db_manager.js <command> [param]

Commands:
  list-tables                 List all tables in the database
  list-columns <table_name>   List all columns in a specific table
  query <sql_query>           Execute a raw SQL query (READ/WRITE)
  
Examples:
  node db_manager.js list-tables
  node db_manager.js list-columns users
  node db_manager.js query "SELECT * FROM users LIMIT 5"
  node db_manager.js query "ALTER TABLE users ADD COLUMN new_col TEXT"
    `);
}

async function listTables(client) {
    const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
    `);
    console.log('Tables:');
    res.rows.forEach(r => console.log(` - ${r.table_name}`));
}

async function listColumns(client, tableName) {
    if (!tableName) {
        console.error('Error: Table name required.');
        return;
    }
    const res = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
    `, [tableName]);
    
    if (res.rows.length === 0) {
        console.log(`No columns found for table '${tableName}' (or table does not exist).`);
        return;
    }

    console.log(`Columns for '${tableName}':`);
    res.rows.forEach(r => {
        console.log(` - ${r.column_name} (${r.data_type}, ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'})`);
    });
}

async function executeQuery(client, query) {
    if (!query) {
        console.error('Error: SQL query required.');
        return;
    }
    try {
        console.log(`Executing: ${query}`);
        const res = await client.query(query);
        if (res.command === 'SELECT') {
            console.log(`Rows returned: ${res.rowCount}`);
            console.table(res.rows);
        } else {
            console.log(`Command: ${res.command}`);
            console.log(`Rows affected: ${res.rowCount}`);
        }
    } catch (err) {
        console.error('Query Error:', err.message);
    }
}

async function main() {
    if (!command) {
        printHelp();
        process.exit(0);
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
        switch (command) {
            case 'list-tables':
                await listTables(client);
                break;
            case 'list-columns':
                await listColumns(client, param1);
                break;
            case 'query':
                await executeQuery(client, param1);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                printHelp();
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        // Force exit after a short delay to allow logs to flush
        setTimeout(() => process.exit(0), 100);
    }
}

main();
