const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS keys (
            key TEXT PRIMARY KEY,
            discord_id TEXT,
            hwid TEXT,
            banned INTEGER DEFAULT 0
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            last_reset TEXT
        )
    `);
});

module.exports = db;
