import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Edit3, X, ChevronDown, ChevronRight, Package, Save, Wand2, Trash2, Loader2 } from 'lucide-react';
import { getDb } from '../db/Database';
import './Inventory.css';

// Standard styles from other components
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




import ProductMatch from '../components/ProductMatch';
import IgnoreRecords from '../components/IgnoreRecords';
import ProductModal from '../components/ProductModal';

export default function Products() {
    const [collections, setCollections] = useState([]);
    const [products, setProducts] = useState([]);
    const [shippers, setShippers] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [mainTab, setMainTab] = useState('list');

    const [expandedCollections, setExpandedCollections] = useState({});

    // Modals state
    const [showCollectionModal, setShowCollectionModal] = useState(false);
    const [collectionFormData, setCollectionFormData] = useState({ id: null, name: '', shipper_id: '' });

    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const db = await getDb();
            const cols = await db.select("SELECT * FROM collections ORDER BY collection_name");
            const prods = await db.select("SELECT * FROM products ORDER BY product_name");
            const shps = await db.select("SELECT shipper_id, shipper_name FROM shippers ORDER BY shipper_name");
            const attrs = await db.select("SELECT * FROM attributes WHERE type IN ('colour', 'finish')");

            setCollections(cols);
            setProducts(prods);
            setShippers(shps);
            setAttributes(attrs);

            // Expand all by default
            const expanded = {};
            cols.forEach(c => expanded[c.collection_id] = true);
            setExpandedCollections(expanded);
        } catch (e) {
            console.error("Failed to load products data:", e);
        } finally {
            setIsLoading(false);
        }
    };


    const handleAutoMatchGlobalCollections = async () => {
        if (!confirm('Scan inventory and create collections for unique extracted names?')) return;
        try {
            const db = await getDb();
            const invs = await db.select("SELECT DISTINCT extracted_name FROM inventory WHERE (x_inactive IS NULL OR x_inactive != 1) AND extracted_name IS NOT NULL AND extracted_name != ''");
            let count = 0;
            for (let i of invs) {
                const name = (i.extracted_name || '').trim();
                if (!name) continue;
                const exists = collections.find(c => c.collection_name.toLowerCase() === name.toLowerCase());
                if (!exists) {
                    await db.execute("INSERT INTO collections (collection_name, shipper_id) VALUES ($1, $2)", [name, '']);
                    count++;
                }
            }
            alert(`Auto match complete. Created ${count} new collections.`);
            loadData();
        } catch (e) { console.error(e); alert('Error'); }
    };

    const handleSaveCollection = async () => {
        try {
            const db = await getDb();
            if (collectionFormData.id) {
                await db.execute(
                    "UPDATE collections SET collection_name = $1, shipper_id = $2 WHERE collection_id = $3",
                    [collectionFormData.name, collectionFormData.shipper_id || null, collectionFormData.id]
                );
            } else {
                await db.execute(
                    "INSERT INTO collections (collection_name, shipper_id) VALUES ($1, $2)",
                    [collectionFormData.name, collectionFormData.shipper_id || null]
                );
            }
            setShowCollectionModal(false);
            loadData();
        } catch (e) {
            console.error("Failed to save collection", e);
        }
    };

    const handleAutoMatchCollection = async (e, collection) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to auto match products for collection "${collection.collection_name}"?`)) return;
        try {
            const db = await getDb();
            const colName = collection.collection_name;

            const query = `
                SELECT extracted_colour, extracted_finish, extracted_size, MAX(product_id) as latest_inv_id 
                FROM inventory 
                WHERE lower(extracted_name) = lower($1) AND (backorder IS NULL OR backorder != 1) 
                GROUP BY extracted_colour, extracted_finish, extracted_size
            `;
            const groups = await db.select(query, [colName]);

            if (!groups || groups.length === 0) {
                alert("No matching inventory records found for this collection.");
                return;
            }

            let createdCount = 0;
            for (const g of groups) {
                const color = g.extracted_colour || '';
                const finish = g.extracted_finish || '';
                const size = g.extracted_size || '';

                const exists = products.find(p =>
                    p.collection_id === collection.collection_id &&
                    (p.color || '').toLowerCase() === color.toLowerCase() &&
                    (p.finish || '').toLowerCase() === finish.toLowerCase() &&
                    (p.size || '').toLowerCase() === size.toLowerCase()
                );

                if (!exists) {
                    const invDetails = await db.select(`SELECT * FROM inventory WHERE product_id = $1`, [g.latest_inv_id]);
                    const inv = invDetails && invDetails.length > 0 ? invDetails[0] : null;

                    let showCode = '';
                    let showName = '';
                    let showPrice = '';
                    let m2 = '';
                    let pcs = '';
                    let boxP = '';

                    if (inv) {
                        if (inv.showtile_name) {
                            const parts = inv.showtile_name.trim().split(' ');
                            if (parts.length > 0) {
                                showCode = parts[0];
                                showName = parts.slice(1).join(' ');
                            }
                        }
                        showPrice = inv.rrp || '';
                        m2 = inv.m2_per_box || '';
                        pcs = inv.pcs_per_box || '';
                        boxP = inv.box_per_pallet || '';
                    }

                    const pName = `${colName} ${color} ${finish} ${size}`.replace(/\s+/g, ' ').trim();
                    const defaultStock = JSON.stringify({ force_in_stock: false, backorder: false });

                    const res = await db.select(`
                        INSERT INTO products (
                            product_name, collection_id, color, finish, size, 
                            showtile_name, showtile_product_code, showtile_price,
                            m2_per_box, pcs_per_box, box_per_pallet, cht_and_gto_stock_status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING product_id as id
                    `, [pName, collection.collection_id, color, finish, size, showName, showCode, showPrice, m2, pcs, boxP, defaultStock]);

                    const newId = res[0].id;
                    const matchingRows = await db.select(
                        `
                            SELECT product_id FROM inventory 
                            WHERE (product_parent_id IS NULL OR product_parent_id = 0)
                            AND lower(COALESCE(extracted_name, '')) = lower(COALESCE($1, ''))
                            AND lower(COALESCE(extracted_colour, '')) = lower(COALESCE($2, ''))
                            AND lower(COALESCE(extracted_finish, '')) = lower(COALESCE($3, ''))
                            AND lower(COALESCE(extracted_size, '')) = lower(COALESCE($4, ''))
                        `,
                        [colName, color, finish, size]
                    );
                    if (matchingRows && matchingRows.length > 0) {
                        const ids = matchingRows.map(r => "'" + r.product_id + "'").join(',');
                        await db.execute(`UPDATE inventory SET product_parent_id = ? WHERE product_id IN (${ids})`, [newId]);
                    }
                    createdCount++;
                }
            }

            if (createdCount > 0) {
                alert(`Auto match complete. Created ${createdCount} new product(s).`);
                loadData();
            } else {
                alert("Auto match complete. No new products needed to be created.");
            }
        } catch (e) {
            console.error(e);
            alert("Error during auto match.");
        }
    };

    const handleAutoFetch = async () => {
        try {
            const db = await getDb();
            const pId = productFormData.product_id || productFormData.id;
            const col = collections.find(c => c.collection_id.toString() === (productFormData.collection_id || '').toString());
            const colName = col ? col.collection_name : '';
            const color = productFormData.color || colorInput || '';
            const finish = productFormData.finish || finishInput || '';
            const size = productFormData.size || '';

            let query = `SELECT * FROM inventory WHERE (backorder IS NULL OR backorder != 1) AND (product_parent_id = $1 OR (lower(extracted_name) = lower($2) AND lower(extracted_colour) = lower($3) AND lower(extracted_finish) = lower($4) AND lower(extracted_size) = lower($5))) ORDER BY product_id DESC LIMIT 1`;
            let params = [pId || -1, colName, color, finish, size];

            const invs = await db.select(query, params);
            if (invs && invs.length > 0) {
                const inv = invs[0];
                let newShowtileCode = '';
                let newShowtileName = '';
                if (inv.showtile_name) {
                    const parts = inv.showtile_name.trim().split(' ');
                    if (parts.length > 0) {
                        newShowtileCode = parts[0];
                        newShowtileName = parts.slice(1).join(' ');
                    }
                }

                setProductFormData(prev => ({
                    ...prev,
                    showtile_product_code: newShowtileCode || prev.showtile_product_code,
                    showtile_name: newShowtileName || prev.showtile_name,
                    showtile_price: inv.rrp || prev.showtile_price,
                    m2_per_box: inv.m2_per_box || prev.m2_per_box,
                    pcs_per_box: inv.pcs_per_box || prev.pcs_per_box,
                    box_per_pallet: inv.box_per_pallet || prev.box_per_pallet
                }));
            } else {
                alert("No matching inventory records found.");
            }
        } catch (e) {
            console.error(e);
            alert("Error fetching inventory data.");
        }
    };

    const handleStockStatusChange = async (productId, currentStatus, key, checked) => {
        try {
            const db = await getDb();
            const newStatus = { ...currentStatus, [key]: checked };
            await db.execute("UPDATE products SET cht_and_gto_stock_status = $1 WHERE product_id = $2", [JSON.stringify(newStatus), productId]);

            // Optimistic update
            setProducts(products.map(p => {
                if (p.product_id === productId) {
                    return { ...p, cht_and_gto_stock_status: JSON.stringify(newStatus) };
                }
                return p;
            }));
        } catch (e) {
            console.error("Failed to update stock status", e);
        }
    };

    const formatPrice = (regular, sales) => {
        if (sales && regular) return `${sales} - ${regular}`;
        if (regular) return `${regular}`;
        if (sales) return `${sales}`;
        return '-';
    };

    return (
        <div className="page-content" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
            {/* Topbar */}

            <div className="containers-subnav" style={{
                display: 'flex',
                gap: '16px',
                padding: '12px 24px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                zIndex: 10,
                margin: '-24px -24px 24px -24px'
            }}>
                <button className={`subnav-btn ${mainTab === 'list' ? 'active' : ''}`} onClick={() => setMainTab('list')}>Product List</button>
                <button className={`subnav-btn ${mainTab === 'match' ? 'active' : ''}`} onClick={() => setMainTab('match')}>Product Match</button>
                <button className={`subnav-btn ${mainTab === 'ignore' ? 'active' : ''}`} onClick={() => setMainTab('ignore')}>Ignore Records</button>
            </div>

            <div style={{ display: mainTab === 'list' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div className="topbar"
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
                    <div className="search-bar" style={{ display: 'flex', alignItems: 'center', background: 'white', padding: '8px 16px', borderRadius: '24px', border: '1px solid #e2e8f0', width: '300px' }}>
                        <Search size={18} style={{ color: '#94a3b8', marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: '0.9rem' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={() => {
                            setCollectionFormData({ id: null, name: '', shipper_id: '' });
                            setShowCollectionModal(true);
                        }}>
                            <Plus size={16} /> Add Collection
                        </button>
                        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={handleAutoMatchGlobalCollections}>
                            <Wand2 size={16} /> Auto Match Collection
                        </button>
                        <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={() => {
                            setEditingProduct(null); setShowProductModal(true);
                        }}>
                            <Plus size={16} /> Add Product
                        </button>
                    </div>
                </div>

                {/* Main Area: Collections Accordion */}
                <div style={{ flex: 1, overflowY: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    {isLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
                            <Loader2 className="animate-spin" size={32} style={{ color: '#3b82f6' }} />
                        </div>
                    ) : (
                        <>
                            {collections.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No collections found.</div>}
                            {collections.map(collection => {
                                const collectionProducts = products.filter(p => p.collection_id === collection.collection_id).filter(p => {
                                    if (!search) return true;
                                    const term = search.toLowerCase();
                                    return (p.product_name || '').toLowerCase().includes(term) ||
                                        (p.color || '').toLowerCase().includes(term) ||
                                        (p.finish || '').toLowerCase().includes(term);
                                });

                                if (search && collectionProducts.length === 0) return null;

                                const isExpanded = expandedCollections[collection.collection_id];

                                return (
                                    <div key={collection.collection_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', cursor: 'pointer', background: isExpanded ? '#f8fafc' : 'white', transition: 'background 0.2s' }}
                                            onClick={() => toggleCollection(collection.collection_id)}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                {isExpanded ? <ChevronDown size={18} style={{ marginRight: '12px', color: '#64748b' }} /> : <ChevronRight size={18} style={{ marginRight: '12px', color: '#64748b' }} />}
                                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>{collection.collection_name}</h3>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <button className="btn-icon" title="Auto Match" onClick={(e) => handleAutoMatchCollection(e, collection)}>
                                                    <Wand2 size={18} />
                                                </button>
                                                <button className="btn-icon" title="Edit Collection" onClick={(e) => {
                                                    e.stopPropagation();
                                                    setCollectionFormData({ id: collection.collection_id, name: collection.collection_name, shipper_id: collection.shipper_id || '' });
                                                    setShowCollectionModal(true);
                                                }}>
                                                    <Edit2 size={18} />
                                                </button>
                                                <button className="btn-icon" title="Delete Collection" style={{ color: '#ef4444' }} onClick={(e) => handleDeleteCollection(e, collection)}>
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div style={{ padding: '0 24px 24px 24px' }}>
                                                {collectionProducts.length === 0 ? (
                                                    <div style={{ padding: '16px', color: '#94a3b8', fontSize: '0.9rem', fontStyle: 'italic' }}>No products in this collection.</div>
                                                ) : (
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '80px' }}>Actions</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Product Name</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>Colour</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>Finish</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>Size</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>CHT Price</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>GTO Price</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '240px' }}>Online Stock Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {collectionProducts.map(product => {
                                                                let stockStatus = { force_in_stock: false, backorder: false };
                                                                try {
                                                                    if (product.cht_and_gto_stock_status) {
                                                                        stockStatus = JSON.parse(product.cht_and_gto_stock_status);
                                                                    }
                                                                } catch (e) { }

                                                                return (
                                                                    <tr key={product.product_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                                        <td style={{ padding: '12px 8px' }}>
                                                                            <button className="btn-icon" onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setEditingProduct(product); setShowProductModal(true);
                                                                            }}>
                                                                                <Edit2 size={16} />
                                                                            </button>
                                                                        </td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#1e293b' }}>{product.product_name}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.color}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.finish}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.size}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{formatPrice(product.cht_regular_price, product.cht_sales_price)}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{formatPrice(product.gto_regular_price, product.gto_sales_price)}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>
                                                                            <div style={{ display: 'flex', gap: '16px' }}>
                                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={!!stockStatus.force_in_stock}
                                                                                        onChange={(e) => handleStockStatusChange(product.product_id, stockStatus, 'force_in_stock', e.target.checked)}
                                                                                    />
                                                                                    Force in Stock
                                                                                </label>
                                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={!!stockStatus.backorder}
                                                                                        onChange={(e) => handleStockStatusChange(product.product_id, stockStatus, 'backorder', e.target.checked)}
                                                                                    />
                                                                                    Backorder
                                                                                </label>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>


            </div> {/* End list tab */}

            <div style={{ display: mainTab === 'match' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <ProductMatch />
            </div>

            <div style={{ display: mainTab === 'ignore' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <IgnoreRecords />
            </div>

            {/* Collection Modal */}

            {showCollectionModal && (
                <div style={overlayStyle}>
                    <div style={{ ...contentStyle, width: '400px', maxHeight: '500px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>{collectionFormData.id ? 'Edit Collection' : 'Add Collection'}</h2>
                            <button className="btn-icon" onClick={() => setShowCollectionModal(false)}><X size={20} /></button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Collection Name</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={collectionFormData.name}
                                    onChange={e => setCollectionFormData({ ...collectionFormData, name: e.target.value })}
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Shipper</label>
                                <select
                                    className="form-control"
                                    value={collectionFormData.shipper_id}
                                    onChange={e => setCollectionFormData({ ...collectionFormData, shipper_id: e.target.value })}
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem' }}
                                >
                                    <option value="">Select Shipper...</option>
                                    {shippers.map(s => <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                            <button className="btn-secondary" onClick={() => setShowCollectionModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancel</button>
                            <button className="btn-primary" onClick={handleSaveCollection} style={{ padding: '8px 16px', borderRadius: '6px' }}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Product Modal */}
            <ProductModal 
                isOpen={showProductModal} 
                onClose={() => setShowProductModal(false)}
                product={editingProduct} 
                collections={collections} 
                shippers={shippers} 
                attributes={attributes} 
                onSaveSuccess={() => {
                    setShowProductModal(false);
                    loadData();
                }}
            />
        </div>
    );
}
