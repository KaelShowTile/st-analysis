import { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getDb } from '../db/Database';
import CustomerModal from '../components/CustomerModal';
import './Inventory.css';

const joinParts = (...parts) => parts.map(p => (p ?? '').toString().trim()).filter(Boolean).join(' ');

export default function Customers({ currentUser }) {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [modalCustomer, setModalCustomer] = useState(null); // null = closed, {} = add, record = edit

    const p = currentUser?.permissions || {};
    const canWrite = p.admin || p.customers?.write;

    // All reads come from the local replica (0 remote row reads).
    const loadData = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const db = await getDb();
            const rows = await db.select('SELECT * FROM customer ORDER BY customer_id DESC');
            setCustomers(rows);
        } catch (err) {
            console.error('Failed to load customers', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        loadData(true); 
        const handleSync = () => loadData(false);
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, []);

    const handleDelete = async (c) => {
        const label = c.company || joinParts(c.first_name, c.last_name) || `#${c.customer_id}`;
        if (!(await confirm(`Are you sure you want to delete customer "${label}"?`))) return;
        try {
            const db = await getDb();
            await db.execute('DELETE FROM customer WHERE customer_id = $1', [c.customer_id]);
            if (db.sync) await db.sync();
            setCustomers(prev => prev.filter(x => x.customer_id !== c.customer_id));
        } catch (err) {
            console.error('Failed to delete customer', err);
            alert('Failed to delete customer: ' + err);
        }
    };

    const term = search.trim().toLowerCase();
    const filtered = term
        ? customers.filter(c => [
            c.company, c.first_name, c.last_name, c.contact, c.email, c.tel1, c.tel2,
            c.street, c.city, c.state, c.postcode, c.st_login_name, c.abn
        ].some(v => (v ?? '').toString().toLowerCase().includes(term)))
        : customers;

    return (
        <div className="inventory-container">
            <div className="toolbar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        id="customer-search"
                        type="text"
                        placeholder="Search customers..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="search-input"
                    />
                </div>
                <div style={{ color: 'var(--text-color)', fontSize: '0.9rem', marginRight: 'auto', marginLeft: '16px' }}>
                    Total Records: {filtered.length}
                </div>
                <button
                    id="add-customer-btn"
                    className="btn-upload"
                    onClick={() => setModalCustomer({})}
                    disabled={!canWrite}
                    style={{
                        background: canWrite ? 'var(--primary-color)' : '#d1d5db',
                        cursor: canWrite ? 'pointer' : 'not-allowed',
                        opacity: canWrite ? 1 : 0.6
                    }}
                >
                    <Plus size={16} />
                    Add Customer
                </button>
            </div>

            <div className="table-container">
                {loading ? (
                    <div className="loading-spinner-container">
                        <div className="spinner"></div>
                        <p>Loading data, please wait...</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: '90px' }}>Action</th>
                                <th>Company</th>
                                <th>Name</th>
                                <th>Contact</th>
                                <th>Email</th>
                                <th>Tel1</th>
                                <th>Address</th>
                                <th>ST Account</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={8} style={{ textAlign: 'center', opacity: 0.6, padding: '24px' }}>No customers found</td></tr>
                            ) : filtered.map(c => (
                                <tr key={c.customer_id}>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                title="Edit"
                                                disabled={!canWrite}
                                                onClick={() => setModalCustomer(c)}
                                                style={{ background: 'none', border: 'none', cursor: canWrite ? 'pointer' : 'not-allowed', color: 'var(--primary-color)', opacity: canWrite ? 1 : 0.4 }}
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                title="Delete"
                                                disabled={!canWrite}
                                                onClick={() => handleDelete(c)}
                                                style={{ background: 'none', border: 'none', cursor: canWrite ? 'pointer' : 'not-allowed', color: '#ef4444', opacity: canWrite ? 1 : 0.4 }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="product-name">{c.company}</td>
                                    <td>{joinParts(c.first_name, c.last_name)}</td>
                                    <td>{c.contact}</td>
                                    <td>{c.email}</td>
                                    <td>{c.tel1}</td>
                                    <td>{joinParts(c.street, c.city, c.state, c.postcode)}</td>
                                    <td>{c.st_login_name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {modalCustomer && (
                <CustomerModal
                    customer={modalCustomer}
                    onClose={() => setModalCustomer(null)}
                    onSaved={() => { setModalCustomer(null); loadData(); }}
                />
            )}
        </div>
    );
}
