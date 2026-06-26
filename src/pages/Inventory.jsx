import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Search, Trash2, Edit3, X, Save } from 'lucide-react';
import { getDb } from '../db/Database';
import './Inventory.css';

export default function Inventory() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [renderLimit, setRenderLimit] = useState(50);
    const [attributes, setAttributes] = useState({ colours: [], finishes: [] });
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [editModal, setEditModal] = useState({ show: false, item: null, field: '', val: '', options: [] });
    const fileInputRef = useRef(null);

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

    const processData = async (parsedData) => {
        setLoading(true);
        try {
            const db = await getDb();
            const attributes = await db.select('SELECT * FROM attributes');

            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.toLowerCase());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.toLowerCase());

            try {
                const parseNumber = (val) => {
                    if (!val) return 0;
                    const num = parseFloat(String(val).replace(/,/g, '').trim());
                    return isNaN(num) ? 0 : num;
                };

                for (const row of parsedData) {
                    if (!row['SKU'] || row['SKU'].trim() === '') continue; // skip invalid rows

                    const salesDesc = String(row['Sales Description'] || '');

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
                            days = d.toISOString().split('T')[0];
                        }
                    }

                    const x_inactive = String(row['X/Inactive'] || '');
                    const batch = String(row['Batch'] || '');
                    const location = String(row['Location'] || '');

                    const backorder = sales_desc.toLowerCase().includes('backorder') ? 1 : 0;
                    let backorder_amount = 0;
                    if (backorder) {
                        const match = sales_desc.match(/backorder-?(\d+(?:\.\d+)?)/i);
                        if (match && match[1]) {
                            backorder_amount = parseFloat(match[1]);
                        }
                    }

                    // Upsert logic
                    await db.execute(`
                        INSERT INTO inventory (
                            sku, stock_no, sales_description, supplier, available, holding, so_qty, total_qty, rrp, cost, 
                            online_name, showtile_name, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet, 
                            stk, days, x_inactive, batch, location, extracted_name, extracted_finish, extracted_size, extracted_colour, backorder, backorder_amount
                        ) VALUES (
                            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
                        )
                        ON CONFLICT(sku) DO UPDATE SET 
                            stock_no=excluded.stock_no, sales_description=excluded.sales_description, supplier=excluded.supplier, 
                            available=excluded.available, holding=excluded.holding, so_qty=excluded.so_qty, total_qty=excluded.total_qty, 
                            rrp=excluded.rrp, cost=excluded.cost, online_name=excluded.online_name, showtile_name=excluded.showtile_name, 
                            pallet_qty=excluded.pallet_qty, box_qty=excluded.box_qty, piece_qty=excluded.piece_qty, 
                            m2_per_box=excluded.m2_per_box, pcs_per_box=excluded.pcs_per_box, box_per_pallet=excluded.box_per_pallet, 
                            stk=excluded.stk, days=excluded.days, x_inactive=excluded.x_inactive, batch=excluded.batch, 
                            location=excluded.location, extracted_name=excluded.extracted_name, extracted_finish=excluded.extracted_finish, 
                            extracted_size=excluded.extracted_size, extracted_colour=excluded.extracted_colour, backorder=excluded.backorder, backorder_amount=excluded.backorder_amount
                    `, [sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty, rrp, cost, online_name, showtile, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet, stk, days, x_inactive, batch, location, extractedName, extractedFinish, extractedSize, extractedColour, backorder, backorder_amount]);
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
        if (!editModal.item) return;
        setLoading(true);
        try {
            const db = await getDb();
            const { field, val, item } = editModal;

            await db.execute(`UPDATE inventory SET ${field} = $1 WHERE product_id = $2`, [val, item.product_id]);

            setData(prev => prev.map(row =>
                row.product_id === item.product_id ? { ...row, [field]: val } : row
            ));

            setEditModal({ show: false, item: null, field: '', val: '', options: [] });
        } catch (err) {
            console.error("Failed to save edit", err);
            alert("Save failed");
        } finally {
            setLoading(false);
        }
    };

    const filteredData = data.filter(item =>
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.extracted_name && item.extracted_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const sortedData = [...filteredData];
    if (sortConfig.key) {
        sortedData.sort((a, b) => {
            const valA = a[sortConfig.key] || '';
            const valB = b[sortConfig.key] || '';

            const numericKeys = ['available', 'holding', 'so_qty', 'total_qty'];
            if (numericKeys.includes(sortConfig.key)) {
                return sortConfig.direction === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const displayedData = sortedData.slice(0, renderLimit);

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
                        disabled={loading}
                        style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', boxShadow: '0 4px 6px rgba(239, 68, 68, 0.25)' }}
                    >
                        <Trash2 size={16} />
                        Clear All
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                    <button
                        className="btn-upload"
                        onClick={() => fileInputRef.current.click()}
                        disabled={loading}
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
                                    <td className="product-name editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_name', val: item.extracted_name || '', options: [] })}>
                                        {item.extracted_name} <Edit3 size={12} className="edit-icon" />
                                    </td>
                                    <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_colour', val: item.extracted_colour || '', options: attributes.colours })}>
                                        {item.extracted_colour && <span className="param-badge colour">{item.extracted_colour}</span>}
                                        <Edit3 size={12} className="edit-icon" />
                                    </td>
                                    <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_finish', val: item.extracted_finish || '', options: attributes.finishes })}>
                                        {item.extracted_finish && <span className="param-badge finish">{item.extracted_finish}</span>}
                                        <Edit3 size={12} className="edit-icon" />
                                    </td>
                                    <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_size', val: item.extracted_size || '', options: [] })}>
                                        {item.extracted_size && <span className="param-badge size">{item.extracted_size}</span>}
                                        <Edit3 size={12} className="edit-icon" />
                                    </td>
                                    <td className="num">{item.available}</td>
                                    <td className="num">{item.holding}</td>
                                    <td className="num">{item.so_qty}</td>
                                    <td className="num">{item.total_qty}</td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="empty-state">
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
