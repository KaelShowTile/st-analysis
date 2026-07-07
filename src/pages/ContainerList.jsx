import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Plus, Download, Upload, Calendar, Edit, FileText, CheckCircle, Navigation } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import ContainerModal from './ContainerModal';
import './Containers.css';

export default function ContainerList({ currentUser }) {
    const [years, setYears] = useState([]);
    const [activeYear, setActiveYear] = useState(new Date().getFullYear());
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);

    const [shippersMap, setShippersMap] = useState({});
    const [inventoryMap, setInventoryMap] = useState({});

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState(null);

    const canWrite = currentUser?.permissions?.containers?.write;

    useEffect(() => {
        loadSidebar();
        loadMappings();
    }, []);

    useEffect(() => {
        if (activeYear) {
            loadRecords(activeYear);
        }
    }, [activeYear]);

    const loadMappings = async () => {
        try {
            const db = await getDb();
            const shp = await db.select('SELECT shipper_id, shipper_name FROM shippers');
            const sMap = {};
            shp.forEach(s => sMap[s.shipper_id] = s.shipper_name);
            setShippersMap(sMap);

            const inv = await db.select('SELECT product_id, sales_description FROM inventory');
            const iMap = {};
            inv.forEach(i => iMap[i.product_id] = i.sales_description);
            setInventoryMap(iMap);
        } catch (e) {
            console.error('Failed to load mappings', e);
        }
    };

    const loadSidebar = async () => {
        try {
            const db = await getDb();
            const res = await db.select('SELECT DISTINCT year FROM containers ORDER BY year DESC');
            const yrList = res.map(r => r.year);
            const currentYear = new Date().getFullYear();
            if (!yrList.includes(currentYear)) {
                yrList.unshift(currentYear);
            }
            yrList.sort((a, b) => b - a);
            setYears(yrList);
        } catch (e) {
            console.error('Failed to load years', e);
        }
    };

    const loadRecords = async (year) => {
        setLoading(true);
        try {
            const db = await getDb();
            const res = await db.select('SELECT * FROM containers WHERE year = $1 ORDER BY seq ASC, container_id ASC', [year]);
            setRecords(res);
        } catch (e) {
            console.error('Failed to load records', e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddClick = () => {
        setEditingRecord(null);
        setModalOpen(true);
    };

    const handleEditClick = (record) => {
        setEditingRecord(record);
        setModalOpen(true);
    };

    const handleModalSave = async (formData) => {
        try {
            const db = await getDb();

            // Handle seq calculation for delivery
            let newSeq = editingRecord ? editingRecord.seq : null;
            if (formData.delivery) {
                if (!editingRecord || !editingRecord.delivery) {
                    const countRes = await db.select(
                        "SELECT COUNT(*) as c FROM containers WHERE year = $1 AND delivery IS NOT NULL AND delivery != ''",
                        [activeYear]
                    );
                    newSeq = countRes[0].c + 1;
                }
            } else if (editingRecord && editingRecord.delivery && !formData.delivery) {
                newSeq = null;
            }

            const data = { ...formData, seq: newSeq };
            delete data.year; // Handle year separately for insertion

            if (editingRecord) {
                // Update
                const cols = Object.keys(data);
                const vals = Object.values(data);
                const setString = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
                await db.execute(
                    `UPDATE containers SET ${setString} WHERE container_id = $${cols.length + 1}`,
                    [...vals, editingRecord.container_id]
                );
            } else {
                // Insert
                data.year = activeYear;
                const cols = Object.keys(data);
                const vals = Object.values(data);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                await db.execute(
                    `INSERT INTO containers (${cols.join(', ')}) VALUES (${placeholders})`,
                    vals
                );
            }

            setModalOpen(false);
            loadRecords(activeYear);
            loadSidebar();
        } catch (e) {
            console.error("Failed to save container", e);
            alert("Failed to save container.");
        }
    };

    const handleReceivedClick = async (containerId) => {
        if (!canWrite) return;
        try {
            const today = new Date().toISOString().split('T')[0];
            const db = await getDb();
            await db.execute('UPDATE containers SET warehouse_received = $1 WHERE container_id = $2', [today, containerId]);
            loadRecords(activeYear);
        } catch (e) {
            console.error("Failed to mark as received", e);
        }
    };

    const handleTrackClick = async (record) => {
        if (!canWrite) return;
        if (!record.cntr_no) {
            alert("This container does not have a CNTR No. yet. Please edit and add one first.");
            return;
        }

        try {
            const response = await fetch(`http://findteu.showtile-apis.workers.dev/api/containers/${encodeURIComponent(record.cntr_no)}/track`, {
                method: 'POST',
                headers: {
                    'x-api-key': 'tauri-local-secret',
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();

            if (data.success) {
                const db = await getDb();
                await db.execute('UPDATE containers SET track_status = $1 WHERE container_id = $2', ['tracking', record.container_id]);
                loadRecords(activeYear);
            } else {
                alert(`Failed to track: ${data.message || 'Unknown error'}`);
            }
        } catch (e) {
            console.error("Failed to call tracking API", e);
            alert("Failed to connect to the tracking server.");
        }
    };

    const handleExportCSV = async () => {
        try {
            const headerArr = ['CNTR No.', 'HBL No.', 'Shipper', 'Invoice No.', 'Contents', 'POL', 'ETD', 'ETA', 'Delivery', 'Received', 'Tracking', 'Info', 'Internal Memo', 'Last Free DTN'];
            const header = headerArr.join(",") + "\n";

            const rows = records.map(r => {
                const cols = [
                    r.cntr_no || '',
                    r.hbl_no || '',
                    shippersMap[r.shipper] || r.shipper || '',
                    r.invoice_no || '',
                    formatContents(r.contents),
                    r.pol || '',
                    r.etd || '',
                    r.eta || '',
                    r.delivery || '',
                    r.warehouse_received || '',
                    r.track_status || '',
                    r.info || '',
                    r.internal_memo || '',
                    r.last_free_dtn || ''
                ];
                return cols.map(val => {
                    let v = String(val);
                    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
                        return `"${v.replace(/"/g, '""')}"`;
                    }
                    return v;
                }).join(",");
            }).join("\n");

            const filePath = await save({
                filters: [{ name: 'CSV File', extensions: ['csv'] }],
                defaultPath: `containers_${activeYear}.csv`,
            });

            if (filePath) {
                await writeTextFile(filePath, header + rows);
                alert("File exported successfully!");
            }
        } catch (e) {
            console.error('Failed to export', e);
            alert("Failed to export file.");
        }
    };

    const formatContents = (contentsStr) => {
        if (!contentsStr) return '';
        const ids = contentsStr.split(',').filter(x => x);
        return ids.map(id => inventoryMap[id] || `[ID: ${id}]`).join(' | ');
    };

    return (
        <div className="containers-layout">
            <div className="containers-sidebar">
                <div className="sidebar-header">
                    <h3>Years</h3>
                </div>
                <ul className="year-list">
                    {years.map(yr => (
                        <li
                            key={yr}
                            className={`year-item ${yr === activeYear ? 'active' : ''}`}
                            onClick={() => setActiveYear(yr)}
                        >
                            <Calendar size={16} style={{ marginRight: '8px' }} /> {yr}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="containers-main">
                <div className="main-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0 }}>Container List {activeYear}</h2>
                        {canWrite && (
                            <button className="btn-primary" onClick={handleAddClick}>
                                <Plus size={16} style={{ marginRight: '6px' }} /> Add Row
                            </button>
                        )}
                    </div>
                    <div className="header-actions">
                        <button className="btn-secondary" onClick={handleExportCSV}>
                            <Download size={16} style={{ marginRight: '6px' }} /> Export
                        </button>
                    </div>
                </div>

                <div className="table-container">
                    {loading ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading records...</div>
                    ) : (
                        <div className="excel-table-wrapper">
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        {canWrite && <th style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>Actions</th>}
                                        <th style={{ width: '120px', minWidth: '120px' }}>Container Number</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>HBL No.</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Shipper</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Invoice No.</th>
                                        <th style={{ width: '200px', minWidth: '200px' }}>Contents</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>POL</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>ETD</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>ETA</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>Delivery</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Received</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>Tracking</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Info</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Internal Memo</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Last Free DTN</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.length === 0 ? (
                                        <tr>
                                            <td colSpan={canWrite ? 15 : 14} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                                                No container records for {activeYear}.
                                            </td>
                                        </tr>
                                    ) : (
                                        records.map(row => (
                                            <tr key={row.container_id}>
                                                {canWrite && (
                                                    <td style={{ width: '80px', minWidth: '80px', textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                            <button className="btn-icon" onClick={() => handleEditClick(row)} title="Edit">
                                                                <Edit size={14} />
                                                            </button>
                                                            <button className="btn-icon" title="Detail (Coming soon)">
                                                                <FileText size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                )}
                                                <td><div className="readonly-cell">{row.cntr_no}</div></td>
                                                <td><div className="readonly-cell">{row.hbl_no}</div></td>
                                                <td><div className="readonly-cell">{shippersMap[row.shipper] || row.shipper}</div></td>
                                                <td><div className="readonly-cell">{row.invoice_no}</div></td>
                                                <td><div className="readonly-cell">{formatContents(row.contents)}</div></td>
                                                <td><div className="readonly-cell">{row.pol}</div></td>
                                                <td><div className="readonly-cell">{row.etd}</div></td>
                                                <td><div className="readonly-cell">{row.eta}</div></td>
                                                <td><div className="readonly-cell">{row.delivery}</div></td>
                                                <td>
                                                    <div className="readonly-cell">
                                                        {row.warehouse_received ? (
                                                            row.warehouse_received
                                                        ) : (
                                                            canWrite ? (
                                                                <button
                                                                    className="btn-secondary"
                                                                    style={{ padding: '2px 8px', fontSize: '11px', height: 'auto' }}
                                                                    onClick={() => handleReceivedClick(row.container_id)}
                                                                >
                                                                    <CheckCircle size={12} style={{ marginRight: '4px' }} /> Received
                                                                </button>
                                                            ) : ''
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="readonly-cell">
                                                        {row.track_status ? (
                                                            <span style={{ color: 'var(--primary-color)', fontWeight: 500, textTransform: 'capitalize' }}>{row.track_status}</span>
                                                        ) : (
                                                            canWrite ? (
                                                                <button
                                                                    className="btn-primary"
                                                                    style={{ padding: '2px 8px', fontSize: '11px', height: 'auto' }}
                                                                    onClick={() => handleTrackClick(row)}
                                                                >
                                                                    <Navigation size={12} style={{ marginRight: '4px' }} /> Track
                                                                </button>
                                                            ) : ''
                                                        )}
                                                    </div>
                                                </td>
                                                <td><div className="readonly-cell" style={{ whiteSpace: 'pre-wrap' }}>{row.info}</div></td>
                                                <td><div className="readonly-cell" style={{ whiteSpace: 'pre-wrap' }}>{row.internal_memo}</div></td>
                                                <td><div className="readonly-cell">{row.last_free_dtn}</div></td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {modalOpen && (
                <ContainerModal
                    record={editingRecord}
                    year={activeYear}
                    onClose={() => setModalOpen(false)}
                    onSave={handleModalSave}
                />
            )}
        </div>
    );
}
