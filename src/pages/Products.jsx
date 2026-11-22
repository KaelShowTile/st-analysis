import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, X, ChevronDown, ChevronRight, Wand2, Trash2, Loader2, RefreshCw, UploadCloud, Sparkles, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getDb } from '../db/Database';
import { fetchProductFeeds, buildStPriceUpdateItem, updateStPricesOnline } from '../utils/productFeeds';
import { normalizeSize } from '../utils/featureExtractor';
import { buildInventoryLookup, findMatchedInventoryForProduct, extractAutoFillFromMatchedInventory } from '../utils/inventoryAutoFill';
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
    const [collectionFormData, setCollectionFormData] = useState({ id: null, name: '', shipper_id: '', description: '' });

    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);

    const [productSortConfig, setProductSortConfig] = useState({ key: 'product_name', direction: 'asc' });

    const [isAutoMatchingGlobal, setIsAutoMatchingGlobal] = useState(false);
    const [isAutoMatchingCollection, setIsAutoMatchingCollection] = useState(null);
    const [isRefreshingFeeds, setIsRefreshingFeeds] = useState(false);
    const [isUpdatingStPrices, setIsUpdatingStPrices] = useState(false);
    const [isAutoFillingInventory, setIsAutoFillingInventory] = useState(false);

    const toggleCollection = (id) => {
        setExpandedCollections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleDeleteCollection = async (e, collection) => {
        e.stopPropagation();
        if (!(await confirm(`Are you sure you want to delete collection "${collection.collection_name}"? This will also remove the collection association from all its products.`))) {
            return;
        }
        try {
            const db = await getDb();
            await db.execute("UPDATE products SET collection_id = NULL WHERE collection_id = $1", [collection.collection_id]);
            await db.execute("DELETE FROM collections WHERE collection_id = $1", [collection.collection_id]);
            loadData();
        } catch (err) {
            console.error(err);
            alert("Failed to delete collection.");
        }
    };

    const handleDeleteProduct = async (e, product) => {
        e.stopPropagation();
        if (!(await confirm(`Are you sure you want to delete product "${product.product_name}"?`))) {
            return;
        }
        try {
            const db = await getDb();
            await db.execute("UPDATE inventory SET product_parent_id = NULL WHERE product_parent_id = $1", [product.product_id]);
            await db.execute("DELETE FROM products WHERE product_id = $1", [product.product_id]);
            loadData();
        } catch (err) {
            console.error(err);
            alert("Failed to delete product.");
        }
    };

    useEffect(() => {
        loadData(true);
        const handleSync = () => loadData(false);
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, []);

    const loadData = async (isInitial = false) => {
        if (isInitial) setIsLoading(true);
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

            // Expand new collections by default, preserve existing states
            setExpandedCollections(prev => {
                const newExpanded = { ...prev };
                cols.forEach(c => {
                    if (newExpanded[c.collection_id] === undefined) {
                        newExpanded[c.collection_id] = true;
                    }
                });
                return newExpanded;
            });
        } catch (e) {
            console.error("Failed to load products data:", e);
        } finally {
            if (isInitial) setIsLoading(false);
        }
    };


    const handleAutoMatchGlobalCollections = async () => {
        if (!(await confirm('Scan inventory and create collections for unique extracted names?'))) return;
        setIsAutoMatchingGlobal(true);
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
        } catch (e) {
            console.error(e);
            alert('Error');
        } finally {
            setIsAutoMatchingGlobal(false);
        }
    };

    const handleRefreshFeeds = async () => {
        setIsRefreshingFeeds(true);
        try {
            const feeds = await fetchProductFeeds();
            const stCount = feeds.st?.length || 0;
            const chtCount = feeds.cht?.length || 0;
            const gtoCount = feeds.gto?.length || 0;
            alert(`Product feeds refreshed successfully!\nST: ${stCount} items\nCHT: ${chtCount} items\nGTO: ${gtoCount} items`);
        } catch (e) {
            console.error("Failed to refresh feeds:", e);
            alert("Failed to refresh product feeds.");
        } finally {
            setIsRefreshingFeeds(false);
        }
    };

    const handleBatchUpdateStPrices = async () => {
        setIsUpdatingStPrices(true);
        try {
            const db = await getDb();
            const allProducts = await db.select("SELECT * FROM products ORDER BY product_name");

            const eligibleProducts = allProducts.filter(p => {
                if (!p.st_id) return false;
                const hasPrice = p.showtile_price !== null && p.showtile_price !== undefined && p.showtile_price !== '';
                const hasMatchKeys = (p.finish && p.size) || p.showtile_product_code;
                return hasPrice && hasMatchKeys;
            });

            if (eligibleProducts.length === 0) {
                alert("No eligible products found (requires ST binding, showtile_price, and finish/size or showtile_product_code).");
                return;
            }

            const skippedCount = allProducts.length - eligibleProducts.length;
            const confirmed = await confirm(
                `Update Showtile Price and Unit Suffix online for ${eligibleProducts.length} product(s)?` +
                (skippedCount > 0 ? `\n(${skippedCount} product(s) skipped due to missing ST binding, price, or matching keys.)` : '')
            );
            if (!confirmed) return;

            const updates = eligibleProducts.map(buildStPriceUpdateItem);
            const summary = await updateStPricesOnline(updates);

            let message = `ST Price Update Complete.\nTotal Sent: ${summary.total}\nSucceeded: ${summary.successCount}\nFailed: ${summary.failCount}`;
            if (summary.errors.length > 0) {
                const sampleErrors = summary.errors.slice(0, 5).join('\n');
                message += `\n\nErrors (first ${Math.min(5, summary.errors.length)}):\n${sampleErrors}`;
            }
            alert(message);
        } catch (err) {
            console.error("Failed to batch update ST prices:", err);
            alert(err?.message || "Failed to update ST prices online.");
        } finally {
            setIsUpdatingStPrices(false);
        }
    };

    const handleBatchAutoFillFromInventory = async () => {
        setIsAutoFillingInventory(true);
        try {
            const db = await getDb();
            const [allProducts, allCollections, allInventory] = await Promise.all([
                db.select("SELECT * FROM products ORDER BY product_name"),
                db.select("SELECT collection_id, collection_name FROM collections"),
                db.select("SELECT * FROM inventory ORDER BY product_id DESC")
            ]);

            if (!allProducts || allProducts.length === 0) {
                alert("No products found.");
                return;
            }

            const confirmed = await confirm(
                `Run "Auto Fill from Inventory" for all ${allProducts.length} product(s)?\n` +
                `This will update Showtile Code, Showtile Name, Showtile Price, m2/box, pcs/box, and box/pallet wherever matching inventory records provide values.`
            );
            if (!confirmed) return;

            const colNameMap = new Map(
                (allCollections || []).map(c => [String(c.collection_id), c.collection_name || ''])
            );
            const lookup = buildInventoryLookup(allInventory || []);

            const strVal = (v) => (v === null || v === undefined ? '' : String(v).trim());
            const numOrStrEqual = (a, b) => {
                if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
                const na = Number(a);
                const nb = Number(b);
                if (!isNaN(na) && !isNaN(nb) && strVal(a) !== '' && strVal(b) !== '') return na === nb;
                return strVal(a) === strVal(b);
            };

            let matchedCount = 0;
            let updatedCount = 0;
            let unchangedCount = 0;
            let unmatchedCount = 0;

            for (const product of allProducts) {
                const collectionName = colNameMap.get(String(product.collection_id || '')) || '';
                const matched = findMatchedInventoryForProduct(
                    {
                        productId: product.product_id,
                        collectionName,
                        color: product.color,
                        finish: product.finish,
                        size: product.size
                    },
                    lookup
                );

                const extracted = extractAutoFillFromMatchedInventory(matched);
                if (!extracted) {
                    unmatchedCount++;
                    continue;
                }
                matchedCount++;

                const nextCode = extracted.showtile_product_code || product.showtile_product_code || '';
                const nextName = extracted.showtile_name || product.showtile_name || '';
                const nextPrice = extracted.showtile_price || product.showtile_price || null;
                const nextM2 = extracted.m2_per_box || product.m2_per_box || null;
                const nextPcs = extracted.pcs_per_box || product.pcs_per_box || null;
                const nextBoxPallet = extracted.box_per_pallet || product.box_per_pallet || null;

                const changed =
                    strVal(nextCode) !== strVal(product.showtile_product_code) ||
                    strVal(nextName) !== strVal(product.showtile_name) ||
                    !numOrStrEqual(nextPrice, product.showtile_price) ||
                    !numOrStrEqual(nextM2, product.m2_per_box) ||
                    !numOrStrEqual(nextPcs, product.pcs_per_box) ||
                    !numOrStrEqual(nextBoxPallet, product.box_per_pallet);

                if (!changed) {
                    unchangedCount++;
                    continue;
                }

                await db.execute(
                    `UPDATE products SET
                        showtile_product_code = $1,
                        showtile_name = $2,
                        showtile_price = $3,
                        m2_per_box = $4,
                        pcs_per_box = $5,
                        box_per_pallet = $6
                    WHERE product_id = $7`,
                    [
                        nextCode,
                        nextName,
                        nextPrice,
                        nextM2,
                        nextPcs,
                        nextBoxPallet,
                        product.product_id
                    ]
                );
                updatedCount++;
            }

            if (updatedCount > 0 && db.sync) {
                await db.sync();
            }
            await loadData(false);

            alert(
                `Auto Fill from Inventory complete!\n` +
                `Total Products: ${allProducts.length}\n` +
                `Matched: ${matchedCount} (Updated: ${updatedCount}, Already Up-to-date: ${unchangedCount})\n` +
                `No Matching Inventory: ${unmatchedCount}`
            );
        } catch (err) {
            console.error("Failed to batch auto-fill products from inventory:", err);
            alert("Failed to auto-fill products from inventory.");
        } finally {
            setIsAutoFillingInventory(false);
        }
    };

    const handleSaveCollection = async () => {
        try {
            const db = await getDb();
            if (collectionFormData.id) {
                await db.execute(
                    "UPDATE collections SET collection_name = $1, shipper_id = $2, collection_description = $3 WHERE collection_id = $4",
                    [collectionFormData.name, collectionFormData.shipper_id || null, collectionFormData.description || '', collectionFormData.id]
                );
            } else {
                await db.execute(
                    "INSERT INTO collections (collection_name, shipper_id, collection_description) VALUES ($1, $2, $3)",
                    [collectionFormData.name, collectionFormData.shipper_id || null, collectionFormData.description || '']
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
        if (!(await confirm(`Are you sure you want to auto match products for collection "${collection.collection_name}"?`))) return;
        setIsAutoMatchingCollection(collection.collection_id);
        try {
            const db = await getDb();
            const colName = (collection.collection_name || '').trim();

            const query = `
                SELECT * 
                FROM inventory 
                WHERE lower(trim(extracted_name)) = lower(trim($1)) 
                  AND (x_inactive IS NULL OR x_inactive != 1)
                ORDER BY product_id DESC
            `;
            const invRows = await db.select(query, [colName]);

            if (!invRows || invRows.length === 0) {
                alert("No matching inventory records found for this collection.");
                return;
            }

            const groupMap = new Map();
            for (const inv of invRows) {
                const rawColor = (inv.extracted_colour || '').trim();
                const rawFinish = (inv.extracted_finish || '').trim();
                const rawSize = (inv.extracted_size || '').trim();
                const normSize = normalizeSize(rawSize);

                const groupKey = `${rawColor.toLowerCase()}:::${rawFinish.toLowerCase()}:::${normSize.toLowerCase()}`;

                if (!groupMap.has(groupKey)) {
                    groupMap.set(groupKey, {
                        color: rawColor,
                        finish: rawFinish,
                        size: normSize,
                        items: [inv],
                        latestInv: inv
                    });
                } else {
                    const group = groupMap.get(groupKey);
                    group.items.push(inv);
                    if (!group.color && rawColor) group.color = rawColor;
                    if (!group.finish && rawFinish) group.finish = rawFinish;
                    if (!group.size && normSize) group.size = normSize;
                }
            }

            // Fresh fetch of existing products to prevent duplicates and check for valid parent IDs
            const currentProds = await db.select("SELECT product_id, collection_id, color, finish, size FROM products");
            const existingProductIds = new Set(currentProds.map(p => Number(p.product_id)));
            const createdProducts = [];

            let createdCount = 0;
            let linkedCount = 0;

            for (const group of groupMap.values()) {
                const color = group.color;
                const finish = group.finish;
                const size = group.size;

                const allCurrent = [...currentProds, ...createdProducts];
                const exists = allCurrent.find(p =>
                    p.collection_id === collection.collection_id &&
                    (p.color || '').trim().toLowerCase() === color.toLowerCase() &&
                    (p.finish || '').trim().toLowerCase() === finish.toLowerCase() &&
                    normalizeSize(p.size || '').toLowerCase() === size.toLowerCase()
                );

                let targetProductId;
                if (exists) {
                    targetProductId = exists.product_id;
                } else {
                    // Pick the best inventory record for product metadata:
                    // Prefer non-backorder records with showtile_name, fallback to any with showtile_name, or backorder records
                    const nonBoWithShow = group.items.find(i => (i.backorder !== 1 && i.backorder !== '1') && i.showtile_name);
                    const anyWithShow = group.items.find(i => i.showtile_name);
                    const nonBoAny = group.items.find(i => i.backorder !== 1 && i.backorder !== '1');
                    const inv = nonBoWithShow || anyWithShow || nonBoAny || group.latestInv || group.items[0];

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

                    // Fallback to other items in the group if certain attributes are empty on `inv`
                    if (!showPrice) {
                        const withPrice = group.items.find(i => i.rrp);
                        if (withPrice) showPrice = withPrice.rrp;
                    }
                    if (!m2) {
                        const withM2 = group.items.find(i => i.m2_per_box);
                        if (withM2) m2 = withM2.m2_per_box;
                    }
                    if (!pcs) {
                        const withPcs = group.items.find(i => i.pcs_per_box);
                        if (withPcs) pcs = withPcs.pcs_per_box;
                    }
                    if (!boxP) {
                        const withBoxP = group.items.find(i => i.box_per_pallet);
                        if (withBoxP) boxP = withBoxP.box_per_pallet;
                    }

                    const pName = `${colName} ${color} ${finish} ${size}`.replace(/\s+/g, ' ').trim();
                    const defaultStock = JSON.stringify({ force_in_stock: false, backorder: false });

                    // IMPORTANT: Must use db.execute so the INSERT is queued into offline_queue and synced to Turso!
                    await db.execute(`
                        INSERT INTO products (
                            product_name, collection_id, color, finish, size, 
                            showtile_name, showtile_product_code, showtile_price,
                            m2_per_box, pcs_per_box, box_per_pallet, cht_and_gto_stock_status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    `, [pName, collection.collection_id, color, finish, size, showName, showCode, showPrice, m2, pcs, boxP, defaultStock]);

                    const insertedProds = await db.select(
                        `SELECT product_id FROM products WHERE collection_id = $1 AND lower(trim(color)) = lower(trim($2)) AND lower(trim(finish)) = lower(trim($3)) AND lower(trim(size)) = lower(trim($4)) ORDER BY product_id DESC LIMIT 1`,
                        [collection.collection_id, color, finish, size]
                    );

                    targetProductId = insertedProds && insertedProds.length > 0 ? insertedProds[0].product_id : null;
                    if (!targetProductId) {
                        const rowIdRes = await db.select("SELECT last_insert_rowid() as id");
                        targetProductId = rowIdRes?.[0]?.id;
                    }

                    if (targetProductId) {
                        createdProducts.push({
                            product_id: targetProductId,
                            collection_id: collection.collection_id,
                            color,
                            finish,
                            size
                        });
                        existingProductIds.add(Number(targetProductId));
                    }
                    createdCount++;
                }

                if (targetProductId) {
                    // Link unlinked or orphaned inventory records in this group
                    const unlinkedIds = group.items
                        .filter(r => !r.product_parent_id || r.product_parent_id === 0 || r.product_parent_id === '0' || !existingProductIds.has(Number(r.product_parent_id)))
                        .map(r => r.product_id);

                    if (unlinkedIds.length > 0) {
                        const idsPlaceholder = unlinkedIds.map((_, i) => `$${i + 2}`).join(',');
                        await db.execute(
                            `UPDATE inventory SET product_parent_id = $1 WHERE product_id IN (${idsPlaceholder})`,
                            [targetProductId, ...unlinkedIds]
                        );
                        linkedCount += unlinkedIds.length;
                    }
                }

                // Normalize extracted_size in inventory for records with non-normalized format
                const sizeMismatchIds = group.items
                    .filter(r => r.extracted_size && r.extracted_size !== size)
                    .map(r => r.product_id);

                if (sizeMismatchIds.length > 0) {
                    const idsPlaceholder = sizeMismatchIds.map((_, i) => `$${i + 2}`).join(',');
                    await db.execute(
                        `UPDATE inventory SET extracted_size = $1 WHERE product_id IN (${idsPlaceholder})`,
                        [size, ...sizeMismatchIds]
                    );
                }
            }

            if (createdCount > 0) {
                alert(`Auto match complete. Created ${createdCount} new product(s).`);
                await loadData();
            } else if (linkedCount > 0) {
                alert(`Auto match complete. Linked ${linkedCount} inventory record(s) to existing products.`);
                await loadData();
            } else {
                alert("Auto match complete. No new products needed to be created.");
            }
        } catch (e) {
            console.error(e);
            alert("Error during auto match.");
        } finally {
            setIsAutoMatchingCollection(null);
        }
    };

    const handleProductSort = (columnKey) => {
        setProductSortConfig(prev => {
            if (prev.key === columnKey) {
                return { key: columnKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key: columnKey, direction: 'asc' };
        });
    };

    const renderProductSortHeader = (label, columnKey, width = 'auto') => {
        const isSorted = productSortConfig.key === columnKey;
        return (
            <th
                style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleProductSort(columnKey)}
                title={`Sort by ${label}`}
            >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span>{label}</span>
                    {isSorted ? (
                        productSortConfig.direction === 'asc' ? <ArrowUp size={14} color="#2563eb" /> : <ArrowDown size={14} color="#2563eb" />
                    ) : (
                        <ArrowUpDown size={14} color="#94a3b8" />
                    )}
                </div>
            </th>
        );
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
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div className="search-bar" style={{ display: 'flex', alignItems: 'center', background: 'white', padding: '8px 16px', borderRadius: '24px', border: '1px solid #e2e8f0', width: '380px' }}>
                        <Search size={18} style={{ color: '#94a3b8', marginRight: '8px', flexShrink: 0 }} />
                        <input
                            type="text"
                            placeholder="Search collection, description, product, ST code, ST name, colour, finish, size..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: '0.9rem' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }}
                            onClick={handleBatchAutoFillFromInventory}
                            disabled={isAutoFillingInventory}
                            title="Auto fill Showtile details and packaging dimensions for all products from inventory"
                        >
                            {isAutoFillingInventory ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {isAutoFillingInventory ? 'Auto Filling...' : 'Auto Fill Inventory'}
                        </button>
                        <button
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }}
                            onClick={handleBatchUpdateStPrices}
                            disabled={isUpdatingStPrices}
                            title="Batch update Showtile Price and Unit Suffix to ST website"
                        >
                            {isUpdatingStPrices ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                            {isUpdatingStPrices ? 'Updating ST Price...' : 'Update ST Price'}
                        </button>
                        <button
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }}
                            onClick={handleRefreshFeeds}
                            disabled={isRefreshingFeeds}
                            title="Refresh product feeds from ST, CHT, and GTO"
                        >
                            {isRefreshingFeeds ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            Refresh Feeds
                        </button>
                        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={() => {
                            setCollectionFormData({ id: null, name: '', shipper_id: '', description: '' });
                            setShowCollectionModal(true);
                        }}>
                            <Plus size={16} /> Add Collection
                        </button>
                        <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px' }} onClick={handleAutoMatchGlobalCollections}>
                            {isAutoMatchingGlobal ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Auto Match Collection
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
                                const term = search.trim().toLowerCase();
                                const isCollectionMatch = term ? (
                                    String(collection.collection_name || '').toLowerCase().includes(term) ||
                                    String(collection.collection_description || '').toLowerCase().includes(term)
                                ) : false;

                                const collectionProducts = products.filter(p => p.collection_id === collection.collection_id).filter(p => {
                                    if (!term) return true;
                                    if (isCollectionMatch) return true;
                                    return String(p.product_name || '').toLowerCase().includes(term) ||
                                        String(p.showtile_product_code || '').toLowerCase().includes(term) ||
                                        String(p.showtile_name || '').toLowerCase().includes(term) ||
                                        String(p.color || '').toLowerCase().includes(term) ||
                                        String(p.finish || '').toLowerCase().includes(term) ||
                                        String(p.size || '').toLowerCase().includes(term);
                                });

                                if (term && collectionProducts.length === 0 && !isCollectionMatch) return null;

                                const sortedCollectionProducts = [...collectionProducts].sort((a, b) => {
                                    if (!productSortConfig.key) return 0;
                                    const valA = String(a[productSortConfig.key] || '').toLowerCase().trim();
                                    const valB = String(b[productSortConfig.key] || '').toLowerCase().trim();
                                    const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                                    return productSortConfig.direction === 'asc' ? cmp : -cmp;
                                });

                                const isExpanded = term ? true : expandedCollections[collection.collection_id];

                                return (
                                    <div key={collection.collection_id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', cursor: 'pointer', background: isExpanded ? '#f8fafc' : 'white', transition: 'background 0.2s' }}
                                            onClick={() => toggleCollection(collection.collection_id)}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                {isExpanded ? <ChevronDown size={18} style={{ marginRight: '4px', color: '#64748b', flexShrink: 0 }} /> : <ChevronRight size={18} style={{ marginRight: '4px', color: '#64748b', flexShrink: 0 }} />}
                                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>{collection.collection_name}</h3>
                                                {collection.collection_description && (
                                                    <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'normal' }} title={collection.collection_description}>
                                                        {collection.collection_description}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <button className="btn-icon" title="Auto Match" onClick={(e) => handleAutoMatchCollection(e, collection)}>
                                                    {isAutoMatchingCollection === collection.collection_id ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                                                </button>
                                                <button className="btn-icon" title="Edit Collection" onClick={(e) => {
                                                    e.stopPropagation();
                                                    setCollectionFormData({
                                                        id: collection.collection_id,
                                                        name: collection.collection_name,
                                                        shipper_id: collection.shipper_id || '',
                                                        description: collection.collection_description || ''
                                                    });
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
                                                                {renderProductSortHeader('ST Code', 'showtile_product_code', '120px')}
                                                                {renderProductSortHeader('Product Name', 'product_name')}
                                                                {renderProductSortHeader('ST Name', 'showtile_name', '20%')}
                                                                {renderProductSortHeader('Colour', 'color', '120px')}
                                                                {renderProductSortHeader('Finish', 'finish', '120px')}
                                                                {renderProductSortHeader('Size', 'size', '120px')}
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '60px', textAlign: 'center' }}>ST</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '60px', textAlign: 'center' }}>CHT</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '60px', textAlign: 'center' }}>GTO</th>
                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '240px' }}>Online Stock Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {sortedCollectionProducts.map(product => {
                                                                let stockStatus = { force_in_stock: false, backorder: false };
                                                                try {
                                                                    if (product.cht_and_gto_stock_status) {
                                                                        stockStatus = JSON.parse(product.cht_and_gto_stock_status);
                                                                    }
                                                                } catch (e) { }

                                                                const isStBound = Boolean(product.st_id && String(product.st_id).trim() !== '');
                                                                const isChtBound = Boolean(
                                                                    (product.cht_shopify_id && String(product.cht_shopify_id).trim() !== '') ||
                                                                    (product.cht_id && String(product.cht_id).trim() !== '')
                                                                );
                                                                const isGtoBound = Boolean(
                                                                    (product.gto_id && String(product.gto_id).trim() !== '') ||
                                                                    (product.gto_name && String(product.gto_name).trim() !== '')
                                                                );

                                                                return (
                                                                    <tr key={product.product_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                                        <td style={{ padding: '12px 8px', display: 'flex' }}>
                                                                            <button className="btn-icon" title="Edit Product" onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setEditingProduct(product); setShowProductModal(true);
                                                                            }}>
                                                                                <Edit2 size={16} />
                                                                            </button>
                                                                            <button className="btn-icon" title="Delete Product" style={{ color: '#ef4444' }} onClick={(e) => handleDeleteProduct(e, product)}>
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.showtile_product_code}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#1e293b' }}>{product.product_name}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.showtile_name || '-'}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.color}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.finish}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{product.size}</td>
                                                                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isStBound}
                                                                                readOnly
                                                                                style={{ pointerEvents: 'none', accentColor: '#2563eb' }}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isChtBound}
                                                                                readOnly
                                                                                style={{ pointerEvents: 'none', accentColor: '#2563eb' }}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isGtoBound}
                                                                                readOnly
                                                                                style={{ pointerEvents: 'none', accentColor: '#2563eb' }}
                                                                            />
                                                                        </td>
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
                    <div style={{ ...contentStyle, width: '450px', maxHeight: '600px' }}>
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
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Collection Description</label>
                                <textarea
                                    className="form-control"
                                    rows={3}
                                    value={collectionFormData.description || ''}
                                    onChange={e => setCollectionFormData({ ...collectionFormData, description: e.target.value })}
                                    placeholder="Optional collection description..."
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', resize: 'vertical' }}
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
