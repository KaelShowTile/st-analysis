import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Plus, Download, Upload, Calendar, Edit, FileText, CheckCircle, Navigation } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
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
    const [trackingIds, setTrackingIds] = useState(new Set());

    const canWrite = currentUser?.permissions?.containers?.write;

    useEffect(() => {
        loadSidebar();
        loadMappings();
        syncTrackedContainers();
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

    const syncTrackedContainers = async () => {
        try {
            const response = await fetch('https://findteu.showtile-apis.workers.dev/api/containers', {
                headers: { 'x-api-key': 'TAURI_API_KEY' }
            });
            if (!response.ok) return;
            const data = await response.json();
            
            if (data && data.containers && data.containers.length > 0) {
                const db = await getDb();
                let hasUpdates = false;
                for (const item of data.containers) {
                    const cntr_no = item.container_number || (item.container && item.container.number) || item.number || item.id;
                    if (!cntr_no) continue;
                    
                    let pol = null, etd = null, eta = null, origin = null, destination = null;
                    if (item.pol) {
                        pol = `${item.pol.port || ''}, ${item.pol.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                        etd = item.pol.etd_date || null;
                    }
                    if (item.pod) {
                        eta = item.pod.eta_date || null;
                    }
                    if (item.origin) {
                        origin = `${item.origin.port || ''}, ${item.origin.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                    }
                    if (item.destination) {
                        destination = `${item.destination.port || ''}, ${item.destination.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                    }
                    
                    let finalStatus = 'Tracking';
                    if (item.events && item.events.length > 0) {
                        const lastEvent = item.events[item.events.length - 1];
                        if (lastEvent.action && lastEvent.action.action_name) {
                            finalStatus = lastEvent.action.action_name.replace(/ by$/i, '').trim();
                        }
                    } else if (item.status) {
                        finalStatus = item.status;
                    }
                    
                    const shippmentStr = JSON.stringify(item);
                    
                    const existing = await db.select('SELECT container_id, original_eta, year FROM containers WHERE cntr_no = $1', [cntr_no]);
                    if (existing && existing.length > 0) {
                        for (const record of existing) {
                            let query = 'UPDATE containers SET track_status = $1, shippment = $2, pol = $3, etd = $4, eta = $5, origin = $6, destination = $7';
                            let params = [finalStatus, shippmentStr, pol, etd, eta, origin, destination];

                            if (!record.original_eta && eta) {
                                query += ', original_eta = $8 WHERE container_id = $9';
                                params.push(eta, record.container_id);
                            } else {
                                query += ' WHERE container_id = $8';
                                params.push(record.container_id);
                            }
                            await db.execute(query, params);
                            hasUpdates = true;
                        }
                    }
                }
                
                if (hasUpdates) {
                    loadRecords(activeYear);
                }
            }
        } catch (e) {
            console.error("Failed to sync containers", e);
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

    const handleDeleteRow = async (id) => {
        if (!canWrite) return;
        if (!window.confirm("Are you sure you want to delete this container record?")) return;
        try {
            const db = await getDb();
            await db.execute('DELETE FROM containers WHERE container_id = $1', [id]);
            loadRecords(activeYear);
        } catch (e) {
            console.error('Failed to delete row', e);
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

        setTrackingIds(prev => new Set(prev).add(record.container_id));

        try {
            const response = await fetch(`https://findteu.showtile-apis.workers.dev/api/containers/${encodeURIComponent(record.cntr_no)}/track`, {
                method: 'POST',
                headers: {
                    'x-api-key': 'TAURI_API_KEY',
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();

            const isFindteuSuccess = data.findteu_response && data.findteu_response.success;
            if (data.success && isFindteuSuccess) {
                // Polling logic for actual details
                let details = null;
                let detailsResp = null;
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 5000));

                    detailsResp = await fetch(`https://findteu.showtile-apis.workers.dev/api/containers/${encodeURIComponent(record.cntr_no)}`, {
                        headers: { 'x-api-key': 'TAURI_API_KEY' }
                    });

                    console.log(detailsResp);

                    if (detailsResp.status === 404) {
                        continue; // try again
                    }

                    if (detailsResp.ok) {
                        details = await detailsResp.json();
                        console.log(details);
                        break;
                    } else {
                        break; // other error
                    }
                }

                if (!details) {
                    alert("Tracking initiated, but failed to fetch details after 50 seconds. The webhook data might be delayed.");
                    return; // Skip DB update since we have no data
                }

                console.log(detailsResp);

                let pol = null, etd = null, eta = null, origin = null, destination = null;
                if (details.pol) {
                    pol = `${details.pol.port || ''}, ${details.pol.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                    etd = details.pol.etd_date || null;
                }
                if (details.pod) {
                    eta = details.pod.eta_date || null;
                }
                if (details.origin) {
                    origin = `${details.origin.port || ''}, ${details.origin.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                }
                if (details.destination) {
                    destination = `${details.destination.port || ''}, ${details.destination.country || ''}`.replace(/^, |, $/g, '').trim() || null;
                }

                let finalStatus = 'Tracking';
                if (details.events && details.events.length > 0) {
                    const lastEvent = details.events[details.events.length - 1];
                    if (lastEvent.action && lastEvent.action.action_name) {
                        finalStatus = lastEvent.action.action_name.replace(/ by$/i, '').trim();
                    }
                }

                const shippmentStr = JSON.stringify(details);
                const db = await getDb();

                let query = 'UPDATE containers SET track_status = $1, shippment = $2, pol = $3, etd = $4, eta = $5, origin = $6, destination = $7';
                let params = [finalStatus, shippmentStr, pol, etd, eta, origin, destination];

                if (!record.original_eta && eta) {
                    query += ', original_eta = $8 WHERE container_id = $9';
                    params.push(eta, record.container_id);
                } else {
                    query += ' WHERE container_id = $8';
                    params.push(record.container_id);
                }

                await db.execute(query, params);
                loadRecords(activeYear);

            } else {
                let errorMsg = data.message || 'Unknown error';
                if (!isFindteuSuccess && data.findteu_response?.error?.text) {
                    errorMsg = data.findteu_response.error.text;
                }
                alert(`Failed to track: ${errorMsg}`);
            }
        } catch (e) {
            console.error("Failed to call tracking API", e);
            alert("Failed to connect to the tracking server.");
        } finally {
            setTrackingIds(prev => {
                const next = new Set(prev);
                next.delete(record.container_id);
                return next;
            });
        }
    };

    const handleExportCSV = async () => {
        try {
            const headerArr = ['CNTR No.', 'HBL No.', 'Shipper', 'Invoice No.', 'Contents', 'POL', 'ETD', 'ETA', 'Original ETA', 'Delivery', 'Received', 'Tracking', 'Info', 'Internal Memo', 'Last Free DTN'];
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
                    r.original_eta || '',
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
                                        <th style={{ width: '110px', minWidth: '110px' }}>Original ETA</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>Delivery</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Received</th>
                                        <th style={{ width: '100px', minWidth: '100px' }}>Tracking</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Info</th>
                                        <th style={{ width: '150px', minWidth: '150px' }}>Internal Memo</th>
                                        <th style={{ width: '120px', minWidth: '120px' }}>Last Free DTN</th>
                                        {canWrite && <th style={{ width: '40px', minWidth: '40px' }}></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.length === 0 ? (
                                        <tr>
                                            <td colSpan={canWrite ? 17 : 15} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
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
                                                <td><div className="readonly-cell">{row.original_eta}</div></td>
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
                                                        {trackingIds.has(row.container_id) ? (
                                                            <span style={{ color: '#64748b', fontStyle: 'italic' }}>Tracking...</span>
                                                        ) : row.track_status ? (
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
                                                {canWrite && (
                                                    <td style={{ width: '40px', minWidth: '40px', textAlign: 'center', verticalAlign: 'middle' }}>
                                                        <button
                                                            className="btn-icon danger"
                                                            style={{ color: '#ef4444' }}
                                                            onClick={() => handleDeleteRow(row.container_id)}
                                                            title="Delete container"
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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
