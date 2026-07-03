import { useEffect, useState } from 'react';
import { getDb } from '../db/Database';
import { getCellCalculations } from '../utils/calculations';
import { Package, AlertTriangle } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard({ currentUser, onNavigate }) {
    const [lowStockItems, setLowStockItems] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = await getDb();

            // Load all reports
            const reports = await db.select('SELECT id, name, start_date, end_date, data FROM reports');

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

                // Ensure report has start_date if missing but end_date exists
                let startDate = report.start_date;
                if (!startDate && report.end_date) {
                    const ed = new Date(report.end_date);
                    ed.setDate(ed.getDate() - 30);
                    startDate = ed.toISOString().split('T')[0];
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
                                // Find product name from one of the SKUs if possible
                                let productName = report.name;
                                
                                lowStock.push({
                                    reportId: report.id,
                                    reportName: report.name,
                                    productName: productName,
                                    finish: finish.name,
                                    size: size.name,
                                    colour: colour,
                                    total: calc.total,
                                    cycle: calc.cycle
                                });
                            }
                        });
                    });
                });
            });

            // Sort low stock items by cycle (highest cycle first, or lowest total)
            lowStock.sort((a, b) => a.total - b.total);
            setLowStockItems(lowStock);

        } catch (err) {
            console.error("Failed to load dashboard data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    return (
        <div className="dashboard-layout">
            <div className="dashboard-header">
                <h2><Package size={24} style={{ marginRight: '10px' }} /> Overview Dashboard</h2>
                <p>Welcome back, {currentUser?.username || 'User'}</p>
            </div>

            <div className="dashboard-content">
                <div className="alert-card">
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
                                        <th>Finish</th>
                                        <th>Size</th>
                                        <th>Colour</th>
                                        <th className="num">Total Qty</th>
                                        <th className="num">Cycle</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lowStockItems.map((item, idx) => (
                                        <tr key={idx}>
                                            <td style={{ fontWeight: 600 }}>{item.reportName}</td>
                                            <td><span className="param-badge finish">{item.finish}</span></td>
                                            <td><span className="param-badge size">{item.size}</span></td>
                                            <td>{item.colour}</td>
                                            <td className="num" style={{ color: '#ef4444', fontWeight: 'bold' }}>{item.total.toFixed(0)}</td>
                                            <td className="num">{item.cycle.toFixed(2)}</td>
                                            <td>
                                                <button 
                                                    className="btn-view"
                                                    onClick={() => onNavigate('reports', item.reportId)}
                                                >
                                                    View Report
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
