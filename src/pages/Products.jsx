import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, X, ChevronDown, ChevronRight, Package, Save , Wand2, Trash2} from 'lucide-react';
import { getDb } from '../db/Database';

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

export default function Products() {
    const [collections, setCollections] = useState([]);
    const [products, setProducts] = useState([]);
    const [shippers, setShippers] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [search, setSearch] = useState('');

    const [expandedCollections, setExpandedCollections] = useState({});

    // Modals state
    const [showCollectionModal, setShowCollectionModal] = useState(false);
    const [collectionFormData, setCollectionFormData] = useState({ id: null, name: '', shipper_id: '' });

    const [showProductModal, setShowProductModal] = useState(false);
    const [productTab, setProductTab] = useState('info'); // 'info' or 'inventory'
    const [productFormData, setProductFormData] = useState(getInitialProductState());

    const [colorInput, setColorInput] = useState('');
    const [finishInput, setFinishInput] = useState('');
    const [showColorSuggestions, setShowColorSuggestions] = useState(false);
    const [showFinishSuggestions, setShowFinishSuggestions] = useState(false);

    const [productInventory, setProductInventory] = useState([]);

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
                         lower(extracted_name) = lower($2) 
                         AND lower(extracted_colour) = lower($3)
                         AND lower(extracted_finish) = lower($4)
                         AND lower(extracted_size) = lower($5)
                     )
                 `, [pId, colName || '', color || '', finish || '', size || '']);
                 setProductInventory(invs);
            } else {
                 setProductInventory([]);
            }
        } catch(e) { 
            console.error(e); 
        }
    };
useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
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
        }
    };

    function getInitialProductState() {
        return {
            id: null,
            product_name: '',
            product_description: '',
            collection_id: '',
            shipper_id: '',
            color: '',
            finish: '',
            size: '',
            showtile_name: '',
            showtile_product_code: '',
            showtile_price: '',
            gto_name: '',
            cht_name: '',
            m2_per_box: '',
            pcs_per_box: '',
            box_per_pallet: ''
        };
    }

    const toggleCollection = (id) => {
        setExpandedCollections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // --- Collection Modal ---
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

    // --- Product Modal ---
    const handleSaveProduct = async () => {
        try {
            const db = await getDb();
            const p = productFormData;
            const cId = p.collection_id || null;
            const sId = p.shipper_id || null;
            const stPrice = parseFloat(p.showtile_price) || null;
            const m2 = parseFloat(p.m2_per_box) || null;
            const pcs = parseFloat(p.pcs_per_box) || null;
            const box = parseFloat(p.box_per_pallet) || null;

            if (p.id) {
                await db.execute(
                    `UPDATE products SET 
                        product_name = $1, product_description = $2, collection_id = $3, shipper_id = $4,
                        color = $5, finish = $6, size = $7, showtile_name = $8, showtile_product_code = $9,
                        showtile_price = $10, gto_name = $11, cht_name = $12,
                        m2_per_box = $13, pcs_per_box = $14, box_per_pallet = $15
                     WHERE product_id = $16`,
                    [
                        p.product_name, p.product_description, cId, sId, colorInput, finishInput, p.size,
                        p.showtile_name, p.showtile_product_code, stPrice, p.gto_name, p.cht_name,
                        m2, pcs, box, p.id
                    ]
                );
            } else {
                const defaultStock = JSON.stringify({ force_in_stock: false, backorder: false });
                await db.execute(
                    `INSERT INTO products (
                        product_name, product_description, collection_id, shipper_id,
                        color, finish, size, showtile_name, showtile_product_code,
                        showtile_price, gto_name, cht_name, m2_per_box, pcs_per_box, box_per_pallet, cht_and_gto_stock_status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                    [
                        p.product_name, p.product_description, cId, sId, colorInput, finishInput, p.size,
                        p.showtile_name, p.showtile_product_code, stPrice, p.gto_name, p.cht_name,
                        m2, pcs, box, defaultStock
                    ]
                );
            }

            // Save new attributes if they don't exist
            if (colorInput) {
                const exists = attributes.find(a => a.type === 'colour' && a.value.toLowerCase() === colorInput.toLowerCase());
                if (!exists) await db.execute("INSERT INTO attributes (type, value) VALUES ('colour', $1)", [colorInput]);
            }
            if (finishInput) {
                const exists = attributes.find(a => a.type === 'finish' && a.value.toLowerCase() === finishInput.toLowerCase());
                if (!exists) await db.execute("INSERT INTO attributes (type, value) VALUES ('finish', $1)", [finishInput]);
            }

            setShowProductModal(false);
            loadData();
        } catch (e) {
            console.error("Failed to save product", e);
        }
    };

    
    const handleDeleteCollection = async (e, collection) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete collection "${collection.collection_name}" and ALL its products?`)) {
            try {
                const db = await getDb();
                const prods = await db.select("SELECT product_id FROM products WHERE collection_id = $1", [collection.collection_id]);
                if (prods && prods.length > 0) {
                    const pIds = prods.map(p => p.product_id).join(',');
                    await db.execute(`UPDATE inventory SET product_parent_id = NULL WHERE product_parent_id IN (${pIds})`);
                }
                await db.execute("DELETE FROM products WHERE collection_id = $1", [collection.collection_id]);
                await db.execute("DELETE FROM collections WHERE collection_id = $1", [collection.collection_id]);
                loadData();
            } catch(err) {
                console.error(err);
                alert("Failed to delete collection.");
            }
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
                    
                    await db.execute(`
                        INSERT INTO products (
                            product_name, collection_id, color, finish, size, 
                            showtile_name, showtile_product_code, showtile_price,
                            m2_per_box, pcs_per_box, box_per_pallet, cht_and_gto_stock_status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    `, [pName, collection.collection_id, color, finish, size, showName, showCode, showPrice, m2, pcs, boxP, defaultStock]);
                    
                    createdCount++;
                }
            }
            
            if (createdCount > 0) {
                alert(`Auto match complete. Created ${createdCount} new product(s).`);
                loadData();
            } else {
                alert("Auto match complete. No new products needed to be created.");
            }
        } catch(e) {
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
        } catch(e) {
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

    const colorSuggestions = attributes.filter(a => a.type === 'colour' && a.value.toLowerCase().includes(colorInput.toLowerCase()));
    const finishSuggestions = attributes.filter(a => a.type === 'finish' && a.value.toLowerCase().includes(finishInput.toLowerCase()));

    return (
        <div className="page-content" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
            {/* Topbar */}
            <div className="topbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
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
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={() => {
                        setProductFormData(getInitialProductState());
                        setColorInput('');
                        setFinishInput('');
                        setProductTab('info');
                        setProductInventory([]);
                        setShowProductModal(true);
                        loadProductInventory(null, '', '', '', '');
                    }}>
                        <Plus size={16} /> Add Product
                    </button>
                </div>
            </div>

            {/* Main Area: Collections Accordion */}
            <div style={{ flex: 1, overflowY: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
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
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Actions</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Product Name</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Colour</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Finish</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Size</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>CHT Price</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>GTO Price</th>
                                                    <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Online Stock Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {collectionProducts.map(product => {
                                                    let stockStatus = { force_in_stock: false, backorder: false };
                                                    try {
                                                        if (product.cht_and_gto_stock_status) {
                                                            stockStatus = JSON.parse(product.cht_and_gto_stock_status);
                                                        }
                                                    } catch (e) {}

                                                    return (
                                                        <tr key={product.product_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                            <td style={{ padding: '12px 8px' }}>
                                                                <button className="btn-icon" onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setProductFormData({
                                                                        id: product.product_id,
                                                                        ...product
                                                                    });
                                                                    setColorInput(product.color || '');
                                                                    setFinishInput(product.finish || '');
                                                                    setProductTab('info');
                                                                    setProductInventory([]);
                                                                    setShowProductModal(true);
                                                                    loadProductInventory(product.product_id, product.collection_id, product.color, product.finish, product.size);
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
                                    onChange={e => setCollectionFormData({...collectionFormData, name: e.target.value})}
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Shipper</label>
                                <select 
                                    className="form-control" 
                                    value={collectionFormData.shipper_id}
                                    onChange={e => setCollectionFormData({...collectionFormData, shipper_id: e.target.value})}
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
            {showProductModal && (
                <div style={overlayStyle}>
                    <div style={contentStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>{productFormData.id ? 'Edit Product' : 'Add Product'}</h2>
                            <button className="btn-icon" onClick={() => setShowProductModal(false)}><X size={20} /></button>
                        </div>
                        
                        
                        
                        {(()=>{
                            const hasVariants = (colorInput || '').trim() !== '' && (finishInput || '').trim() !== '' && (productFormData.size || '').trim() !== '';
                            return (
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
                            );
                        })()}



                        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', minHeight: '300px' }}>
                            {productTab === 'info' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    {/* Section 1: Basic Info */}
                                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#334155', marginBottom: '16px', marginTop: 0 }}>Basic Info</h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Product Name</label>
                                                <input type="text" className="form-control" value={productFormData.product_name} onChange={e => setProductFormData({...productFormData, product_name: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Product Description</label>
                                                <input type="text" className="form-control" value={productFormData.product_description} onChange={e => setProductFormData({...productFormData, product_description: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Collection</label>
                                                <select className="form-control" value={productFormData.collection_id} onChange={e => {
                                                    const cId = e.target.value;
                                                    const col = collections.find(c => c.collection_id.toString() === cId);
                                                    setProductFormData({...productFormData, collection_id: cId, shipper_id: col ? col.shipper_id : productFormData.shipper_id});
                                                }} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
                                                    <option value="">Select Collection...</option>
                                                    {collections.map(c => <option key={c.collection_id} value={c.collection_id}>{c.collection_name}</option>)}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Shipper</label>
                                                <select className="form-control" value={productFormData.shipper_id} onChange={e => setProductFormData({...productFormData, shipper_id: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
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
                                                {showColorSuggestions && colorSuggestions.length > 0 && (
                                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', zIndex: 10, maxHeight: '150px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                                        {colorSuggestions.map(s => (
                                                            <div key={s.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem' }} onClick={() => { setColorInput(s.value); setShowColorSuggestions(false); }} className="dropdown-item">
                                                                {s.value}
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
                                                {showFinishSuggestions && finishSuggestions.length > 0 && (
                                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', zIndex: 10, maxHeight: '150px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                                        {finishSuggestions.map(s => (
                                                            <div key={s.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem' }} onClick={() => { setFinishInput(s.value); setShowFinishSuggestions(false); }} className="dropdown-item">
                                                                {s.value}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Size</label>
                                                <input type="text" className="form-control" value={productFormData.size} onChange={e => setProductFormData({...productFormData, size: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Section 2: Showtile & Specs */}
                                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#334155', margin: 0 }}>Showtile & Specs</h3>
                                            {(colorInput || '').trim() !== '' && (finishInput || '').trim() !== '' && (productFormData.size || '').trim() !== '' && (
                                                <button className="btn-secondary" onClick={handleAutoFetch} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem' }}>
                                                    <Wand2 size={14} /> Auto fetch
                                                </button>
                                            )}
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Name</label>
                                                <input type="text" className="form-control" value={productFormData.showtile_name} onChange={e => setProductFormData({...productFormData, showtile_name: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Product Code</label>
                                                <input type="text" className="form-control" value={productFormData.showtile_product_code} onChange={e => setProductFormData({...productFormData, showtile_product_code: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Showtile Price</label>
                                                <input type="number" step="0.01" className="form-control" value={productFormData.showtile_price} onChange={e => setProductFormData({...productFormData, showtile_price: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>m2 / box</label>
                                                <input type="number" step="0.01" className="form-control" value={productFormData.m2_per_box} onChange={e => setProductFormData({...productFormData, m2_per_box: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>pcs / box</label>
                                                <input type="number" step="0.01" className="form-control" value={productFormData.pcs_per_box} onChange={e => setProductFormData({...productFormData, pcs_per_box: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>box / pallet</label>
                                                <input type="number" step="0.01" className="form-control" value={productFormData.box_per_pallet} onChange={e => setProductFormData({...productFormData, box_per_pallet: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Section 3: External Names */}
                                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#334155', marginBottom: '16px', marginTop: 0 }}>External Names</h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>CHT Name</label>
                                                <input type="text" className="form-control" value={productFormData.cht_name} onChange={e => setProductFormData({...productFormData, cht_name: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>GTO Name</label>
                                                <input type="text" className="form-control" value={productFormData.gto_name} onChange={e => setProductFormData({...productFormData, gto_name: e.target.value})} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
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
                                            {productInventory.filter(i => !i.backorder).map((inv, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#1e293b' }}>{inv.sku}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.available || 0}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.holding || 0}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.so_qty || 0}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.total_qty || 0}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.cost || 0}</td>
                                                </tr>
                                            ))}
                                            {productInventory.filter(i => !i.backorder).length === 0 && (
                                                <tr>
                                                    <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>No inventory records found.</td>
                                                </tr>
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
                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Backorder Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {productInventory.filter(i => i.backorder).map((inv, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#1e293b' }}>{inv.sku}</td>
                                                    <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{inv.backorder_amount || 0}</td>
                                                </tr>
                                            ))}
                                            {productInventory.filter(i => i.backorder).length === 0 && (
                                                <tr>
                                                    <td colSpan="2" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>No backorder records found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                            <button className="btn-secondary" onClick={() => setShowProductModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Cancel</button>
                            <button className="btn-primary" onClick={handleSaveProduct} style={{ padding: '8px 16px', borderRadius: '6px' }}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
