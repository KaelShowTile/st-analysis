import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, Search, Trash2, Edit3, X, Save, RefreshCw } from 'lucide-react';
import { save, confirm } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getDb } from '../db/Database';
import { getLocalTodayStrSync } from '../utils/timezone';
import { normalizeSize, findBestMatch, extractFeatures } from '../utils/featureExtractor';
import './Inventory.css';

export { normalizeSize, findBestMatch, extractFeatures };

const parseCsvNumber = (val) => {
    if (!val) return 0;
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    return isNaN(num) ? 0 : num;
};

const parseInventoryCsvRow = (row) => {
    const sku = String(row['SKU'] || '').trim();
    const stock_no = String(row['Stock No.'] || '');
    const sales_desc = String(row['Sales Description'] || '');
    const supplier = String(row['Supplier'] || '');
    const available = parseCsvNumber(row['Available Qty'] || row['Available']);
    const holding = parseCsvNumber(row['Holding']);
    const so_qty = parseCsvNumber(row['SO Qty']);
    const total_qty = parseCsvNumber(row['Total Qty']);
    const rrp = parseCsvNumber(row['RRP']);
    const cost = parseCsvNumber(row['Cost']);
    const online_name = String(row['Online(the name using on online sale)'] || row['Online'] || '');
    const showtile = String(row['Showtile(The name use in store sale)'] || row['Showtile'] || '');
    const pallet_qty = parseCsvNumber(row['Pallet Qty']);
    const box_qty = parseCsvNumber(row['Box Qty']);
    const piece_qty = parseCsvNumber(row['Piece Qty']);
    const m2_per_box = parseCsvNumber(row['m2/Box']);
    const pcs_per_box = parseCsvNumber(row['pcs/Box']);
    const box_per_pallet = parseCsvNumber(row['box/Pallet']);
    const stk = String(row['STK'] || '');

    let days = '';
    if (row['Days'] !== undefined && row['Days'] !== '') {
        const daysNum = parseFloat(String(row['Days']).replace(/,/g, '').trim());
        if (!isNaN(daysNum)) {
            const d = new Date();
            d.setDate(d.getDate() - daysNum);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            days = `${year}-${month}-${day}`;
        }
    }

    const x_inactive = String(row['X/Inactive'] || '');
    const batch = String(row['Batch'] || '');
    const location = String(row['Location'] || '');

    return {
        sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty,
        rrp, cost, online_name, showtile, pallet_qty, box_qty, piece_qty,
        m2_per_box, pcs_per_box, box_per_pallet, stk, days, x_inactive, batch, location
    };
};

const syncBackorderItems = async (db, backorderItemsToSync) => {
    for (const b of backorderItemsToSync) {
        try {
            await db.execute(`
                INSERT INTO order_batch (product_id, sku, description, amount, created_date)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT(sku) DO UPDATE SET
                    product_id = COALESCE(excluded.product_id, order_batch.product_id),
                    description = excluded.description,
                    amount = excluded.amount,
                    created_date = excluded.created_date
            `, [b.product_id, b.sku, b.description, b.amount, b.created_date]);
        } catch (obErr) {
            console.warn("Failed to sync order_batch row:", obErr);
        }
    }
};

