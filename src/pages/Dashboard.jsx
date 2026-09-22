import { getLocalTodayStrSync, getLocalStrFromDate } from '../utils/timezone';
import { useEffect, useState } from 'react';
import { getDb } from '../db/Database';
import { getCellCalculations } from '../utils/calculations';
import { Package, AlertTriangle } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard({ currentUser, onNavigate, isActive }) {
    const [lowStockItems, setLowStockItems] = useState([]);
    const [backorderProducts, setBackorderProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeDashTab, setActiveDashTab] = useState('low-stock');

    const loadData = async () => {
        setLoading(true);
        try {
            const db = await getDb();

            // Load all reports
            const reports = await db.select('SELECT id, name, start_date, end_date, data, ignore FROM reports');

            // Load Inventory
            const inv = await db.select('SELECT sku, available, total_qty, days, holding, so_qty FROM inventory');
            const inventoryMap = {};
            inv.forEach(item => {
                inventoryMap[item.sku] = item;
            });

            // Load Sales
            const sales = await db.select('SELECT sku, date, qty FROM sales');
            const salesData = {};
            sales.forEach(s => {
                if (!salesData[s.sku]) salesData[s.sku] = [];
                salesData[s.sku].push(s);
            });

            const lowStock = [];

            // Load shipments, containers, shippers for backorder tracking
            const shipments = await db.select("SELECT * FROM shipments WHERE status IN ('open', 'Processing')");
            const containers = await db.select("SELECT * FROM containers");
            const shippers = await db.select("SELECT * FROM shippers");

            const shipperMap = {};
            shippers.forEach(s => shipperMap[s.shipper_id] = s.shipper_name);

            const inventoryIdMap = {};
            inv.forEach(item => {
                inventoryIdMap[item.sku] = item;
            });
            const invById = await db.select("SELECT product_id, sku, sales_description FROM inventory");
            invById.forEach(item => inventoryIdMap[item.product_id] = item);

            const backorders = [];
            const todayStr = getLocalTodayStrSync();

            shipments.forEach(s => {
                if (!s.products) return;
                let prods = [];
                try {
                    prods = JSON.parse(s.products);
                } catch (e) { }

                prods.forEach(p => {
                    let totalSqm = parseFloat(p.sqm) || 0;
                    let arrivedSqm = 0;
                    let shippingSqm = 0;

                    // Check containers
                    containers.forEach(c => {
                        if (!c.contents) return;
                        let contents = [];
                        try {
                            contents = JSON.parse(c.contents);
                        } catch (e) { }

                        contents.forEach(block => {
                            if (block.shipment_id && block.shipment_id.toString() === s.shipment_id.toString()) {
                                if (block.products && Array.isArray(block.products)) {
                                    block.products.forEach(cp => {
                                        if (cp.product_id && cp.product_id.toString() === p.id.toString()) {
                                            const containerSqm = parseFloat(cp.sqm) || 0;

                                            // Determine if arrived or shipping
                                            // The rule: if c.delivery exists and is less than today -> arrived
                                            // If c.delivery is empty, or >= today -> shipping
                                            if (c.delivery) {
                                                const deliveryDateStr = c.delivery.split('T')[0];
                                                if (deliveryDateStr < todayStr) {
                                                    arrivedSqm += containerSqm;
                                                } else {
                                                    shippingSqm += containerSqm;
                                                }
                                            } else {
                                                shippingSqm += containerSqm;
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    });

                    let factorySqm = totalSqm - arrivedSqm - shippingSqm;
                    if (factorySqm < 0) factorySqm = 0;

                    const invItem = inventoryIdMap[p.id];
                    const productName = invItem ? `${invItem.sku} - ${invItem.sales_description}` : p.name;

                    backorders.push({
                        shipmentId: s.shipment_id,
                        invoiceNo: s.invoice_no,
                        shipperName: shipperMap[s.shipper] || s.shipper,
                        productName: productName,
                        factorySqm: factorySqm.toFixed(2),
                        shippingSqm: shippingSqm.toFixed(2),
                        arrivedSqm: arrivedSqm.toFixed(2)
                    });
                });
            });

            setBackorderProducts(backorders);

            // Process all reports
            reports.forEach(report => {
                if (!report.data) return;
                let parsedData = null;
                try {
                    parsedData = JSON.parse(report.data);
                } catch (e) {
                    return;
                }

                if (!parsedData.finishes) return;
                if (report.ignore === 1) return;

                // Ensure report has start_date if missing but end_date exists
                let startDate = report.start_date;
                if (!startDate && report.end_date) {
                    const ed = new Date(report.end_date);
                    ed.setDate(ed.getDate() - 30);
                    startDate = getLocalStrFromDate(ed);
                }

                parsedData.finishes.forEach(finish => {
                    if (!finish.sizes) return;
                    finish.sizes.forEach(size => {
                        if (!size.cells) return;
                        Object.keys(size.cells).forEach(colour => {
                            const cell = size.cells[colour];
                            if (!cell || cell.deleted) return;

                            const calc = getCellCalculations(cell, startDate, report.end_date, inventoryMap, salesData);

                            if (calc.isLowStock) {
                                let existing = lowStock.find(r => r.reportId === report.id);
                                if (!existing) {
                                    lowStock.push({
                                        reportId: report.id,
                                        reportName: report.name,
                                        count: 1
                                    });
                                } else {
                                    existing.count += 1;
                                }
                            }
                        });
                    });
                });
            });

            // Sort low stock reports by count descending
            lowStock.sort((a, b) => b.count - a.count);
            setLowStockItems(lowStock);

        } catch (err) {
            console.error("Failed to load dashboard data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isActive !== false) {
            loadData();
        }
    }, [isActive]);

    const handleIgnoreReport = async (reportId) => {
        if (!window.confirm("Are you sure you want to ignore low stock alerts for this report?")) return;
        try {
            const db = await getDb();
            await db.execute('UPDATE reports SET ignore = 1 WHERE id = $1', [reportId]);
            loadData();
        } catch (e) {
            console.error("Failed to ignore report", e);
        }
    };

    return (
        <div className="dashboard-container">
            <div className="dashboard-header">
                <h2><Package size={24} style={{ marginRight: '10px' }} /> Overview Dashboard</h2>
                <p>Welcome back, {currentUser?.username || 'User'}</p>
            </div>

            <div className="dashboard-content">
                <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '16px', gap: '16px' }}>
                    <button
                        style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: activeDashTab === 'low-stock' ? 600 : 400, color: activeDashTab === 'low-stock' ? '#3b82f6' : '#64748b', borderBottom: activeDashTab === 'low-stock' ? '2px solid #3b82f6' : '2px solid transparent' }}
                        onClick={() => setActiveDashTab('low-stock')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={16} /> Low Stock Alerts <span className="badge">{lowStockItems.length}</span>
                        </div>
                    </button>
                    <button
                        style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: activeDashTab === 'backorder' ? 600 : 400, color: activeDashTab === 'backorder' ? '#3b82f6' : '#64748b', borderBottom: activeDashTab === 'backorder' ? '2px solid #3b82f6' : '2px solid transparent' }}
                        onClick={() => setActiveDashTab('backorder')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Package size={16} /> Backorder Products <span className="badge">{backorderProducts.length}</span>
                        </div>
                    </button>
                </div>

                {activeDashTab === 'low-stock' && (
                    <div className="alert-card" style={{ width: '60%' }}>
                        <div className="alert-card-header">
                            <AlertTriangle size={20} color="#eab308" style={{ marginRight: '8px' }} />
                            <h3>Low Stock Alerts</h3>
                            <span className="badge">{lowStockItems.length} items</span>
                        </div>

                        {loading ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Calculating stock levels...</div>
                        ) : lowStockItems.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#10b981' }}>No low stock items found across any reports.</div>
                        ) : (
                            <div className="alert-table-container">
                                <table className="dashboard-table">
                                    <thead>
                                        <tr>
                                            <th>Report</th>
                                            <th className="num">Low Stock Components</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lowStockItems.map((item, idx) => (
                                            <tr key={idx}>
                                                <td style={{ fontWeight: 600 }}>{item.reportName}</td>
                                                <td className="num" style={{ color: '#ef4444', fontWeight: 'bold' }}>{item.count} items</td>
                                                <td>
                                                    <button
                                                        className="btn-view"
                                                        onClick={() => onNavigate('reports', item.reportId)}
                                                    >
                                                        View Report
                                                    </button>
                                                    <button
                                                        className="btn-view"
                                                        style={{ marginLeft: '8px', background: 'transparent', border: '1px solid #cbd5e1', color: '#64748b' }}
                                                        onClick={() => handleIgnoreReport(item.reportId)}
                                                    >
                                                        Ignore
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeDashTab === 'backorder' && (
                    <div className="alert-card" style={{ width: '100%' }}>
                        <div className="alert-card-header">
                            <Package size={20} color="#3b82f6" style={{ marginRight: '8px' }} />
                            <h3>Backorder Products</h3>
                        </div>

                        {loading ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading backorders...</div>
                        ) : backorderProducts.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#10b981' }}>No active backorder products found.</div>
                        ) : (
                            <div className="alert-table-container">
                                <table className="dashboard-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice Number</th>
                                            <th>Shipper</th>
                                            <th>Product Name</th>
                                            <th className="num">Factory (SQM)</th>
                                            <th className="num">Shipping (SQM)</th>
                                            <th className="num">Arrived (SQM)</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {backorderProducts.map((item, idx) => (
                                            <tr key={idx}>
                                                <td style={{ fontWeight: 500 }}>{item.invoiceNo}</td>
                                                <td>{item.shipperName}</td>
                                                <td>{item.productName}</td>
                                                <td className="num">{item.factorySqm}</td>
                                                <td className="num">{item.shippingSqm}</td>
                                                <td className="num">{item.arrivedSqm}</td>
                                                <td>
                                                    <button
                                                        className="btn-view"
                                                        onClick={() => onNavigate('containers', { shipmentId: item.shipmentId })}
                                                    >
                                                        Details
                                                    </button>
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
        </div>
    );
}
