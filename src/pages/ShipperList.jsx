import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Plus, Trash2 } from 'lucide-react';
import './Containers.css'; // Reuse container CSS since the layout is similar

export default function ShipperList({ currentUser, isActive }) {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);

    const canWrite = currentUser?.permissions?.shippers?.write;

    const loadRecords = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const res = await db.select('SELECT * FROM shippers ORDER BY shipper_id ASC');
            setRecords(res);
        } catch (e) {
            console.error('Failed to load shippers', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isActive !== false) {
            loadRecords();
        }
    }, [isActive]);

    const handleAddRow = async () => {
        if (!canWrite) return;
        try {
            const db = await getDb();
            await db.execute('INSERT INTO shippers (shipper_name, payment_term, payment_period, deposit) VALUES ($1, $2, $3, $4)', ['', '', 0, 0]);
            loadRecords();
        } catch (e) {
            console.error('Failed to add shipper', e);
        }
    };

    const handleDeleteRow = async (id) => {
        if (!canWrite) return;
        if (!window.confirm("Are you sure you want to delete this shipper?")) return;
        try {
            const db = await getDb();
            await db.execute('DELETE FROM shippers WHERE shipper_id = $1', [id]);
            loadRecords();
        } catch (e) {
            console.error('Failed to delete shipper', e);
        }
    };

    const handleCellChange = (id, key, val) => {
        // Optimistic UI update
        setRecords(prev => prev.map(r => r.shipper_id === id ? { ...r, [key]: val } : r));
    };

    const handleCellBlur = async (record, key, val) => {
        if (!canWrite) return;
        try {
            const db = await getDb();
            await db.execute(
                `UPDATE shippers SET ${key} = $1 WHERE shipper_id = $2`,
                [val, record.shipper_id]
            );
        } catch (e) {
            console.error('Failed to update shipper', e);
            alert("Failed to auto-save cell.");
            loadRecords(); // Revert optimistic update
        }
    };

    return (
        <div className="containers-main" style={{ height: '100%', flex: 1 }}>
            <div className="main-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h2 style={{ margin: 0 }}>Shippers</h2>
                    {canWrite && (
                        <button className="btn-primary" onClick={handleAddRow}>
                            <Plus size={16} style={{ marginRight: '6px' }} /> Add Row
                        </button>
                    )}
                </div>
            </div>

            <div className="table-container shipper-container">
                {loading ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading records...</div>
                ) : (
                    <div className="excel-table-wrapper">
                        <table className="excel-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '60px', minWidth: '60px' }}>ID</th>
                                    <th style={{ width: '250px', minWidth: '250px' }}>Shipper Name</th>
                                    <th style={{ width: '200px', minWidth: '200px' }}>Payment Term</th>
                                    <th style={{ width: '150px', minWidth: '150px' }}>Payment Period (Days)</th>
                                    <th style={{ width: '120px', minWidth: '120px' }}>Deposit (%)</th>
                                    {canWrite && <th style={{ width: '40px', minWidth: '40px' }}></th>}
                                </tr>
                            </thead>
                            <tbody>
                                {records.length === 0 ? (
                                    <tr>
                                        <td colSpan={canWrite ? 6 : 5} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                                            No shippers found.
                                        </td>
                                    </tr>
                                ) : (
                                    records.map(row => (
                                        <tr key={row.shipper_id}>
                                            <td style={{ width: '60px', minWidth: '60px' }}>
                                                <div className="readonly-cell">{row.shipper_id}</div>
                                            </td>
                                            <td style={{ width: '250px', minWidth: '250px' }}>
                                                <input
                                                    type="text"
                                                    className="excel-input"
                                                    value={row.shipper_name || ''}
                                                    onChange={(e) => handleCellChange(row.shipper_id, 'shipper_name', e.target.value)}
                                                    onFocus={(e) => { e.target.dataset.initial = e.target.value; }}
                                                    onBlur={(e) => {
                                                        if (e.target.dataset.initial !== e.target.value) {
                                                            handleCellBlur(row, 'shipper_name', e.target.value);
                                                        }
                                                    }}
                                                    disabled={!canWrite}
                                                />
                                            </td>
                                            <td style={{ width: '200px', minWidth: '200px' }}>
                                                <input
                                                    type="text"
                                                    className="excel-input"
                                                    value={row.payment_term || ''}
                                                    onChange={(e) => handleCellChange(row.shipper_id, 'payment_term', e.target.value)}
                                                    onFocus={(e) => { e.target.dataset.initial = e.target.value; }}
                                                    onBlur={(e) => {
                                                        if (e.target.dataset.initial !== e.target.value) {
                                                            handleCellBlur(row, 'payment_term', e.target.value);
                                                        }
                                                    }}
                                                    disabled={!canWrite}
                                                />
                                            </td>
                                            <td style={{ width: '150px', minWidth: '150px' }}>
                                                <input
                                                    type="number"
                                                    className="excel-input"
                                                    value={row.payment_period ?? ''}
                                                    onChange={(e) => handleCellChange(row.shipper_id, 'payment_period', e.target.value === '' ? null : Number(e.target.value))}
                                                    onFocus={(e) => { e.target.dataset.initial = e.target.value; }}
                                                    onBlur={(e) => {
                                                        if (e.target.dataset.initial !== String(row.payment_period ?? '')) {
                                                            handleCellBlur(row, 'payment_period', row.payment_period);
                                                        }
                                                    }}
                                                    disabled={!canWrite}
                                                />
                                            </td>
                                            <td style={{ width: '120px', minWidth: '120px' }}>
                                                <input
                                                    type="number"
                                                    className="excel-input"
                                                    value={row.deposit ?? ''}
                                                    onChange={(e) => handleCellChange(row.shipper_id, 'deposit', e.target.value === '' ? null : Number(e.target.value))}
                                                    onFocus={(e) => { e.target.dataset.initial = e.target.value; }}
                                                    onBlur={(e) => {
                                                        if (e.target.dataset.initial !== String(row.deposit ?? '')) {
                                                            handleCellBlur(row, 'deposit', row.deposit);
                                                        }
                                                    }}
                                                    disabled={!canWrite}
                                                />
                                            </td>
                                            {canWrite && (
                                                <td style={{ width: '40px', minWidth: '40px', textAlign: 'center', verticalAlign: 'middle' }}>
                                                    <button className="btn-icon danger" onClick={() => handleDeleteRow(row.shipper_id)} title="Delete row">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
