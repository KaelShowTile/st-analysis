import React from 'react';
import { Edit3, X, Save, Search } from 'lucide-react';
import { getDb } from '../db/Database';
import { getLocalTodayStrSync } from '../utils/timezone';
import { extractFeatures } from '../utils/featureExtractor';
import '../pages/Inventory.css';

function ProductMatch() {
    const [records, setRecords] = React.useState([]);
    const [productsList, setProductsList] = React.useState([]);
    const [attributes, setAttributes] = React.useState({ colours: [], finishes: [] });
    const [loading, setLoading] = React.useState(false);
    const [isExtracting, setIsExtracting] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [drafts, setDrafts] = React.useState({});
    const [editModal, setEditModal] = React.useState({ show: false, item: null, field: '', val: '', options: [] });

    const loadRecords = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const res = await db.select("SELECT * FROM inventory WHERE (product_parent_id IS NULL OR product_parent_id = 0 OR product_parent_id = '') AND (x_inactive IS NULL OR x_inactive = 0 OR x_inactive = '') ORDER BY product_id DESC");
            setRecords(res);

            const prods = await db.select("SELECT product_id, product_name FROM products ORDER BY product_name");
            setProductsList(prods);

            const attrs = await db.select('SELECT type, value FROM attributes');
            setAttributes({
                colours: attrs.filter(a => a.type === 'colour').map(a => a.value),
                finishes: attrs.filter(a => a.type === 'finish').map(a => a.value),
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => { loadRecords(); }, []);

    const handleDraftChange = (id, field, value) => {
        setDrafts(prev => ({
            ...prev,
            [id]: { ...(prev[id] || {}), [field]: value }
        }));
    };

    const handleSaveEdit = () => {
        handleDraftChange(editModal.item.product_id, editModal.field, editModal.val);
        setEditModal({ ...editModal, show: false });
    };

    const handleSave = async (record) => {
        const draft = drafts[record.product_id] || {};
        const updated = { ...record, ...draft };

        let parentId = record.product_parent_id;
        if (draft.matched_product_name !== undefined) {
            if (draft.matched_product_name) {
                const matched = productsList.find(p => p.product_name === draft.matched_product_name);
                parentId = matched ? matched.product_id : null;
            } else {
                parentId = null;
            }
        }

        try {
            const db = await getDb();
            await db.execute(
                "UPDATE inventory SET extracted_name = $1, extracted_finish = $2, extracted_colour = $3, extracted_size = $4, product_parent_id = $5 WHERE product_id = $6",
                [updated.extracted_name, updated.extracted_finish, updated.extracted_colour, updated.extracted_size, parentId || null, record.product_id]
            );

            if (parentId) {
                setRecords(prev => prev.filter(r => r.product_id !== record.product_id));
            } else {
                setRecords(prev => prev.map(r => r.product_id === record.product_id ? { ...updated, product_parent_id: parentId } : r));
            }
            alert('Saved successfully!');
        } catch (e) {
            console.error(e);
            alert('Failed to save');
        }
    };

    const handleIgnore = async (id) => {
        try {
            const db = await getDb();
            await db.execute("UPDATE inventory SET x_inactive = 1 WHERE product_id = $1", [id]);
            setRecords(prev => prev.filter(r => r.product_id !== id));
        } catch (e) { console.error(e); alert('Failed to ignore'); }
    };

    const handleExtractParameters = async () => {
        const targets = records.filter(r => {
            const draftName = drafts[r.product_id]?.extracted_name;
            const currentName = draftName !== undefined ? draftName : r.extracted_name;
            return !currentName || !currentName.trim();
        });

        if (targets.length === 0) {
            alert('No records without Extracted Name found in the list.');
            return;
        }

        setIsExtracting(true);
        try {
            const db = await getDb();
            let colours = attributes.colours || [];
            let finishes = attributes.finishes || [];
            if (!colours.length && !finishes.length) {
                const attrs = await db.select('SELECT type, value FROM attributes');
                colours = attrs.filter(a => a.type === 'colour').map(a => a.value.trim());
                finishes = attrs.filter(a => a.type === 'finish').map(a => a.value.trim());
            }

            for (const r of targets) {
                const salesDesc = String(r.sales_description || '');
                const features = extractFeatures(salesDesc, colours, finishes);

                await db.execute(`
                    UPDATE inventory SET 
                        extracted_name = $1, extracted_colour = $2, extracted_finish = $3, 
                        extracted_size = $4, backorder = $5, backorder_amount = $6 
                    WHERE product_id = $7
                `, [features.extractedName, features.extractedColour, features.extractedFinish, features.extractedSize, features.backorder, features.backorder_amount, r.product_id]);

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
                        `, [r.product_parent_id || null, r.sku, salesDesc, features.backorder_amount, todayStr]);
                    } catch (obErr) {
                        console.warn("Failed to sync order_batch in extract parameters:", obErr);
                    }
                }
            }

            setDrafts(prev => {
                const next = { ...prev };
                targets.forEach(t => { delete next[t.product_id]; });
                return next;
            });

            await loadRecords();
            alert(`Parameters extracted and saved for ${targets.length} record(s).`);
        } catch (e) {
            console.error("Failed to extract parameters:", e);
            alert("Failed to extract parameters");
        } finally {
            setIsExtracting(false);
        }
    };

    const term = search.trim().toLowerCase();
    const filteredRecords = term
        ? records.filter(r => {
            const draft = drafts[r.product_id] || {};
            const eName = draft.extracted_name !== undefined ? draft.extracted_name : (r.extracted_name || '');
            return (
                String(r.sku || '').toLowerCase().includes(term) ||
                String(r.sales_description || '').toLowerCase().includes(term) ||
                String(eName || '').toLowerCase().includes(term)
            );
        })
        : records;

    return (
        <div className="inventory-container">
            <datalist id="products-list-match">
                {productsList.map(p => <option key={p.product_id} value={p.product_name} />)}
            </datalist>
            <div className="toolbar" style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center' }}>
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search SKU, Description, Extracted Name..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="search-input"
                    />
                </div>
                <div style={{ color: 'var(--text-color)', fontSize: '0.9rem', marginRight: 'auto', marginLeft: '16px' }}>
                    Total Records: {filteredRecords.length}
                </div>
                <button
                    className="btn-upload white-bg"
                    onClick={handleExtractParameters}
                    disabled={loading || isExtracting}
                    title="Extract parameters from description for rows with missing name"
                    style={{ marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    {isExtracting ? 'Extracting...' : 'Extract Parameters'}
                </button>
            </div>
            <div className="table-container" style={{ margin: 0 }}>
                {loading ? (
                    <div className="loading-spinner-container">
                        <div className="spinner"></div>
                        <p>Loading data, please wait...</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: '100px' }}>SKU</th>
                                <th>Description</th>
                                <th style={{ width: '250px' }}>Extracted Name</th>
                                <th style={{ width: '100px' }}>Colour</th>
                                <th style={{ width: '100px' }}>Finish</th>
                                <th style={{ width: '100px' }}>Size</th>
                                <th>Matched Product</th>
                                <th style={{ textAlign: 'center', width: '150px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRecords.map(r => {
                                const draft = drafts[r.product_id] || {};
                                const eName = draft.extracted_name !== undefined ? draft.extracted_name : (r.extracted_name || '');
                                const eFinish = draft.extracted_finish !== undefined ? draft.extracted_finish : (r.extracted_finish || '');
                                const eColour = draft.extracted_colour !== undefined ? draft.extracted_colour : (r.extracted_colour || '');
                                const eSize = draft.extracted_size !== undefined ? draft.extracted_size : (r.extracted_size || '');
                                const mProduct = draft.matched_product_name !== undefined ? draft.matched_product_name : '';

                                return (
                                    <tr key={r.product_id}>
                                        <td><span className="sku-badge">{r.sku}</span></td>
                                        <td className="product-name" title={r.sales_description} style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sales_description}</td>

                                        <td className="editable-cell product-name" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_name', val: eName, options: [] })}>
                                            {eName} <Edit3 size={12} className="edit-icon" />
                                        </td>
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_colour', val: eColour, options: attributes.colours })}>
                                            {eColour && <span className="param-badge colour">{eColour}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_finish', val: eFinish, options: attributes.finishes })}>
                                            {eFinish && <span className="param-badge finish">{eFinish}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_size', val: eSize, options: [] })}>
                                            {eSize && <span className="param-badge size">{eSize}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>

                                        <td><input type="text" list="products-list-match" className="search-input" style={{ padding: '6px 12px', width: '100%', minWidth: '150px' }} value={mProduct} onChange={e => handleDraftChange(r.product_id, 'matched_product_name', e.target.value)} placeholder="Type to match..." /></td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap', display: 'flex' }}>
                                            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight: '8px' }} onClick={() => handleSave(r)}>Save</button>
                                            <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', color: '#ef4444', borderColor: '#ef4444' }} onClick={() => handleIgnore(r.product_id)}>Ignore</button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredRecords.length === 0 && <tr><td colSpan="8" className="empty-state">{search ? 'No matching records found.' : 'No records to match.'}</td></tr>}
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
                                style={{ padding: '10px', width: '100%', boxSizing: 'border-box' }}
                                value={editModal.val}
                                onChange={e => setEditModal({ ...editModal, val: e.target.value })}
                                list={editModal.options.length > 0 ? "edit-options-list-match" : undefined}
                                autoFocus
                                placeholder="new value"
                            />
                            {editModal.options.length > 0 && (
                                <datalist id="edit-options-list-match">
                                    {editModal.options.map((opt, i) => <option key={i} value={opt} />)}
                                </datalist>
                            )}
                            <button className="btn-upload btn-full" onClick={handleSaveEdit} style={{ marginTop: '20px', background: 'var(--primary-color)', color: 'white', border: 'none', width: '100%' }}>
                                <Save size={16} /> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


export default ProductMatch;
