import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Search, Trash2, Edit3, X, Save } from 'lucide-react';
import { getDb } from '../db/Database';
import './Inventory.css';


const extractFeatures = (salesDesc, colours, finishes) => {
    let text = salesDesc;
    let startIndex = text.indexOf(')');
    let endIndex = text.indexOf('[');

    if (startIndex === -1) startIndex = 0;
    else startIndex += 1;

    if (endIndex === -1) endIndex = text.length;

    if (startIndex < endIndex) {
        text = text.substring(startIndex, endIndex).trim();
    } else {
        text = text.trim();
    }

    let extractedSize = '';
    let extractedFinish = '';
    let extractedColour = '';
    let extractedName = '';

    let firstParamIndex = -1;
    let lastParamIndex = -1;

    const findMatch = (list, str) => {
        for (const item of list) {
            const regex = new RegExp(`\\b${item}\\b`, 'i');
            const match = str.match(regex);
            if (match) {
                return { item, index: match.index, length: match[0].length };
            }
        }
        return null;
    };

    const colourMatch = findMatch(colours, text);
    const finishMatch = findMatch(finishes, text);

    if (colourMatch) {
        extractedColour = colourMatch.item;
        firstParamIndex = colourMatch.index;
        lastParamIndex = colourMatch.index + colourMatch.length;
    }

    if (finishMatch) {
        extractedFinish = finishMatch.item;
        if (firstParamIndex === -1 || finishMatch.index < firstParamIndex) {
            firstParamIndex = finishMatch.index;
        }
        const endIdx = finishMatch.index + finishMatch.length;
        if (endIdx > lastParamIndex) {
            lastParamIndex = endIdx;
        }
    }

    const sizeRegex = /\b\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)?\b/;

    if (firstParamIndex !== -1) {
        extractedName = text.substring(0, firstParamIndex).trim();
        let remainder = text.substring(lastParamIndex).trim();
        const slashIndex = remainder.indexOf('/');
        if (slashIndex !== -1) {
            remainder = remainder.substring(0, slashIndex).trim();
        }
        const sizeMatch = remainder.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = sizeMatch[0];
        }
    } else {
        const sizeMatch = text.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = sizeMatch[0];
            extractedName = text.substring(0, sizeMatch.index).trim();
        } else {
            extractedName = text.trim();
        }
    }

    const backorder = salesDesc.toLowerCase().includes('backorder') ? 1 : 0;
    let backorder_amount = 0;
    if (backorder) {
        const match = salesDesc.match(/backorder-?(\d+(?:\.\d+)?)/i);
        if (match && match[1]) {
            backorder_amount = parseFloat(match[1]);
        }
    }

    return { extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount };
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
    }, []);


    const handleAutoAnalysis = async () => {
        if (!canWrite) return;
        setLoading(true);
        try {
            const db = await getDb();
            const attributes = await db.select('SELECT * FROM attributes');
            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.toLowerCase());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.toLowerCase());

            // Retrieve all rows where extracted_name is empty or null
            const rows = await db.select("SELECT product_id, sku, sales_description FROM inventory WHERE extracted_name IS NULL OR extracted_name = ''");

            for (const row of rows) {
                const salesDesc = String(row.sales_description || '');
                const features = extractFeatures(salesDesc, colours, finishes);

                await db.execute(`
                    UPDATE inventory SET 
                        extracted_name = $1, extracted_colour = $2, extracted_finish = $3, 
                        extracted_size = $4, backorder = $5, backorder_amount = $6 
                    WHERE sku = $7
                `, [features.extractedName, features.extractedColour, features.extractedFinish, features.extractedSize, features.backorder, features.backorder_amount, row.sku]);
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

            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.toLowerCase());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.toLowerCase());

            try {
                const parseNumber = (val) => {
                    if (!val) return 0;
                    const num = parseFloat(String(val).replace(/,/g, '').trim());
                    return isNaN(num) ? 0 : num;
                };

                // Phase 1: Local comparison & filtering (0 remote Turso row reads)
                const itemsToUpsert = [];

                for (const row of parsedData) {
                    if (!row['SKU'] || row['SKU'].trim() === '') continue; // skip invalid rows

                    const salesDesc = String(row['Sales Description'] || '');

                    const {
                        extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount
                    } = extractFeatures(salesDesc, colours, finishes);

                    const sku = String(row['SKU']).trim();
                    const stock_no = String(row['Stock No.'] || '');
                    const sales_desc = String(row['Sales Description'] || '');
                    const supplier = String(row['Supplier'] || '');
                    const available = parseNumber(row['Available Qty'] || row['Available']);
                    const holding = parseNumber(row['Holding']);
                    const so_qty = parseNumber(row['SO Qty']);
                    const total_qty = parseNumber(row['Total Qty']);
                    const rrp = parseNumber(row['RRP']);
                    const cost = parseNumber(row['Cost']);
                    const online_name = String(row['Online(the name using on online sale)'] || row['Online'] || '');
                    const showtile = String(row['Showtile(The name use in store sale)'] || row['Showtile'] || '');
                    const pallet_qty = parseNumber(row['Pallet Qty']);
                    const box_qty = parseNumber(row['Box Qty']);
                    const piece_qty = parseNumber(row['Piece Qty']);
                    const m2_per_box = parseNumber(row['m2/Box']);
                    const pcs_per_box = parseNumber(row['pcs/Box']);
                    const box_per_pallet = parseNumber(row['box/Pallet']);
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
            complete: (results) => {
                processData(results.data);
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

                <div style={{ display: 'flex', gap: '12px' }}>
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
                                <th style={{ maxWidth: '200px', cursor: 'pointer' }} onClick={() => handleSort('sales_description')}>Description {sortConfig.key === 'sales_description' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('sku')}>SKU {sortConfig.key === 'sku' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('extracted_name')}>Extracted Name {sortConfig.key === 'extracted_name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('extracted_colour')}>Colour {sortConfig.key === 'extracted_colour' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('extracted_finish')}>Finish {sortConfig.key === 'extracted_finish' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('extracted_size')}>Size {sortConfig.key === 'extracted_size' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ cursor: 'pointer' }} onClick={() => handleSort('available')}>Available Qty {sortConfig.key === 'available' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ cursor: 'pointer' }} onClick={() => handleSort('holding')}>Holding {sortConfig.key === 'holding' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ cursor: 'pointer' }} onClick={() => handleSort('so_qty')}>SO Qty {sortConfig.key === 'so_qty' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                <th className="num" style={{ cursor: 'pointer' }} onClick={() => handleSort('total_qty')}>Total Qty {sortConfig.key === 'total_qty' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
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
