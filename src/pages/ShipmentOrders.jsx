import { useState, useEffect } from 'react';
import { getDb, getSetting } from '../db/Database';
import { Plus, Edit, Trash2, Search, Check, ChevronUp, ChevronDown, ListFilter, XCircle, Printer, Download } from 'lucide-react';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Containers.css';

export default function ShipmentOrders({ currentUser, initialEditId, onClearEdit, isActive }) {
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [shippers, setShippers] = useState([]);
    const [inventory, setInventory] = useState([]);

    // Filters
    const [filterShipper, setFilterShipper] = useState('');
    const [filterEstDateFrom, setFilterEstDateFrom] = useState('');
    const [filterEstDateTo, setFilterEstDateTo] = useState('');
    const [searchProducts, setSearchProducts] = useState('');

    // Form State
    const [formMode, setFormMode] = useState('add');
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        invoice_no: '',
        shipper: '',
        products: [], // Array of product_ids
        est_date: '',
        note: '',
        status: 'open',
        depositPaid: false,
        balancePaid: false,
        payment_date: ''
    });

    const [productSearch, setProductSearch] = useState('');

    const defaultCols = ['status', 'shipper', 'invoice_no', 'payment', 'products', 'est_date', 'note'];
    const [visibleColumns, setVisibleColumns] = useState(defaultCols);
    const [showColumnModal, setShowColumnModal] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: '', direction: '' });
    const [filterStatus, setFilterStatus] = useState('');

    const canWrite = currentUser?.permissions?.shipmentOrders?.write !== false;

    useEffect(() => {
        if (isActive !== false) {
            loadInitialData();
        }
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [orders, filterShipper, filterEstDateFrom, filterEstDateTo, searchProducts, filterStatus]);

    useEffect(() => {
        if (initialEditId && orders.length > 0) {
            const target = orders.find(o => o.shipment_id == initialEditId);
            if (target) {
                handleEditClick(target);
                if (onClearEdit) onClearEdit();
            }
        }
    }, [initialEditId, orders]);

    const loadInitialData = async () => {
        try {
            const db = await getDb();
            const sRes = await db.select('SELECT * FROM shippers ORDER BY shipper_name ASC');
            setShippers(sRes);
            const colSetting = await db.select("SELECT value FROM settings WHERE key = 'shipment_orders_columns'");
            if (colSetting && colSetting.length > 0) {
                try { setVisibleColumns(JSON.parse(colSetting[0].value)); } catch (e) { }
            }

            const iRes = await db.select('SELECT * FROM inventory WHERE backorder = 1 ORDER BY sales_description ASC');
            setInventory(iRes);

            await loadOrders();
        } catch (e) {
            console.error("Failed to load initial data", e);
        }
    };

    const loadOrders = async () => {
        try {
            const db = await getDb();
            const res = await db.select('SELECT * FROM shipments ORDER BY shipment_id DESC');
            setOrders(res);
        } catch (e) {
            console.error("Failed to load orders", e);
        }
    };

    const applyFilters = () => {
        let result = [...orders];

        if (filterStatus) {
            result = result.filter(o => o.status === filterStatus);
        }
        if (filterShipper) {
            result = result.filter(o => o.shipper == filterShipper);
        }
        if (filterEstDateFrom) {
            result = result.filter(o => o.est_date >= filterEstDateFrom);
        }
        if (filterEstDateTo) {
            result = result.filter(o => o.est_date <= filterEstDateTo);
        }
        if (searchProducts) {
            const lowerSearch = searchProducts.toLowerCase();
            result = result.filter(o => {
                const prodIds = o.products ? o.products.split(',') : [];
                for (let pid of prodIds) {
                    const invItem = inventory.find(i => i.product_id == pid);
                    if (invItem) {
                        const sDesc = invItem.sales_description || '';
                        const sSku = invItem.sku || '';
                        if (sDesc.toLowerCase().includes(lowerSearch) || sSku.toLowerCase().includes(lowerSearch)) {
                            return true;
                        }
                    }
                }
                return false;
            });
        }
        setFilteredOrders(result);
    };

    const getShipperName = (shipperId) => {
        const s = shippers.find(x => x.shipper_id == shipperId);
        return s ? s.shipper_name : shipperId;
    };

    const getProductNames = (productIdsStr) => {
        if (!productIdsStr) return [];
        const ids = productIdsStr.split(',');
        return ids.map(id => {
            const item = inventory.find(i => i.product_id == id);
            return item ? `${item.sku || 'No SKU'} - ${item.sales_description || ''}` : `[ID: ${id}]`;
        });
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const toggleProduct = (productId) => {
        setFormData(prev => {
            const current = [...prev.products];
            const idStr = productId.toString();
            if (current.includes(idStr)) {
                return { ...prev, products: current.filter(id => id !== idStr) };
            } else {
                return { ...prev, products: [...current, idStr] };
            }
        });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!canWrite) return;

        try {
            const db = await getDb();
            const prodStr = formData.products.join(',');

            const selectedShipper = shippers.find(s => s.shipper_id == formData.shipper);
            const depositRate = selectedShipper ? (selectedShipper.deposit || 0) : 0;
            const balanceRate = 100 - depositRate;

            const dbDeposit = formData.depositPaid ? depositRate : null;
            let dbBalance = formData.balancePaid ? balanceRate : null;
            if (depositRate === 100 && formData.depositPaid) {
                dbBalance = 0;
            }

            const dbPaymentDate = (formData.depositPaid && (formData.balancePaid || depositRate === 100)) ? formData.payment_date : null;

            if (formMode === 'add') {
                await db.execute(
                    'INSERT INTO shipments (invoice_no, shipper, products, est_date, hbl_no, note, status, deposit, balance, payment_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                    [formData.invoice_no, formData.shipper, prodStr, formData.est_date, '', formData.note, 'open', dbDeposit, dbBalance, dbPaymentDate]
                );
            } else {
                await db.execute(
                    'UPDATE shipments SET invoice_no = $1, shipper = $2, products = $3, est_date = $4, note = $5, status = $6, deposit = $7, balance = $8, payment_date = $9 WHERE shipment_id = $10',
                    [formData.invoice_no, formData.shipper, prodStr, formData.est_date, formData.note, formData.status, dbDeposit, dbBalance, dbPaymentDate, editingId]
                );

                // Sync payments down to all linked containers
                const containers = await db.select('SELECT container_id, contents, deposit, balance, payment_date FROM containers');
                for (const cntr of containers) {
                    try {
                        const parsedContents = JSON.parse(cntr.contents || '[]');
                        if (parsedContents.some(item => item.shipment_id == editingId)) {
                            let cDep = cntr.deposit ? JSON.parse(cntr.deposit) : {};
                            let cBal = cntr.balance ? JSON.parse(cntr.balance) : {};
                            let cPay = cntr.payment_date ? JSON.parse(cntr.payment_date) : {};

                            if (dbDeposit != null) cDep[editingId] = dbDeposit; else delete cDep[editingId];
                            if (dbBalance != null) cBal[editingId] = dbBalance; else delete cBal[editingId];
                            if (dbPaymentDate != null) cPay[editingId] = dbPaymentDate; else delete cPay[editingId];

                            await db.execute(
                                'UPDATE containers SET deposit = $1, balance = $2, payment_date = $3 WHERE container_id = $4',
                                [JSON.stringify(cDep), JSON.stringify(cBal), JSON.stringify(cPay), cntr.container_id]
                            );
                        }
                    } catch (err) { }
                }
            }

            resetForm();
            await loadOrders();
        } catch (e) {
            console.error("Failed to save shipment", e);
            alert("Failed to save shipment order.");
        }
    };

    const handleEditClick = (order) => {
        setFormMode('edit');
        setEditingId(order.shipment_id);
        setFormData({
            invoice_no: order.invoice_no || '',
            shipper: order.shipper || '',
            products: order.products ? order.products.split(',') : [],
            est_date: order.est_date || '',
            note: order.note || '',
            status: order.status || 'open',
            depositPaid: order.deposit != null,
            balancePaid: order.balance != null,
            payment_date: order.payment_date || ''
        });
        setProductSearch('');
    };

    const handleDeleteClick = async (id) => {
        if (!canWrite) return;
        const confirmed = await confirm("Are you sure you want to delete this shipment order?", { title: "Delete Shipment", type: 'warning' });
        if (!confirmed) return;

        try {
            const db = await getDb();
            await db.execute('DELETE FROM shipments WHERE shipment_id = $1', [id]);
            await loadOrders();
            if (editingId === id) {
                resetForm();
            }
        } catch (e) {
            console.error("Failed to delete shipment", e);
        }
    };

    const resetForm = () => {
        setFormMode('add');
        setEditingId(null);
        setFormData({
            invoice_no: '',
            shipper: '',
            products: [],
            est_date: '',
            note: '',
            status: 'open',
            depositPaid: false,
            balancePaid: false,
            payment_date: ''
        });
        setProductSearch('');
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'open': return '#3b82f6';
            case 'processing': return '#f59e0b';
            case 'closed': return '#10b981';
            default: return '#64748b';
        }
    };

    const filteredInventory = inventory.filter(i => {
        const search = productSearch.toLowerCase();
        return (i.sales_description || '').toLowerCase().includes(search) || (i.sku || '').toLowerCase().includes(search);
    }).sort((a, b) => {
        const aSelected = formData.products.includes(a.product_id.toString());
        const bSelected = formData.products.includes(b.product_id.toString());
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return 0;
    });

    const toggleColumn = async (col) => {
        const newCols = visibleColumns.includes(col) ? visibleColumns.filter(c => c !== col) : [...visibleColumns, col];
        setVisibleColumns(newCols);
        try {
            const db = await getDb();
            await db.execute("INSERT INTO settings (key, value) VALUES ('shipment_orders_columns', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [JSON.stringify(newCols)]);
        } catch (e) { }
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <ChevronDown size={14} style={{ color: '#cbd5e1', marginLeft: '4px', verticalAlign: 'middle' }} />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={14} style={{ color: '#3b82f6', marginLeft: '4px', verticalAlign: 'middle' }} /> : <ChevronDown size={14} style={{ color: '#3b82f6', marginLeft: '4px', verticalAlign: 'middle' }} />;
    };

    const sortedOrders = [...filteredOrders].sort((a, b) => {
        if (!sortConfig.key) return 0;
        const key = sortConfig.key;
        let valA = a[key] || '';
        let valB = b[key] || '';
        if (key === 'shipper') {
            valA = getShipperName(a.shipper) || '';
            valB = getShipperName(b.shipper) || '';
        }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const exportHTML = async (print = false) => {
        let printColsStr = '';
        try { printColsStr = await getSetting('print_cols_shipment', ''); } catch (e) { }
        let printCols = ['invoice_no', 'hbl_no', 'shipper_name', 'est_date', 'cntr_no', 'products', 'note', 'deposit', 'balance'];
        if (printColsStr) {
            try { printCols = JSON.parse(printColsStr); } catch (e) { }
        }

        const colLabels = {
            invoice_no: 'Invoice No.', hbl_no: 'HBL No.', shipper_name: 'Shipper', est_date: 'Est. Date',
            cntr_no: 'Container No.', products: 'Products', note: 'Note', deposit: 'Deposit', balance: 'Balance'
        };

        let htmlRows = '';
        sortedOrders.forEach(order => {
            const s = shippers.find(x => x.shipper_id == order.shipper);
            const dRate = s ? (s.deposit || 0) : 0;
            const bRate = 100 - dRate;

            htmlRows += `<tr>`;
            for (const col of printCols) {
                if (col === 'shipper_name') {
                    htmlRows += `<td>${getShipperName(order.shipper)}</td>`;
                } else if (col === 'products') {
                    htmlRows += `<td>${getProductNames(order.products).join('<br/>')}</td>`;
                } else if (col === 'deposit') {
                    htmlRows += `<td>${dRate}%: ${order.deposit != null ? 'Paid' : 'Pending'}${order.payment_date && order.deposit != null ? `<br/>Date: ${order.payment_date}` : ''}</td>`;
                } else if (col === 'balance') {
                    htmlRows += `<td>${bRate}%: ${order.balance != null ? 'Paid' : 'Pending'}</td>`;
                } else {
                    htmlRows += `<td>${order[col] || ''}</td>`;
                }
            }
            htmlRows += `</tr>`;
        });

        const headerRow = printCols.map(col => `<th>${colLabels[col] || col}</th>`).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Shipment Orders</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { size: landscape; margin: 10mm; }
    }
</style>
</head>
<body>
    <h2>Shipment Orders (Records: ${sortedOrders.length})</h2>
    <table class="report-table">
        <thead>
            <tr>
                ${headerRow}
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
                setTimeout(() => {
                    if (document.body.contains(iframe)) {
                        document.body.removeChild(iframe);
                    }
                }, 1000);
            }, 500);
        } else {
            try {
                const filePath = await save({
                    filters: [{ name: 'HTML Document', extensions: ['html'] }],
                    defaultPath: `shipment_orders.html`,
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
        <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#f8fafc' }}>

            {/* Left Pane - Table */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden', width: 'calc(100vw - 400px)' }}>
                <div style={{ padding: '16px 24px', backgroundColor: 'white' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Shipment Orders</h2>
                            {canWrite && (
                                <button className="btn-primary" onClick={resetForm} style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '12px' }}>
                                    <Plus size={16} /> Add Order
                                </button>
                            )}
                        </div>
                        <div className="header-actions">
                            <button className="btn-upload white-bg" onClick={() => setShowColumnModal(true)} title="Columns">
                                <ListFilter size={16} style={{ marginRight: '2px' }} /> Columns
                            </button>
                            <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                                <Printer size={16} style={{ marginRight: '2px' }} /> Print List
                            </button>
                            <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                                <Download size={16} style={{ marginRight: '2px' }} /> Export HTML
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                            <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
                                <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                <input
                                    type="text"
                                    placeholder="Search products..."
                                    value={searchProducts}
                                    onChange={(e) => setSearchProducts(e.target.value)}
                                    style={{ width: '100%', padding: '6px 12px 6px 32px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                />
                            </div>
                            <select
                                value={filterStatus}
                                onChange={e => setFilterStatus(e.target.value)}
                                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                            >
                                <option value="">All Status</option>
                                <option value="open">Open</option>
                                <option value="processing">Processing</option>
                                <option value="closed">Closed</option>
                            </select>
                            <select
                                value={filterShipper}
                                onChange={(e) => setFilterShipper(e.target.value)}
                                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', background: 'white', minWidth: '150px' }}
                            >
                                <option value="">All Shippers</option>
                                {shippers.map(s => (
                                    <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>
                                ))}
                            </select>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Date:</span>
                                <input
                                    type="date"
                                    value={filterEstDateFrom}
                                    onChange={(e) => setFilterEstDateFrom(e.target.value)}
                                    style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                    title="From Date"
                                />
                                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>~</span>
                                <input
                                    type="date"
                                    value={filterEstDateTo}
                                    onChange={(e) => setFilterEstDateTo(e.target.value)}
                                    style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                    title="To Date"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="table-container create-order-container" style={{ padding: 0 }}>
                    {filteredOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No shipment orders found.</div>
                    ) : (
                        <div className="excel-table-wrapper create-order-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        {canWrite && <th style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>Actions</th>}
                                        {visibleColumns.includes('status') && <th className='has-sort-icon' style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('status')}><SortIcon columnKey="status" /> Status</th>}
                                        {visibleColumns.includes('shipper') && <th className='has-sort-icon' style={{ width: '150px', minWidth: '150px', cursor: 'pointer' }} onClick={() => handleSort('shipper')}><SortIcon columnKey="shipper" /> Shipper</th>}
                                        {visibleColumns.includes('invoice_no') && <th className='has-sort-icon' style={{ width: '120px', minWidth: '120px', cursor: 'pointer' }} onClick={() => handleSort('invoice_no')}><SortIcon columnKey="invoice_no" /> Invoice No.</th>}
                                        {visibleColumns.includes('payment') && <th style={{ width: '230px', minWidth: '230px' }}>Payment</th>}
                                        {visibleColumns.includes('products') && <th style={{ width: '250px', minWidth: '250px' }}>Products</th>}
                                        {visibleColumns.includes('est_date') && <th className='has-sort-icon' style={{ width: '120px', minWidth: '120px', cursor: 'pointer' }} onClick={() => handleSort('est_date')}><SortIcon columnKey="est_date" /> Est. Date</th>}
                                        {visibleColumns.includes('note') && <th style={{ width: '200px', minWidth: '200px' }}>Note</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedOrders.map(order => (
                                        <tr key={order.shipment_id}>
                                            {canWrite && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                        <button className="btn-icon" onClick={() => handleEditClick(order)} title="Edit">
                                                            <Edit size={14} />
                                                        </button>
                                                        <button className="btn-icon danger" onClick={() => handleDeleteClick(order.shipment_id)} title="Delete" style={{ color: '#ef4444' }}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                            {visibleColumns.includes('status') && <td>
                                                <div className="readonly-cell" style={{ textAlign: 'center' }}>
                                                    <span style={{
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        backgroundColor: `${getStatusColor(order.status)}20`,
                                                        color: getStatusColor(order.status),
                                                        fontSize: '0.8rem',
                                                        fontWeight: 'bold',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {order.status || 'open'}
                                                    </span>
                                                </div>
                                            </td>}
                                            {visibleColumns.includes('shipper') && <td><div className="readonly-cell">{getShipperName(order.shipper)}</div></td>}
                                            {visibleColumns.includes('invoice_no') && <td><div className="readonly-cell">{order.invoice_no}</div></td>}
                                            {visibleColumns.includes('payment') && <td>
                                                {(() => {
                                                    const s = shippers.find(x => x.shipper_id == order.shipper);
                                                    const dRate = s ? (s.deposit || 0) : 0;
                                                    const bRate = 100 - dRate;
                                                    return (
                                                        <div className="readonly-cell" style={{ fontSize: '0.8rem', color: '#475569' }}>
                                                            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'default' }}>
                                                                <input type="checkbox" checked={order.deposit != null} readOnly style={{ cursor: 'default' }} />
                                                                <span>{dRate}%</span>
                                                            </label>
                                                            {dRate < 100 && (
                                                                <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '4px', cursor: 'default' }}>
                                                                    <input type="checkbox" checked={order.balance != null} readOnly style={{ cursor: 'default' }} />
                                                                    <span>{bRate}%</span>
                                                                </label>
                                                            )}
                                                            {order.payment_date && (
                                                                <div style={{ marginLeft: '8px', color: '#ffffff', backgroundColor: 'rgb(16 185 129)', padding: '1px 4px 2px', MarginTop: '-1px' }}>Date: {order.payment_date}</div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>}
                                            {visibleColumns.includes('products') && <td>
                                                <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                                    {getProductNames(order.products).map((pname, idx) => (
                                                        <div key={idx} style={{
                                                            backgroundColor: '#f1f5f9',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis'
                                                        }}>
                                                            {pname}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>}
                                            {visibleColumns.includes('est_date') && <td><div className="readonly-cell">{order.est_date}</div></td>}
                                            {visibleColumns.includes('note') && <td>
                                                <div className="readonly-cell" style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: '#475569' }}>
                                                    {order.note}
                                                </div>
                                            </td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Pane - Form */}
            {canWrite && (
                <div style={{ width: '400px', backgroundColor: 'white', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>
                            {formMode === 'add' ? 'New Shipment Order' : 'Edit Shipment Order'}
                        </h3>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                        <form id="shipment-form" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Invoice No.</label>
                                <input
                                    type="text"
                                    name="invoice_no"
                                    value={formData.invoice_no}
                                    onChange={handleFormChange}
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Shipper</label>
                                <select
                                    name="shipper"
                                    value={formData.shipper}
                                    onChange={handleFormChange}
                                    required
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', background: 'white' }}
                                >
                                    <option value="" disabled>Select Shipper</option>
                                    {shippers.map(s => (
                                        <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Products (Backordered)</label>
                                <div style={{ position: 'relative', marginBottom: '8px' }}>
                                    <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text"
                                        placeholder="Search inventory..."
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        style={{ width: '100%', padding: '6px 8px 6px 28px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                    />
                                </div>
                                <div style={{
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    backgroundColor: 'white'
                                }}>
                                    {filteredInventory.map(i => {
                                        const isSelected = formData.products.includes(i.product_id.toString());
                                        return (
                                            <div
                                                key={i.product_id}
                                                onClick={() => toggleProduct(i.product_id)}
                                                style={{
                                                    padding: '6px 10px',
                                                    borderBottom: '1px solid #f1f5f9',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                                    fontSize: '0.85rem'
                                                }}
                                            >
                                                <div style={{
                                                    width: '14px', height: '14px',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: '3px',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    backgroundColor: isSelected ? '#3b82f6' : 'transparent',
                                                    borderColor: isSelected ? '#3b82f6' : '#cbd5e1',
                                                    flexShrink: 0
                                                }}>
                                                    {isSelected && <Check size={10} color="white" />}
                                                </div>
                                                {i.sku} - {i.sales_description}
                                            </div>
                                        );
                                    })}
                                    {filteredInventory.length === 0 && (
                                        <div style={{ padding: '8px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>No products found.</div>
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Estimated Date</label>
                                <input
                                    type="date"
                                    name="est_date"
                                    value={formData.est_date}
                                    onChange={handleFormChange}
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                />
                            </div>

                            <div className="form-group" style={{ padding: '12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Payment Status</label>
                                {!formData.shipper ? (
                                    <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Please select a Shipper first.</div>
                                ) : (
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.depositPaid}
                                                onChange={(e) => {
                                                    const checked = e.target.checked;
                                                    const shipper = shippers.find(s => s.shipper_id == formData.shipper);
                                                    const rate = shipper ? (shipper.deposit || 0) : 0;
                                                    setFormData(p => {
                                                        let bp = p.balancePaid;
                                                        let pd = p.payment_date;
                                                        if (rate === 100) {
                                                            bp = checked;
                                                            pd = (checked && !pd) ? new Date().toISOString().split('T')[0] : (checked ? pd : '');
                                                        }
                                                        return { ...p, depositPaid: checked, balancePaid: bp, payment_date: pd };
                                                    });
                                                }}
                                            />
                                            {(() => {
                                                const s = shippers.find(x => x.shipper_id == formData.shipper);
                                                return `Deposit (${s ? (s.deposit || 0) : 0}%)`;
                                            })()}
                                        </label>

                                        {(() => {
                                            const s = shippers.find(x => x.shipper_id == formData.shipper);
                                            const rate = s ? (s.deposit || 0) : 0;
                                            if (rate < 100) {
                                                return (
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={formData.balancePaid}
                                                            onChange={(e) => {
                                                                const checked = e.target.checked;
                                                                setFormData(p => ({
                                                                    ...p,
                                                                    balancePaid: checked,
                                                                    payment_date: (checked && p.depositPaid && !p.payment_date) ? new Date().toISOString().split('T')[0] : p.payment_date
                                                                }));
                                                            }}
                                                        />
                                                        {`Balance (${100 - rate}%)`}
                                                    </label>
                                                );
                                            }
                                            return null;
                                        })()}

                                        {formData.depositPaid && (formData.balancePaid || (() => {
                                            const s = shippers.find(x => x.shipper_id == formData.shipper);
                                            return s && s.deposit === 100;
                                        })()) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                                                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Payment Date:</span>
                                                    <input
                                                        type="date"
                                                        name="payment_date"
                                                        value={formData.payment_date}
                                                        onChange={handleFormChange}
                                                        style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                                    />
                                                </div>
                                            )}
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Note</label>
                                <textarea
                                    name="note"
                                    value={formData.note}
                                    onChange={handleFormChange}
                                    rows="3"
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', resize: 'vertical' }}
                                />
                            </div>

                            {formMode === 'edit' && (
                                <div className="form-group">
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Status</label>
                                    <select
                                        name="status"
                                        value={formData.status}
                                        onChange={handleFormChange}
                                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', background: 'white' }}
                                    >
                                        <option value="open">Open</option>
                                        <option value="processing">Processing</option>
                                        <option value="closed">Closed</option>
                                    </select>
                                </div>
                            )}

                        </form>
                    </div>
                    <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        {formMode === 'edit' && (
                            <button className="btn-secondary" onClick={resetForm} style={{ padding: '8px 16px' }}>Cancel</button>
                        )}
                        <button type="submit" form="shipment-form" className="btn-primary" style={{ padding: '8px 24px' }}>
                            {formMode === 'add' ? 'Save Order' : 'Update Order'}
                        </button>
                    </div>
                </div>
            )}
            {showColumnModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h3>Display Columns</h3>
                            <button className="btn-icon" onClick={() => setShowColumnModal(false)}><XCircle size={20} /></button>
                        </div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
                            {defaultCols.map(col => (
                                <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={visibleColumns.includes(col)} onChange={() => toggleColumn(col)} />
                                    {col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </label>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn-primary" onClick={() => setShowColumnModal(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
