import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { getLocalTodayStrSync } from '../utils/timezone';
import { Plus, Edit, Trash2, Search, RefreshCw, Printer, Download, ChevronUp, ChevronDown, X, Package, CheckCircle2, Clock, Truck, Layers, Sparkles } from 'lucide-react';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Containers.css';

export default function OrderBatches({ currentUser, isActive }) {
    const [batches, setBatches] = useState([]);
    const [filteredBatches, setFilteredBatches] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [allOrders, setAllOrders] = useState([]);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'order_batch_id', direction: 'desc' });

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingBatch, setEditingBatch] = useState(null);

    // Form states
    const [addForm, setAddForm] = useState({
        sku: '',
        product_id: '',
        order_id: '',
        description: '',
        amount: '',
        status: 'pending'
    });

    const [editForm, setEditForm] = useState({
        order_batch_id: null,
        sku: '',
        product_id: '',
        order_id: '',
        description: '',
        amount: '',
        status: 'pending'
    });

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isMatching, setIsMatching] = useState(false);
    const [lastUpdated, setLastUpdated] = useState('');

    const canWrite = currentUser?.permissions?.orderBatches?.write ?? currentUser?.permissions?.purchaseOrders?.write ?? currentUser?.permissions?.admin ?? true;

    useEffect(() => {
        if (isActive !== false) {
            loadData();
        }
    }, [isActive]);

    // Background sync listener
    useEffect(() => {
        const handleSync = () => {
            if (isActive !== false) {
                loadData(true);
            }
        };
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [batches, searchQuery, filterStatus]);

    const loadData = async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        try {
            const db = await getDb();

            const [bRes, pRes, oRes] = await Promise.all([
                db.select(`
                    SELECT 
                        ob.order_batch_id,
                        ob.product_id,
                        ob.sku,
                        ob.description,
                        ob.amount,
                        ob.status,
                        ob.created_date,
                        ob.order_id,
                        p.product_name,
                        po.invoice_no
                    FROM order_batch ob
                    LEFT JOIN products p ON ob.product_id = p.product_id
                    LEFT JOIN purchase_orders po ON ob.order_id = po.order_id
                    ORDER BY ob.order_batch_id DESC
                `),
                db.select('SELECT product_id, product_name FROM products ORDER BY product_name ASC'),
                db.select('SELECT order_id, invoice_no FROM purchase_orders ORDER BY order_id DESC')
            ]);

            setBatches(bRes || []);
            setAllProducts(pRes || []);
            setAllOrders(oRes || []);
            setLastUpdated(new Date().toLocaleTimeString());
        } catch (e) {
            console.error("Failed to load order batches", e);
        } finally {
            setIsRefreshing(false);
        }
    };

    const applyFilters = () => {
        let result = [...batches];

        // 1. Search Query: SKU, Product, Order, Description
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            result = result.filter(item => {
                const skuMatch = item.sku && item.sku.toLowerCase().includes(q);
                const prodMatch = item.product_name && item.product_name.toLowerCase().includes(q);
                const orderMatch = (item.invoice_no && item.invoice_no.toLowerCase().includes(q)) ||
                                   (item.order_id && String(item.order_id).includes(q));
                const descMatch = item.description && item.description.toLowerCase().includes(q);
                return skuMatch || prodMatch || orderMatch || descMatch;
            });
        }

        // 2. Status Filter
        if (filterStatus) {
            result = result.filter(item => {
                const s = (item.status || 'pending').toLowerCase();
                return s === filterStatus.toLowerCase();
            });
        }

        setFilteredBatches(result);
    };

    const handleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    const sortedBatches = [...filteredBatches].sort((a, b) => {
        if (!sortConfig.key) return 0;
        const key = sortConfig.key;
        let valA = a[key];
        let valB = b[key];

        if (key === 'amount') {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
            return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        }

        const strA = (valA || '').toString().toLowerCase();
        const strB = (valB || '').toString().toLowerCase();
        if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) {
            return <ChevronDown size={14} style={{ opacity: 0.3 }} />;
        }
        return sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#2563eb" /> : <ChevronDown size={14} color="#2563eb" />;
    };

    const formatNumber = (num) => {
        if (num === null || num === undefined || isNaN(num)) return '-';
        return Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const getStatusBadge = (status) => {
        const s = (status || 'pending').toLowerCase();
        if (s === 'delivered') {
            return (
                <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#15803d',
                    backgroundColor: '#dcfce7',
                    border: '1px solid #bbf7d0',
                    padding: '2px 8px',
                    borderRadius: '10px'
                }}>
                    <CheckCircle2 size={12} /> Delivered
                </span>
            );
        }
        if (s === 'in_transit') {
            return (
                <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#b45309',
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fde68a',
                    padding: '2px 8px',
                    borderRadius: '10px'
                }}>
                    <Truck size={12} /> In Transit
                </span>
            );
        }
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#1d4ed8',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                padding: '2px 8px',
                borderRadius: '10px'
            }}>
                <Clock size={12} /> Pending
            </span>
        );
    };

    // Match with Inventory
    const handleMatchWithInventory = async () => {
        setIsMatching(true);
        try {
            const db = await getDb();

            // 1. Fetch inventory rows
            const invRows = await db.select(`
                SELECT sku, sales_description, product_parent_id, backorder, backorder_amount
                FROM inventory
                WHERE sku IS NOT NULL AND TRIM(sku) != ''
            `);

            // 2. Fetch current order_batch rows
            const obRows = await db.select(`
                SELECT order_batch_id, sku, status
                FROM order_batch
            `);

            // Build SKU lookup maps (trimmed, case-insensitive)
            const obSkuMap = new Map();
            obRows.forEach(b => {
                if (b.sku) obSkuMap.set(String(b.sku).trim().toLowerCase(), b);
            });

            const invSkuMap = new Map();
            invRows.forEach(i => {
                if (i.sku) invSkuMap.set(String(i.sku).trim().toLowerCase(), i);
            });

            // 3. Find inventory backorders not in order_batch -> Insert as pending
            const todayStr = getLocalTodayStrSync();
            let addedCount = 0;
            for (const inv of invRows) {
                const isBackorder = Number(inv.backorder) === 1 || String(inv.backorder) === '1';
                if (!isBackorder) continue;
                const normSku = String(inv.sku).trim().toLowerCase();
                if (!obSkuMap.has(normSku)) {
                    await db.execute(`
                        INSERT INTO order_batch (product_id, sku, description, amount, created_date, status)
                        VALUES ($1, $2, $3, $4, $5, 'pending')
                    `, [
                        inv.product_parent_id || null,
                        String(inv.sku).trim(),
                        inv.sales_description || '',
                        parseFloat(inv.backorder_amount) || 0,
                        todayStr
                    ]);
                    addedCount++;
                    obSkuMap.set(normSku, { sku: inv.sku });
                }
            }

            // 4. Find order_batch rows that are NOT in inventory OR inventory backorder != 1 -> Mark as delivered
            let deliveredCount = 0;
            for (const ob of obRows) {
                const normSku = String(ob.sku || '').trim().toLowerCase();
                const inv = invSkuMap.get(normSku);
                const isBackorder = inv && (Number(inv.backorder) === 1 || String(inv.backorder) === '1');

                if (!isBackorder) {
                    if (ob.status !== 'delivered') {
                        await db.execute(
                            'UPDATE order_batch SET status = $1 WHERE order_batch_id = $2',
                            ['delivered', ob.order_batch_id]
                        );
                        deliveredCount++;
                    }
                }
            }

            await loadData();
            alert(`Match with Inventory Complete!\n\n• New pending order batches added: ${addedCount}\n• Existing batches marked delivered: ${deliveredCount}`);
        } catch (e) {
            console.error("Failed to match with inventory", e);
            alert("Failed to match with inventory: " + (e?.message || e));
        } finally {
            setIsMatching(false);
        }
    };

    // Add Modal Handlers
    const handleOpenAddModal = () => {
        setAddForm({
            sku: '',
            product_id: '',
            order_id: '',
            description: '',
            amount: '',
            status: 'pending'
        });
        setShowAddModal(true);
    };

    const handleSaveAddBatch = async () => {
        if (!addForm.sku.trim()) {
            alert("SKU is required.");
            return;
        }

        try {
            const db = await getDb();
            const existing = await db.select('SELECT order_batch_id FROM order_batch WHERE sku = $1', [addForm.sku.trim()]);
            if (existing && existing.length > 0) {
                alert(`An order batch with SKU "${addForm.sku.trim()}" already exists.`);
                return;
            }

            const todayStr = getLocalTodayStrSync();
            await db.execute(`
                INSERT INTO order_batch (sku, product_id, order_id, description, amount, status, created_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                addForm.sku.trim(),
                addForm.product_id ? Number(addForm.product_id) : null,
                addForm.order_id ? Number(addForm.order_id) : null,
                addForm.description.trim() || null,
                addForm.amount !== '' ? parseFloat(addForm.amount) : 0,
                addForm.status || 'pending',
                todayStr
            ]);

            setShowAddModal(false);
            await loadData();
        } catch (e) {
            console.error("Failed to add order batch", e);
            alert("Failed to create order batch: " + (e?.message || e));
        }
    };

    // Edit Modal Handlers
    const handleOpenEditModal = (batch) => {
        setEditingBatch(batch);
        setEditForm({
            order_batch_id: batch.order_batch_id,
            sku: batch.sku || '',
            product_id: batch.product_id ? String(batch.product_id) : '',
            order_id: batch.order_id ? String(batch.order_id) : '',
            description: batch.description || '',
            amount: batch.amount != null ? String(batch.amount) : '',
            status: batch.status || 'pending'
        });
        setShowEditModal(true);
    };

    const handleSaveEditBatch = async () => {
        if (!editForm.sku.trim()) {
            alert("SKU is required.");
            return;
        }

        try {
            const db = await getDb();

            // Check SKU uniqueness against other batches
            const existing = await db.select(
                'SELECT order_batch_id FROM order_batch WHERE sku = $1 AND order_batch_id != $2',
                [editForm.sku.trim(), editForm.order_batch_id]
            );
            if (existing && existing.length > 0) {
                alert(`Another order batch already has SKU "${editForm.sku.trim()}".`);
                return;
            }

            await db.execute(`
                UPDATE order_batch
                SET sku = $1, product_id = $2, order_id = $3, description = $4, amount = $5, status = $6
                WHERE order_batch_id = $7
            `, [
                editForm.sku.trim(),
                editForm.product_id ? Number(editForm.product_id) : null,
                editForm.order_id ? Number(editForm.order_id) : null,
                editForm.description.trim() || null,
                editForm.amount !== '' ? parseFloat(editForm.amount) : 0,
                editForm.status || 'pending',
                editForm.order_batch_id
            ]);

            setShowEditModal(false);
            await loadData();
        } catch (e) {
            console.error("Failed to update order batch", e);
            alert("Failed to update order batch: " + (e?.message || e));
        }
    };

    // Delete Handler
    const handleDeleteBatch = async (batchId, sku) => {
        const ok = await confirm(`Are you sure you want to delete order batch "${sku || '#' + batchId}"?`, {
            title: 'Delete Order Batch',
            kind: 'warning'
        });
        if (!ok) return;

        try {
            const db = await getDb();
            // Clean up associations if any
            await db.execute('DELETE FROM container_order_batch WHERE order_batch_id = $1', [batchId]);
            await db.execute('DELETE FROM order_batch WHERE order_batch_id = $1', [batchId]);
            await loadData();
        } catch (e) {
            console.error("Failed to delete order batch", e);
            alert("Failed to delete order batch: " + (e?.message || e));
        }
    };

    // Print & Export HTML
    const exportHTML = async (print = false) => {
        let htmlRows = '';
        sortedBatches.forEach(b => {
            htmlRows += `
                <tr>
                    <td style="font-weight: 600;">${b.sku || '-'}</td>
                    <td>${b.product_name || '-'}</td>
                    <td>${b.invoice_no || (b.order_id ? '#' + b.order_id : '-')}</td>
                    <td>${b.description || '-'}</td>
                    <td style="text-align: right; font-weight: 600;">${formatNumber(b.amount)} m²</td>
                    <td style="text-align: center;">${(b.status || 'pending').toUpperCase()}</td>
                </tr>
            `;
        });

        const html = `<!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <title>Order Batches</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #1e293b; background: white; }
            h2 { margin-top: 0; color: #0f172a; margin-bottom: 6px; }
            .meta { font-size: 12px; color: #64748b; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: top; }
            th { background: #f8fafc; font-weight: 600; color: #475569; }
            @media print {
                body { padding: 0; margin: 0; }
                @page { margin: 10mm; }
            }
        </style>
        </head>
        <body>
            <h2>Order Batches Report</h2>
            <div class="meta">Total Records: ${sortedBatches.length} | Generated: ${new Date().toLocaleString()}</div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 140px;">SKU</th>
                        <th style="width: 180px;">Product</th>
                        <th style="width: 130px;">Order</th>
                        <th>Description</th>
                        <th style="width: 110px; text-align: right;">Amount</th>
                        <th style="width: 100px; text-align: center;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${htmlRows}
                </tbody>
            </table>
        </body>
        </html>`;

        if (print) {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            iframe.contentWindow.document.open();
            iframe.contentWindow.document.write(html);
            iframe.contentWindow.document.close();
            iframe.contentWindow.focus();
            setTimeout(() => {
                iframe.contentWindow.print();
                document.body.removeChild(iframe);
            }, 500);
        } else {
            try {
                const filePath = await save({
                    defaultPath: `order_batches_${getLocalTodayStrSync()}.html`,
                    filters: [{ name: 'HTML', extensions: ['html'] }]
                });
                if (filePath) {
                    await writeTextFile(filePath, html);
                }
            } catch (e) {
                console.error('Failed to export HTML', e);
            }
        }
    };

    return (
        <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#f8fafc', flexDirection: 'column' }}>
            {/* Top Toolbar */}
            <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Order Batches</h2>
                        <span style={{ fontSize: '0.85rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                            {sortedBatches.length} {sortedBatches.length === 1 ? 'batch' : 'batches'}
                        </span>
                        {lastUpdated && (
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Updated: {lastUpdated}
                            </span>
                        )}
                    </div>
                    <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {canWrite && (
                            <button
                                className="btn-upload white-bg"
                                onClick={handleMatchWithInventory}
                                disabled={isMatching || isRefreshing}
                                title="Sync backorders with inventory table"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    backgroundColor: '#eff6ff',
                                    borderColor: '#bfdbfe',
                                    color: '#1d4ed8',
                                    fontWeight: 600
                                }}
                            >
                                <Sparkles size={14} className={isMatching ? "spin" : ""} color="#2563eb" />
                                <span>{isMatching ? 'Matching...' : 'Match with Inventory'}</span>
                            </button>
                        )}
                        {canWrite && (
                            <button
                                className="btn-upload"
                                onClick={handleOpenAddModal}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563eb', color: 'white', borderColor: '#2563eb' }}
                            >
                                <Plus size={14} />
                                <span>Add Batch</span>
                            </button>
                        )}
                        <button
                            className="btn-upload white-bg"
                            onClick={() => loadData(false)}
                            disabled={isRefreshing}
                            title="Refresh from local database"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <RefreshCw size={14} className={isRefreshing ? "spin" : ""} />
                            <span>Refresh</span>
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                            <Printer size={16} style={{ marginRight: '2px' }} /> Print
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                            <Download size={16} style={{ marginRight: '2px' }} /> Export HTML
                        </button>
                    </div>
                </div>

                {/* Search & Filter Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
                        {/* Search bar: SKU, Product, Order, Description */}
                        <div style={{ flex: 1, minWidth: '260px', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Search SKU, Product, Order, Description..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '6px 12px 6px 32px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                            />
                        </div>

                        {/* Status Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Status:</span>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', outline: 'none', backgroundColor: 'white' }}
                            >
                                <option value="">All Statuses</option>
                                <option value="pending">Pending</option>
                                <option value="in_transit">In Transit</option>
                                <option value="delivered">Delivered</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="table-container container-list" style={{ padding: 0, flex: 1, maxWidth: '100%' }}>
                {sortedBatches.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                        No order batches found.
                    </div>
                ) : (
                    <div className="excel-table-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                        <table className="excel-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Actions</th>
                                    <th className="has-sort-icon" style={{ width: '160px', minWidth: '140px', cursor: 'pointer' }} onClick={() => handleSort('sku')}>
                                        <SortIcon columnKey="sku" /> SKU
                                    </th>
                                    <th className="has-sort-icon" style={{ width: '220px', minWidth: '180px', cursor: 'pointer' }} onClick={() => handleSort('product_name')}>
                                        <SortIcon columnKey="product_name" /> Product
                                    </th>
                                    <th className="has-sort-icon" style={{ width: '150px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('invoice_no')}>
                                        <SortIcon columnKey="invoice_no" /> Order
                                    </th>
                                    <th className="has-sort-icon" style={{ minWidth: '220px', cursor: 'pointer' }} onClick={() => handleSort('description')}>
                                        <SortIcon columnKey="description" /> Description
                                    </th>
                                    <th className="has-sort-icon" style={{ width: '120px', minWidth: '110px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('amount')}>
                                        <SortIcon columnKey="amount" /> Amount
                                    </th>
                                    <th className="has-sort-icon" style={{ width: '120px', minWidth: '120px', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('status')}>
                                        <SortIcon columnKey="status" /> Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedBatches.map(row => (
                                    <tr key={row.order_batch_id} style={{ opacity: row.status === 'delivered' ? 0.75 : 1 }}>
                                        {/* Actions */}
                                        <td style={{ textAlign: 'center' }}>
                                            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                                                {canWrite && (
                                                    <>
                                                        <button
                                                            className="action-btn"
                                                            title="Edit Order Batch"
                                                            onClick={() => handleOpenEditModal(row)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#2563eb' }}
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            className="action-btn"
                                                            title="Delete Order Batch"
                                                            onClick={() => handleDeleteBatch(row.order_batch_id, row.sku)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>

                                        {/* SKU */}
                                        <td>
                                            <div className="readonly-cell" style={{ fontWeight: 600, color: '#0f172a' }}>
                                                {row.sku || '-'}
                                            </div>
                                        </td>

                                        {/* Product */}
                                        <td>
                                            <div className="readonly-cell" style={{ fontWeight: 500, color: row.product_name ? '#1e293b' : '#94a3b8' }}>
                                                {row.product_name || '-'}
                                            </div>
                                        </td>

                                        {/* Order */}
                                        <td>
                                            <div className="readonly-cell" style={{ color: row.invoice_no ? '#0f172a' : '#94a3b8' }}>
                                                {row.invoice_no ? row.invoice_no : (row.order_id ? `#${row.order_id}` : '-')}
                                            </div>
                                        </td>

                                        {/* Description */}
                                        <td>
                                            <div className="readonly-cell" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#475569' }}>
                                                {row.description || '-'}
                                            </div>
                                        </td>

                                        {/* Amount */}
                                        <td style={{ textAlign: 'right' }}>
                                            <div className="readonly-cell" style={{ fontWeight: 600, color: '#0f172a' }}>
                                                {formatNumber(row.amount)} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}>m²</span>
                                            </div>
                                        </td>

                                        {/* Status */}
                                        <td style={{ textAlign: 'center' }}>
                                            <div className="readonly-cell" style={{ display: 'flex', justifyContent: 'center' }}>
                                                {getStatusBadge(row.status)}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* --- ADD BATCH MODAL --- */}
            {showAddModal && (
                <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}>
                        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Add Order Batch</h3>
                            <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* SKU */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    SKU <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. BATCH-SKU-001"
                                    value={addForm.sku}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, sku: e.target.value }))}
                                />
                            </div>

                            {/* Product */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Associated Product
                                </label>
                                <select
                                    className="form-control"
                                    value={addForm.product_id}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, product_id: e.target.value }))}
                                >
                                    <option value="">-- No Product Linked --</option>
                                    {allProducts.map(p => (
                                        <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Purchase Order */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Associated Purchase Order
                                </label>
                                <select
                                    className="form-control"
                                    value={addForm.order_id}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, order_id: e.target.value }))}
                                >
                                    <option value="">-- No Order Linked --</option>
                                    {allOrders.map(o => (
                                        <option key={o.order_id} value={o.order_id}>
                                            {o.invoice_no ? `${o.invoice_no} (PO #${o.order_id})` : `PO #${o.order_id}`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Amount */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Amount (SQM)
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="form-control"
                                    placeholder="0.00"
                                    value={addForm.amount}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, amount: e.target.value }))}
                                />
                            </div>

                            {/* Status */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Status
                                </label>
                                <select
                                    className="form-control"
                                    value={addForm.status}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, status: e.target.value }))}
                                >
                                    <option value="pending">Pending</option>
                                    <option value="in_transit">In Transit</option>
                                    <option value="delivered">Delivered</option>
                                </select>
                            </div>

                            {/* Description */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Description
                                </label>
                                <textarea
                                    className="form-control"
                                    rows="3"
                                    placeholder="Order batch description..."
                                    value={addForm.description}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="btn-upload white-bg" onClick={() => setShowAddModal(false)}>
                                Cancel
                            </button>
                            <button className="btn-upload" onClick={handleSaveAddBatch} style={{ backgroundColor: '#2563eb', color: 'white', borderColor: '#2563eb' }}>
                                Create Batch
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- EDIT BATCH MODAL --- */}
            {showEditModal && (
                <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}>
                        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Edit Order Batch</h3>
                            <button onClick={() => setShowEditModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* SKU */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    SKU <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={editForm.sku}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, sku: e.target.value }))}
                                />
                            </div>

                            {/* Product */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Associated Product
                                </label>
                                <select
                                    className="form-control"
                                    value={editForm.product_id}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, product_id: e.target.value }))}
                                >
                                    <option value="">-- No Product Linked --</option>
                                    {allProducts.map(p => (
                                        <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Purchase Order */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Associated Purchase Order
                                </label>
                                <select
                                    className="form-control"
                                    value={editForm.order_id}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, order_id: e.target.value }))}
                                >
                                    <option value="">-- No Order Linked --</option>
                                    {allOrders.map(o => (
                                        <option key={o.order_id} value={o.order_id}>
                                            {o.invoice_no ? `${o.invoice_no} (PO #${o.order_id})` : `PO #${o.order_id}`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Amount */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Amount (SQM)
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="form-control"
                                    value={editForm.amount}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, amount: e.target.value }))}
                                />
                            </div>

                            {/* Status */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Status
                                </label>
                                <select
                                    className="form-control"
                                    value={editForm.status}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                                >
                                    <option value="pending">Pending</option>
                                    <option value="in_transit">In Transit</option>
                                    <option value="delivered">Delivered</option>
                                </select>
                            </div>

                            {/* Description */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Description
                                </label>
                                <textarea
                                    className="form-control"
                                    rows="3"
                                    value={editForm.description}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="btn-upload white-bg" onClick={() => setShowEditModal(false)}>
                                Cancel
                            </button>
                            <button className="btn-upload" onClick={handleSaveEditBatch} style={{ backgroundColor: '#2563eb', color: 'white', borderColor: '#2563eb' }}>
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

