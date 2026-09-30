import React from 'react';
import { Edit3, X, Save } from 'lucide-react';
import { getDb } from '../db/Database';
import '../pages/Inventory.css';

function IgnoreRecords() {
    const [records, setRecords] = React.useState([]);
    const [productsList, setProductsList] = React.useState([]);
    const [attributes, setAttributes] = React.useState({ colours: [], finishes: [] });
    const [loading, setLoading] = React.useState(false);
    const [drafts, setDrafts] = React.useState({});
    const [editModal, setEditModal] = React.useState({ show: false, item: null, field: '', val: '', options: [] });

    const loadRecords = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const res = await db.select("SELECT * FROM inventory WHERE x_inactive = 1 OR x_inactive = '1' ORDER BY product_id DESC");
            setRecords(res);

            const prods = await db.select("SELECT product_id, product_name FROM products ORDER BY product_name");
            setProductsList(prods);

            const attrs = await db.select('SELECT type, value FROM attributes');
            setAttributes({
                colours: attrs.filter(a => a.type === 'colour').map(a => a.value),
                finishes: attrs.filter(a => a.type === 'finish').map(a => a.value),
            });
        } catch (e) { console.error(e); } finally { setLoading(false); }
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

    const handleRestore = async (id) => {
        try {
            const db = await getDb();
            await db.execute("UPDATE inventory SET x_inactive = 0 WHERE product_id = $1", [id]);
            setRecords(prev => prev.filter(r => r.product_id !== id));
        } catch (e) { console.error(e); alert('Failed to restore'); }
    };

    return (
        <div className="inventory-container">
            <datalist id="products-list-ignore">
                {productsList.map(p => <option key={p.product_id} value={p.product_name} />)}
            </datalist>
            <div className="table-container" style={{ margin: '-10px 0 0 0' }}>
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
                                <th style={{ width: '100px' }}>Finish</th>
                                <th style={{ width: '100px' }}>Colour</th>
                                <th style={{ width: '100px' }}>Size</th>
                                <th>Matched Product</th>
                                <th style={{ textAlign: 'center', width: '150px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.map(r => {
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
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_finish', val: eFinish, options: attributes.finishes })}>
                                            {eFinish && <span className="param-badge finish">{eFinish}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_colour', val: eColour, options: attributes.colours })}>
                                            {eColour && <span className="param-badge colour">{eColour}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>
                                        <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item: r, field: 'extracted_size', val: eSize, options: [] })}>
                                            {eSize && <span className="param-badge size">{eSize}</span>} <Edit3 size={12} className="edit-icon" />
                                        </td>

                                        <td><input type="text" list="products-list-ignore" className="search-input" style={{ padding: '6px 12px', width: '100%', minWidth: '150px' }} value={mProduct} onChange={e => handleDraftChange(r.product_id, 'matched_product_name', e.target.value)} placeholder="Type to match..." /></td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap', display: 'flex' }}>
                                            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem', marginRight: '8px' }} onClick={() => handleSave(r)}>Save</button>
                                            <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', color: '#10b981', borderColor: '#10b981' }} onClick={() => handleRestore(r.product_id)}>Restore</button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {records.length === 0 && <tr><td colSpan="8" className="empty-state">No ignored records.</td></tr>}
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
                                list={editModal.options.length > 0 ? "edit-options-list-ignore" : undefined}
                                autoFocus
                                placeholder="new value"
                            />
                            {editModal.options.length > 0 && (
                                <datalist id="edit-options-list-ignore">
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



export default IgnoreRecords;
