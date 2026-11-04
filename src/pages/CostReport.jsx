import { useState, useEffect } from 'react';
import { getDb, getSetting } from '../db/Database';
import { Plus, Search, Trash2, RefreshCw, Printer, Download } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Reports.css';

export default function CostReport({ currentUser, isActive }) {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedReportId, setSelectedReportId] = useState(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [allPurchaseOrders, setAllPurchaseOrders] = useState([]);
    const [addForm, setAddForm] = useState({ order_id: '', name: '' });
    const [orderSearch, setOrderSearch] = useState('');

    const [reportData, setReportData] = useState(null);
    const [expandedShippers, setExpandedShippers] = useState({});

    const toggleShipperExpand = (shipper) => {
        setExpandedShippers(prev => ({ ...prev, [shipper]: !prev[shipper] }));
    };

    const canWrite = currentUser?.permissions?.costReport?.write || currentUser?.permissions?.admin;

    useEffect(() => {
        if (isActive) {
            loadReports();
        }
    }, [isActive]);

    const loadReports = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const res = await db.select(`
                SELECT cr.*, 
                       COALESCE(po.invoice_no, s.invoice_no) as invoice_no, 
                       COALESCE(shp_po.shipper_name, shp.shipper_name, 'Unknown Shipper') as shipper_name 
                FROM cost_reports cr
                LEFT JOIN purchase_orders po ON cr.order_id = po.order_id
                LEFT JOIN shippers shp_po ON po.shipper_id = shp_po.shipper_id
                LEFT JOIN shipments s ON cr.shipment_id = s.shipment_id
                LEFT JOIN shippers shp ON s.shipper = shp.shipper_id
                ORDER BY shipper_name ASC, cr.created_at DESC
            `);
            setReports(res);
        } catch (e) {
            console.error('Failed to load cost reports', e);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenAddModal = async () => {
        try {
            const db = await getDb();
            const orders = await db.select(`
                SELECT po.order_id, po.invoice_no, shp.shipper_name 
                FROM purchase_orders po 
                LEFT JOIN shippers shp ON po.shipper_id = shp.shipper_id 
                ORDER BY shp.shipper_name ASC, po.invoice_no ASC
            `);
            setAllPurchaseOrders(orders);
            setAddForm({ order_id: '', name: '' });
            setOrderSearch('');
            setShowAddModal(true);
        } catch (e) {
            console.error(e);
        }
    };

    const handleCreateReport = async () => {
        if (!addForm.order_id || !addForm.name) {
            alert("Please select a purchase order and enter a name.");
            return;
        }
        try {
            const data = await generatePurchaseOrderReportData(addForm.order_id);
            const db = await getDb();
            const res = await db.execute(
                'INSERT INTO cost_reports (name, order_id, data, created_at) VALUES ($1, $2, $3, $4)',
                [addForm.name, addForm.order_id, JSON.stringify(data), new Date().toISOString()]
            );
            setShowAddModal(false);
            loadReports();
            if (res.lastInsertId) {
                handleSelectReport(res.lastInsertId);
            }
        } catch (e) {
            console.error('Failed to create report', e);
            alert("Failed to create report");
        }
    };

    /**
     * Generates report data based on Purchase Order (new data model).
     */
    const generatePurchaseOrderReportData = async (orderId) => {
        const db = await getDb();
        const orderRows = await db.select('SELECT * FROM purchase_orders WHERE order_id = $1', [orderId]);
        if (orderRows.length === 0) throw new Error("Purchase order not found");
        const po = orderRows[0];

        const shipperRows = await db.select('SELECT * FROM shippers WHERE shipper_id = $1', [po.shipper_id]);
        const shipper = shipperRows[0] || {};

        let poProducts = [];
        try {
            if (po.products && typeof po.products === 'string') {
                poProducts = JSON.parse(po.products);
            } else if (Array.isArray(po.products)) {
                poProducts = po.products;
            }
        } catch (e) {
            console.error("Failed to parse po.products", e);
        }

        // Global settings
        let storageFee = await getSetting('storage_fee', '0');
        storageFee = parseFloat(storageFee) || 0;

        let defaultUsdAudRate = await getSetting('default_usd_aud_rate', '1');
        defaultUsdAudRate = parseFloat(defaultUsdAudRate) || 1;

        const poDepositRate = parseFloat(po.deposit_exchange_rate) || defaultUsdAudRate;
        const poDutyPercent = parseFloat(shipper.duty) || 0;

        // Calculate PO total USD value to determine actual deposit percentage
        const poTotalValueUsd = poProducts.reduce((sum, p) => sum + (parseFloat(p.price) || 0) * (parseFloat(p.amount) || 0), 0);
        let depositPercent = parseFloat(shipper.deposit) || 0;
        const poDepositAmount = parseFloat(po.deposit_amount) || 0;
        if (poDepositAmount > 0 && poTotalValueUsd > 0) {
            depositPercent = (poDepositAmount / poTotalValueUsd) * 100;
        }

        // Load related Shipping Orders & Batches for this PO
        const shippingOrders = await db.select('SELECT * FROM shipping_order WHERE order_id = $1', [orderId]);
        const shippingOrderIds = new Set(shippingOrders.map(so => so.shipping_order_id));

        const orderBatches = await db.select('SELECT * FROM order_batch WHERE order_id = $1', [orderId]);
        const orderBatchIds = new Set(orderBatches.map(ob => ob.order_batch_id));

        // Load all auxiliary tables
        const allContainers = await db.select('SELECT * FROM containers');
        const oceanShippers = await db.select('SELECT * FROM ocean_shippers');
        const allBatches = await db.select('SELECT order_batch_id, product_id, sku, description, balance_exchange_rate, order_id FROM order_batch');
        const allBatchesMap = {};
        allBatches.forEach(b => { allBatchesMap[b.order_batch_id] = b; });

        const allSOs = await db.select('SELECT shipping_order_id, order_id, hbl_no FROM shipping_order');
        const allSOsMap = {};
        allSOs.forEach(so => { allSOsMap[so.shipping_order_id] = so; });

        const allPOs = await db.select('SELECT order_id, products, shipper_id, deposit_exchange_rate FROM purchase_orders');
        const allPOsMap = {};
        allPOs.forEach(p => {
            try { p.parsedProducts = JSON.parse(p.products); } catch (e) { p.parsedProducts = []; }
            allPOsMap[p.order_id] = p;
        });

        // Identify linked containers and blocks
        const linkedContainers = [];
        const allHbls = new Set();

        for (const c of allContainers) {
            let blocks = [];
            try {
                if (c.shipping_order_detail) {
                    blocks = typeof c.shipping_order_detail === 'string'
                        ? JSON.parse(c.shipping_order_detail)
                        : c.shipping_order_detail;
                }
            } catch (e) { }

            if (!Array.isArray(blocks) || blocks.length === 0) continue;

            // Check if any block belongs to this PO
            const hasCurrentOrder = blocks.some(b => {
                if (b.shipping_order_id && shippingOrderIds.has(Number(b.shipping_order_id))) return true;
                if (b.shipping_order_id && allSOsMap[b.shipping_order_id]?.order_id === orderId) return true;
                if (b.products && Array.isArray(b.products)) {
                    return b.products.some(p => {
                        if (p.order_batch_id && orderBatchIds.has(Number(p.order_batch_id))) return true;
                        if (p.order_batch_id && allBatchesMap[p.order_batch_id]?.order_id === orderId) return true;
                        return false;
                    });
                }
                return false;
            });

            if (hasCurrentOrder) {
                linkedContainers.push({ c, blocks });
                blocks.forEach(b => {
                    const isCur = (b.shipping_order_id && shippingOrderIds.has(Number(b.shipping_order_id)))
                        || (b.shipping_order_id && allSOsMap[b.shipping_order_id]?.order_id === orderId);
                    if (isCur && b.hbl_no) {
                        b.hbl_no.split(',').map(s => s.trim()).filter(Boolean).forEach(h => allHbls.add(h));
                    }
                });
            }
        }

        const reportData = {
            isPurchaseOrder: true,
            order: {
                order_id: po.order_id,
                invoice_no: po.invoice_no,
                shipper_name: shipper.shipper_name || 'Unknown Shipper',
                deposit_percent: depositPercent,
                deposit_rate: poDepositRate,
                duty_percent: poDutyPercent,
                hbls: Array.from(allHbls).join(', '),
                containers: linkedContainers.map(lc => lc.c.cntr_no || `#${lc.c.container_id}`).filter(Boolean).join(', '),
                products: poProducts.map(p => `${p.product_name} ($${p.price})`).join(', ')
            },
            containerAllocations: [],
            purchasePrices: [],
            finalCosts: [],
            summaryCosts: []
        };

        // Helper to match FOB price from PO products
        const findProductPrice = (ob, targetPoProducts) => {
            if (!Array.isArray(targetPoProducts) || targetPoProducts.length === 0) return { price: 0, product_name: '' };
            if (ob && ob.product_id) {
                const found = targetPoProducts.find(p => String(p.product_id) === String(ob.product_id));
                if (found) return found;
            }
            if (ob && ob.sku) {
                const lowerSku = ob.sku.toLowerCase();
                const found = targetPoProducts.find(p => p.product_name && p.product_name.toLowerCase().includes(lowerSku));
                if (found) return found;
            }
            if (ob && ob.description) {
                const lowerDesc = ob.description.toLowerCase();
                const found = targetPoProducts.find(p => p.product_name && lowerDesc.includes(p.product_name.toLowerCase()));
                if (found) return found;
            }
            if (targetPoProducts.length === 1) {
                return targetPoProducts[0];
            }
            return { price: 0, product_name: ob?.description || ob?.sku || '' };
        };

        // Process each linked container
        for (const { c, blocks } of linkedContainers) {
            const containerHbls = new Set();
            blocks.forEach(b => {
                if (b.hbl_no) {
                    b.hbl_no.split(',').map(s => s.trim()).filter(Boolean).forEach(h => containerHbls.add(h));
                }
            });
            const containerHblsCount = Math.max(1, containerHbls.size);

            const freightCostUsd = parseFloat(c.freight_cost) || 0;
            const freightCostAud = freightCostUsd / defaultUsdAudRate;

            let currentOrderAddCostUsd = 0;
            let totalContainerValueAud = 0;

            // First pass: compute total container value for duty calculation
            blocks.forEach(b => {
                const bSo = allSOsMap[b.shipping_order_id];
                const bOrderId = bSo?.order_id;
                const bPo = allPOsMap[bOrderId];
                const bPoProds = bOrderId === orderId ? poProducts : (bPo?.parsedProducts || []);
                const bExRate = parseFloat(bPo?.deposit_exchange_rate) || defaultUsdAudRate;

                const isCurrentOrderBlock = bOrderId === orderId || (b.shipping_order_id && shippingOrderIds.has(Number(b.shipping_order_id)));
                if (isCurrentOrderBlock && b.additional_cost) {
                    currentOrderAddCostUsd += parseFloat(b.additional_cost) || 0;
                }

                if (b.products && Array.isArray(b.products)) {
                    b.products.forEach(p => {
                        const ob = allBatchesMap[p.order_batch_id];
                        const matched = findProductPrice(ob, bPoProds);
                        const sqm = parseFloat(p.amount) || 0;
                        const usdVal = sqm * (parseFloat(matched.price) || 0);
                        totalContainerValueAud += usdVal / bExRate;
                    });
                }
            });

            const dutyCost = totalContainerValueAud * (poDutyPercent / 100);
            const currentOrderAddCostAud = currentOrderAddCostUsd / defaultUsdAudRate;

            const logisticsCosts = [
                { name: 'Freight', charge_type: 'CTNR', rate: freightCostUsd, exRate: defaultUsdAudRate, amount: freightCostAud },
                { name: 'Duty', charge_type: 'CTNR', rate: null, exRate: null, amount: dutyCost }
            ];

            if (currentOrderAddCostAud > 0) {
                logisticsCosts.push({
                    name: 'Additional Cost',
                    charge_type: 'HBL',
                    rate: currentOrderAddCostUsd,
                    exRate: defaultUsdAudRate,
                    amount: currentOrderAddCostAud
                });
            }

            let forwarder = oceanShippers.find(os => os.ocean_shipper_id && c.ocean_shipper && String(os.ocean_shipper_id) === String(c.ocean_shipper));
            let otherTotal = 0;
            if (forwarder && forwarder.extra_charges) {
                try {
                    const extra = JSON.parse(forwarder.extra_charges);
                    extra.forEach(ex => {
                        const rate = parseFloat(ex.price) || 0;
                        const amtUsd = ex.type === 'HBL' ? rate * Math.max(1, containerHblsCount) : rate;
                        const amtAud = amtUsd / defaultUsdAudRate;
                        logisticsCosts.push({ name: ex.service_name, charge_type: ex.type, rate: amtUsd, exRate: defaultUsdAudRate, amount: amtAud });
                        otherTotal += amtAud;
                    });
                } catch (e) { }
            }

            const totalLogistics = logisticsCosts.reduce((sum, item) => sum + item.amount, 0);

            // Weight allocations
            let totalWeight = 0;
            let currentOrderWeight = 0;
            const productAllocations = [];

            blocks.forEach(b => {
                const bSo = allSOsMap[b.shipping_order_id];
                const bOrderId = bSo?.order_id;
                const isCurrentOrderBlock = bOrderId === orderId || (b.shipping_order_id && shippingOrderIds.has(Number(b.shipping_order_id)));

                if (b.products && Array.isArray(b.products)) {
                    b.products.forEach(p => {
                        const ob = allBatchesMap[p.order_batch_id];
                        const isCurrent = isCurrentOrderBlock || (ob && ob.order_id === orderId) || (p.order_batch_id && orderBatchIds.has(Number(p.order_batch_id)));

                        const matched = findProductPrice(ob, poProducts);
                        const w = parseFloat(p.weight) || 0;
                        const s = parseFloat(p.amount) || 0;
                        totalWeight += w;
                        if (isCurrent) {
                            currentOrderWeight += w;
                        }

                        productAllocations.push({
                            hbl: b.hbl_no || '',
                            order_batch_id: p.order_batch_id,
                            product_id: matched.product_id || ob?.product_id,
                            sku: ob?.sku || '',
                            name: matched.product_name || p.batch_label || ob?.description || `Batch #${p.order_batch_id}`,
                            sqm: s,
                            weight: w,
                            isCurrentShipment: isCurrent,
                            ob
                        });
                    });
                }
            });

            productAllocations.forEach(p => {
                p.percentage = totalWeight > 0 ? (p.weight / totalWeight) : 0;
                p.duty = dutyCost * p.percentage;
                p.freight = freightCostAud * p.percentage;
                p.others = otherTotal * p.percentage;
                p.addition = 0;
                if (p.isCurrentShipment && currentOrderWeight > 0) {
                    p.addition = currentOrderAddCostAud * (p.weight / currentOrderWeight);
                }
                p.total = p.duty + p.freight + p.others + p.addition;
            });

            reportData.containerAllocations.push({
                container_no: c.cntr_no || 'Unknown',
                logisticsCosts,
                totalLogistics,
                productAllocations
            });

            // Purchase Price & Landed Costs for current order products in this container
            productAllocations.filter(p => p.isCurrentShipment).forEach(p => {
                const matched = findProductPrice(p.ob, poProducts);
                const sqmPrice = parseFloat(matched.price) || 0;

                const depositUsd = sqmPrice * (depositPercent / 100);
                const balanceUsd = sqmPrice * ((100 - depositPercent) / 100);

                const ob = p.ob;
                const balRate = (ob && parseFloat(ob.balance_exchange_rate)) || poDepositRate;

                const audAmount = (depositUsd / poDepositRate) + (balanceUsd / balRate);

                reportData.purchasePrices.push({
                    container_no: c.cntr_no || 'Unknown',
                    order_batch_id: p.order_batch_id,
                    sku: p.sku,
                    name: p.name,
                    sqm: p.sqm,
                    deposit_usd: depositUsd,
                    deposit_percent: depositPercent,
                    deposit_rate: poDepositRate,
                    balance_usd: balanceUsd,
                    balance_percent: 100 - depositPercent,
                    balance_rate: balRate,
                    aud_amount: audAmount
                });

                const shipmentCostPerSqm = p.sqm > 0 ? (p.total / p.sqm) : 0;
                const totalLandedPerSqm = audAmount + shipmentCostPerSqm + storageFee;

                reportData.finalCosts.push({
                    container_no: c.cntr_no || 'Unknown',
                    order_batch_id: p.order_batch_id,
                    product_id: p.product_id,
                    sku: p.sku,
                    name: p.name,
                    sqm: p.sqm,
                    purchase: audAmount,
                    shipment_sqm: shipmentCostPerSqm,
                    storage: storageFee,
                    total: totalLandedPerSqm
                });
            });
        }

        // Summary Table: Weighted Average Landed Costs across all containers for this PO
        const summaryMap = {};
        reportData.finalCosts.forEach(fc => {
            const key = fc.product_id ? String(fc.product_id) : (fc.sku || fc.name);
            if (!summaryMap[key]) {
                summaryMap[key] = {
                    product_id: fc.product_id,
                    sku: fc.sku,
                    name: fc.name,
                    total_sqm: 0,
                    weighted_purchase_sum: 0,
                    weighted_shipment_sum: 0,
                    containers_count: 0,
                    storage: fc.storage || storageFee
                };
            }
            const itemSqm = fc.sqm || 0;
            summaryMap[key].total_sqm += itemSqm;
            summaryMap[key].weighted_purchase_sum += (fc.purchase || 0) * itemSqm;
            summaryMap[key].weighted_shipment_sum += (fc.shipment_sqm || 0) * itemSqm;
            summaryMap[key].containers_count += 1;
        });

        reportData.summaryCosts = Object.values(summaryMap).map(s => {
            const avgPurchase = s.total_sqm > 0 ? (s.weighted_purchase_sum / s.total_sqm) : 0;
            const avgShipment = s.total_sqm > 0 ? (s.weighted_shipment_sum / s.total_sqm) : 0;
            const finalTotal = avgPurchase + avgShipment + s.storage;
            return {
                product_id: s.product_id,
                sku: s.sku,
                name: s.name,
                total_sqm: s.total_sqm,
                avg_purchase: avgPurchase,
                avg_shipment_sqm: avgShipment,
                storage: s.storage,
                final_total: finalTotal,
                containers_count: s.containers_count
            };
        });

        return reportData;
    };

    /**
     * Legacy shipment report generation (backward compatibility for old reports).
     */
    const generateLegacyReportData = async (shipmentId) => {
        const db = await getDb();
        const shipmentRows = await db.select('SELECT * FROM shipments WHERE shipment_id = $1', [shipmentId]);
        if (shipmentRows.length === 0) throw new Error("Shipment not found");
        const shipment = shipmentRows[0];

        const shipperRows = await db.select('SELECT * FROM shippers WHERE shipper_id = $1', [shipment.shipper]);
        const shipper = shipperRows[0] || {};

        let shipmentProductsIds = [];
        try {
            if (shipment.products.startsWith('[')) {
                shipmentProductsIds = JSON.parse(shipment.products).map(p => p.id.toString());
            } else {
                shipmentProductsIds = shipment.products.split(',');
            }
        } catch (e) { }

        const allContainers = await db.select('SELECT * FROM containers');
        const oceanShippers = await db.select('SELECT * FROM ocean_shippers');
        const inventory = await db.select('SELECT * FROM inventory');

        let storageFee = await getSetting('storage_fee', '0');
        storageFee = parseFloat(storageFee) || 0;

        let defaultUsdAudRate = await getSetting('default_usd_aud_rate', '1');
        defaultUsdAudRate = parseFloat(defaultUsdAudRate) || 1;

        const linkedContainers = [];
        const allHbls = new Set();

        for (const c of allContainers) {
            if (!c.contents) continue;
            try {
                const arr = JSON.parse(c.contents);
                const block = arr.find(b => b.shipment_id && b.shipment_id.toString() === shipmentId.toString());
                if (block) {
                    linkedContainers.push({ c, arr, block });
                    if (block.hbl_no) {
                        block.hbl_no.split(',').map(s => s.trim()).filter(s => s).forEach(h => allHbls.add(h));
                    }
                }
            } catch (e) { }
        }

        const reportData = {
            isPurchaseOrder: false,
            shipment: {
                invoice_no: shipment.invoice_no,
                hbls: Array.from(allHbls).join(', '),
                containers: linkedContainers.map(lc => lc.c.cntr_no).filter(Boolean).join(', '),
                products: shipmentProductsIds.map(id => {
                    const inv = inventory.find(i => i.product_id.toString() === id);
                    return inv ? inv.sales_description : `[ID: ${id}]`;
                }).join(', ')
            },
            containerAllocations: [],
            purchasePrices: [],
            finalCosts: []
        };

        let parsedShipmentDetails = {};
        if (shipment.products && shipment.products.startsWith('[')) {
            try {
                const arr = JSON.parse(shipment.products);
                arr.forEach(p => {
                    parsedShipmentDetails[p.id.toString()] = { price: parseFloat(p.price) || 0 };
                });
            } catch (e) { }
        }

        const shipperDepositPercent = parseFloat(shipper.deposit) || 0;
        const shipperDutyPercent = parseFloat(shipper.duty) || 0;
        const shipmentDepositExchangeRate = parseFloat(shipment.deposit_currency) || 1;
        const shipmentDuty = parseFloat(shipment.duty) || shipperDutyPercent;

        for (const { c, arr, block } of linkedContainers) {
            const containerHbls = new Set();
            arr.forEach(b => {
                if (b.hbl_no) {
                    b.hbl_no.split(',').forEach(h => {
                        if (h.trim()) containerHbls.add(h.trim());
                    });
                }
            });
            const containerHblsCount = Math.max(1, containerHbls.size);

            const balanceExchangeRate = parseFloat(block.balance_currency) || 1;

            let totalContainerValueUsd = 0;
            arr.forEach(b => {
                totalContainerValueUsd += (parseFloat(b.deposit_amount) || 0) / shipmentDepositExchangeRate;
                totalContainerValueUsd += (parseFloat(b.balance_amount) || 0) / (parseFloat(b.balance_currency) || 1);
            });
            const dutyCost = totalContainerValueUsd * (shipmentDuty / 100);
            const freightCostUsd = parseFloat(c.freight_cost) || 0;
            const freightCostAud = freightCostUsd / defaultUsdAudRate;

            const logisticsCosts = [
                { name: 'Freight', charge_type: 'CTNR', rate: freightCostUsd, exRate: defaultUsdAudRate, amount: freightCostAud },
                { name: 'Duty', charge_type: 'CTNR', rate: null, exRate: null, amount: dutyCost }
            ];

            const addCostUsd = parseFloat(block.additional_cost) || 0;
            const addCostAud = addCostUsd / defaultUsdAudRate;
            logisticsCosts.push({ name: 'Additional Cost', charge_type: 'HBL', rate: addCostUsd, exRate: defaultUsdAudRate, amount: addCostAud });

            let forwarder = oceanShippers.find(os => os.ocean_shipper_id && c.ocean_shipper && os.ocean_shipper_id.toString() === c.ocean_shipper.toString());
            let otherTotal = 0;
            if (forwarder && forwarder.extra_charges) {
                try {
                    const extra = JSON.parse(forwarder.extra_charges);
                    extra.forEach(ex => {
                        const rate = parseFloat(ex.price) || 0;
                        const amtUsd = ex.type === 'HBL' ? rate * Math.max(1, containerHblsCount) : rate;
                        const amtAud = amtUsd / defaultUsdAudRate;
                        logisticsCosts.push({ name: ex.service_name, charge_type: ex.type, rate: amtUsd, exRate: defaultUsdAudRate, amount: amtAud });
                        otherTotal += amtAud;
                    });
                } catch (e) { }
            }

            const totalLogistics = logisticsCosts.reduce((sum, item) => sum + item.amount, 0);

            let totalWeight = 0;
            let currentShipmentWeight = 0;
            const productAllocations = [];

            arr.forEach(b => {
                const isCurrentShipment = b.shipment_id && b.shipment_id.toString() === shipmentId.toString();
                if (b.products) {
                    b.products.forEach(p => {
                        const inv = inventory.find(i => i.product_id.toString() === p.product_id.toString());
                        const w = parseFloat(p.weight) || 0;
                        const s = parseFloat(p.sqm) || 0;
                        totalWeight += w;
                        if (isCurrentShipment) {
                            currentShipmentWeight += w;
                        }
                        productAllocations.push({
                            hbl: b.hbl_no || '',
                            product_id: p.product_id,
                            name: inv ? inv.sales_description : p.sales_description,
                            sqm: s,
                            weight: w,
                            isCurrentShipment
                        });
                    });
                }
            });

            productAllocations.forEach(p => {
                p.percentage = totalWeight > 0 ? (p.weight / totalWeight) : 0;
                p.duty = dutyCost * p.percentage;
                p.freight = freightCostAud * p.percentage;
                p.others = otherTotal * p.percentage;
                p.addition = 0;
                if (p.isCurrentShipment && currentShipmentWeight > 0) {
                    p.addition = addCostAud * (p.weight / currentShipmentWeight);
                }
                p.total = p.duty + p.freight + p.others + p.addition;
            });

            reportData.containerAllocations.push({
                container_no: c.cntr_no || 'Unknown',
                logisticsCosts,
                totalLogistics,
                productAllocations
            });

            productAllocations.filter(p => p.isCurrentShipment).forEach(p => {
                const sqmPrice = parsedShipmentDetails[p.product_id.toString()]?.price || 0;
                const depositUsd = sqmPrice * (shipperDepositPercent / 100);
                const balanceUsd = sqmPrice * ((100 - shipperDepositPercent) / 100);
                const audAmount = (depositUsd / shipmentDepositExchangeRate) + (balanceUsd / balanceExchangeRate);

                reportData.purchasePrices.push({
                    container_no: c.cntr_no || 'Unknown',
                    name: p.name,
                    deposit_usd: depositUsd,
                    deposit_percent: shipperDepositPercent,
                    deposit_rate: shipmentDepositExchangeRate,
                    balance_usd: balanceUsd,
                    balance_percent: 100 - shipperDepositPercent,
                    balance_rate: balanceExchangeRate,
                    aud_amount: audAmount
                });

                const shipmentCostPerSqm = p.sqm > 0 ? (p.total / p.sqm) : 0;
                reportData.finalCosts.push({
                    container_no: c.cntr_no || 'Unknown',
                    name: p.name,
                    purchase: audAmount,
                    shipment_sqm: shipmentCostPerSqm,
                    storage: storageFee,
                    total: audAmount + shipmentCostPerSqm + storageFee
                });
            });
        }

        return reportData;
    };

    const handleSelectReport = async (id) => {
        setSelectedReportId(id);
        const report = reports.find(r => r.id === id);
        if (report) {
            try {
                setReportData(JSON.parse(report.data));
            } catch (e) {
                console.error("Failed to parse report data", e);
                setReportData(null);
            }
        }
    };

    const handleRegenerate = async () => {
        if (!selectedReportId) return;
        const report = reports.find(r => r.id === selectedReportId);
        if (!report) return;
        setLoading(true);
        try {
            let data;
            if (report.order_id) {
                data = await generatePurchaseOrderReportData(report.order_id);
            } else if (report.shipment_id) {
                data = await generateLegacyReportData(report.shipment_id);
            } else {
                throw new Error("Report has no order_id or shipment_id");
            }
            const db = await getDb();
            await db.execute('UPDATE cost_reports SET data = $1 WHERE id = $2', [JSON.stringify(data), selectedReportId]);
            setReportData(data);
            alert("Report successfully regenerated.");
        } catch (e) {
            console.error("Failed to regenerate", e);
            alert("Failed to regenerate report.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteReport = async (id) => {
        if (!canWrite) return;
        if (!window.confirm("Are you sure you want to delete this cost report?")) return;
        try {
            const db = await getDb();
            await db.execute('DELETE FROM cost_reports WHERE id = $1', [id]);
            if (selectedReportId === id) {
                setSelectedReportId(null);
                setReportData(null);
            }
            loadReports();
        } catch (e) {
            console.error(e);
        }
    };

    const generateReportHTML = (smallerFont = false) => {
        if (!reportData) return '';
        const rName = reports.find(r => r.id === selectedReportId)?.name || 'Cost Report';

        let containerFreightHTML = '';
        reportData.containerAllocations.forEach(ca => {
            const currentShipmentProds = ca.productAllocations.filter(p => p.isCurrentShipment);
            const otherProds = ca.productAllocations.filter(p => !p.isCurrentShipment);
            const allProds = [...currentShipmentProds, ...otherProds];

            containerFreightHTML += `
                <div style="margin-bottom: 28px;">
                    <h4 style="margin: 0 0 6px 0; color: #2563eb; font-weight: 600;">Container: ${ca.container_no}</h4>
                    <table class="report-table" style="margin-bottom: 10px;">
                        <thead>
                            <tr>
                                <th style="text-align: left;">HBL No.</th>
                                <th style="text-align: left;">Product Name</th>
                                <th style="text-align: right;">SQM</th>
                                <th style="text-align: right;">Weight (kg)</th>
                                <th style="text-align: right;">Percentage</th>
                                <th style="text-align: right;">Duty (AUD)</th>
                                <th style="text-align: right;">Freight (AUD)</th>
                                <th style="text-align: right;">Others (AUD)</th>
                                <th style="text-align: right;">Addition (AUD)</th>
                                <th style="text-align: right;">Total (AUD)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allProds.map(p => `
                                <tr style="${p.isCurrentShipment ? '' : 'color: #94a3b8;'}">
                                    <td style="text-align: left;">${p.hbl}</td>
                                    <td style="text-align: left;">${p.sku ? `<b>${p.sku}</b> - ` : ''}${p.name} ${p.isCurrentShipment ? '' : '(Other Order)'}</td>
                                    <td style="text-align: right;">${p.sqm.toFixed(2)}</td>
                                    <td style="text-align: right;">${p.weight.toFixed(2)}</td>
                                    <td style="text-align: right;">${(p.percentage * 100).toFixed(2)}%</td>
                                    <td style="text-align: right;">${p.duty.toFixed(2)}</td>
                                    <td style="text-align: right;">${p.freight.toFixed(2)}</td>
                                    <td style="text-align: right;">${p.others.toFixed(2)}</td>
                                    <td style="text-align: right;">${p.addition ? p.addition.toFixed(2) : '0.00'}</td>
                                    <td style="text-align: right; font-weight: ${p.isCurrentShipment ? '600' : '400'};">${p.total.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <table class="report-table" style="margin-bottom: 20px;">
                        <thead>
                            <tr>
                                <th style="text-align: left;">Cost & Charge</th>
                                <th style="text-align: left;">Charge Type</th>
                                <th style="text-align: right;">Rate (USD)</th>
                                <th style="text-align: right;">Ex. Rate</th>
                                <th style="text-align: right;">Amount (AUD)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ca.logisticsCosts.map(lc => `
                                <tr>
                                    <td style="text-align: left;">${lc.name}</td>
                                    <td style="text-align: left;">${lc.charge_type}</td>
                                    <td style="text-align: right;">${lc.rate === null || lc.rate === undefined ? '-' : lc.rate.toFixed(2)}</td>
                                    <td style="text-align: right;">${lc.exRate === null || lc.exRate === undefined ? 'N/A' : lc.exRate.toFixed(4)}</td>
                                    <td style="text-align: right;">${lc.amount.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr style="background: #f1f5f9; font-weight: 600;">
                                <td colspan="4" style="text-align: right;">Total Amount:</td>
                                <td style="text-align: right;">${ca.totalLogistics.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        });

        let purchasePricesHTML = `
            <table class="report-table" style="margin-bottom: 24px;">
                <thead>
                    <tr>
                        <th style="text-align: left;">Container No.</th>
                        <th style="text-align: left;">Product Name</th>
                        <th style="text-align: right;">Deposit (USD)</th>
                        <th style="text-align: right;">Dep. Ex. Rate</th>
                        <th style="text-align: right;">Balance (USD)</th>
                        <th style="text-align: right;">Bal. Ex. Rate</th>
                        <th style="text-align: right;">Amount (AUD)</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportData.purchasePrices.map(pp => `
                        <tr>
                            <td style="text-align: left;">${pp.container_no}</td>
                            <td style="text-align: left;">${pp.sku ? `<b>${pp.sku}</b> - ` : ''}${pp.name}</td>
                            <td style="text-align: right;">${pp.deposit_usd.toFixed(2)} (${pp.deposit_percent.toFixed(0)}%)</td>
                            <td style="text-align: right;">${pp.deposit_rate.toFixed(4)}</td>
                            <td style="text-align: right;">${pp.balance_usd.toFixed(2)} (${pp.balance_percent.toFixed(0)}%)</td>
                            <td style="text-align: right;">${pp.balance_rate.toFixed(4)}</td>
                            <td style="text-align: right; font-weight: 600;">${pp.aud_amount.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        let finalCostsHTML = `
            <table class="report-table" style="margin-bottom: 24px;">
                <thead>
                    <tr>
                        <th style="text-align: left;">Container No.</th>
                        <th style="text-align: left;">Product Name</th>
                        <th style="text-align: right;">SQM (m²)</th>
                        <th style="text-align: right;">Purchase (AUD)</th>
                        <th style="text-align: right;">Shipment Cost/SQM</th>
                        <th style="text-align: right;">Storage</th>
                        <th style="text-align: right;">Total (AUD)</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportData.finalCosts.map(fc => `
                        <tr>
                            <td style="text-align: left;">${fc.container_no}</td>
                            <td style="text-align: left;">${fc.sku ? `<b>${fc.sku}</b> - ` : ''}${fc.name}</td>
                            <td style="text-align: right;">${fc.sqm ? fc.sqm.toFixed(2) : '-'}</td>
                            <td style="text-align: right;">${fc.purchase.toFixed(2)}</td>
                            <td style="text-align: right;">${fc.shipment_sqm.toFixed(2)}</td>
                            <td style="text-align: right;">${fc.storage.toFixed(2)}</td>
                            <td style="text-align: right; font-weight: 600; color: #dc2626;">${fc.total.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        let summaryCostsHTML = '';
        if (reportData.summaryCosts && reportData.summaryCosts.length > 0) {
            summaryCostsHTML = `
                <div style="margin-top: 28px; padding-top: 10px;">
                    <h3 style="border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-bottom: 12px; font-size: 1.15rem; color: #1e293b; text-transform: uppercase;">
                        Purchase Order Final Average Costs
                    </h3>
                    <table class="report-table">
                        <thead>
                            <tr style="background: #f1f5f9;">
                                <th style="text-align: left;">SKU</th>
                                <th style="text-align: left;">Product Name</th>
                                <th style="text-align: right;">Total SQM (m²)</th>
                                <th style="text-align: right;">Containers</th>
                                <th style="text-align: right;">Avg. Purchase (AUD)</th>
                                <th style="text-align: right;">Avg. Shipment/SQM</th>
                                <th style="text-align: right;">Storage</th>
                                <th style="text-align: right; background: #eff6ff;">Final Avg. Cost (AUD)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${reportData.summaryCosts.map(sc => `
                                <tr>
                                    <td style="text-align: left; font-weight: 600; color: #2563eb;">${sc.sku || '-'}</td>
                                    <td style="text-align: left; font-weight: 500;">${sc.name}</td>
                                    <td style="text-align: right; font-weight: 600;">${sc.total_sqm.toFixed(2)}</td>
                                    <td style="text-align: right; color: #64748b;">${sc.containers_count}</td>
                                    <td style="text-align: right;">${sc.avg_purchase.toFixed(2)}</td>
                                    <td style="text-align: right;">${sc.avg_shipment_sqm.toFixed(2)}</td>
                                    <td style="text-align: right;">${sc.storage.toFixed(2)}</td>
                                    <td style="text-align: right; font-weight: bold; color: #dc2626; background: #fef2f2; font-size: 1.05em;">${sc.final_total.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        const fontSize = smallerFont ? '10px' : '12px';
        const paddingSize = smallerFont ? '4px' : '7px';

        const orderInfo = reportData.order || reportData.shipment || {};
        const isPo = Boolean(reportData.isPurchaseOrder);

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${rName} Cost Accounting Report</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 10px; }
    h3 { margin-top: 24px; margin-bottom: 12px; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; text-transform: uppercase; font-size: 1.05rem; }
    .report-table { width: 100%; border-collapse: collapse; font-size: ${fontSize}; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: ${paddingSize}; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .info-item { margin-bottom: 6px; }
    .info-label { color: #64748b; font-size: 0.8rem; display: block; }
    .info-value { font-weight: 500; font-size: 0.95rem; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { size: portrait; margin: 10mm; }
    }
</style>
</head>
<body>
    <div style="background: #deebf7; padding: 12px 18px; margin-bottom: 18px; border-radius: 4px;">
        <h2 style="margin: 0; font-size: 1.15rem; color: #1e3a8a;">${rName} Cost Accounting Report</h2>
    </div>

    <h3>${isPo ? 'Purchase Order Information' : 'Shipment Information'}</h3>
    <div class="info-grid">
        <div class="info-item"><span class="info-label">Invoice No.</span><div class="info-value">${orderInfo.invoice_no || '-'}</div></div>
        <div class="info-item"><span class="info-label">${isPo ? 'Shipper' : 'HBL No(s).'}</span><div class="info-value">${isPo ? orderInfo.shipper_name : (orderInfo.hbls || '-')}</div></div>
        <div class="info-item"><span class="info-label">Container No(s).</span><div class="info-value">${orderInfo.containers || '-'}</div></div>
        ${isPo ? `
            <div class="info-item"><span class="info-label">HBL No(s).</span><div class="info-value">${orderInfo.hbls || '-'}</div></div>
            <div class="info-item"><span class="info-label">Deposit Rate / %</span><div class="info-value">${orderInfo.deposit_rate?.toFixed(4)} (${orderInfo.deposit_percent?.toFixed(0)}%)</div></div>
            <div class="info-item"><span class="info-label">Duty %</span><div class="info-value">${orderInfo.duty_percent?.toFixed(1)}%</div></div>
        ` : ''}
        <div class="info-item" style="grid-column: 1 / -1;"><span class="info-label">Products</span><div class="info-value">${orderInfo.products || '-'}</div></div>
    </div>

    <h3>Containers & Logistics</h3>
    ${containerFreightHTML}

    <h3>Product Cost Breakdown</h3>
    <h5 style="margin: 14px 0 6px 0; font-size: 0.95rem; color: #2563eb; font-weight: 600;">Purchase Prices (by Container)</h5>
    ${purchasePricesHTML}
    <h5 style="margin: 14px 0 6px 0; font-size: 0.95rem; color: #2563eb; font-weight: 600;">Landed Costs (by Container)</h5>
    ${finalCostsHTML}

    ${summaryCostsHTML}
</body>
</html>`;
    };

    const exportReportHTML = async () => {
        const htmlContent = generateReportHTML(false);
        if (!htmlContent) return;
        const rName = reports.find(r => r.id === selectedReportId)?.name || 'cost_report';

        try {
            const filePath = await save({
                filters: [{ name: 'HTML Document', extensions: ['html'] }],
                defaultPath: `${rName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.html`
            });

            if (filePath) {
                await writeTextFile(filePath, htmlContent);
            }
        } catch (err) {
            console.error("Export failed", err);
        }
    };

    const printReport = () => {
        const htmlContent = generateReportHTML(true);
        if (!htmlContent) return;

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(htmlContent);
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
    };

    // Grouping for sidebar by shipper
    const groupedReports = reports.reduce((acc, r) => {
        const shipper = r.shipper_name || 'Unknown Shipper';
        if (!acc[shipper]) acc[shipper] = [];
        acc[shipper].push(r);
        return acc;
    }, {});

    const orderInfo = reportData?.order || reportData?.shipment || {};
    const isPo = Boolean(reportData?.isPurchaseOrder);

    return (
        <div className="reports-layout cost-report-layout" style={{ height: '100%', display: 'flex' }}>
            <div className="reports-sidebar">
                <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        {canWrite && (
                            <button className="btn-primary" style={{ padding: '10px 12px', width: '100%', justifyContent: 'center' }} onClick={handleOpenAddModal}>
                                <Plus size={16} /> Add Report
                            </button>
                        )}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                            type="text"
                            placeholder="Search reports..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: '100%', padding: '8px 8px 8px 32px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none' }}
                        />
                    </div>
                </div>

                <div className="reports-list">
                    {Object.keys(groupedReports).map(shipper => {
                        const sr = groupedReports[shipper].filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
                        if (sr.length === 0 && !expandedShippers[shipper]) return null;

                        return (
                            <div key={shipper}>
                                <div
                                    className="report-item"
                                    style={{ fontWeight: 'bold', background: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}
                                    onClick={() => toggleShipperExpand(shipper)}
                                >
                                    <span style={{ fontSize: '12px' }}>{expandedShippers[shipper] ? '▼' : '▶'} {shipper}</span>
                                </div>
                                {expandedShippers[shipper] && sr.map(r => (
                                    <div
                                        key={r.id}
                                        className={`report-item ${selectedReportId === r.id ? 'active' : ''}`}
                                        onClick={() => handleSelectReport(r.id)}
                                    >
                                        <div className="report-item-title">{r.name}</div>
                                        {canWrite && (
                                            <button className="delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteReport(r.id); }}>
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="report-content-area" style={{ flex: 1, padding: '24px 40px', overflowY: 'auto', background: '#fff' }}>
                {!selectedReportId ? (
                    <div className="empty-state" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Select a report from the left panel or create a new one.</div>
                ) : !reportData ? (
                    <div className="empty-state" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading report data...</div>
                ) : (
                    <div className="report-canvas">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 -20px 30px', padding: '12px 20px', background: '#deebf7' }}>
                            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{reports.find(r => r.id === selectedReportId)?.name} Cost Accounting Report</h2>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-upload" style={{ background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1' }} onClick={printReport}>
                                    <Printer size={16} /> Print
                                </button>
                                <button className="btn-upload" style={{ background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1' }} onClick={exportReportHTML}>
                                    <Download size={16} /> Export
                                </button>
                                <button className="btn-upload" style={{ background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid #cbd5e1' }} onClick={handleRegenerate}>
                                    <RefreshCw size={16} /> Re-generate
                                </button>
                            </div>
                        </div>

                        {/* Part 1: Purchase Order / Shipment Info */}
                        <div className="report-section">
                            <h3 className="section-title" style={{ fontSize: '1.4rem', marginBottom: '12px', textTransform: 'uppercase' }}>
                                {isPo ? 'Purchase Order Information' : 'Shipment Information'}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '35px' }}>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Invoice No.</span> <div style={{ fontWeight: 500 }}>{orderInfo.invoice_no || '-'}</div></div>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>{isPo ? 'Shipper' : 'HBL No(s).'}</span> <div style={{ fontWeight: 500 }}>{isPo ? orderInfo.shipper_name : (orderInfo.hbls || '-')}</div></div>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Container No(s).</span> <div style={{ fontWeight: 500 }}>{orderInfo.containers || '-'}</div></div>
                                {isPo && (
                                    <>
                                        <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>HBL No(s).</span> <div style={{ fontWeight: 500 }}>{orderInfo.hbls || '-'}</div></div>
                                        <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Deposit Rate / %</span> <div style={{ fontWeight: 500 }}>{orderInfo.deposit_rate?.toFixed(4)} ({orderInfo.deposit_percent?.toFixed(0)}%)</div></div>
                                        <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Duty %</span> <div style={{ fontWeight: 500 }}>{orderInfo.duty_percent?.toFixed(1)}%</div></div>
                                    </>
                                )}
                                <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Products</span> <div style={{ fontWeight: 500 }}>{orderInfo.products || '-'}</div></div>
                            </div>
                        </div>

                        {/* Part 2: Container Freight & Logistics */}
                        <div className="report-section" style={{ marginTop: '28px' }}>
                            <h3 className="section-title" style={{ fontSize: '1.4rem', marginBottom: '12px', textTransform: 'uppercase' }}>Containers</h3>
                            {reportData.containerAllocations.map((ca, idx) => {
                                const currentShipmentProds = ca.productAllocations.filter(p => p.isCurrentShipment);
                                const otherProds = ca.productAllocations.filter(p => !p.isCurrentShipment);
                                const allProds = [...currentShipmentProds, ...otherProds];

                                return (
                                    <div key={idx} style={{ marginBottom: '32px' }}>
                                        <h4 style={{ margin: '0 0 6px 0', color: 'var(--primary-color)', fontWeight: 600 }}>Container: {ca.container_no}</h4>
                                        <table className="excel-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                                            <thead>
                                                <tr style={{ background: '#f1f5f9' }}>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>HBL No.</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>SQM</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Weight (kg)</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Percentage</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Duty</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Freight</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Others</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Addition</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {allProds.map((p, i) => (
                                                    <tr key={i} style={{ color: p.isCurrentShipment ? 'inherit' : '#94a3b8' }}>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{p.hbl}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>
                                                            {p.sku ? <b>{p.sku} - </b> : ''}
                                                            {p.name} {p.isCurrentShipment ? '' : '(Other Order)'}
                                                        </td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.sqm.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.weight.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{(p.percentage * 100).toFixed(2)}%</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.duty.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.freight.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.others.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{p.addition ? p.addition.toFixed(2) : '0.00'}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: p.isCurrentShipment ? 600 : 400 }}>{p.total.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <table className="excel-table" style={{ marginBottom: '24px', width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ background: '#f1f5f9' }}>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Cost & Charge</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Charge Type</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Rate (USD)</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Ex. Rate</th>
                                                    <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Amount (AUD)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ca.logisticsCosts.map((lc, i) => (
                                                    <tr key={i}>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{lc.name}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{lc.charge_type}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{lc.rate === null || lc.rate === undefined ? '-' : lc.rate.toFixed(2)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{lc.exRate === null || lc.exRate === undefined ? 'N/A' : lc.exRate.toFixed(4)}</td>
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{lc.amount.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{ background: '#f1f5f9', fontWeight: 600 }}>
                                                    <td colSpan="4" style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total Amount:</td>
                                                    <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{ca.totalLogistics.toFixed(2)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Part 3: Purchase Price & Final Cost per Container */}
                        <div className="report-section" style={{ marginTop: '28px' }}>
                            <h3 className="section-title" style={{ fontSize: '1.4rem', marginBottom: '12px', textTransform: 'uppercase' }}>Product Cost</h3>

                            <h5 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '500', color: 'var(--primary-color)' }}>Purchase Prices (by Container)</h5>
                            <table className="excel-table" style={{ marginBottom: '24px', width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Container No.</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Deposit (USD)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Dep. Ex. Rate</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Balance (USD)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Bal. Ex. Rate</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Amount (AUD)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reportData.purchasePrices.map((pp, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{pp.container_no}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>
                                                {pp.sku ? <b>{pp.sku} - </b> : ''}{pp.name}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.deposit_usd.toFixed(2)} ({pp.deposit_percent.toFixed(0)}%)</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.deposit_rate.toFixed(4)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.balance_usd.toFixed(2)} ({pp.balance_percent.toFixed(0)}%)</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.balance_rate.toFixed(4)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600 }}>{pp.aud_amount.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <h5 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '500', color: 'var(--primary-color)' }}>Final Costs (by Container)</h5>
                            <table className="excel-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Container No.</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>SQM (m²)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Purchase (AUD)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Shipment Cost/SQM</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Storage</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total (AUD)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reportData.finalCosts.map((fc, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{fc.container_no}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>
                                                {fc.sku ? <b>{fc.sku} - </b> : ''}{fc.name}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.sqm ? fc.sqm.toFixed(2) : '-'}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.purchase.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.shipment_sqm.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.storage.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>{fc.total.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Part 4: Purchase Order Summary Table (Weighted Average Final Costs) */}
                        {reportData.summaryCosts && reportData.summaryCosts.length > 0 && (
                            <div className="report-section" style={{ marginTop: '36px', paddingTop: '10px' }}>
                                <h3 className="section-title" style={{ fontSize: '1.35rem', marginBottom: '14px', textTransform: 'uppercase', color: '#1e293b', borderBottom: '2px solid #2563eb', paddingBottom: '6px' }}>
                                    Purchase Order Final Average Costs (加权平均最终成本)
                                </h3>
                                <table className="excel-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
                                    <thead>
                                        <tr style={{ background: '#f1f5f9' }}>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'left' }}>SKU</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Total SQM (m²)</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Containers</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Avg. Purchase (AUD)</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Avg. Shipment/SQM</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Storage</th>
                                            <th style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right', backgroundColor: '#eff6ff' }}>Final Avg. Cost (AUD)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.summaryCosts.map((sc, i) => (
                                            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', fontWeight: 600, color: '#2563eb' }}>{sc.sku || '-'}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', fontWeight: 500 }}>{sc.name}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600 }}>{sc.total_sqm.toFixed(2)}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right', color: '#64748b' }}>{sc.containers_count}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>${sc.avg_purchase.toFixed(2)}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>${sc.avg_shipment_sqm.toFixed(2)}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right' }}>${sc.storage.toFixed(2)}</td>
                                                <td style={{ padding: '10px 12px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '1rem', backgroundColor: '#fef2f2' }}>
                                                    ${sc.final_total.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Add Report Modal */}
            {showAddModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ width: '520px', maxWidth: '90%' }}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                            <h3 style={{ margin: 0 }}>Create Cost Report</h3>
                            <button className="btn-icon" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem' }}>Purchase Order</label>
                                <div style={{ position: 'relative', marginBottom: '8px' }}>
                                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text"
                                        placeholder="Search purchase orders (shipper, invoice no)..."
                                        value={orderSearch}
                                        onChange={(e) => setOrderSearch(e.target.value)}
                                        style={{ width: '100%', padding: '8px 8px 8px 32px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none' }}
                                    />
                                </div>
                                <select
                                    className="form-control"
                                    size={6}
                                    value={addForm.order_id}
                                    onChange={e => {
                                        const oid = e.target.value;
                                        const ord = allPurchaseOrders.find(o => String(o.order_id) === String(oid));
                                        setAddForm({ order_id: oid, name: ord ? `${ord.invoice_no}` : '' });
                                    }}
                                    style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none', background: 'white' }}
                                >
                                    {allPurchaseOrders.filter(o => {
                                        const str = `${o.shipper_name || ''} ${o.invoice_no || ''}`.toLowerCase();
                                        return str.includes(orderSearch.toLowerCase());
                                    }).map(o => (
                                        <option key={o.order_id} value={o.order_id}>
                                            {o.shipper_name || 'Unknown'} | {o.invoice_no} (PO #{o.order_id})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group" style={{ marginTop: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem' }}>Report Name</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={addForm.name}
                                    onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Enter report name"
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none' }}
                                />
                            </div>
                        </div>
                        <div className="modal-footer" style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="btn-secondary" style={{ padding: '8px 12px' }} onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn-primary" style={{ padding: '8px 12px' }} onClick={handleCreateReport}>Create Report</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
