import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Search, ChevronUp, ChevronDown, Printer, Download } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Containers.css';

export default function ComingProducts({ isActive }) {
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [inventory, setInventory] = useState([]);

    const [filterEstDateFrom, setFilterEstDateFrom] = useState('');
    const [filterEstDateTo, setFilterEstDateTo] = useState('');
    const [searchProducts, setSearchProducts] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'est_date', direction: 'asc' });

    useEffect(() => {
        if (isActive !== false) {
            loadInitialData();
        }
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [orders, filterEstDateFrom, filterEstDateTo, searchProducts]);

    const loadInitialData = async () => {
        try {
            const db = await getDb();
            const iRes = await db.select('SELECT * FROM inventory');
            setInventory(iRes);
            await loadOrders();
        } catch (e) {
            console.error("Failed to load initial data", e);
        }
    };

    const loadOrders = async () => {
        try {
            const db = await getDb();
            const res = await db.select("SELECT * FROM shipments WHERE status IN ('open', 'processing')");
            setOrders(res);
        } catch (e) {
            console.error("Failed to load orders", e);
        }
    };

    const getProductsList = (productIdsStr) => {
        if (!productIdsStr) return [];
        if (productIdsStr.startsWith('[')) {
            try {
                const arr = JSON.parse(productIdsStr);
                return arr.map(item => ({ id: item.id.toString(), name: item.name }));
            } catch (e) { }
        }
        const ids = productIdsStr.split(',');
        return ids.map(id => {
            const item = inventory.find(i => i.product_id == id);
            return {
                id: id.toString(),
                name: item ? `${item.sku || 'No SKU'} - ${item.sales_description || ''}` : `[ID: ${id}]`
            };
        });
    };

    const applyFilters = () => {
        let result = [...orders];

        if (filterEstDateFrom) {
            result = result.filter(o => o.est_date >= filterEstDateFrom);
        }
        if (filterEstDateTo) {
            result = result.filter(o => o.est_date <= filterEstDateTo);
        }
        if (searchProducts) {
            const lowerSearch = searchProducts.toLowerCase();
            result = result.filter(o => {
                const prodList = getProductsList(o.products);
                return prodList.some(p => p.name.toLowerCase().includes(lowerSearch));
            });
        }
        setFilteredOrders(result);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <ChevronDown size={12} style={{ opacity: 0.3, marginLeft: '4px' }} />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={12} style={{ marginLeft: '4px' }} /> : <ChevronDown size={12} style={{ marginLeft: '4px' }} />;
    };

    const sortedOrders = [...filteredOrders].sort((a, b) => {
        const key = sortConfig.key || 'est_date';
        let valA = a[key] || '';
        let valB = b[key] || '';

        if (key === 'products') {
            valA = getProductsList(a.products).map(p => p.name).join(', ');
            valB = getProductsList(b.products).map(p => p.name).join(', ');
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const exportHTML = async (print = false) => {
        const printCols = ['products', 'est_date', 'note'];
        const colLabels = {
            products: 'Products',
            est_date: 'Est. Date',
            note: 'Note'
        };

        let htmlRows = '';
        sortedOrders.forEach(order => {
            htmlRows += `<tr>`;
            for (const col of printCols) {
                if (col === 'products') {
                    htmlRows += `<td>${getProductsList(order.products).map(p => p.name).join('<br/>')}</td>`;
                } else {
                    htmlRows += `<td>${order[col] || ''}</td>`;
                }
            }
            htmlRows += `</tr>`;
        });

        const headerRow = printCols.map(col => `<th>${colLabels[col]}</th>`).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Coming Products</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { margin: 10mm; }
    }
</style>
</head>
<body>
    <h2>Coming Products (Records: ${sortedOrders.length})</h2>
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
                    defaultPath: `coming_products.html`,
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
            <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Coming Products</h2>
                    </div>
                    <div className="header-actions">
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Est. Date:</span>
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

            <div className="table-container create-order-container" style={{ padding: 0, flex: 1 }}>
                {filteredOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No coming products found.</div>
                ) : (
                    <div className="excel-table-wrapper create-order-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                        <table className="excel-table">
                            <thead>
                                <tr>
                                    <th className='has-sort-icon' style={{ width: '400px', minWidth: '200px', cursor: 'pointer' }} onClick={() => handleSort('products')}><SortIcon columnKey="products" /> Products</th>
                                    <th className='has-sort-icon' style={{ width: '120px', minWidth: '120px', cursor: 'pointer' }} onClick={() => handleSort('est_date')}><SortIcon columnKey="est_date" /> Est. Date</th>
                                    <th className='has-sort-icon' style={{ width: '250px', minWidth: '200px', cursor: 'pointer' }} onClick={() => handleSort('note')}><SortIcon columnKey="note" /> Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedOrders.map(order => (
                                    <tr key={order.shipment_id}>
                                        <td>
                                            <div className="readonly-cell" style={{ whiteSpace: 'normal', wordBreak: 'break-word', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {getProductsList(order.products).map((p, idx) => <div key={idx}>{p.name}</div>)}
                                            </div>
                                        </td>
                                        <td><div className="readonly-cell">{order.est_date}</div></td>
                                        <td>
                                            <div className="readonly-cell" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {order.note}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
