import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Plus, Edit, Trash2, Search, Check } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import './Containers.css';

export default function ShipmentOrders({ currentUser, initialEditId, onClearEdit }) {
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

    const canWrite = currentUser?.permissions?.containers?.write !== false;

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        applyFilters();
    }, [orders, filterShipper, filterEstDateFrom, filterEstDateTo, searchProducts]);

    useEffect(() => {
        if (initialEditId && orders.length > 0) {
            const target = orders.find(o => o.shipment_id === initialEditId);
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
    });

    return (
        <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#f8fafc' }}>

            {/* Left Pane - Table */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', backgroundColor: 'white' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Shipment Orders</h2>
                        {canWrite && (
                            <button className="btn-primary" onClick={resetForm} style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Plus size={16} /> Add Order
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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

                <div className="table-container create-order-container" style={{ padding: 0 }}>
                    {filteredOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No shipment orders found.</div>
                    ) : (
                        <div className="excel-table-wrapper create-order-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        {canWrite && <th style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>Actions</th>}
                                        <th style={{ width: '100px', minWidth: '100px' }}>Status</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Shipper</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Invoice No.</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Est. Date</th>
                                        <th style={{ width: '300px', minWidth: '300px' }}>Products</th>
                                        <th style={{ width: '200px', minWidth: '200px' }}>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map(order => (
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
                                            <td>
                                                <div className="readonly-cell" style={{ textAlign: 'center' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        textTransform: 'uppercase',
                                                        padding: '2px 8px',
                                                        borderRadius: '999px',
                                                        backgroundColor: getStatusColor(order.status) + '20',
                                                        color: getStatusColor(order.status)
                                                    }}>
                                                        {order.status}
                                                    </span>
                                                </div>
                                            </td>
                                            <td><div className="readonly-cell">{getShipperName(order.shipper)}</div></td>
                                            <td><div className="readonly-cell">{order.invoice_no}</div></td>
                                            <td><div className="readonly-cell">{order.est_date}</div></td>
                                            <td>
                                                <div className="readonly-cell" style={{ whiteSpace: 'normal', wordBreak: 'break-word', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {getProductNames(order.products).map((name, i) => <div key={i}>{name}</div>)}
                                                </div>
                                            </td>
                                            <td><div className="readonly-cell" style={{ whiteSpace: 'normal', wordBreak: 'break-word', fontSize: '0.85rem' }}>{order.note}</div></td>
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
        </div>
    );
}