export default function Inventory({ currentUser }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [renderLimit, setRenderLimit] = useState(50);
    const [attributes, setAttributes] = useState({ colours: [], finishes: [] });
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [editModal, setEditModal] = useState({ show: false, item: null, field: '', val: '', options: [] });
    const fileInputRef = useRef(null);
    const matchingFileInputRef = useRef(null);
    const recoverFileInputRef = useRef(null);

    const canWrite = currentUser?.permissions?.inventory?.write;

    const loadData = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const db = await getDb();
            const results = await db.select('SELECT * FROM inventory ORDER BY product_id DESC');
            setData(results);

            const attrs = await db.select('SELECT type, value FROM attributes');
            setAttributes({
                colours: attrs.filter(a => a.type === 'colour').map(a => a.value),
                finishes: attrs.filter(a => a.type === 'finish').map(a => a.value),
            });
        } finally {
            if (showSpinner) setLoading(false);
        }
    };

    useEffect(() => {
        loadData(true);
        const handleSync = () => loadData(false);
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, []);


    const handleAutoAnalysis = async () => {
        if (!canWrite) return;
        setLoading(true);
        try {
            const db = await getDb();
            const attributes = await db.select('SELECT * FROM attributes');
            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.trim());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.trim());

            // Retrieve all rows where extracted_name is empty or null
            const rows = await db.select("SELECT product_id, sku, sales_description, product_parent_id FROM inventory WHERE extracted_name IS NULL OR extracted_name = ''");

            for (const row of rows) {
                const salesDesc = String(row.sales_description || '');
                const features = extractFeatures(salesDesc, colours, finishes);

                await db.execute(`
                    UPDATE inventory SET 
                        extracted_name = $1, extracted_colour = $2, extracted_finish = $3, 
                        extracted_size = $4, backorder = $5, backorder_amount = $6 
                    WHERE sku = $7
                `, [features.extractedName, features.extractedColour, features.extractedFinish, features.extractedSize, features.backorder, features.backorder_amount, row.sku]);

                if (features.backorder === 1) {
                    try {
                        const todayStr = getLocalTodayStrSync();
                        await db.execute(`
                            INSERT INTO order_batch (product_id, sku, description, amount, created_date)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT(sku) DO UPDATE SET
                                product_id = COALESCE(excluded.product_id, order_batch.product_id),
                                description = excluded.description,
                                amount = excluded.amount,
                                created_date = excluded.created_date
                        `, [row.product_parent_id || null, row.sku, salesDesc, features.backorder_amount, todayStr]);
                    } catch (obErr) {
                        console.warn("Failed to sync order_batch in auto analysis:", obErr);
                    }
                }
            }
            loadData();
            alert(`Auto Analysis complete. Processed ${rows.length} records.`);
        } catch (err) {
            console.error(err);
            alert("Auto Analysis failed");
        } finally {
            setLoading(false);
        }
    };

    const processData = async (parsedData) => {
        if (!canWrite) return;
        setLoading(true);
        try {
            const db = await getDb();
            const attributes = await db.select('SELECT * FROM attributes');

            const allInventory = await db.select('SELECT * FROM inventory');
            const inventoryMap = new Map();
            for (const item of allInventory) {
                if (item.sku) {
                    inventoryMap.set(String(item.sku).trim(), item);
                }
            }

            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.trim());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.trim());

            try {
                // Phase 1: Local comparison & filtering (0 remote Turso row reads)
                const itemsToUpsert = [];
                const backorderItemsToSync = [];
                const todayStr = getLocalTodayStrSync();

                for (const row of parsedData) {
                    if (!row['SKU'] || String(row['SKU']).trim() === '') continue; // skip invalid rows

                    const parsed = parseInventoryCsvRow(row);
                    const {
                        extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount
                    } = extractFeatures(parsed.sales_desc, colours, finishes);

                    const {
                        sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty, rrp, cost,
                        online_name, showtile, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box,
                        box_per_pallet, stk, days, x_inactive, batch, location
                    } = parsed;

                    const existing = inventoryMap.get(sku);
                    let shouldUpdate = false;

                    if (!existing) {
                        shouldUpdate = true;
                    } else {
                        const finalDays = days !== '' ? days : (existing.days || '');
                        if (
                            String(existing.stock_no || '') !== stock_no ||
                            String(existing.sales_description || '') !== sales_desc ||
                            String(existing.supplier || '') !== supplier ||
                            Number(existing.available || 0) !== available ||
                            Number(existing.holding || 0) !== holding ||
                            Number(existing.so_qty || 0) !== so_qty ||
                            Number(existing.total_qty || 0) !== total_qty ||
                            Number(existing.rrp || 0) !== rrp ||
                            Number(existing.cost || 0) !== cost ||
                            String(existing.online_name || '') !== online_name ||
                            String(existing.showtile_name || '') !== showtile ||
                            Number(existing.pallet_qty || 0) !== pallet_qty ||
                            Number(existing.box_qty || 0) !== box_qty ||
                            Number(existing.piece_qty || 0) !== piece_qty ||
                            Number(existing.m2_per_box || 0) !== m2_per_box ||
                            Number(existing.pcs_per_box || 0) !== pcs_per_box ||
                            Number(existing.box_per_pallet || 0) !== box_per_pallet ||
                            String(existing.stk || '') !== stk ||
                            String(existing.days || '') !== finalDays ||
                            String(existing.x_inactive || '') !== x_inactive ||
                            String(existing.batch || '') !== batch ||
                            String(existing.location || '') !== location ||
                            String(existing.extracted_name || '') !== extractedName ||
                            String(existing.extracted_finish || '') !== extractedFinish ||
                            String(existing.extracted_size || '') !== extractedSize ||
                            String(existing.extracted_colour || '') !== extractedColour ||
                            Number(existing.backorder || 0) !== backorder ||
                            Number(existing.backorder_amount || 0) !== backorder_amount
                        ) {
                            shouldUpdate = true;
                        }
                    }

                    if (backorder === 1) {
                        backorderItemsToSync.push({
                            sku,
                            description: sales_desc,
                            amount: backorder_amount,
                            product_id: existing?.product_parent_id || null,
                            created_date: todayStr
                        });
                    }

                    if (shouldUpdate) {
                        itemsToUpsert.push([
                            sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty, rrp, cost,
                            online_name, showtile, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet,
                            stk, days, x_inactive, batch, location, extractedName, extractedFinish, extractedSize, extractedColour,
                            backorder, backorder_amount
                        ]);
                    }
                }

                // Phase 2: Batch multi-row upsert to remote DB (High speed, minimal roundtrips & row reads)
                if (itemsToUpsert.length > 0) {
                    const batchSize = 25; // 25 rows * 29 columns = 725 parameters, safely below SQLite 999 limit
                    for (let i = 0; i < itemsToUpsert.length; i += batchSize) {
                        const chunk = itemsToUpsert.slice(i, i + batchSize);
                        const rowPlaceholders = chunk.map(() => `(${new Array(29).fill('?').join(', ')})`).join(',\n');
                        const batchQuery = `
                            INSERT INTO inventory (
                                sku, stock_no, sales_description, supplier, available, holding, so_qty, total_qty, rrp, cost, 
                                online_name, showtile_name, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet, 
                                stk, days, x_inactive, batch, location, extracted_name, extracted_finish, extracted_size, extracted_colour, backorder, backorder_amount
                            ) VALUES 
                            ${rowPlaceholders}
                            ON CONFLICT(sku) DO UPDATE SET 
                                stock_no=excluded.stock_no, sales_description=excluded.sales_description, supplier=excluded.supplier, 
                                available=excluded.available, holding=excluded.holding, so_qty=excluded.so_qty, total_qty=excluded.total_qty, 
                                rrp=excluded.rrp, cost=excluded.cost, online_name=excluded.online_name, showtile_name=excluded.showtile_name, 
                                pallet_qty=excluded.pallet_qty, box_qty=excluded.box_qty, piece_qty=excluded.piece_qty, 
                                m2_per_box=excluded.m2_per_box, pcs_per_box=excluded.pcs_per_box, box_per_pallet=excluded.box_per_pallet, 
                                stk=excluded.stk, 
                                days = CASE WHEN excluded.days != '' THEN excluded.days ELSE inventory.days END, 
                                x_inactive=excluded.x_inactive, batch=excluded.batch, 
                                location=excluded.location, backorder=excluded.backorder, backorder_amount=excluded.backorder_amount
                        `;
                        const batchArgs = chunk.flat();
                        await db.execute(batchQuery, batchArgs);
                    }
                    if (db.sync) {
                        await db.sync();
                    }
                }
                // Phase 3: Sync backorder items to order_batch
                if (backorderItemsToSync.length > 0) {
                    await syncBackorderItems(db, backorderItemsToSync);
                }
            } catch (innerErr) {
                console.error("Data processing failed", innerErr);
            }

            loadData();
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleClearAll = async () => {
        if (!canWrite) return;
        if (!window.confirm("Are you sure you want to delete all inventory data? This cannot be undone.")) return;
        setLoading(true);
        try {
            const db = await getDb();
            await db.execute('DELETE FROM inventory');
            if (db.sync) {
                await db.sync();
            }
            loadData();
        } catch (err) {
            console.error("Failed to clear data", err);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (e) => {
        if (!canWrite) return;
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: h => h.trim(),
            complete: (results) => {
                const fields = results.meta?.fields || [];
                if (!fields.includes('SKU') || !fields.includes('Sales Description')) {
                    alert("Invalid Inventory CSV format: missing 'SKU' or 'Sales Description' column. If you are importing matching parameters, please use 'Import Matching Data'.");
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    return;
                }
                processData(results.data);
            }
        });
    };

    const handleRecoverCleanCsv = (e) => {
        if (!canWrite) return;
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: h => h.trim(),
            complete: async (results) => {
                const resetInput = () => {
                    if (recoverFileInputRef.current) recoverFileInputRef.current.value = '';
                };

                const fields = results.meta?.fields || [];
                if (!fields.includes('SKU') || !fields.includes('Sales Description')) {
                    alert("Invalid CSV format: missing required 'SKU' or 'Sales Description' column. Please select a standard Inventory export CSV.");
                    resetInput();
                    return;
                }

                if (!results.data || results.data.length === 0) {
                    alert("No data found in the CSV file.");
                    resetInput();
                    return;
                }

                setLoading(true);
                try {
                    const db = await getDb();
                    const emptyDescRows = await db.select(
                        "SELECT product_id, sku, product_parent_id, days FROM inventory WHERE sales_description IS NULL OR TRIM(sales_description) = ''"
                    );

                    if (!emptyDescRows || emptyDescRows.length === 0) {
                        alert("No inventory records with empty sales_description were found.");
                        return;
                    }

                    const csvRowMap = new Map();
                    for (const row of results.data) {
                        const rawSku = String(row['SKU'] || '').trim();
                        if (rawSku) {
                            csvRowMap.set(rawSku.toLowerCase(), row);
                        }
                    }

                    const toUpdate = [];
                    const toDelete = [];
                    for (const dbRow of emptyDescRows) {
                        const dbSku = String(dbRow.sku || '').trim().toLowerCase();
                        const matchedCsvRow = dbSku ? csvRowMap.get(dbSku) : undefined;
                        if (matchedCsvRow) {
                            toUpdate.push({ dbRow, csvRow: matchedCsvRow });
                        } else {
                            toDelete.push(dbRow);
                        }
                    }

                    const confirmed = await confirm(
                        `Found ${emptyDescRows.length} inventory record(s) with empty description:\n` +
                        `• ${toUpdate.length} matched by SKU in CSV (will restore/update columns while keeping existing extracted parameters)\n` +
                        `• ${toDelete.length} not found in CSV (will be PERMANENTLY DELETED as obsolete)\n\n` +
                        `Do you want to proceed?`
                    );
                    if (!confirmed) return;

                    const attrs = await db.select('SELECT type, value FROM attributes');
                    const colours = attrs.filter(a => a.type === 'colour').map(a => a.value.trim());
                    const finishes = attrs.filter(a => a.type === 'finish').map(a => a.value.trim());
                    const todayStr = getLocalTodayStrSync();
                    const backorderItemsToSync = [];

                    let updatedCount = 0;
                    for (const { dbRow, csvRow } of toUpdate) {
                        const parsed = parseInventoryCsvRow(csvRow);
                        const { backorder, backorder_amount } = extractFeatures(parsed.sales_desc, colours, finishes);
                        const finalDays = parsed.days !== '' ? parsed.days : (dbRow.days || '');

                        await db.execute(
                            `UPDATE inventory SET
                                stock_no = $1,
                                sales_description = $2,
                                supplier = $3,
                                available = $4,
                                holding = $5,
                                so_qty = $6,
                                total_qty = $7,
                                rrp = $8,
                                cost = $9,
                                online_name = $10,
                                showtile_name = $11,
                                pallet_qty = $12,
                                box_qty = $13,
                                piece_qty = $14,
                                m2_per_box = $15,
                                pcs_per_box = $16,
                                box_per_pallet = $17,
                                stk = $18,
                                days = $19,
                                x_inactive = $20,
                                batch = $21,
                                location = $22,
                                backorder = $23,
                                backorder_amount = $24
                            WHERE product_id = $25`,
                            [
                                parsed.stock_no, parsed.sales_desc, parsed.supplier,
                                parsed.available, parsed.holding, parsed.so_qty, parsed.total_qty,
                                parsed.rrp, parsed.cost, parsed.online_name, parsed.showtile,
                                parsed.pallet_qty, parsed.box_qty, parsed.piece_qty,
                                parsed.m2_per_box, parsed.pcs_per_box, parsed.box_per_pallet,
                                parsed.stk, finalDays, parsed.x_inactive, parsed.batch, parsed.location,
                                backorder, backorder_amount, dbRow.product_id
                            ]
                        );
                        updatedCount++;

                        if (backorder === 1) {
                            backorderItemsToSync.push({
                                sku: dbRow.sku,
                                description: parsed.sales_desc,
                                amount: backorder_amount,
                                product_id: dbRow.product_parent_id || null,
                                created_date: todayStr
                            });
                        }
                    }

                    let deletedCount = 0;
                    if (toDelete.length > 0) {
                        const deleteBatchSize = 200;
                        for (let i = 0; i < toDelete.length; i += deleteBatchSize) {
                            const chunkIds = toDelete.slice(i, i + deleteBatchSize).map(r => r.product_id);
                            const placeholders = chunkIds.map((_, idx) => `$${idx + 1}`).join(', ');
                            await db.execute(`DELETE FROM inventory WHERE product_id IN (${placeholders})`, chunkIds);
                            deletedCount += chunkIds.length;
                        }
                    }

                    if (backorderItemsToSync.length > 0) {
                        await syncBackorderItems(db, backorderItemsToSync);
                    }

                    if (db.sync) {
                        await db.sync();
                    }
                    await loadData(false);
                    alert(`Recovery & cleanup complete!\nRestored/Updated: ${updatedCount} record(s)\nDeleted obsolete: ${deletedCount} record(s)`);
                } catch (err) {
                    console.error("Failed to recover/clean inventory CSV:", err);
                    alert("Error processing recovery/cleanup CSV.");
                } finally {
                    setLoading(false);
                    resetInput();
                }
            }
        });
    };

    const handleExportMatchingData = async () => {
        try {
            setLoading(true);
            const db = await getDb();
            const rows = await db.select(
                'SELECT product_id, sku, sales_description, extracted_name, extracted_colour, extracted_finish, extracted_size FROM inventory ORDER BY product_id ASC'
            );

            if (!rows || rows.length === 0) {
                alert("No inventory records to export.");
                return;
            }

            const exportData = rows.map(r => ({
                'ID': r.product_id,
                'SKU': r.sku || '',
                'Description': r.sales_description || '',
                'Extracted Name': r.extracted_name || '',
                'Colour': r.extracted_colour || '',
                'Finish': r.extracted_finish || '',
                'Size': r.extracted_size || ''
            }));

            const csvContent = Papa.unparse(exportData);

            let saved = false;
            try {
                const filePath = await save({
                    filters: [{ name: 'CSV File', extensions: ['csv'] }],
                    defaultPath: 'inventory_matching_data.csv'
                });
                if (filePath) {
                    await writeTextFile(filePath, csvContent);
                    saved = true;
                    alert(`Exported ${exportData.length} matching data record(s) successfully!`);
                }
            } catch (dialogErr) {
                console.warn("Tauri save dialog not available, using browser download:", dialogErr);
            }

            if (!saved) {
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'inventory_matching_data.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert(`Exported ${exportData.length} matching data record(s) successfully!`);
            }
        } catch (e) {
            console.error("Failed to export matching data:", e);
            alert("Failed to export matching data.");
        } finally {
            setLoading(false);
        }
    };

    const handleImportMatchingData = (e) => {
        if (!canWrite) return;
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                if (!results.data || results.data.length === 0) {
                    alert("No data found in the CSV file.");
                    if (matchingFileInputRef.current) matchingFileInputRef.current.value = '';
                    return;
                }

                setLoading(true);
                try {
                    const db = await getDb();
                    let updatedCount = 0;

                    const getVal = (row, candidates) => {
                        for (const k of Object.keys(row)) {
                            const cleanK = k.trim().toLowerCase();
                            for (const c of candidates) {
                                if (cleanK === c.toLowerCase()) return row[k];
                            }
                        }
                        return undefined;
                    };

                    for (const row of results.data) {
                        const id = getVal(row, ['ID', 'product_id', 'id']);
                        const sku = getVal(row, ['SKU', 'sku']);
                        const eName = getVal(row, ['Extracted Name', 'extracted_name', 'name']);
                        const eColour = getVal(row, ['Colour', 'Color', 'extracted_colour', 'extracted_color', 'colour', 'color']);
                        const eFinish = getVal(row, ['Finish', 'extracted_finish', 'finish']);
                        const eSize = getVal(row, ['Size', 'extracted_size', 'size']);

                        const normSize = (eSize !== undefined && eSize !== null && String(eSize).trim() !== '')
                            ? normalizeSize(String(eSize).trim())
                            : (eSize !== undefined ? '' : undefined);

                        const nameVal = eName !== undefined ? String(eName).trim() : null;
                        const colourVal = eColour !== undefined ? String(eColour).trim() : null;
                        const finishVal = eFinish !== undefined ? String(eFinish).trim() : null;
                        const sizeVal = normSize !== undefined ? normSize : null;

                        if (id) {
                            await db.execute(
                                `UPDATE inventory SET 
                                    extracted_name = $1, 
                                    extracted_colour = $2, 
                                    extracted_finish = $3, 
                                    extracted_size = $4 
                                 WHERE product_id = $5`,
                                [nameVal, colourVal, finishVal, sizeVal, id]
                            );
                            updatedCount++;
                        } else if (sku && String(sku).trim() !== '') {
                            await db.execute(
                                `UPDATE inventory SET 
                                    extracted_name = $1, 
                                    extracted_colour = $2, 
                                    extracted_finish = $3, 
                                    extracted_size = $4 
                                 WHERE sku = $5`,
                                [nameVal, colourVal, finishVal, sizeVal, String(sku).trim()]
                            );
                            updatedCount++;
                        }
                    }

                    if (db.sync) {
                        await db.sync();
                    }
                    await loadData(false);
                    alert(`Successfully imported matching data! Updated ${updatedCount} inventory record(s).`);
                } catch (err) {
                    console.error("Failed to import matching data:", err);
                    alert("Error importing matching data.");
                } finally {
                    setLoading(false);
                    if (matchingFileInputRef.current) matchingFileInputRef.current.value = '';
                }
            }
        });
    };

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            setRenderLimit(prev => prev + 50);
        }
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleSaveEdit = async () => {
        if (!canWrite) return;
        try {
            const db = await getDb();
            await db.execute(
                `UPDATE inventory SET ${editModal.field} = $1 WHERE sku = $2`,
                [editModal.val, editModal.item.sku]
            );
            setEditModal({ ...editModal, show: false });
            loadData();
        } catch (err) {
            console.error("Failed to update item", err);
            alert("Failed to update item");
        }
    };

    let filteredData = data.filter(item => {
        const term = searchTerm.toLowerCase();
        return (item.sku && String(item.sku).toLowerCase().includes(term)) ||
            (item.sales_description && item.sales_description.toLowerCase().includes(term));
    });

    if (sortConfig.key) {
        filteredData.sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
            if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const displayedData = filteredData.slice(0, renderLimit);

    return (
        <div className="inventory-container">
            <div className="toolbar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search SKU or Name..."
                        value={searchTerm}
                        onChange={e => {
                            setSearchTerm(e.target.value);
                            setRenderLimit(50);
                        }}
                        className="search-input"
                    />
                </div>
                <div style={{ color: 'var(--text-color)', fontSize: '0.9rem', marginRight: 'auto', marginLeft: '16px' }}>
                    Total Records: {filteredData.length}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                        className="btn-upload"
                        onClick={handleExportMatchingData}
                        disabled={loading}
                        style={{
                            background: 'white',
                            color: '#334155',
                            border: '1px solid #cbd5e1',
                            cursor: 'pointer'
                        }}
                        title="Export matching parameters (ID, SKU, Description, Extracted parameters) to CSV"
                    >
                        <Download size={16} />
                        Export Matching Data
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={matchingFileInputRef}
                        onChange={handleImportMatchingData}
                        style={{ display: 'none' }}
                        disabled={!canWrite}
                    />
                    <button
                        className="btn-upload"
                        onClick={() => matchingFileInputRef.current?.click()}
                        disabled={loading || !canWrite}
                        style={{
                            background: 'white',
                            color: canWrite ? '#334155' : '#94a3b8',
                            border: '1px solid #cbd5e1',
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6
                        }}
                        title={!canWrite ? 'You do not have permission to import' : 'Import matching parameters from CSV'}
                    >
                        <Upload size={16} />
                        Import Matching Data
                    </button>
                    <button
                        className="btn-upload"
                        onClick={handleClearAll}
                        disabled={loading || !canWrite}
                        style={{
                            background: canWrite ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : '#d1d5db',
                            boxShadow: canWrite ? '0 4px 6px rgba(239, 68, 68, 0.25)' : 'none',
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6
                        }}
                        title={!canWrite ? 'You do not have permission to clear data' : ''}
                    >
                        <Trash2 size={16} />
                        Clear All
                    </button>
                    <button
                        className="btn-upload"
                        onClick={handleAutoAnalysis}
                        disabled={loading || !canWrite}
                        style={{
                            background: canWrite ? 'var(--primary-color)' : '#d1d5db',
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6
                        }}
                    >
                        {loading ? 'Processing...' : 'Auto Analysis'}
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={recoverFileInputRef}
                        onChange={handleRecoverCleanCsv}
                        style={{ display: 'none' }}
                        disabled={!canWrite}
                    />
                    <button
                        className="btn-upload"
                        onClick={() => recoverFileInputRef.current?.click()}
                        disabled={loading || !canWrite}
                        style={{
                            background: 'white',
                            color: canWrite ? '#b45309' : '#94a3b8',
                            border: '1px solid #f59e0b',
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6
                        }}
                        title={!canWrite ? 'You do not have permission to import' : 'Restore empty-description records from Inventory CSV and delete unmatched obsolete SKUs'}
                    >
                        <RefreshCw size={16} />
                        Recover / Clean CSV
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                        disabled={!canWrite}
                    />
                    <button
                        className="btn-upload"
                        onClick={() => fileInputRef.current.click()}
                        disabled={loading || !canWrite}
                        style={{
                            background: canWrite ? 'var(--primary-color)' : '#d1d5db',
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6
                        }}
                        title={!canWrite ? 'You do not have permission to upload' : ''}
                    >
                        <Upload size={16} />
                        {loading ? 'Processing...' : 'Import CSV'}
                    </button>
                </div>
            </div>

            <div className="table-container" onScroll={handleScroll}>
                {loading ? (
                    <div className="loading-spinner-container">
                        <div className="spinner"></div>
                        <p>Loading data, please wait...</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sales_description')}>Description {sortConfig.key === 'sales_description' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ width: '100px', cursor: 'pointer' }} onClick={() => handleSort('sku')}>SKU {sortConfig.key === 'sku' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ width: '250px', cursor: 'pointer' }} onClick={() => handleSort('extracted_name')}>Extracted Name {sortConfig.key === 'extracted_name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ width: '120px', cursor: 'pointer' }} onClick={() => handleSort('extracted_colour')}>Colour {sortConfig.key === 'extracted_colour' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ width: '120px', cursor: 'pointer' }} onClick={() => handleSort('extracted_finish')}>Finish {sortConfig.key === 'extracted_finish' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ width: '120px', cursor: 'pointer' }} onClick={() => handleSort('extracted_size')}>Size {sortConfig.key === 'extracted_size' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ width: '100px', cursor: 'pointer' }} onClick={() => handleSort('available')}>Available Qty {sortConfig.key === 'available' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ width: '100px', cursor: 'pointer' }} onClick={() => handleSort('holding')}>Holding {sortConfig.key === 'holding' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ width: '100px', cursor: 'pointer' }} onClick={() => handleSort('so_qty')}>SO Qty {sortConfig.key === 'so_qty' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ width: '100px', cursor: 'pointer' }} onClick={() => handleSort('total_qty')}>Total Qty {sortConfig.key === 'total_qty' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedData.map(item => (
                                <tr key={item.product_id}>
                                    <td className="product-name" title={item.sales_description} style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.sales_description}
                                    </td>
                                    <td>
                                        <span className="sku-badge">{item.sku}</span>
                                        {item.backorder === 1 && <span className="param-badge" style={{ backgroundColor: '#fecaca', color: '#991b1b', marginLeft: '6px' }}>Backorder</span>}
                                    </td>
                                    <td className={canWrite ? "product-name editable-cell" : "product-name"} title={canWrite ? "Click to edit" : ""} onClick={() => canWrite && setEditModal({ show: true, item, field: 'extracted_name', val: item.extracted_name || '', options: [] })}>
                                        {item.extracted_name} {canWrite && <Edit3 size={12} className="edit-icon" />}
                                    </td>
                                    <td className={canWrite ? "editable-cell" : ""} title={canWrite ? "Click to edit" : ""} onClick={() => canWrite && setEditModal({ show: true, item, field: 'extracted_colour', val: item.extracted_colour || '', options: attributes.colours })}>
                                        {item.extracted_colour && <span className="param-badge colour">{item.extracted_colour}</span>}
                                        {canWrite && <Edit3 size={12} className="edit-icon" />}
                                    </td>
                                    <td className={canWrite ? "editable-cell" : ""} title={canWrite ? "Click to edit" : ""} onClick={() => canWrite && setEditModal({ show: true, item, field: 'extracted_finish', val: item.extracted_finish || '', options: attributes.finishes })}>
                                        {item.extracted_finish && <span className="param-badge finish">{item.extracted_finish}</span>}
                                        {canWrite && <Edit3 size={12} className="edit-icon" />}
                                    </td>
                                    <td className={canWrite ? "editable-cell" : ""} title={canWrite ? "Click to edit" : ""} onClick={() => canWrite && setEditModal({ show: true, item, field: 'extracted_size', val: item.extracted_size || '', options: [] })}>
                                        {item.extracted_size && <span className="param-badge size">{item.extracted_size}</span>}
                                        {canWrite && <Edit3 size={12} className="edit-icon" />}
                                    </td>
                                    <td className="num">{item.available}</td>
                                    <td className="num">{item.holding}</td>
                                    <td className="num">{item.so_qty}</td>
                                    <td className="num">{item.total_qty}</td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr>
                                    <td colSpan="10" className="empty-state">
                                        {loading ? 'Loading...' : 'No inventory data found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {editModal.show && (
                <div className="modal-overlay" onClick={() => setEditModal({ ...editModal, show: false })}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Edit {editModal.field.replace('extracted_', '')}</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setEditModal({ ...editModal, show: false })} />
                        </div>
                        <div className="modal-body">
                            <input
                                type="text"
                                className="modal-input"
                                style={{ padding: '10px' }}
                                value={editModal.val}
                                onChange={e => setEditModal({ ...editModal, val: e.target.value })}
                                list={editModal.options.length > 0 ? "edit-options-list" : undefined}
                                autoFocus
                                placeholder="new value"
                            />
                            {editModal.options.length > 0 && (
                                <datalist id="edit-options-list">
                                    {editModal.options.map((opt, i) => <option key={i} value={opt} />)}
                                </datalist>
                            )}
                            <button className="btn-upload btn-full" onClick={handleSaveEdit} style={{ marginTop: '20px', background: 'var(--primary-color)', color: 'white', border: 'none' }}>
                                <Save size={16} /> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
