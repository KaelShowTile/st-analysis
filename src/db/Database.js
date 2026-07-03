import Database from '@tauri-apps/plugin-sql';
import { load } from '@tauri-apps/plugin-store';

let dbPromise = null;

export const getDbPath = async () => {
    const store = await load('settings.json', { autoSave: false });
    const customPath = await store.get('customDbPath');
    return customPath || null;
};

export const getDb = async () => {
    if (!dbPromise) {
        dbPromise = (async () => {
            const store = await load('settings.json', { autoSave: false });
            const customPath = await store.get('customDbPath');
            
            // For plugin-sql, absolute paths must be prefixed with sqlite:
            let connectionString = 'sqlite:inventory.db';
            if (customPath) {
                connectionString = `sqlite:${customPath}`;
            }

            const db = await Database.load(connectionString);
            await initializeTables(db);
            return db;
        })();
    }
    return dbPromise;
};

const initializeTables = async (db) => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS inventory (
            product_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT UNIQUE,
            stock_no TEXT,
            sales_description TEXT,
            supplier TEXT,
            available REAL,
            holding REAL,
            so_qty REAL,
            total_qty REAL,
            rrp REAL,
            cost REAL,
            online_name TEXT,
            showtile_name TEXT,
            pallet_qty REAL,
            box_qty REAL,
            piece_qty REAL,
            m2_per_box REAL,
            pcs_per_box REAL,
            box_per_pallet REAL,
            stk TEXT,
            days REAL,
            x_inactive TEXT,
            batch TEXT,
            location TEXT,
            extracted_name TEXT,
            extracted_finish TEXT,
            extracted_size TEXT,
            extracted_colour TEXT,
            backorder INTEGER DEFAULT 0,
            backorder_amount REAL DEFAULT 0
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS attributes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT, -- 'finish', 'colour'
            value TEXT
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            start_date TEXT,
            end_date TEXT,
            data TEXT
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            time TEXT,
            sales_person TEXT,
            customer TEXT,
            invoice_no TEXT,
            sku TEXT,
            description TEXT,
            qty REAL,
            total_ex_tax REAL,
            cost_ex_tax REAL
        )
    `);

    try {
        await db.execute('DROP INDEX IF EXISTS idx_sales_invoice_sku');
    } catch (e) {
        console.warn("Could not drop unique index on sales.", e);
    }
    
    // Check if theme setting exists, if not set to system or dark
    const result = await db.select("SELECT value FROM settings WHERE key = 'theme'");
    if (result.length === 0) {
        await db.execute("INSERT INTO settings (key, value) VALUES ('theme', 'system')");
    }

    // Migrations
    try {
        await db.execute('ALTER TABLE inventory ADD COLUMN backorder INTEGER DEFAULT 0');
    } catch (e) {
        // Column likely already exists
    }
    
    try {
        await db.execute('ALTER TABLE inventory ADD COLUMN backorder_amount REAL DEFAULT 0');
    } catch (e) {
        // Column likely already exists
    }

    try {
        await db.execute('ALTER TABLE reports ADD COLUMN start_date TEXT');
    } catch (e) {
        // Column likely already exists
    }

    // Auth System
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            permissions TEXT
        )
    `);

    const usersCount = await db.select("SELECT COUNT(*) as count FROM users");
    if (usersCount[0].count === 0) {
        const fullPermissions = JSON.stringify({
            inventory: { read: true, write: true },
            sales: { read: true, write: true },
            reports: { read: true, write: true },
            settings: { read: true, write: true }
        });
        await db.execute(
            "INSERT INTO users (username, password, permissions) VALUES ($1, $2, $3)", 
            ['admin', 'admin123', fullPermissions]
        );
    }
};
