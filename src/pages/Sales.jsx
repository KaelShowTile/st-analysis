import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Search, Trash2 } from 'lucide-react';
import { getDb } from '../db/Database';
import './Inventory.css'; // Reusing the same styles as Inventory page

export default function Sales() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [renderLimit, setRenderLimit] = useState(50);
    const fileInputRef = useRef(null);

    const loadData = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const db = await getDb();
            const results = await db.select('SELECT * FROM sales ORDER BY id DESC');
            setData(results);
        } finally {
            if (showSpinner) setLoading(false);
        }
    };

    useEffect(() => {
        loadData(true);
    }, []);

    const processData = async (parsedData) => {
        setLoading(true);
        try {
            const db = await getDb();
            
            const existingRecords = await db.select('SELECT DISTINCT invoice_no, sku FROM sales');
            const existingPairs = new Set(existingRecords.map(r => r.invoice_no + '|' + r.sku));

            const parseNumber = (val) => {
                if (!val) return 0;
                const num = parseFloat(String(val).replace(/,/g, '').trim());
                return isNaN(num) ? 0 : num;
            };

            for (const row of parsedData) {
                if (!row['SKU'] || String(row['SKU']).trim() === '') continue; // skip invalid rows

                const date = String(row['Date'] || '');
                const time = String(row['Time'] || '');
                const sales_person = String(row['Sales Person'] || '');
                const customer = String(row['Customer'] || '');
                const invoice_no = String(row['Invoice No'] || '');
                const sku = String(row['SKU']).trim();

                const key = invoice_no + '|' + sku;
                if (existingPairs.has(key)) {
                    continue; // Skip because it was already uploaded in a previous session
                }

                const description = String(row['Description'] || '');
                const qty = parseNumber(row['Qty']);
                const total_ex_tax = parseNumber(row['Total (Ex Tax)']);
                const cost_ex_tax = parseNumber(row['Cost (Ex Tax)']);

                await db.execute(`
                    INSERT INTO sales (
                        date, time, sales_person, customer, invoice_no, sku, description, qty, total_ex_tax, cost_ex_tax
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                    )
                `, [date, time, sales_person, customer, invoice_no, sku, description, qty, total_ex_tax, cost_ex_tax]);
            }
            loadData();
        } catch (err) {
            console.error("Data processing failed", err);
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleClearAll = async () => {
        if (!window.confirm("Are you sure you want to delete all sales data? This cannot be undone.")) return;
        setLoading(true);
        try {
            const db = await getDb();
            await db.execute('DELETE FROM sales');
            loadData();
        } catch (err) {
            console.error("Failed to clear data", err);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                processData(results.data);
            }
        });
    };

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            setRenderLimit(prev => prev + 50);
        }
    };

    const filteredData = data.filter(item =>
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.customer && item.customer.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.invoice_no && item.invoice_no.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const displayedData = filteredData.slice(0, renderLimit);

    return (
        <div className="inventory-container">
            <div className="toolbar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search SKU, Customer, Invoice..."
                        value={searchTerm}
                        onChange={e => {
                            setSearchTerm(e.target.value);
                            setRenderLimit(50);
                        }}
                        className="search-input"
                    />
                </div>
                <div style={{ color: 'var(--text-color)', fontSize: '0.9rem', marginRight: 'auto', marginLeft: '16px' }}>
                    Total Records: {filteredData.length}
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                        className="btn-upload" 
                        onClick={handleClearAll}
                        disabled={loading}
                        style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', boxShadow: '0 4px 6px rgba(239, 68, 68, 0.25)' }}
                    >
                        <Trash2 size={16} />
                        Clear All
                    </button>
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                    <button
                        className="btn-upload"
                        onClick={() => fileInputRef.current.click()}
                        disabled={loading}
                    >
                        <Upload size={16} />
                        {loading ? 'Processing...' : 'Import CSV'}
                    </button>
                </div>
            </div>

            <div className="table-container" onScroll={handleScroll}>
                {loading ? (
                    <div className="loading-spinner-container">
                        <div className="spinner"></div>
                        <p>Loading data, please wait...</p>
                    </div>
                ) : (
                    <table className="data-table">
                    <thead>
                        <tr>
                            <th>Date & Time</th>
                            <th>Invoice No</th>
                            <th>Customer</th>
                            <th>SKU</th>
                            <th>Description</th>
                            <th className="num">Qty</th>
                            <th className="num">Total (Ex Tax)</th>
                            <th className="num">Cost (Ex Tax)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedData.map(item => (
                            <tr key={item.id}>
                                <td>{item.date} {item.time}</td>
                                <td><span className="sku-badge">{item.invoice_no}</span></td>
                                <td className="product-name">{item.customer}</td>
                                <td><span className="sku-badge">{item.sku}</span></td>
                                <td>{item.description}</td>
                                <td className="num">{item.qty}</td>
                                <td className="num">${item.total_ex_tax}</td>
                                <td className="num">${item.cost_ex_tax}</td>
                            </tr>
                        ))}
                        {filteredData.length === 0 && (
                            <tr>
                                <td colSpan="8" className="empty-state">
                                    {loading ? 'Loading...' : 'No sales data found.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                )}
            </div>
        </div>
    );
}
