import { useState, useEffect, useRef } from 'react';
import { getDb, getSetting } from '../db/Database';
import { getLocalTodayStrSync } from '../utils/timezone';
import { Plus, Edit, Trash2, Search, Check, ChevronUp, ChevronDown, ListFilter, X, Printer, Download, Calendar, Box, DollarSign, CheckCircle2, Truck, Clock, Unlink, Link } from 'lucide-react';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Containers.css';

export default function PurchaseOrders({ currentUser, isActive }) {
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [shippers, setShippers] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const shippersLoadedRef = useRef(false);
    const productsLoadedRef = useRef(false);

    // Filters
    const [filterShipper, setFilterShipper] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editActiveTab, setEditActiveTab] = useState('info'); // 'info', 'shipment', 'payment', 'products'
    const [editingOrder, setEditingOrder] = useState(null);

    // Edit Form: Batches & Containers state
    const [orderBatches, setOrderBatches] = useState([]); // batches linked to editingOrder
    const [unassignedBatches, setUnassignedBatches] = useState([]); // batches with order_id IS NULL
    const [containerOrderBatches, setContainerOrderBatches] = useState([]); // COB rows for shipping orders / batches under this PO
    const [unlinkedBatchIds, setUnlinkedBatchIds] = useState([]); // batches unlinked during edit session
    const [selectedUnassignedBatchId, setSelectedUnassignedBatchId] = useState('');

    // Add Form State
    const [addForm, setAddForm] = useState({
        shipper_id: '',
        invoice_no: '',
        selectedProductIds: [],
        productDetails: {}, // { [product_id]: { price: '', amount: '' } }
        deposit_amount: '',
        deposit_exchange_rate: '',
        note: ''
    });
    const [addProductSearch, setAddProductSearch] = useState('');

    // Edit Form State
    const [editForm, setEditForm] = useState({
        order_id: null,
        shipper_id: '',
        invoice_no: '',
        status: 'open',
        selectedProductIds: [],
        productDetails: {},
        deposit_amount: '',
        deposit_exchange_rate: '',
        note: '',
        shippingOrders: [] // array of { shipping_order_id, hbl_no, est_date, container_id }
    });
    const [editProductSearch, setEditProductSearch] = useState('');
    const [originalShippingOrderIds, setOriginalShippingOrderIds] = useState([]);

    // Table Columns & Sorting
    const defaultCols = ['status', 'shipper', 'invoice_no', 'payment', 'products', 'note'];
    const [visibleColumns, setVisibleColumns] = useState(defaultCols);
    const [showColumnModal, setShowColumnModal] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: '', direction: '' });

    const canWrite = currentUser?.permissions?.purchaseOrders?.write ?? currentUser?.permissions?.shipmentOrders?.write ?? currentUser?.permissions?.admin ?? true;

    useEffect(() => {
        if (isActive !== false) {
            loadInitialData();
        }
        const handleSync = () => {
            if (isActive !== false) {
                loadOrders();
            }
        };
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [orders, filterShipper, filterStatus, searchQuery]);

    const ORDERS_QUERY = `
        SELECT po.*, 
               COALESCE(b_sum.paid_balance, 0) as paid_balance
        FROM purchase_orders po
        LEFT JOIN (
            SELECT order_id, SUM(balance) as paid_balance
            FROM (
                SELECT DISTINCT ob.order_batch_id, COALESCE(ob.order_id, so.order_id) as order_id, COALESCE(ob.balance, 0) as balance
                FROM order_batch ob
                LEFT JOIN container_order_batch cob ON ob.order_batch_id = cob.order_batch_id
                LEFT JOIN shipping_order so ON cob.shipping_order_id = so.shipping_order_id
                WHERE ob.order_id IS NOT NULL OR so.order_id IS NOT NULL
            )
            GROUP BY order_id
        ) b_sum ON po.order_id = b_sum.order_id
        ORDER BY po.order_id DESC
    `;

    const loadInitialData = async () => {
        try {
            const db = await getDb();

            // Run initial queries in parallel on local mirror.db without blocking sequentially
            const [sRes, pRes, colSetting, oRes] = await Promise.all([
                shippersLoadedRef.current ? Promise.resolve(null) : db.select('SELECT * FROM shippers ORDER BY shipper_name ASC'),
                productsLoadedRef.current ? Promise.resolve(null) : db.select('SELECT product_id, product_name, showtile_price FROM products ORDER BY product_name ASC'),
                db.select("SELECT value FROM settings WHERE key = 'purchase_orders_columns'"),
                db.select(ORDERS_QUERY)
            ]);

            if (sRes) {
                setShippers(sRes);
                shippersLoadedRef.current = true;
            }
            if (pRes) {
                setAllProducts(pRes);
                productsLoadedRef.current = true;
            }
            if (colSetting && colSetting.length > 0) {
                try { setVisibleColumns(JSON.parse(colSetting[0].value)); } catch (e) { }
            }
            if (oRes) {
                setOrders(oRes);
            }
        } catch (e) {
            console.error("Failed to load initial data for purchase orders", e);
        }
    };

    const loadOrders = async () => {
        try {
            const db = await getDb();
            const res = await db.select(ORDERS_QUERY);
            setOrders(res);
        } catch (e) {
            console.error("Failed to load purchase orders", e);
        }
    };

    const getShipperName = (id) => {
        if (!id) return '';
        const found = shippers.find(s => String(s.shipper_id) === String(id));
        return found ? found.shipper_name : `Shipper #${id}`;
    };

    const getProductName = (id) => {
        const found = allProducts.find(p => String(p.product_id) === String(id));
        return found ? found.product_name : `Product #${id}`;
    };

    const parseOrderProducts = (productsJson) => {
        if (!productsJson) return [];
        try {
            const arr = JSON.parse(productsJson);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    };

    const getOrderPaymentInfo = (row) => {
        let totalPOValue = 0;
        const prods = parseOrderProducts(row.products);
        if (Array.isArray(prods)) {
            totalPOValue = prods.reduce((sum, p) => sum + (parseFloat(p.price) || 0) * (parseFloat(p.amount) || 0), 0);
        }

        const depositAmount = parseFloat(row.deposit_amount) || 0;
        const isDepositPaid = row.deposit_amount !== null && row.deposit_amount !== '' && depositAmount > 0;

        const totalRequiredBalance = Math.max(0, totalPOValue - depositAmount);
        const paidBalance = parseFloat(row.paid_balance) || 0;

        // Balance is completed only if all remaining balance is fully paid (allowing for minor float rounding)
        const isBalanceCompleted = totalPOValue > 0 && (paidBalance >= totalRequiredBalance - 0.01);

        return {
            totalPOValue,
            depositAmount,
            isDepositPaid,
            totalRequiredBalance,
            paidBalance,
            isBalanceCompleted
        };
    };

    const applyFilters = () => {
        let result = [...orders];

        if (filterShipper) {
            result = result.filter(o => String(o.shipper_id) === String(filterShipper));
        }

        if (filterStatus) {
            result = result.filter(o => o.status === filterStatus);
        }

        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            result = result.filter(o => {
                if (o.invoice_no && o.invoice_no.toLowerCase().includes(lower)) return true;
                if (o.note && o.note.toLowerCase().includes(lower)) return true;
                const prods = parseOrderProducts(o.products);
                return prods.some(p => (p.product_name || getProductName(p.product_id)).toLowerCase().includes(lower));
            });
        }

        setFilteredOrders(result);
    };

    // Calculate Total Cost for Add Form
    const calculateAddTotal = () => {
        let total = 0;
        addForm.selectedProductIds.forEach(id => {
            const details = addForm.productDetails[id];
            if (details) {
                const price = parseFloat(details.price) || 0;
                const amount = parseFloat(details.amount) || 0;
                total += price * amount;
            }
        });
        return total;
    };

    // Calculate Total Cost for Edit Form
    const calculateEditTotal = () => {
        let total = 0;
        editForm.selectedProductIds.forEach(id => {
            const details = editForm.productDetails[id];
            if (details) {
                const price = parseFloat(details.price) || 0;
                const amount = parseFloat(details.amount) || 0;
                total += price * amount;
            }
        });
        return total;
    };

    // Sorting rule:
    // Status 'close' ALWAYS placed at the very bottom!
    // 'open' and 'processing' on top.
    const sortedOrders = [...filteredOrders].sort((a, b) => {
        const isCloseA = a.status === 'close';
        const isCloseB = b.status === 'close';
        if (isCloseA && !isCloseB) return 1;
        if (!isCloseA && isCloseB) return -1;

        if (sortConfig.key) {
            let valA = a[sortConfig.key] || '';
            let valB = b[sortConfig.key] || '';
            if (sortConfig.key === 'shipper') {
                valA = getShipperName(a.shipper_id) || '';
                valB = getShipperName(b.shipper_id) || '';
            }
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        }

        return b.order_id - a.order_id;
    });

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <ChevronDown size={14} style={{ color: '#cbd5e1', marginLeft: '4px', verticalAlign: 'middle' }} />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={14} style={{ color: '#3b82f6', marginLeft: '4px', verticalAlign: 'middle' }} /> : <ChevronDown size={14} style={{ color: '#3b82f6', marginLeft: '4px', verticalAlign: 'middle' }} />;
    };

    const toggleColumn = async (col) => {
        const newCols = visibleColumns.includes(col) ? visibleColumns.filter(c => c !== col) : [...visibleColumns, col];
        setVisibleColumns(newCols);
        try {
            const db = await getDb();
            await db.execute("INSERT INTO settings (key, value) VALUES ('purchase_orders_columns', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [JSON.stringify(newCols)]);
        } catch (e) { }
    };

    // --- ADD ORDER HANDLERS ---
    const handleOpenAddModal = () => {
        setAddForm({
            shipper_id: '',
            invoice_no: '',
            selectedProductIds: [],
            productDetails: {},
            deposit_amount: '',
            deposit_exchange_rate: '',
            note: ''
        });
        setAddProductSearch('');
        setShowAddModal(true);
    };

    const handleAddShipperChange = (shipperId) => {
        const shipper = shippers.find(s => String(s.shipper_id) === String(shipperId));
        const depositRate = shipper ? (shipper.deposit || 0) : 0;
        const currentTotal = calculateAddTotal();
        const defaultDeposit = depositRate > 0 ? ((currentTotal * depositRate) / 100).toFixed(2) : '';

        setAddForm(prev => ({
            ...prev,
            shipper_id: shipperId,
            deposit_amount: defaultDeposit
        }));
    };

    const handleAddToggleProduct = (productId) => {
        const idStr = String(productId);
        setAddForm(prev => {
            const exists = prev.selectedProductIds.includes(idStr);
            const newIds = exists ? prev.selectedProductIds.filter(id => id !== idStr) : [...prev.selectedProductIds, idStr];
            const newDetails = { ...prev.productDetails };

            if (!exists && !newDetails[idStr]) {
                const prod = allProducts.find(p => String(p.product_id) === idStr);
                newDetails[idStr] = {
                    price: '',
                    amount: ''
                };
            }

            // Recalculate deposit
            let newTotal = 0;
            newIds.forEach(id => {
                const d = newDetails[id];
                if (d) newTotal += (parseFloat(d.price) || 0) * (parseFloat(d.amount) || 0);
            });
            const shipper = shippers.find(s => String(s.shipper_id) === String(prev.shipper_id));
            const depositRate = shipper ? (shipper.deposit || 0) : 0;
            const newDeposit = depositRate > 0 ? ((newTotal * depositRate) / 100).toFixed(2) : prev.deposit_amount;

            return {
                ...prev,
                selectedProductIds: newIds,
                productDetails: newDetails,
                deposit_amount: newDeposit
            };
        });
    };

    const handleAddProductDetailChange = (productId, field, value) => {
        const idStr = String(productId);
        setAddForm(prev => {
            const newDetails = {
                ...prev.productDetails,
                [idStr]: {
                    ...prev.productDetails[idStr],
                    [field]: value
                }
            };

            // Recalculate deposit
            let newTotal = 0;
            prev.selectedProductIds.forEach(id => {
                const d = newDetails[id];
                if (d) newTotal += (parseFloat(d.price) || 0) * (parseFloat(d.amount) || 0);
            });
            const shipper = shippers.find(s => String(s.shipper_id) === String(prev.shipper_id));
            const depositRate = shipper ? (shipper.deposit || 0) : 0;
            const newDeposit = depositRate > 0 ? ((newTotal * depositRate) / 100).toFixed(2) : prev.deposit_amount;

            return {
                ...prev,
                productDetails: newDetails,
                deposit_amount: newDeposit
            };
        });
    };

    const handleSaveAddOrder = async () => {
        if (!addForm.shipper_id) {
            alert("Please select a Factory.");
            return;
        }

        try {
            const db = await getDb();
            const productsData = addForm.selectedProductIds.map(id => {
                const details = addForm.productDetails[id] || {};
                return {
                    product_id: parseInt(id),
                    product_name: getProductName(id),
                    price: parseFloat(details.price) || 0,
                    amount: parseFloat(details.amount) || 0
                };
            });

            const today = getLocalTodayStrSync();
            await db.execute(`
                INSERT INTO purchase_orders (
                    shipper_id, invoice_no, products, note, status, 
                    deposit_amount, deposit_exchange_rate, created_at
                ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
            `, [
                addForm.shipper_id ? parseInt(addForm.shipper_id) : null,
                (addForm.invoice_no || '').trim(),
                JSON.stringify(productsData),
                (addForm.note || '').trim(),
                addForm.deposit_amount ? parseFloat(addForm.deposit_amount) : null,
                addForm.deposit_exchange_rate ? parseFloat(addForm.deposit_exchange_rate) : null,
                today
            ]);

            setShowAddModal(false);
            await loadOrders();
        } catch (e) {
            console.error("Failed to add purchase order", e);
            alert("Failed to save purchase order.");
        }
    };

    // --- EDIT ORDER HANDLERS ---
    const handleOpenEditModal = async (order) => {
        setEditingOrder(order);
        setEditActiveTab('info');
        setEditProductSearch('');

        const parsedProducts = parseOrderProducts(order.products);
        const selectedIds = parsedProducts.map(p => String(p.product_id));
        const detailsMap = {};
        parsedProducts.forEach(p => {
            detailsMap[String(p.product_id)] = {
                price: p.price ?? '',
                amount: p.amount ?? ''
            };
        });

        // Load associated shipping orders, batches, COBs and unassigned batches
        let shippingList = [];
        let origIds = [];
        let batches = [];
        let cobList = [];
        let unassigned = [];
        try {
            const db = await getDb();
            const sOrders = await db.select('SELECT * FROM shipping_order WHERE order_id = $1 ORDER BY shipping_order_id ASC', [order.order_id]);
            shippingList = sOrders.map(s => ({
                shipping_order_id: s.shipping_order_id,
                hbl_no: s.hbl_no || '',
                est_date: s.est_date || '',
                container_id: s.container_id || null
            }));
            origIds = sOrders.map(s => s.shipping_order_id);

            // Load batches linked to this order or its shipping orders
            batches = await db.select(`
                SELECT ob.*, p.product_name 
                FROM order_batch ob 
                LEFT JOIN products p ON ob.product_id = p.product_id 
                WHERE ob.order_id = $1 
                   OR ob.order_batch_id IN (
                       SELECT cob.order_batch_id 
                       FROM container_order_batch cob 
                       JOIN shipping_order so ON cob.shipping_order_id = so.shipping_order_id 
                       WHERE so.order_id = $1
                   )
                ORDER BY ob.order_batch_id ASC
            `, [order.order_id]);

            // Load COB items with container info
            cobList = await db.select(`
                SELECT cob.id, cob.shipping_order_id, cob.container_id, cob.order_batch_id, cob.amount, cob.weight,
                       c.cntr_no, c.delivery, c.warehouse_received,
                       ob.product_id, ob.sku, ob.description,
                       p.product_name
                FROM container_order_batch cob
                LEFT JOIN containers c ON cob.container_id = c.container_id
                LEFT JOIN order_batch ob ON cob.order_batch_id = ob.order_batch_id
                LEFT JOIN products p ON ob.product_id = p.product_id
                WHERE ob.order_id = $1 
                   OR cob.shipping_order_id IN (SELECT shipping_order_id FROM shipping_order WHERE order_id = $1)
            `, [order.order_id]);

            // Load unassigned batches (order_id IS NULL)
            unassigned = await db.select(`
                SELECT ob.*, p.product_name 
                FROM order_batch ob 
                LEFT JOIN products p ON ob.product_id = p.product_id 
                WHERE (ob.order_id IS NULL OR ob.order_id = '')
                  AND ob.order_batch_id NOT IN (
                      SELECT cob.order_batch_id 
                      FROM container_order_batch cob 
                      JOIN shipping_order so ON cob.shipping_order_id = so.shipping_order_id 
                      WHERE so.order_id IS NOT NULL
                  )
                ORDER BY ob.order_batch_id DESC
            `);
        } catch (e) {
            console.error("Failed to load shipping orders and batch details", e);
        }

        setOriginalShippingOrderIds(origIds);
        setOrderBatches(batches);
        setContainerOrderBatches(cobList);
        setUnassignedBatches(unassigned);
        setUnlinkedBatchIds([]);
        setSelectedUnassignedBatchId('');

        setEditForm({
            order_id: order.order_id,
            shipper_id: order.shipper_id ? String(order.shipper_id) : '',
            invoice_no: order.invoice_no || '',
            status: order.status || 'open',
            selectedProductIds: selectedIds,
            productDetails: detailsMap,
            deposit_amount: order.deposit_amount ?? '',
            deposit_exchange_rate: order.deposit_exchange_rate ?? '',
            note: order.note || '',
            shippingOrders: shippingList
        });

        setShowEditModal(true);
    };

    const handleEditToggleProduct = (productId) => {
        const idStr = String(productId);
        setEditForm(prev => {
            const exists = prev.selectedProductIds.includes(idStr);
            const newIds = exists ? prev.selectedProductIds.filter(id => id !== idStr) : [...prev.selectedProductIds, idStr];
            const newDetails = { ...prev.productDetails };

            if (!exists && !newDetails[idStr]) {
                const prod = allProducts.find(p => String(p.product_id) === idStr);
                newDetails[idStr] = {
                    price: '',
                    amount: ''
                };
            }

            return {
                ...prev,
                selectedProductIds: newIds,
                productDetails: newDetails
            };
        });
    };

    const handleEditProductDetailChange = (productId, field, value) => {
        const idStr = String(productId);
        setEditForm(prev => ({
            ...prev,
            productDetails: {
                ...prev.productDetails,
                [idStr]: {
                    ...prev.productDetails[idStr],
                    [field]: value
                }
            }
        }));
    };

    // Shipping Order Repeater Handlers
    const handleAddShippingOrderRow = () => {
        setEditForm(prev => ({
            ...prev,
            shippingOrders: [
                ...prev.shippingOrders,
                {
                    shipping_order_id: null,
                    hbl_no: '',
                    est_date: getLocalTodayStrSync(),
                    container_id: null
                }
            ]
        }));
    };

    const handleUpdateShippingOrderRow = (index, field, value) => {
        setEditForm(prev => {
            const list = [...prev.shippingOrders];
            list[index] = { ...list[index], [field]: value };
            return { ...prev, shippingOrders: list };
        });
    };

    const handleRemoveShippingOrderRow = (index) => {
        setEditForm(prev => {
            const list = [...prev.shippingOrders];
            list.splice(index, 1);
            return { ...prev, shippingOrders: list };
        });
    };

    // Batch Handlers in Edit Order
    const handleBatchFieldChange = (batchId, field, value) => {
        setOrderBatches(prev => prev.map(b =>
            b.order_batch_id === batchId ? { ...b, [field]: value } : b
        ));
    };

    const handleLinkUnassignedBatch = () => {
        if (!selectedUnassignedBatchId) return;
        const bId = Number(selectedUnassignedBatchId);
        const batchToLink = unassignedBatches.find(b => b.order_batch_id === bId);
        if (!batchToLink) return;

        setOrderBatches(prev => [
            ...prev,
            {
                ...batchToLink,
                order_id: editForm.order_id,
                balance: batchToLink.balance != null ? batchToLink.balance : '',
                balance_exchange_rate: batchToLink.balance_exchange_rate != null ? batchToLink.balance_exchange_rate : '',
                balance_paid_date: batchToLink.balance_paid_date || ''
            }
        ]);
        setUnassignedBatches(prev => prev.filter(b => b.order_batch_id !== bId));
        setUnlinkedBatchIds(prev => prev.filter(id => id !== bId));
        setSelectedUnassignedBatchId('');
    };

    const handleUnlinkBatch = (batchId) => {
        const batchToUnlink = orderBatches.find(b => b.order_batch_id === batchId);
        if (!batchToUnlink) return;

        setOrderBatches(prev => prev.filter(b => b.order_batch_id !== batchId));
        setUnassignedBatches(prev => [{ ...batchToUnlink, order_id: null }, ...prev]);
        setUnlinkedBatchIds(prev => [...new Set([...prev, batchId])]);
    };

    const isContainerDelivered = (deliveryDate, warehouseReceived) => {
        if (warehouseReceived === '1' || (warehouseReceived && warehouseReceived !== '0')) return true;
        const todayStr = getLocalTodayStrSync();
        if (deliveryDate && String(deliveryDate).trim() !== '' && deliveryDate < todayStr) return true;
        return false;
    };

    const handleSaveEditOrder = async () => {
        if (!editForm.shipper_id) {
            alert("Please select a Factory.");
            return;
        }

        try {
            const db = await getDb();
            const productsData = editForm.selectedProductIds.map(id => {
                const details = editForm.productDetails[id] || {};
                return {
                    product_id: parseInt(id),
                    product_name: getProductName(id),
                    price: parseFloat(details.price) || 0,
                    amount: parseFloat(details.amount) || 0
                };
            });

            // 1. Update purchase_orders
            await db.execute(`
                UPDATE purchase_orders SET 
                    shipper_id = $1, invoice_no = $2, products = $3, 
                    note = $4, status = $5, deposit_amount = $6, deposit_exchange_rate = $7
                WHERE order_id = $8
            `, [
                editForm.shipper_id ? parseInt(editForm.shipper_id) : null,
                (editForm.invoice_no || '').trim(),
                JSON.stringify(productsData),
                (editForm.note || '').trim(),
                editForm.status,
                editForm.deposit_amount ? parseFloat(editForm.deposit_amount) : null,
                editForm.deposit_exchange_rate ? parseFloat(editForm.deposit_exchange_rate) : null,
                editForm.order_id
            ]);

            // 2. Sync shipping_order table
            const currentShippingIds = editForm.shippingOrders.filter(s => s.shipping_order_id).map(s => s.shipping_order_id);
            const toDelete = originalShippingOrderIds.filter(id => !currentShippingIds.includes(id));

            for (const delId of toDelete) {
                await db.execute('DELETE FROM shipping_order WHERE shipping_order_id = $1', [delId]);
            }

            const today = getLocalTodayStrSync();
            for (const s of editForm.shippingOrders) {
                if (s.shipping_order_id) {
                    await db.execute(`
                        UPDATE shipping_order SET 
                            hbl_no = $1, est_date = $2 
                        WHERE shipping_order_id = $3
                    `, [s.hbl_no.trim(), s.est_date || null, s.shipping_order_id]);
                } else {
                    await db.execute(`
                        INSERT INTO shipping_order (order_id, hbl_no, est_date, created_date)
                        VALUES ($1, $2, $3, $4)
                    `, [editForm.order_id, s.hbl_no.trim(), s.est_date || null, today]);
                }
            }

            // 3. Update order batches (balance, balance_exchange_rate, balance_paid_date, order_id)
            for (const b of orderBatches) {
                await db.execute(`
                    UPDATE order_batch SET 
                        order_id = $1,
                        balance = $2,
                        balance_exchange_rate = $3,
                        balance_paid_date = $4
                    WHERE order_batch_id = $5
                `, [
                    editForm.order_id,
                    b.balance != null && b.balance !== '' ? parseFloat(b.balance) : null,
                    b.balance_exchange_rate != null && b.balance_exchange_rate !== '' ? parseFloat(b.balance_exchange_rate) : null,
                    b.balance_paid_date || null,
                    b.order_batch_id
                ]);
            }

            // 4. Reset order_id for unlinked batches
            for (const uId of unlinkedBatchIds) {
                await db.execute(`
                    UPDATE order_batch SET order_id = NULL WHERE order_batch_id = $1
                `, [uId]);
            }

            setShowEditModal(false);
            await loadOrders();
        } catch (e) {
            console.error("Failed to update purchase order", e);
            alert("Failed to update purchase order.");
        }
    };

    const handleDeleteOrder = async (orderId) => {
        if (!canWrite) return;
        const confirmed = await confirm("Are you sure you want to delete this purchase order? All associated shipping orders will also be removed.", { title: "Delete Purchase Order", type: 'warning' });
        if (!confirmed) return;

        try {
            const db = await getDb();
            await db.execute('DELETE FROM shipping_order WHERE order_id = $1', [orderId]);
            await db.execute('DELETE FROM purchase_orders WHERE order_id = $1', [orderId]);
            await loadOrders();
        } catch (e) {
            console.error("Failed to delete purchase order", e);
            alert("Failed to delete purchase order.");
        }
    };

    // --- EXPORT & PRINT ---
    const exportHTML = async (print = false) => {
        const printCols = visibleColumns;
        const colLabels = {
            status: 'Status',
            shipper: 'Shipper',
            invoice_no: 'Invoice No.',
            payment: 'Payment',
            products: 'Products',
            note: 'Note'
        };

        let htmlRows = '';
        sortedOrders.forEach(o => {
            htmlRows += `<tr>`;
            for (const col of printCols) {
                if (col === 'shipper') {
                    htmlRows += `<td>${getShipperName(o.shipper_id)}</td>`;
                } else if (col === 'status') {
                    htmlRows += `<td>${o.status || 'open'}</td>`;
                } else if (col === 'products') {
                    const prods = parseOrderProducts(o.products);
                    const prodLines = prods.map(p => p.product_name || getProductName(p.product_id) || (p.sku ? p.sku : `Product #${p.product_id}`)).filter(Boolean);
                    htmlRows += `<td>${prodLines.join('<br/>') || '-'}</td>`;
                } else if (col === 'payment') {
                    const payInfo = getOrderPaymentInfo(o);
                    const depText = payInfo.isDepositPaid ? 'Deposit: Completed' : 'Deposit: Unpaid';
                    const balText = payInfo.isBalanceCompleted
                        ? 'Balance: Completed'
                        : `Balance: $${payInfo.paidBalance.toFixed(2)} / $${payInfo.totalRequiredBalance.toFixed(2)}`;
                    htmlRows += `<td>${depText}<br/>${balText}</td>`;
                } else {
                    htmlRows += `<td>${o[col] || ''}</td>`;
                }
            }
            htmlRows += `</tr>`;
        });

        const headerRow = printCols.map(col => `<th>${colLabels[col] || col}</th>`).join('');
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Purchase Orders</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    @media print { body { padding: 0; margin: 0; } @page { margin: 10mm; } }
</style>
</head>
<body>
    <h2>Purchase Orders (Records: ${sortedOrders.length})</h2>
    <table class="report-table">
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${htmlRows}</tbody>
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
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                }, 1000);
            }, 500);
        } else {
            try {
                const filePath = await save({
                    filters: [{ name: 'HTML Document', extensions: ['html'] }],
                    defaultPath: 'purchase_orders.html'
                });
                if (filePath) await writeTextFile(filePath, html);
            } catch (e) {
                console.error("Export HTML error", e);
            }
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open':
                return <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#eff6ff', color: '#1d4ed8' }}>Open</span>;
            case 'processing':
                return <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#fef3c7', color: '#b45309' }}>Processing</span>;
            case 'close':
                return <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#f1f5f9', color: '#475569' }}>Closed</span>;
            default:
                return <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#f1f5f9', color: '#64748b' }}>{status || 'Open'}</span>;
        }
    };

    const filteredAddProducts = allProducts.filter(p => {
        const s = addProductSearch.toLowerCase();
        return (p.product_name || '').toLowerCase().includes(s);
    }).sort((a, b) => {
        const aSelected = addForm.selectedProductIds.includes(String(a.product_id));
        const bSelected = addForm.selectedProductIds.includes(String(b.product_id));
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return 0;
    });

    const filteredEditProducts = allProducts.filter(p => {
        const s = editProductSearch.toLowerCase();
        return (p.product_name || '').toLowerCase().includes(s);
    }).sort((a, b) => {
        const aSelected = editForm.selectedProductIds.includes(String(a.product_id));
        const bSelected = editForm.selectedProductIds.includes(String(b.product_id));
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return 0;
    });

    return (
        <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#f8fafc', flexDirection: 'column' }}>
            {/* Top Toolbar */}
            <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Purchase Orders</h2>
                        <span style={{ fontSize: '0.85rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                            {sortedOrders.length} {sortedOrders.length === 1 ? 'order' : 'orders'}
                        </span>
                    </div>
                    <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {canWrite && (
                            <button className="btn-primary" onClick={handleOpenAddModal} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Plus size={16} /> Add Order
                            </button>
                        )}
                        <button className="btn-upload white-bg" onClick={() => setShowColumnModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ListFilter size={16} /> Columns
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                            <Printer size={16} style={{ marginRight: '2px' }} /> Print List
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                            <Download size={16} style={{ marginRight: '2px' }} /> Export HTML
                        </button>
                    </div>
                </div>

                {/* Filter and Search Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Search invoice #, products, note..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '6px 12px 6px 32px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                            />
                        </div>

                        {/* Shipper Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Factory:</span>
                            <select
                                value={filterShipper}
                                onChange={(e) => setFilterShipper(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', outline: 'none', backgroundColor: 'white' }}
                            >
                                <option value="">All Factories</option>
                                {shippers.map(s => (
                                    <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>
                                ))}
                            </select>
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
                                <option value="open">Open</option>
                                <option value="processing">Processing</option>
                                <option value="close">Closed</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="table-container container-list" style={{ padding: 0, flex: 1, maxWidth: '100%' }}>
                {sortedOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                        No purchase orders found.
                    </div>
                ) : (
                    <div className="excel-table-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                        <table className="excel-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Actions</th>
                                    {visibleColumns.includes('status') && (
                                        <th className="has-sort-icon" style={{ width: '110px', minWidth: '110px', cursor: 'pointer' }} onClick={() => handleSort('status')}>
                                            <SortIcon columnKey="status" /> Status
                                        </th>
                                    )}
                                    {visibleColumns.includes('shipper') && (
                                        <th className="has-sort-icon" style={{ width: '180px', cursor: 'pointer' }} onClick={() => handleSort('shipper')}>
                                            <SortIcon columnKey="shipper" /> Factory
                                        </th>
                                    )}
                                    {visibleColumns.includes('invoice_no') && (
                                        <th className="has-sort-icon" style={{ width: '180px', cursor: 'pointer' }} onClick={() => handleSort('invoice_no')}>
                                            <SortIcon columnKey="invoice_no" /> Invoice No.
                                        </th>
                                    )}
                                    {visibleColumns.includes('payment') && (
                                        <th style={{ width: '220px' }}>Payment</th>
                                    )}
                                    {visibleColumns.includes('products') && (
                                        <th style={{ minWidth: '300px' }}>Product</th>
                                    )}
                                    {visibleColumns.includes('note') && (
                                        <th style={{ Width: '200px' }}>Note</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedOrders.map(row => (
                                    <tr key={row.order_id} style={{ opacity: row.status === 'close' ? 0.75 : 1 }}>
                                        <td style={{ textAlign: 'center' }}>
                                            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                                                {canWrite && (
                                                    <>
                                                        <button
                                                            className="action-btn"
                                                            title="Edit Order"
                                                            onClick={() => handleOpenEditModal(row)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#2563eb' }}
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            className="action-btn"
                                                            title="Delete Order"
                                                            onClick={() => handleDeleteOrder(row.order_id)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                        {visibleColumns.includes('status') && (
                                            <td><div className="readonly-cell">{getStatusBadge(row.status)}</div></td>
                                        )}
                                        {visibleColumns.includes('shipper') && (
                                            <td><div className="readonly-cell" style={{ fontWeight: 500 }}>{getShipperName(row.shipper_id)}</div></td>
                                        )}
                                        {visibleColumns.includes('invoice_no') && (
                                            <td><div className="readonly-cell">{row.invoice_no || '-'}</div></td>
                                        )}
                                        {visibleColumns.includes('payment') && (
                                            <td style={{ verticalAlign: 'middle' }}>
                                                {(() => {
                                                    const payInfo = getOrderPaymentInfo(row);
                                                    if (payInfo.totalPOValue === 0 && !payInfo.isDepositPaid) {
                                                        return <div className="readonly-cell" style={{ color: '#94a3b8' }}>-</div>;
                                                    }
                                                    return (
                                                        <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                                                                <span style={{ color: '#64748b', fontSize: '0.8rem', minWidth: '50px' }}>Deposit:</span>
                                                                {payInfo.isDepositPaid ? (
                                                                    <span style={{
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '3px',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: 600,
                                                                        color: '#15803d',
                                                                        backgroundColor: '#dcfce7',
                                                                        border: '1px solid #bbf7d0',
                                                                        padding: '1px 7px',
                                                                        borderRadius: '10px'
                                                                    }}>
                                                                        Paid
                                                                    </span>
                                                                ) : (
                                                                    <span style={{
                                                                        fontSize: '0.75rem',
                                                                        color: '#64748b',
                                                                        backgroundColor: '#f1f5f9',
                                                                        padding: '1px 7px',
                                                                        borderRadius: '10px'
                                                                    }}>
                                                                        Unpaid
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                                                                <span style={{ color: '#64748b', fontSize: '0.8rem', minWidth: '50px' }}>Balance:</span>
                                                                {payInfo.isBalanceCompleted ? (
                                                                    <span style={{
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '3px',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: 600,
                                                                        color: '#15803d',
                                                                        backgroundColor: '#dcfce7',
                                                                        border: '1px solid #bbf7d0',
                                                                        padding: '1px 7px',
                                                                        borderRadius: '10px'
                                                                    }}>
                                                                        Paid
                                                                    </span>
                                                                ) : (
                                                                    <span style={{
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: payInfo.paidBalance > 0 ? 600 : 500,
                                                                        color: payInfo.paidBalance > 0 ? '#b45309' : '#475569',
                                                                        backgroundColor: payInfo.paidBalance > 0 ? '#fef3c7' : '#f8fafc',
                                                                        border: '1px solid',
                                                                        borderColor: payInfo.paidBalance > 0 ? '#fde68a' : '#e2e8f0',
                                                                        padding: '1px 6px',
                                                                        borderRadius: '4px'
                                                                    }}>
                                                                        ${payInfo.paidBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${payInfo.totalRequiredBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                        )}
                                        {visibleColumns.includes('products') && (
                                            <td style={{ verticalAlign: 'middle' }}>
                                                <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px' }}>
                                                    {(() => {
                                                        const prods = parseOrderProducts(row.products);
                                                        if (prods.length === 0) {
                                                            return <span style={{ color: '#94a3b8' }}>-</span>;
                                                        }
                                                        return prods.map((p, pIdx) => {
                                                            const prodName = p.product_name || getProductName(p.product_id) || (p.sku ? p.sku : `Product #${p.product_id}`);
                                                            return (
                                                                <div
                                                                    key={pIdx}
                                                                    style={{
                                                                        fontSize: '0.85rem',
                                                                        color: '#1e293b',
                                                                        lineHeight: 1.35,
                                                                        wordBreak: 'break-word'
                                                                    }}
                                                                    title={prodName}
                                                                >
                                                                    {prodName}
                                                                </div>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            </td>
                                        )}
                                        {visibleColumns.includes('note') && (
                                            <td><div className="readonly-cell" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.note || ''}</div></td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* --- ADD ORDER MODAL --- */}
            {showAddModal && (
                <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', borderRadius: '8px', width: '90%', maxWidth: '850px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}>
                        {/* Modal Header */}
                        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Add Purchase Order</h3>
                            <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* 1. Select Shipper */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Select Factory <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <select
                                    className="form-control"
                                    value={addForm.shipper_id}
                                    onChange={(e) => handleAddShipperChange(e.target.value)}
                                >
                                    <option value="">-- Choose Factory --</option>
                                    {shippers.map(s => (
                                        <option key={s.shipper_id} value={s.shipper_id}>
                                            {s.shipper_name} {s.deposit ? `(Deposit: ${s.deposit}%)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* 2. Select Product (Multi-select checklist with search) */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                    Select Products ({addForm.selectedProductIds.length} selected)
                                </label>
                                <div style={{ position: 'relative', marginBottom: '8px' }}>
                                    <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        value={addProductSearch}
                                        onChange={(e) => setAddProductSearch(e.target.value)}
                                        style={{ width: '100%', padding: '6px 8px 6px 28px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                    />
                                </div>
                                <div style={{ border: '1px solid #cbd5e1', borderRadius: '4px', maxHeight: '180px', overflowY: 'auto', backgroundColor: 'white' }}>
                                    {filteredAddProducts.length === 0 ? (
                                        <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>No matching products.</div>
                                    ) : (
                                        filteredAddProducts.map(p => {
                                            const isSelected = addForm.selectedProductIds.includes(String(p.product_id));
                                            return (
                                                <div
                                                    key={p.product_id}
                                                    onClick={() => handleAddToggleProduct(p.product_id)}
                                                    style={{
                                                        padding: '8px 12px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        cursor: 'pointer',
                                                        borderBottom: '1px solid #f1f5f9',
                                                        backgroundColor: isSelected ? '#eff6ff' : 'transparent'
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => { }}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '0.85rem', color: isSelected ? '#1e40af' : '#334155', fontWeight: isSelected ? 500 : 400 }}>
                                                        {p.product_name}
                                                    </span>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* 3. Order Details Table */}
                            {addForm.selectedProductIds.length > 0 && (
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>
                                        Order Details
                                    </label>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ background: '#f1f5f9' }}>
                                                <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                                <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>Price</th>
                                                <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>SQM (Amount)</th>
                                                <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {addForm.selectedProductIds.map(id => {
                                                const details = addForm.productDetails[id] || { price: '', amount: '' };
                                                const subtotal = (parseFloat(details.price) || 0) * (parseFloat(details.amount) || 0);
                                                return (
                                                    <tr key={id}>
                                                        <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', fontWeight: 500 }}>
                                                            {getProductName(id)}
                                                        </td>
                                                        <td style={{ padding: '4px', border: '1px solid #cbd5e1' }}>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={details.price}
                                                                onChange={(e) => handleAddProductDetailChange(id, 'price', e.target.value)}
                                                                style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '3px', outline: 'none', textAlign: 'right' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '4px', border: '1px solid #cbd5e1' }}>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0"
                                                                value={details.amount}
                                                                onChange={(e) => handleAddProductDetailChange(id, 'amount', e.target.value)}
                                                                style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '3px', outline: 'none', textAlign: 'right' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600, color: '#334155' }}>
                                                            ${subtotal.toFixed(2)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                                                <td colSpan="3" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total:</td>
                                                <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', color: '#2563eb', fontSize: '0.95rem' }}>
                                                    ${calculateAddTotal().toFixed(2)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}

                            {/* 4. Payment Sub-settings */}
                            <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', marginBottom: '12px' }}>Payment Info</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569' }}>Invoice No.</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="e.g. INV-2026-001"
                                            value={addForm.invoice_no}
                                            onChange={(e) => setAddForm(prev => ({ ...prev, invoice_no: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569' }}>Deposit Amount</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="form-control"
                                            placeholder="Auto-calculated or enter manually"
                                            value={addForm.deposit_amount}
                                            onChange={(e) => setAddForm(prev => ({ ...prev, deposit_amount: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569' }}>Exchange Rate</label>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            className="form-control"
                                            placeholder="e.g. 0.65"
                                            value={addForm.deposit_exchange_rate}
                                            onChange={(e) => setAddForm(prev => ({ ...prev, deposit_exchange_rate: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 5. Note */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Note</label>
                                <textarea
                                    className="form-control"
                                    rows="3"
                                    placeholder="Enter additional remarks or order instructions..."
                                    value={addForm.note}
                                    onChange={(e) => setAddForm(prev => ({ ...prev, note: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleSaveAddOrder}>Save Order</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- EDIT ORDER MODAL (4 TABS) --- */}
            {showEditModal && (
                <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', borderRadius: '8px', width: '1200px', maxWidth: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)', padding: '15px 8px' }}>
                        {/* Modal Header */}
                        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: '400' }}>
                                Edit Order <span style={{ fontWeight: '700' }}>{editForm.invoice_no}</span>
                            </h3>
                            <button onClick={() => setShowEditModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
                        </div>

                        {/* 4 Tabs Header */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', padding: '0 24px' }}>
                            {[
                                { id: 'info', label: 'Info' },
                                { id: 'shipment', label: `Shipment (${editForm.shippingOrders.length})` },
                                { id: 'payment', label: 'Payment' },
                                { id: 'products', label: 'Products' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setEditActiveTab(tab.id)}
                                    style={{
                                        padding: '12px 18px',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        fontSize: '0.9rem',
                                        letterSpacing: '0.5px',
                                        color: editActiveTab === tab.id ? '#2563eb' : '#64748b',
                                        borderBottom: editActiveTab === tab.id ? '2px solid #2563eb' : '2px solid transparent'
                                    }}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
                            {/* TAB 1: INFO */}
                            {editActiveTab === 'info' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        {/* Invoice No */}
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Invoice No.</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={editForm.invoice_no}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, invoice_no: e.target.value }))}
                                            />
                                        </div>

                                        {/* Shipper */}
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Factory</label>
                                            <select
                                                className="form-control"
                                                value={editForm.shipper_id}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, shipper_id: e.target.value }))}
                                            >
                                                <option value="">-- Choose Factory --</option>
                                                {shippers.map(s => (
                                                    <option key={s.shipper_id} value={s.shipper_id}>{s.shipper_name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Status */}
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Status</label>
                                        <select
                                            className="form-control"
                                            value={editForm.status}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                                            style={{ maxWidth: '200px' }}
                                        >
                                            <option value="open">open</option>
                                            <option value="processing">processing</option>
                                            <option value="close">close</option>
                                        </select>
                                    </div>

                                    {/* Order Details Table */}
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                            <label style={{ margin: 0, fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Order Details</label>
                                        </div>
                                        {editForm.selectedProductIds.length === 0 ? (
                                            <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '4px' }}>
                                                No products assigned to this order.
                                            </div>
                                        ) : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                <thead>
                                                    <tr style={{ background: '#f1f5f9' }}>
                                                        <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                                        <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>Price</th>
                                                        <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>SQM (Amount)</th>
                                                        <th style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', width: '120px' }}>Subtotal</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {editForm.selectedProductIds.map(id => {
                                                        const details = editForm.productDetails[id] || { price: '', amount: '' };
                                                        const subtotal = (parseFloat(details.price) || 0) * (parseFloat(details.amount) || 0);
                                                        return (
                                                            <tr key={id}>
                                                                <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', fontWeight: 500 }}>
                                                                    {getProductName(id)}
                                                                </td>
                                                                <td style={{ padding: '4px', border: '1px solid #cbd5e1' }}>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={details.price}
                                                                        onChange={(e) => handleEditProductDetailChange(id, 'price', e.target.value)}
                                                                        style={{ width: '100%', padding: '6px', borderWidth: '0', borderRadius: '3px', outline: 'none', textAlign: 'right' }}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '4px', border: '1px solid #cbd5e1' }}>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={details.amount}
                                                                        onChange={(e) => handleEditProductDetailChange(id, 'amount', e.target.value)}
                                                                        style={{ width: '100%', padding: '6px', borderWidth: '0', borderRadius: '3px', outline: 'none', textAlign: 'right' }}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600, color: '#334155' }}>
                                                                    ${subtotal.toFixed(2)}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                                <tfoot>
                                                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                                                        <td colSpan="3" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total:</td>
                                                        <td style={{ padding: '8px 10px', border: '1px solid #cbd5e1', textAlign: 'right', color: '#2563eb', fontSize: '0.95rem' }}>
                                                            ${calculateEditTotal().toFixed(2)}
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        )}
                                    </div>

                                    {/* Note */}
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '0.9rem', color: '#475569' }}>Note</label>
                                        <textarea
                                            className="form-control"
                                            rows="3"
                                            value={editForm.note}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, note: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: SHIPMENT (Repeater Field Group) */}
                            {editActiveTab === 'shipment' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                                            Shipping Orders ({editForm.shippingOrders.length})
                                        </div>
                                        <button
                                            className="btn-upload white-bg"
                                            onClick={handleAddShippingOrderRow}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.85rem' }}
                                        >
                                            <Plus size={14} /> Add Shipping Order
                                        </button>
                                    </div>

                                    {editForm.shippingOrders.length === 0 ? (
                                        <div style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                                            No shipping orders created yet. Click "+ Add Shipping Order" to create one.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                            {editForm.shippingOrders.map((item, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        padding: '16px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #e2e8f0',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '12px'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                                                            Shipment #{idx + 1}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveShippingOrderRow(idx)}
                                                            title="Remove Shipment"
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                                        {/* 1. HBL No. */}
                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569' }}>HBL No.</label>
                                                            <input
                                                                type="text"
                                                                className="form-control"
                                                                placeholder="e.g. HBL987654321"
                                                                value={item.hbl_no}
                                                                onChange={(e) => handleUpdateShippingOrderRow(idx, 'hbl_no', e.target.value)}
                                                            />
                                                        </div>

                                                        {/* 2. Estimated Date */}
                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569' }}>Estimated Date</label>
                                                            <input
                                                                type="date"
                                                                className="form-control"
                                                                value={item.est_date}
                                                                onChange={(e) => handleUpdateShippingOrderRow(idx, 'est_date', e.target.value)}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* 3. Read-only Container Info Area with 3-column table */}
                                                    {(() => {
                                                        const shipmentCobs = item.shipping_order_id
                                                            ? containerOrderBatches.filter(cob => cob.shipping_order_id === item.shipping_order_id)
                                                            : [];

                                                        if (shipmentCobs.length === 0) {
                                                            return (
                                                                <div style={{ padding: '10px 12px', backgroundColor: '#f1f5f9', borderRadius: '4px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <Box size={16} color="#64748b" />
                                                                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                                                        Container: (Pending container assignment)
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderWidth: '0', overflow: 'hidden' }}>
                                                                    <thead>
                                                                        <tr style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.8rem' }}>
                                                                            <th style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'left' }}>Container No.</th>
                                                                            <th style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'left' }}>Product Name</th>
                                                                            <th style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'right', width: '110px' }}>SQM</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {shipmentCobs.map((cRow, cIdx) => (
                                                                            <tr key={cIdx} style={{ backgroundColor: cIdx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                                                                <td style={{ padding: '6px 10px', border: '1px solid #e2e8f0', fontWeight: 600, color: '#0f172a' }}>
                                                                                    {cRow.cntr_no || `#${cRow.container_id}`}
                                                                                </td>
                                                                                <td style={{ padding: '6px 10px', border: '1px solid #e2e8f0', color: '#334155' }}>
                                                                                    {cRow.product_name || cRow.description || cRow.sku || '-'}
                                                                                </td>
                                                                                <td style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 500, color: '#1e293b' }}>
                                                                                    {cRow.amount != null ? Number(cRow.amount).toFixed(2) : '-'}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                    <tfoot>
                                                                        <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                                                                            <td colSpan="2" style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'right', color: '#475569' }}>Total SQM:</td>
                                                                            <td style={{ padding: '6px 10px', border: '1px solid #e2e8f0', textAlign: 'right', color: '#2563eb' }}>
                                                                                {shipmentCobs.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(2)}
                                                                            </td>
                                                                        </tr>
                                                                    </tfoot>
                                                                </table>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TAB 3: PAYMENT */}
                            {editActiveTab === 'payment' && (() => {
                                // 1. Calculate financial metrics
                                let totalPOValue = 0;
                                let unshippedPOValue = 0;

                                const productSummaries = editForm.selectedProductIds.map(id => {
                                    const ordered = parseFloat(editForm.productDetails[id]?.amount) || 0;
                                    const price = parseFloat(editForm.productDetails[id]?.price) || 0;
                                    const subtotal = ordered * price;
                                    totalPOValue += subtotal;

                                    const cobs = containerOrderBatches.filter(cob => String(cob.product_id) === String(id));
                                    const arrived = cobs.filter(cob => isContainerDelivered(cob.delivery, cob.warehouse_received)).reduce((sum, cob) => sum + (parseFloat(cob.amount) || 0), 0);
                                    const shipping = cobs.filter(cob => !isContainerDelivered(cob.delivery, cob.warehouse_received)).reduce((sum, cob) => sum + (parseFloat(cob.amount) || 0), 0);
                                    const remain = Math.max(0, ordered - (arrived + shipping));
                                    const unshippedVal = remain * price;
                                    unshippedPOValue += unshippedVal;

                                    return {
                                        id,
                                        name: getProductName(id),
                                        ordered,
                                        price,
                                        subtotal,
                                        arrived,
                                        shipping,
                                        remain
                                    };
                                });

                                const paidDeposit = parseFloat(editForm.deposit_amount) || 0;
                                const paidBalanceTotal = orderBatches.reduce((sum, b) => sum + (parseFloat(b.balance) || 0), 0);
                                const totalRequiredBalance = Math.max(0, totalPOValue - paidDeposit);
                                const totalUnpaidBalance = Math.max(0, totalRequiredBalance - paidBalanceTotal);

                                // Calculate used deposit across existing shipments
                                let totalShippedValue = 0;
                                containerOrderBatches.forEach(cob => {
                                    const price = parseFloat(editForm.productDetails[cob.product_id]?.price) || 0;
                                    const amount = parseFloat(cob.amount) || 0;
                                    totalShippedValue += amount * price;
                                });

                                let usedDeposit = 0;
                                if (totalPOValue > 0 && paidDeposit > 0) {
                                    usedDeposit = (totalShippedValue / totalPOValue) * paidDeposit;
                                    if (usedDeposit > paidDeposit) {
                                        usedDeposit = paidDeposit;
                                    }
                                }

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        {/* 1. Overview Area (Read-only) */}
                                        <div style={{ backgroundColor: '#ffffff', paddingBottom: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase', color: '#0f172a' }}>
                                                    Overview(USD)
                                                </div>
                                            </div>

                                            {/* KPI Metric Cards */}
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                                                <div style={{ backgroundColor: '#f8fafc', padding: '12px 14px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Total Value</div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>${totalPOValue.toFixed(2)}</div>
                                                </div>
                                                <div style={{ backgroundColor: '#eff6ff', padding: '12px 14px', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#1e40af', marginBottom: '4px' }}>Deposit</div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: paidDeposit > 0 ? '#1d4ed8' : '#94a3b8' }}>
                                                        {paidDeposit > 0 ? `$${usedDeposit.toFixed(2)} / $${paidDeposit.toFixed(2)}` : 'unpaid'}
                                                    </div>
                                                </div>
                                                <div style={{ backgroundColor: '#f0fdf4', padding: '12px 14px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#166534', marginBottom: '4px' }}>Balance</div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#15803d' }}>
                                                        ${paidBalanceTotal.toFixed(2)} / ${totalRequiredBalance.toFixed(2)}
                                                    </div>
                                                </div>
                                                <div style={{ backgroundColor: '#fff1f2', padding: '12px 14px', borderRadius: '6px', border: '1px solid #fecdd3' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#9f1239', marginBottom: '4px' }}>Total Unpaid Balance</div>
                                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#be123c' }}>${totalUnpaidBalance.toFixed(2)}</div>
                                                </div>
                                            </div>

                                            {/* Products Breakdown Table */}
                                            {productSummaries.length > 0 && (
                                                <div style={{ marginTop: '4px' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                                                        <thead>
                                                            <tr style={{ color: '#475569' }}>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Product Name</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e2e8f0', width: '100px' }}>Quantity</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e2e8f0', width: '100px' }}>Unit Price</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #e2e8f0', width: '110px' }}>Subtotal</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {productSummaries.map((p, idx) => (
                                                                <tr key={p.id} style={{ borderBottom: idx < productSummaries.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                                                                    <td style={{ padding: '6px 10px', fontWeight: 500, color: '#1e293b' }}>{p.name}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#475569' }}>{p.ordered.toFixed(2)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#475569' }}>${p.price.toFixed(2)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>${p.subtotal.toFixed(2)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        {/* 2. PO Level Deposit Settings */}
                                        <div style={{ backgroundColor: '#ffffff', paddingBottom: '18px' }}>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase', color: '#0f172a', marginBottom: '12px' }}>
                                                Deposit
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569', fontWeight: 500 }}>
                                                        Deposit Amount ($)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="form-control"
                                                        placeholder="e.g. 5000.00"
                                                        value={editForm.deposit_amount}
                                                        onChange={(e) => setEditForm(prev => ({ ...prev, deposit_amount: e.target.value }))}
                                                    />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#475569', fontWeight: 500 }}>
                                                        Deposit Transfer / Exchange Rate
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        className="form-control"
                                                        placeholder="e.g. 0.65"
                                                        value={editForm.deposit_exchange_rate}
                                                        onChange={(e) => setEditForm(prev => ({ ...prev, deposit_exchange_rate: e.target.value }))}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* 3. Backorder Batches Payment Section */}
                                        <div style={{ backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase', color: '#0f172a' }}>
                                                    Balance ({orderBatches.length})
                                                </div>
                                            </div>

                                            {orderBatches.length === 0 ? (
                                                <div style={{ padding: '28px 20px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '6px', backgroundColor: '#f8fafc', fontSize: '0.85rem' }}>
                                                    No backorder batches currently associated with this purchase order. Use the dropdown above to link an unassigned batch or add shipments.
                                                </div>
                                            ) : (
                                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                        <thead>
                                                            <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                                                                <th style={{ padding: '8px 10px', textAlign: 'left' }}>SKU</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Product / Desc</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '160px' }}>Containers & Status</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>Balance ($)</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>Transfer Rate</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'center', width: '125px' }}>Paid Date</th>
                                                                <th style={{ padding: '8px 10px', textAlign: 'center', width: '60px' }}>Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {orderBatches.map((b, idx) => {
                                                                const relatedCobs = containerOrderBatches.filter(cob => cob.order_batch_id === b.order_batch_id);
                                                                return (
                                                                    <tr key={b.order_batch_id} style={{ borderBottom: idx < orderBatches.length - 1 ? '1px solid #f1f5f9' : 'none', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                                                                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                                                                            {b.sku}
                                                                        </td>
                                                                        <td style={{ padding: '8px 10px', color: '#334155' }}>
                                                                            {b.product_name || b.description || '-'}
                                                                        </td>
                                                                        <td style={{ padding: '8px 10px' }}>
                                                                            {relatedCobs.length === 0 ? (
                                                                                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', padding: '2px 6px', backgroundColor: '#f1f5f9', borderRadius: '4px' }}>
                                                                                    Pending container
                                                                                </span>
                                                                            ) : (
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                    {relatedCobs.map((cItem, cIdx) => {
                                                                                        const isDelivered = isContainerDelivered(cItem.delivery, cItem.warehouse_received);
                                                                                        return (
                                                                                            <span
                                                                                                key={cIdx}
                                                                                                style={{
                                                                                                    fontSize: '0.75rem',
                                                                                                    fontWeight: 500,
                                                                                                    padding: '2px 6px',
                                                                                                    borderRadius: '4px',
                                                                                                    backgroundColor: isDelivered ? '#dcfce7' : '#e0f2fe',
                                                                                                    color: isDelivered ? '#166534' : '#0369a1',
                                                                                                    display: 'inline-flex',
                                                                                                    alignItems: 'center',
                                                                                                    gap: '4px',
                                                                                                    width: 'fit-content'
                                                                                                }}
                                                                                            >
                                                                                                {cItem.cntr_no || `#${cItem.container_id}`} ({isDelivered ? 'Delivered' : 'Delivering'}{cItem.amount ? ` - ${cItem.amount} SQM` : ''})
                                                                                            </span>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                        <td style={{ padding: '4px 6px' }}>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: '3px', textAlign: 'right', fontSize: '0.85rem' }}
                                                                                value={b.balance ?? ''}
                                                                                placeholder="0.00"
                                                                                onChange={(e) => handleBatchFieldChange(b.order_batch_id, 'balance', e.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '4px 6px' }}>
                                                                            <input
                                                                                type="number"
                                                                                step="0.0001"
                                                                                style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: '3px', textAlign: 'right', fontSize: '0.85rem' }}
                                                                                value={b.balance_exchange_rate ?? ''}
                                                                                placeholder="e.g. 0.65"
                                                                                onChange={(e) => handleBatchFieldChange(b.order_batch_id, 'balance_exchange_rate', e.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '4px 6px' }}>
                                                                            <input
                                                                                type="date"
                                                                                style={{ width: '100%', padding: '5px 6px', border: '1px solid #cbd5e1', borderRadius: '3px', fontSize: '0.8rem' }}
                                                                                value={b.balance_paid_date ?? ''}
                                                                                onChange={(e) => handleBatchFieldChange(b.order_batch_id, 'balance_paid_date', e.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUnlinkBatch(b.order_batch_id)}
                                                                                title="Unlink Batch from Order"
                                                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444', padding: '4px' }}
                                                                            >
                                                                                <Unlink size={16} />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}

                                            {/* Associate Unassigned Batch Inline */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <select
                                                    value={selectedUnassignedBatchId}
                                                    onChange={(e) => setSelectedUnassignedBatchId(e.target.value)}
                                                    style={{ padding: '5px 10px', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '4px', maxWidth: '320px', backgroundColor: 'white' }}
                                                >
                                                    <option value="">-- Link Unassigned Batch --</option>
                                                    {unassignedBatches.map(b => (
                                                        <option key={b.order_batch_id} value={b.order_batch_id}>
                                                            {b.sku} - {b.product_name || b.description || 'No desc'} ({b.amount != null ? b.amount : 0} SQM)
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    className="btn-upload white-bg"
                                                    onClick={handleLinkUnassignedBatch}
                                                    disabled={!selectedUnassignedBatchId}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '0.85rem', cursor: selectedUnassignedBatchId ? 'pointer' : 'not-allowed', opacity: selectedUnassignedBatchId ? 1 : 0.6 }}
                                                >
                                                    <Plus size={14} /> Link Batch
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* TAB 4: PRODUCTS */}
                            {editActiveTab === 'products' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                                            Product Fulfillment & Shipping Progress
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            Tracking across {editForm.shippingOrders.length} shipments
                                        </div>
                                    </div>

                                    {editForm.selectedProductIds.length === 0 ? (
                                        <div style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
                                            No products assigned to this purchase order. Add products in the Info tab first.
                                        </div>
                                    ) : (
                                        (() => {
                                            let totalOrdered = 0;
                                            let totalArrived = 0;
                                            let totalShipping = 0;
                                            let totalRemain = 0;

                                            const rows = editForm.selectedProductIds.map(id => {
                                                const ordered = parseFloat(editForm.productDetails[id]?.amount) || 0;
                                                const cobs = containerOrderBatches.filter(cob => String(cob.product_id) === String(id));
                                                const arrived = cobs.filter(cob => isContainerDelivered(cob.delivery, cob.warehouse_received)).reduce((sum, cob) => sum + (parseFloat(cob.amount) || 0), 0);
                                                const shipping = cobs.filter(cob => !isContainerDelivered(cob.delivery, cob.warehouse_received)).reduce((sum, cob) => sum + (parseFloat(cob.amount) || 0), 0);
                                                const remain = Math.max(0, ordered - (arrived + shipping));

                                                totalOrdered += ordered;
                                                totalArrived += arrived;
                                                totalShipping += shipping;
                                                totalRemain += remain;

                                                return {
                                                    id,
                                                    name: getProductName(id),
                                                    ordered,
                                                    arrived,
                                                    shipping,
                                                    remain
                                                };
                                            });

                                            return (
                                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'white' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                        <thead>
                                                            <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                                                                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product Name</th>
                                                                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, width: '120px' }}>Ordered</th>
                                                                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, width: '120px' }}>Arrived</th>
                                                                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, width: '120px' }}>Shipping</th>
                                                                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, width: '120px' }}>Remain</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rows.map((r, idx) => (
                                                                <tr key={r.id} style={{ borderBottom: idx < rows.length - 1 ? '1px solid #f1f5f9' : 'none', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                                                                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                                                                        {r.name}
                                                                    </td>
                                                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#334155' }}>
                                                                        {r.ordered.toFixed(2)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>
                                                                        {r.arrived.toFixed(2)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>
                                                                        {r.shipping.toFixed(2)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: r.remain > 0 ? '#d97706' : '#64748b' }}>
                                                                        {r.remain.toFixed(2)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>
                                                                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#475569' }}>Total:</td>
                                                                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0f172a' }}>{totalOrdered.toFixed(2)}</td>
                                                                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#16a34a' }}>{totalArrived.toFixed(2)}</td>
                                                                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#2563eb' }}>{totalShipping.toFixed(2)}</td>
                                                                <td style={{ padding: '10px 14px', textAlign: 'right', color: totalRemain > 0 ? '#d97706' : '#64748b' }}>{totalRemain.toFixed(2)}</td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            );
                                        })()
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleSaveEditOrder}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- COLUMN CUSTOMIZATION MODAL --- */}
            {showColumnModal && (
                <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', width: '360px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Visible Columns</h3>
                            <button onClick={() => setShowColumnModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                { id: 'status', label: 'Status' },
                                { id: 'shipper', label: 'Factory' },
                                { id: 'invoice_no', label: 'Invoice No.' },
                                { id: 'payment', label: 'Payment' },
                                { id: 'products', label: 'Products' },
                                { id: 'note', label: 'Note' }
                            ].map(col => (
                                <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.includes(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                    />
                                    {col.label}
                                </label>
                            ))}
                        </div>
                        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn-primary" onClick={() => setShowColumnModal(false)} style={{ padding: '6px 14px' }}>Done</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

