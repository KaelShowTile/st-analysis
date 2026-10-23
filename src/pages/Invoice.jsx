import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { getDb } from '../db/Database';
import { formatCustomerName } from '../utils/customerHelper';
import './Inventory.css';

export default function Invoice({ currentUser, isActive }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [renderLimit, setRenderLimit] = useState(50);

    const loadData = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const db = await getDb();
            const results = await db.select(`
                SELECT 
                    i.*,
                    c.company AS customer_company,
                    c.first_name AS customer_first_name,
                    c.last_name AS customer_last_name,
                    c.contact AS customer_contact
                FROM invoice i
                LEFT JOIN customer c ON i.customer_id = c.customer_id
                ORDER BY i.invoice_id DESC
            `);
            setData(results);
        } catch (err) {
            console.error("Failed to load invoice data:", err);
        } finally {
            if (showSpinner) setLoading(false);
        }
    };

    useEffect(() => {
        loadData(true);
        const handleSync = () => loadData(false);
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, []);

    useEffect(() => {
        if (isActive) {
            loadData(false);
        }
    }, [isActive]);

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            setRenderLimit(prev => prev + 50);
        }
    };

    const term = searchTerm.trim().toLowerCase();
    const filteredData = data.filter(item => {
        if (!term) return true;
        const invNo = String(item.invoice_no || '').toLowerCase();
        const date = String(item.invoice_date || '').toLowerCase();
        const proformaNo = String(item.proforma_invoice_no || '').toLowerCase();
        const custName = formatCustomerName(item).toLowerCase();
        return invNo.includes(term) || date.includes(term) || proformaNo.includes(term) || custName.includes(term);
    });

    const displayedData = filteredData.slice(0, renderLimit);

    return (
        <div className="inventory-container">
            <div className="toolbar" style={{ margin: '16px 24px 0' }}>
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search Invoice No, Date, Pro Forma, Customer..."
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
            </div>

            <div className="table-container" onScroll={handleScroll}>
                {loading ? (
                    <div className="loading-spinner-container">
                        <div className="spinner"></div>
                        <p>Loading invoice data, please wait...</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Invoice No</th>
                                <th>Invoice Date</th>
                                <th>Pro Forma Invoice No</th>
                                <th>Customer Name</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedData.map(item => (
                                <tr key={item.invoice_id}>
                                    <td>
                                        <span className="sku-badge">{item.invoice_no || '-'}</span>
                                    </td>
                                    <td>{item.invoice_date || '-'}</td>
                                    <td>
                                        {item.proforma_invoice_no ? (
                                            <span className="sku-badge" style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-color)' }}>
                                                {item.proforma_invoice_no}
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="product-name">{formatCustomerName(item)}</td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="empty-state">
                                        No invoices found.
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
