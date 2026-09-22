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
    const [allShipments, setAllShipments] = useState([]);
    const [addForm, setAddForm] = useState({ shipment_id: '', name: '' });
    const [shipmentSearch, setShipmentSearch] = useState('');

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
                SELECT cr.*, s.invoice_no, shp.shipper_name 
                FROM cost_reports cr
                LEFT JOIN shipments s ON cr.shipment_id = s.shipment_id
                LEFT JOIN shippers shp ON s.shipper = shp.shipper_id
                ORDER BY shp.shipper_name ASC, cr.created_at DESC
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
            const shps = await db.select(`
                SELECT s.shipment_id, s.invoice_no, shp.shipper_name 
                FROM shipments s 
                LEFT JOIN shippers shp ON s.shipper = shp.shipper_id 
                ORDER BY shp.shipper_name ASC, s.invoice_no ASC
            `);
            setAllShipments(shps);
            setAddForm({ shipment_id: '', name: '' });
            setShipmentSearch('');
            setShowAddModal(true);
        } catch (e) {
            console.error(e);
        }
    };

    const handleCreateReport = async () => {
        if (!addForm.shipment_id || !addForm.name) {
            alert("Please select a shipment and enter a name.");
            return;
        }
        try {
            const data = await generateReportData(addForm.shipment_id);
            const db = await getDb();
            const res = await db.execute(
                'INSERT INTO cost_reports (name, shipment_id, data, created_at) VALUES ($1, $2, $3, $4)',
                [addForm.name, addForm.shipment_id, JSON.stringify(data), new Date().toISOString()]
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

    const generateReportData = async (shipmentId) => {
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

        // Parse Shipment Details to get SQM Prices
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
            // Sum all blocks in this container
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

            // Weight allocations
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

            // Part 3 Calculation
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
            const data = await generateReportData(report.shipment_id);
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
                <div style="margin-bottom: 32px;">
                    <h4 style="margin: 0 0 5px 0; color: #3b82f6; font-weight: 500;">Container: ${ca.container_no}</h4>
                    <table class="report-table" style="margin-bottom: 10px;">
                        <thead>
                            <tr>
                                <th style="text-align: left;">HBL No.</th>
                                <th style="text-align: left;">Product Name</th>
                                <th style="text-align: right;">SQM</th>
                                <th style="text-align: right;">Weight (kg)</th>
                                <th style="text-align: right;">Percentage</th>
                                <th style="text-align: right;">Duty</th>
                                <th style="text-align: right;">Freight</th>
                                <th style="text-align: right;">Others</th>
                                <th style="text-align: right;">Addition</th>
                                <th style="text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allProds.map(p => `
                                <tr style="${p.isCurrentShipment ? '' : 'color: #94a3b8;'}">
                                    <td style="text-align: left;">${p.hbl}</td>
                                    <td style="text-align: left;">${p.name} ${p.isCurrentShipment ? '' : '(Other Order)'}</td>
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
                    <table class="report-table" style="margin-bottom: 24px;">
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
                        <th style="text-align: right;">Deposit (USD/EUR)</th>
                        <th style="text-align: right;">Dep. Ex. Rate</th>
                        <th style="text-align: right;">Balance (USD/EUR)</th>
                        <th style="text-align: right;">Bal. Ex. Rate</th>
                        <th style="text-align: right;">Amount (AUD)</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportData.purchasePrices.map(pp => `
                        <tr>
                            <td style="text-align: left;">${pp.container_no}</td>
                            <td style="text-align: left;">${pp.name}</td>
                            <td style="text-align: right;">${pp.deposit_usd.toFixed(2)} (${pp.deposit_percent}%)</td>
                            <td style="text-align: right;">${pp.deposit_rate.toFixed(4)}</td>
                            <td style="text-align: right;">${pp.balance_usd.toFixed(2)} (${pp.balance_percent}%)</td>
                            <td style="text-align: right;">${pp.balance_rate.toFixed(4)}</td>
                            <td style="text-align: right; font-weight: 600;">${pp.aud_amount.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        let finalCostsHTML = `
            <table class="report-table">
                <thead>
                    <tr>
                        <th style="text-align: left;">Container No.</th>
                        <th style="text-align: left;">Product Name</th>
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
                            <td style="text-align: left;">${fc.name}</td>
                            <td style="text-align: right;">${fc.purchase.toFixed(2)}</td>
                            <td style="text-align: right;">${fc.shipment_sqm.toFixed(2)}</td>
                            <td style="text-align: right;">${fc.storage.toFixed(2)}</td>
                            <td style="text-align: right; font-weight: 600; color: #ff0000;">${fc.total.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        const fontSize = smallerFont ? '10px' : '13px';
        const paddingSize = smallerFont ? '4px' : '8px';

        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${rName} Cost Accounting Report</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    h3 { margin-top: 30px; margin-bottom: 15px; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; text-transform: uppercase; }
    .report-table { width: 100%; border-collapse: collapse; font-size: ${fontSize}; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: ${paddingSize}; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 30px; }
    .info-item { margin-bottom: 10px; }
    .info-label { color: #64748b; font-size: 0.85rem; display: block; }
    .info-value { font-weight: 500; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { size: portrait; margin: 0; }
    }
</style>
</head>
<body>
    <table style="width: 100%; border: none; border-collapse: collapse;">
        <thead style="border: none;">
            <tr><td style="height: 1.5cm; border: none; padding: 0;"></td></tr>
        </thead>
        <tfoot style="border: none;">
            <tr><td style="height: 1.5cm; border: none; padding: 0;"></td></tr>
        </tfoot>
        <tbody style="border: none;">
            <tr><td style="border: none; padding: 0 1.5cm;">
                <div style="background: #deebf7; padding: 15px 20px; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 1.2rem;">${rName} Cost Accounting Report</h2>
                </div>

                <h3>Shipment Information</h3>
                <div class="info-grid">
                    <div class="info-item"><span class="info-label">Invoice No.</span><div class="info-value">${reportData.shipment.invoice_no}</div></div>
                    <div class="info-item"><span class="info-label">HBL No(s).</span><div class="info-value">${reportData.shipment.hbls || '-'}</div></div>
                    <div class="info-item"><span class="info-label">Container No(s).</span><div class="info-value">${reportData.shipment.containers || '-'}</div></div>
                    <div class="info-item" style="grid-column: 1 / -1;"><span class="info-label">Products</span><div class="info-value">${reportData.shipment.products || '-'}</div></div>
                </div>

                <h3>Containers</h3>
                ${containerFreightHTML}

                <h3>Product Cost</h3>
                <h5 style="margin: 0 0 8px 0; font-size: 1rem; color: #3b82f6; font-weight: 500;">Purchase Prices</h5>
                ${purchasePricesHTML}
                <h5 style="margin: 0 0 8px 0; font-size: 1rem; color: #3b82f6; font-weight: 500;">Final Costs</h5>
                ${finalCostsHTML}
            </td></tr>
        </tbody>
    </table>
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

    // Grouping for sidebar
    const groupedReports = reports.reduce((acc, r) => {
        const shipper = r.shipper_name || 'Unknown Shipper';
        if (!acc[shipper]) acc[shipper] = [];
        acc[shipper].push(r);
        return acc;
    }, {});

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

                        {/* Part 1: Shipment Info */}
                        <div className="report-section">
                            <h3 className="section-title" style={{ fontSize: '1.5rem', marginBottom: '12px', textTransform: 'uppercase' }}>Shipment Information</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '50px' }}>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Invoice No.</span> <div style={{ fontWeight: 500 }}>{reportData.shipment.invoice_no}</div></div>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>HBL No(s).</span> <div style={{ fontWeight: 500 }}>{reportData.shipment.hbls || '-'}</div></div>
                                <div><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Container No(s).</span> <div style={{ fontWeight: 500 }}>{reportData.shipment.containers || '-'}</div></div>
                                <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b', fontSize: '0.85rem', display: 'block' }}>Products</span> <div style={{ fontWeight: 500 }}>{reportData.shipment.products || '-'}</div></div>
                            </div>
                        </div>

                        {/* Part 2: Container Freight */}
                        <div className="report-section" style={{ marginTop: '32px' }}>
                            <h3 className="section-title" style={{ fontSize: '1.5rem', marginBottom: '12px', textTransform: 'uppercase' }}>Containers</h3>
                            {reportData.containerAllocations.map((ca, idx) => {
                                const currentShipmentProds = ca.productAllocations.filter(p => p.isCurrentShipment);
                                const otherProds = ca.productAllocations.filter(p => !p.isCurrentShipment);
                                const allProds = [...currentShipmentProds, ...otherProds];

                                return (
                                    <div key={idx} style={{ marginBottom: '32px' }}>
                                        <h4 style={{ margin: '0 0 5px 0', color: 'var(--primary-color)', fontWeight: 500 }}>Container: {ca.container_no}</h4>
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
                                                        <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{p.name} {p.isCurrentShipment ? '' : '(Other Order)'}</td>
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

                        {/* Part 3: Purchase Price & Final Cost */}
                        <div className="report-section" style={{ marginTop: '32px' }}>
                            <h3 className="section-title" style={{ fontSize: '1.5rem', marginBottom: '12px', textTransform: 'uppercase' }}>Product Cost</h3>

                            <h5 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '500', color: 'var(--primary-color)' }}>Purchase Prices</h5>
                            <table className="excel-table" style={{ marginBottom: '24px', width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Container No.</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Deposit (USD/EUR)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Dep. Ex. Rate</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Balance (USD/EUR)</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Bal. Ex. Rate</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>Amount (AUD)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reportData.purchasePrices.map((pp, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{pp.container_no}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{pp.name}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.deposit_usd.toFixed(2)} ({pp.deposit_percent}%)</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.deposit_rate.toFixed(4)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.balance_usd.toFixed(2)} ({pp.balance_percent}%)</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{pp.balance_rate.toFixed(4)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600 }}>{pp.aud_amount.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <h5 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '500', color: 'var(--primary-color)' }}>Final Costs</h5>
                            <table className="excel-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Container No.</th>
                                        <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>Product Name</th>
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
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>{fc.name}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.purchase.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.shipment_sqm.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>{fc.storage.toFixed(2)}</td>
                                            <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 600, color: '#ff0000' }}>{fc.total.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </div>
                )}
            </div>

            {/* Add Report Modal */}
            {
                showAddModal && (
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ width: '500px', maxWidth: '90%' }}>
                            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                                <h3 style={{ margin: 0 }}>Create Cost Report</h3>
                                <button className="btn-icon" onClick={() => setShowAddModal(false)}>×</button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.9rem' }}>Shipment Order</label>
                                    <div style={{ position: 'relative', marginBottom: '8px' }}>
                                        <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                        <input
                                            type="text"
                                            placeholder="Search shipments..."
                                            value={shipmentSearch}
                                            onChange={(e) => setShipmentSearch(e.target.value)}
                                            style={{ width: '100%', padding: '8px 8px 8px 32px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none' }}
                                        />
                                    </div>
                                    <select
                                        className="form-control"
                                        size={5}
                                        value={addForm.shipment_id}
                                        onChange={e => {
                                            const sid = e.target.value;
                                            const shp = allShipments.find(s => s.shipment_id.toString() === sid);
                                            setAddForm({ shipment_id: sid, name: shp ? shp.invoice_no : '' });
                                        }}
                                        style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none', background: 'white' }}
                                    >
                                        {allShipments.filter(s => {
                                            const str = `${s.shipper_name} ${s.invoice_no}`.toLowerCase();
                                            return str.includes(shipmentSearch.toLowerCase());
                                        }).map(s => (
                                            <option key={s.shipment_id} value={s.shipment_id}>{s.shipper_name} | {s.invoice_no}</option>
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
                )
            }
        </div >
    );
}
