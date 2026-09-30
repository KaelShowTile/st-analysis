import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getDb } from '../db/Database';

const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
};
const contentStyle = {
    background: 'white', borderRadius: '8px', padding: '24px',
    width: '80%', maxWidth: '900px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column'
};

function getInitialProductState() {
    return {
        id: null,
        product_name: '',
        product_description: '',
        collection_id: '',
        shipper_id: '',
        size: '',
        m2_per_box: '',
        pcs_per_box: '',
        box_per_pallet: '',
        showtile_name: '',
        showtile_product_code: '',
        showtile_price: '',
        cht_name: '',
        gto_name: ''
    };
}

export default function ProductModal({
    isOpen,
    onClose,
    product,
    collections,
    shippers,
    attributes,
    onSaveSuccess
}) {
    const [productTab, setProductTab] = useState('info');
    const [productFormData, setProductFormData] = useState(getInitialProductState());
    const [colorInput, setColorInput] = useState('');
    const [finishInput, setFinishInput] = useState('');
    const [showColorSuggestions, setShowColorSuggestions] = useState(false);
    const [showFinishSuggestions, setShowFinishSuggestions] = useState(false);
    const [productInventory, setProductInventory] = useState([]);

    useEffect(() => {
        if (isOpen) {
            if (product) {
                setProductFormData({
                    id: product.product_id,
                    ...product
                });
                setColorInput(product.color || '');
                setFinishInput(product.finish || '');
                setProductTab('info');
                setProductInventory([]);
                loadProductInventory(product.product_id, product.collection_id, product.color, product.finish, product.size);
            } else {
                setProductFormData(getInitialProductState());
                setColorInput('');
                setFinishInput('');
                setProductTab('info');
                setProductInventory([]);
                loadProductInventory(null, '', '', '', '');
            }
        }
    }, [isOpen, product]);

    const loadProductInventory = async (pId, colId, color, finish, size) => {
        try {
            const db = await getDb();
            if (pId) {
                const col = collections.find(c => c.collection_id.toString() === (colId || '').toString());
                const colName = col ? col.collection_name : '';

                const invs = await db.select(`
                     SELECT sku, available, holding, so_qty, total_qty, cost, backorder, backorder_amount 
                     FROM inventory 
                     WHERE product_parent_id = $1
                     OR (
                         (backorder IS NULL OR backorder != 1) 
                         AND lower(extracted_name) = lower($2)
                         AND lower(extracted_colour) = lower($3)
                         AND lower(extracted_finish) = lower($4)
                         AND lower(extracted_size) = lower($5)
                     )
                 `, [pId, colName || '', color || '', finish || '', size || '']);
                setProductInventory(invs);
            } else {
                setProductInventory([]);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleAutoFillShowtile = async () => {
        try {
            const db = await getDb();
            const col = collections.find(c => c.collection_id.toString() === productFormData.collection_id.toString());
            const colName = col ? col.collection_name : '';
            const color = productFormData.color || colorInput || '';
            const finish = productFormData.finish || finishInput || '';
            const size = productFormData.size || '';

            let query = `SELECT * FROM inventory WHERE (backorder IS NULL OR backorder != 1) AND (product_parent_id = $1 OR (lower(extracted_name) = lower($2) AND lower(extracted_colour) = lower($3) AND lower(extracted_finish) = lower($4) AND lower(extracted_size) = lower($5))) ORDER BY product_id DESC LIMIT 1`;
            let params = [productFormData.id || -1, colName, color, finish, size];

            const invs = await db.select(query, params);
            if (invs && invs.length > 0) {
                const inv = invs[0];
                let newShowtileCode = inv.showtile_product_code || '';
                let newShowtileName = '';
                if (inv.showtile_name) {
                    const parts = inv.showtile_name.trim().split(' ');
                    if (parts.length > 1) {
                        newShowtileName = parts.slice(1).join(' ');
                    }
                }

                setProductFormData(prev => ({
                    ...prev,
                    showtile_product_code: newShowtileCode || prev.showtile_product_code,
                    showtile_name: newShowtileName || prev.showtile_name,
                    showtile_price: inv.price || prev.showtile_price,
                    m2_per_box: inv.m2_per_box || prev.m2_per_box,
                    pcs_per_box: inv.pcs_per_box || prev.pcs_per_box,
                    box_per_pallet: inv.box_per_pallet || prev.box_per_pallet
                }));
                alert("Auto-filled from inventory successfully.");
            } else {
                alert("No matching inventory records found.");
            }
        } catch (e) {
            console.error(e);
            alert("Error fetching inventory data.");
        }
    };

    const handleSaveProduct = async () => {
        try {
            const db = await getDb();
            const finalColor = colorInput.trim();
            const finalFinish = finishInput.trim();

            if (productFormData.id) {
                await db.execute(`
                    UPDATE products SET 
                        product_name = $1, product_description = $2, collection_id = $3, shipper_id = $4,
                        color = $5, finish = $6, size = $7, m2_per_box = $8, pcs_per_box = $9, box_per_pallet = $10,
                        showtile_name = $11, showtile_product_code = $12, showtile_price = $13,
                        cht_name = $14, gto_name = $15
                    WHERE product_id = $16
                `, [
                    productFormData.product_name, productFormData.product_description, productFormData.collection_id, productFormData.shipper_id || null,
                    finalColor, finalFinish, productFormData.size,
                    productFormData.m2_per_box || null, productFormData.pcs_per_box || null, productFormData.box_per_pallet || null,
                    productFormData.showtile_name, productFormData.showtile_product_code, productFormData.showtile_price || null,
                    productFormData.cht_name, productFormData.gto_name,
                    productFormData.id
                ]);
            } else {
                await db.execute(`
                    INSERT INTO products (
                        product_name, product_description, collection_id, shipper_id,
                        color, finish, size, m2_per_box, pcs_per_box, box_per_pallet,
                        showtile_name, showtile_product_code, showtile_price,
                        cht_name, gto_name
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                `, [
                    productFormData.product_name, productFormData.product_description, productFormData.collection_id, productFormData.shipper_id || null,
                    finalColor, finalFinish, productFormData.size,
                    productFormData.m2_per_box || null, productFormData.pcs_per_box || null, productFormData.box_per_pallet || null,
                    productFormData.showtile_name, productFormData.showtile_product_code, productFormData.showtile_price || null,
                    productFormData.cht_name, productFormData.gto_name
                ]);
            }

            // Sync attributes table if new color/finish added
            if (finalColor && !attributes.some(a => a.type === 'colour' && a.value.toLowerCase() === finalColor.toLowerCase())) {
                await db.execute("INSERT INTO attributes (type, value) VALUES ('colour', $1)", [finalColor]);
            }
            if (finalFinish && !attributes.some(a => a.type === 'finish' && a.value.toLowerCase() === finalFinish.toLowerCase())) {
                await db.execute("INSERT INTO attributes (type, value) VALUES ('finish', $1)", [finalFinish]);
            }

            if (onSaveSuccess) onSaveSuccess();
        } catch (err) {
            console.error(err);
            alert("Failed to save product.");
        }
    };

    if (!isOpen) return null;

    const hasVariants = productFormData.id || ((colorInput || '').trim() !== '' && (finishInput || '').trim() !== '' && (productFormData.size || '').trim() !== '');

    return (
        <div style={overlayStyle}>
            <div style={contentStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>{productFormData.id ? 'Edit Product' : 'Add Product'}</h2>
                    <button className="btn-icon" onClick={onClose}><X size={20} /></button>
                </div>

                <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
                    <div
                        style={{ paddingBottom: '12px', cursor: 'pointer', fontWeight: 500, color: productTab === 'info' ? '#3b82f6' : '#64748b', borderBottom: productTab === 'info' ? '2px solid #3b82f6' : 'none' }}
                        onClick={() => setProductTab('info')}
                    >
                        Info
                    </div>
                    {hasVariants && (
                        <>
                            <div
                                style={{ paddingBottom: '12px', cursor: 'pointer', fontWeight: 500, color: productTab === 'inventory' ? '#3b82f6' : '#64748b', borderBottom: productTab === 'inventory' ? '2px solid #3b82f6' : 'none' }}
                                onClick={() => setProductTab('inventory')}
                            >
                                Inventory
                            </div>
                            <div
                                style={{ paddingBottom: '12px', cursor: 'pointer', fontWeight: 500, color: productTab === 'backorder' ? '#3b82f6' : '#64748b', borderBottom: productTab === 'backorder' ? '2px solid #3b82f6' : 'none' }}
                                onClick={() => setProductTab('backorder')}
                            >
                                Backorder
                            </div>
                        </>
                    )}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
                    {productTab === 'info' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {/* General Section */}
                            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#0f172a' }}>General</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Product Name</label>
                                        <input type="text" className="form-control" value={productFormData.product_name} onChange={e => setProductFormData({ ...productFormData, product_name: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Product Description</label>
                                        <input type="text" className="form-control" value={productFormData.product_description} onChange={e => setProductFormData({ ...productFormData, product_description: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Collection</label>
                                        <select className="form-control" value={productFormData.collection_id} onChange={e => {
                                            const cId = e.target.value;
                                            const col = collections.find(c => c.collection_id.toString() === cId);
                                            setProductFormData({ ...productFormData, collection_id: cId, shipper_id: col ? col.shipper_id : productFormData.shipper_id });
                                        }} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
                                            <option value="">Select Collection...</option>
                                            {collections.map(c => <option key={c.collection_id} value={c.collection_id}>{c.collection_name}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Shipper</label>
                                        <select className="form-control" value={productFormData.shipper_id} onChange={e => setProductFormData({ ...productFormData, shipper_id: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
                                            <option value="">Select Shipper...</option>
                                            {shippers.map(s => <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ margin: 0, position: 'relative' }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Colour</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={colorInput}
                                            onChange={e => { setColorInput(e.target.value); setShowColorSuggestions(true); }}
                                            onFocus={() => setShowColorSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowColorSuggestions(false), 200)}
                                            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                        />
                                        {showColorSuggestions && attributes.filter(a => a.type === 'colour').length > 0 && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', zIndex: 10, maxHeight: '150px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                                {attributes.filter(a => a.type === 'colour' && a.value.toLowerCase().includes(colorInput.toLowerCase())).map((attr, idx) => (
                                                    <div key={idx} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => { setColorInput(attr.value); setShowColorSuggestions(false); }}>
                                                        {attr.value}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="form-group" style={{ margin: 0, position: 'relative' }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Finish</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={finishInput}
                                            onChange={e => { setFinishInput(e.target.value); setShowFinishSuggestions(true); }}
                                            onFocus={() => setShowFinishSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowFinishSuggestions(false), 200)}
                                            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                        />
                                        {showFinishSuggestions && attributes.filter(a => a.type === 'finish').length > 0 && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', zIndex: 10, maxHeight: '150px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                                {attributes.filter(a => a.type === 'finish' && a.value.toLowerCase().includes(finishInput.toLowerCase())).map((attr, idx) => (
                                                    <div key={idx} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onClick={() => { setFinishInput(attr.value); setShowFinishSuggestions(false); }}>
                                                        {attr.value}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Size</label>
                                        <input type="text" className="form-control" value={productFormData.size} onChange={e => setProductFormData({ ...productFormData, size: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                </div>
                            </div>

                            {/* Showtile Section */}
                            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#0f172a' }}>Showtile Specifics</h3>
                                    <button className="btn-secondary" onClick={handleAutoFillShowtile} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>Auto Fill from Inventory</button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Name</label>
                                        <input type="text" className="form-control" value={productFormData.showtile_name} onChange={e => setProductFormData({ ...productFormData, showtile_name: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Product Code</label>
                                        <input type="text" className="form-control" value={productFormData.showtile_product_code} onChange={e => setProductFormData({ ...productFormData, showtile_product_code: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Price</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.showtile_price} onChange={e => setProductFormData({ ...productFormData, showtile_price: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>m2 / box</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.m2_per_box} onChange={e => setProductFormData({ ...productFormData, m2_per_box: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>pcs / box</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.pcs_per_box} onChange={e => setProductFormData({ ...productFormData, pcs_per_box: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>box / pallet</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.box_per_pallet} onChange={e => setProductFormData({ ...productFormData, box_per_pallet: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                </div>
                            </div>

                            {/* CHT/GTO Section */}
                            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#0f172a' }}>Online Store Aliases</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>CHT Name</label>
                                        <input type="text" className="form-control" value={productFormData.cht_name} onChange={e => setProductFormData({ ...productFormData, cht_name: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>GTO Name</label>
                                        <input type="text" className="form-control" value={productFormData.gto_name} onChange={e => setProductFormData({ ...productFormData, gto_name: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {productTab === 'inventory' && (
                        <div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>SKU</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Available</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Holding</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>SO Qty</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Total Qty</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {productInventory.length === 0 ? (
                                        <tr><td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>No inventory mapping found.</td></tr>
                                    ) : (
                                        productInventory.filter(inv => inv.backorder !== 1).map((inv, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}><span className="sku-badge">{inv.sku}</span></td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>{inv.available}</td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>{inv.holding}</td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>{inv.so_qty}</td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>{inv.total_qty}</td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>${Number(inv.cost || 0).toFixed(2)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {productTab === 'backorder' && (
                        <div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>SKU</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Total BO Qty</th>
                                        <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {productInventory.filter(inv => inv.backorder === 1).length === 0 ? (
                                        <tr><td colSpan="3" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>No backorders found.</td></tr>
                                    ) : (
                                        productInventory.filter(inv => inv.backorder === 1).map((inv, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}><span className="sku-badge">{inv.sku}</span></td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>{inv.backorder_amount || 0}</td>
                                                <td style={{ padding: '12px 8px', fontSize: '0.9rem' }}>${Number(inv.cost || 0).toFixed(2)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                    <button className="btn-secondary" onClick={onClose} style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancel</button>
                    <button className="btn-primary" onClick={handleSaveProduct} style={{ padding: '8px 16px', borderRadius: '6px' }}>Save</button>
                </div>
            </div>
        </div>
    );
}
