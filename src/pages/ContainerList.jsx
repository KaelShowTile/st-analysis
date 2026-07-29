import { useState, useEffect } from 'react';
import { getDb, getSetting } from '../db/Database';
import { Plus, Download, Calendar, Edit, FileText, CheckCircle, Navigation, XCircle, Search, Printer, ChevronDown, ChevronUp, Columns } from 'lucide-react';
import { save, confirm } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { load } from '@tauri-apps/plugin-store';
import ContainerModal from './ContainerModal';
import ContainerDetailModal from './ContainerDetailModal';
import './Containers.css';

const MultiSelectDropdown = ({ label, options, selected, onChange }) => {
    return (
        <div style={{ position: 'relative' }}>
            <details style={{ cursor: 'pointer', position: 'relative' }}>
                <summary style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', background: 'white', fontSize: '0.85rem', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {label} {selected.length > 0 ? `(${selected.length})` : ''} <ChevronDown size={14} />
                </summary>
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '8px', zIndex: 50, maxHeight: '200px', overflowY: 'auto', minWidth: '180px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                    {options.map(opt => (
                        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '0.85rem' }}>
                            <input
                                type="checkbox"
                                checked={selected.includes(opt.value)}
                                onChange={(e) => {
                                    if (e.target.checked) onChange([...selected, opt.value]);
                                    else onChange(selected.filter(v => v !== opt.value));
                                }}
                            />
                            {opt.label}
                        </label>
                    ))}
                </div>
            </details>
        </div>
    );
};

export default function ContainerList({ currentUser, onNavigateToShipment }) {
    const [years, setYears] = useState([]);
    const [activeYear, setActiveYear] = useState(new Date().getFullYear());
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [shippersMap, setShippersMap] = useState({});
    const [inventoryMap, setInventoryMap] = useState({});
    const [shipmentsMap, setShipmentsMap] = useState({});
    const [quota, setQuota] = useState({ max: 50, usage: 0 });

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [detailRecord, setDetailRecord] = useState(null);
    const [trackingIds, setTrackingIds] = useState(new Set());

    // Filter state
    const [filterShipper, setFilterShipper] = useState([]);
    const [filterPayment, setFilterPayment] = useState('');
    const [filterDeliveryStatus, setFilterDeliveryStatus] = useState([]);
    const [filterEtaFrom, setFilterEtaFrom] = useState('');
    const [filterEtaTo, setFilterEtaTo] = useState('');
    const [searchContent, setSearchContent] = useState('');

    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const defaultCols = ['cntr_no', 'hbl_no', 'shipper', 'invoice_no', 'payment', 'doc', 'contents', 'tracking', 'pol', 'etd', 'eta', 'original_eta', 'delivery', 'info', 'last_free_dtn'];
    const [visibleColumns, setVisibleColumns] = useState(defaultCols);
    const [showColumnModal, setShowColumnModal] = useState(false);

    const canWrite = currentUser?.permissions?.containers?.write;

    useEffect(() => {
        loadSidebar();
        loadMappings();
        loadQuota();
        syncTrackedContainers();
    }, []);

    useEffect(() => {
        if (activeYear) {
            loadRecords(activeYear);
        }
    }, [activeYear]);

    const loadQuota = async () => {
        try {
            const store = await load('settings.json', { autoSave: false });
            const maxVal = await store.get('max_container_tracking');
            const max = maxVal !== undefined ? parseInt(maxVal, 10) : 50;

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const key = `container_tracking_usage_${year}_${month}`;
            const usageVal = await store.get(key);
            const usage = usageVal !== undefined ? parseInt(usageVal, 10) : 0;

            setQuota({ max, usage });
        } catch (e) {
            console.error("Failed to load quota", e);
        }
    };

    const incrementQuota = async () => {
        try {
            const store = await load('settings.json', { autoSave: false });
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const key = `container_tracking_usage_${year}_${month}`;

            const usageVal = await store.get(key);
            const usage = usageVal !== undefined ? parseInt(usageVal, 10) : 0;
            const newUsage = usage + 1;
            await store.set(key, newUsage);
            await store.save();

            setQuota(prev => ({ ...prev, usage: newUsage }));
        } catch (e) {
            console.error("Failed to increment quota", e);
        }
    };

    const loadMappings = async () => {
        try {
            const db = await getDb();

            // Load Shippers (need payment_term, payment_period and deposit now)
            const shp = await db.select('SELECT shipper_id, shipper_name, payment_term, payment_period, deposit FROM shippers');
            const sMap = {};
            shp.forEach(s => {
                const sData = { name: s.shipper_name, payment_term: s.payment_term, payment_period: s.payment_period, deposit: s.deposit };
                sMap[s.shipper_id] = sData;
                sMap[s.shipper_name] = sData;
            });
            setShippersMap(sMap);

            // Load Inventory
            const inv = await db.select('SELECT product_id, sales_description FROM inventory');
            const iMap = {};
            inv.forEach(i => iMap[i.product_id] = i.sales_description);
            setInventoryMap(iMap);

            // Load Shipments mapping (to map shipment_id -> shipper & invoice)
            const shpOrders = await db.select('SELECT shipment_id, shipper, invoice_no, deposit, balance, payment_date FROM shipments');
            const soMap = {};
            shpOrders.forEach(s => soMap[s.shipment_id] = s);
            setShipmentsMap(soMap);

            const colSetting = await db.select("SELECT value FROM settings WHERE key = 'container_list_columns'");
            if (colSetting && colSetting.length > 0) {
                try {
                    setVisibleColumns(JSON.parse(colSetting[0].value));
                } catch (e) { }
            }

        } catch (e) {
            console.error('Failed to load mappings', e);
        }
    };

    const syncTrackedContainers = async () => {
        try {
            const apiUrl = await getSetting('findteu_api_url', 'https://findteu.showtile-apis.workers.dev/api');
            const apiKey = await getSetting('findteu_api_key', '');
            if (!apiKey || apiKey === 'TAURI_API_KEY') return;

            const response = await fetch(`${apiUrl}/containers`, {
                headers: { 'x-api-key': apiKey }
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

                    const subId = item.id || null;
                    const shippmentStr = JSON.stringify(item);

                    const existing = await db.select('SELECT container_id, original_eta, year FROM containers WHERE cntr_no = $1', [cntr_no]);
                    if (existing && existing.length > 0) {
                        for (const record of existing) {
                            let query = 'UPDATE containers SET track_status = $1, shippment = $2, pol = $3, etd = $4, eta = $5, origin = $6, destination = $7, subscription_id = $8';
                            let params = [finalStatus, shippmentStr, pol, etd, eta, origin, destination, subId];

                            if (!record.original_eta && eta) {
                                query += ', original_eta = $9 WHERE container_id = $10';
                                params.push(eta, record.container_id);
                            } else {
                                query += ' WHERE container_id = $9';
                                params.push(record.container_id);
                            }
                            await db.execute(query, params);

                            if (subId && (finalStatus.toLowerCase() === 'delivered' || finalStatus.toLowerCase() === 'empty returned')) {
                                const unsubSuccess = await handleUnsubscribe(subId);
                                if (unsubSuccess) {
                                    await db.execute('UPDATE containers SET subscription_id = NULL WHERE container_id = $1', [record.container_id]);
                                }
                            }

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
            const res = await db.select('SELECT * FROM containers WHERE year = $1 ORDER BY container_id ASC', [year]);
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

            // Sync HBL numbers back to shipments table
            if (data.contents) {
                try {
                    const parsedContents = JSON.parse(data.contents);
                    for (const block of parsedContents) {
                        if (block.shipment_id && block.hbl_no) {
                            await db.execute('UPDATE shipments SET hbl_no = $1 WHERE shipment_id = $2', [block.hbl_no, block.shipment_id]);
                        }
                    }
                } catch (e) { console.error("Failed to update shipment hbl_no", e); }
            }

            setModalOpen(false);
            loadRecords(activeYear);
            loadMappings(); // Reload mappings just in case hbl or shipments changed
        } catch (e) {
            console.error('Failed to save container', e);
            alert("Failed to save. Please check inputs.");
        }
    };

    const handleUnsubscribe = async (subscriptionId) => {
        try {
            const apiUrl = await getSetting('findteu_api_url', 'https://findteu.showtile-apis.workers.dev/api');
            const apiKey = await getSetting('findteu_api_key', '');
            if (!apiKey || apiKey === 'TAURI_API_KEY') return true;

            const response = await fetch(`${apiUrl}/subscriptions/${subscriptionId}`, {
                method: 'DELETE',
                headers: { 'x-api-key': apiKey }
            });
            const data = await response.json();
            if (data.success) {
                return true;
            } else {
                console.warn('Unsubscribe API returned false', data);
                return false;
            }
        } catch (e) {
            console.error('Failed to unsubscribe', e);
            return false;
        }
    };

    const handleDeleteRow = async (id, subscriptionId) => {
        if (!canWrite) return;
        const confirmed = await confirm("Are you sure you want to delete this container record?");
        if (!confirmed) return;
        try {
            if (subscriptionId) {
                await handleUnsubscribe(subscriptionId);
            }
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

    const handleDeliveryChange = async (containerId, newDelivery) => {
        if (!canWrite) return;
        try {
            const db = await getDb();
            await db.execute('UPDATE containers SET delivery = $1 WHERE container_id = $2', [newDelivery, containerId]);
            loadRecords(activeYear);
        } catch (e) {
            console.error("Failed to update delivery", e);
        }
    };

    const handleTrackClick = async (record) => {
        if (!canWrite) return;

        const apiKey = await getSetting('findteu_api_key', '');
        if (!apiKey || apiKey === 'TAURI_API_KEY') {
            alert("Tracking is disabled. Please add a valid findTEU API Key in Settings first.");
            return;
        }

        if (!record.cntr_no) {
            alert("This container does not have a CNTR No. yet. Please edit and add one first.");
            return;
        }

        setTrackingIds(prev => new Set(prev).add(record.container_id));

        try {
            const apiUrl = await getSetting('findteu_api_url', 'https://findteu.showtile-apis.workers.dev/api');
            const response = await fetch(`${apiUrl}/containers/${encodeURIComponent(record.cntr_no)}/track`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
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

                    detailsResp = await fetch(`${apiUrl}/containers/${encodeURIComponent(record.cntr_no)}`, {
                        headers: { 'x-api-key': apiKey }
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
                const subId = data.findteu_response?.data?.id || null;
                const db = await getDb();

                let query = 'UPDATE containers SET track_status = $1, shippment = $2, pol = $3, etd = $4, eta = $5, origin = $6, destination = $7, subscription_id = $8';
                let params = [finalStatus, shippmentStr, pol, etd, eta, origin, destination, subId];

                if (!record.original_eta && eta) {
                    query += ', original_eta = $9 WHERE container_id = $10';
                    params.push(eta, record.container_id);
                } else {
                    query += ' WHERE container_id = $9';
                    params.push(record.container_id);
                }

                await db.execute(query, params);

                // Increment quota after successful track
                await incrementQuota();

                // Auto unsubscribe if arrived
                if (subId && (finalStatus.toLowerCase() === 'delivered' || finalStatus.toLowerCase() === 'empty returned')) {
                    const unsubSuccess = await handleUnsubscribe(subId);
                    if (unsubSuccess) {
                        await db.execute('UPDATE containers SET subscription_id = NULL WHERE container_id = $1', [record.container_id]);
                    }
                }

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

    const exportHTML = async (print = false) => {
        let htmlRows = '';
        filteredRecords.forEach(r => {
            const rData = getRowParsedData(r);
            htmlRows += `<tr>
                <td>${r.cntr_no || ''}</td>
                <td>${rData.shippers.map(sId => shippersMap[sId]?.name || sId).join(', ')}</td>
                <td>${r.pol || ''}</td>
                <td>${r.etd || ''}</td>
                <td>${r.eta || ''}</td>
                <td>${r.original_eta || ''}</td>
                <td>${r.delivery || ''}</td>
                <td>${r.warehouse_received || ''}</td>
                <td>${r.track_status || ''}</td>
                <td>${r.info || ''}</td>
                <td>${r.internal_memo || ''}</td>
                <td>${r.last_free_dtn || ''}</td>
            </tr>`;
        });

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Container List ${activeYear}</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { size: landscape; margin: 10mm; }
    }
</style>
</head>
<body>
    <h2>Container List ${activeYear} (Records: ${filteredRecords.length})</h2>
    <table class="report-table">
        <thead>
            <tr>
                <th>Container No</th>
                <th>Shipper</th>
                <th>POL</th>
                <th>ETD</th>
                <th>ETA</th>
                <th>Original ETA</th>
                <th>Delivery</th>
                <th>WHS Received</th>
                <th>Track Status</th>
                <th>Info</th>
                <th>Internal Memo</th>
                <th>Last Free DTN</th>
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
                    defaultPath: `containers_${activeYear}.html`,
                });

                if (filePath) {
                    await writeTextFile(filePath, html);
                }
            } catch (e) {
                console.error('Failed to export HTML', e);
            }
        }
    };

    const getRowParsedData = (row) => {
        let uniqueShippers = new Set();
        let uniqueInvoices = new Set();
        let uniqueHBLs = new Set();
        let productsList = [];
        let shipmentIds = [];

        let parsedContents = [];
        try {
            if (row.contents && typeof row.contents === 'string' && row.contents.startsWith('[')) {
                parsedContents = JSON.parse(row.contents);
            } else if (row.contents) {
                parsedContents = JSON.parse(row.contents);
            }
        } catch (e) { }

        if (Array.isArray(parsedContents)) {
            parsedContents.forEach(block => {
                if (block.shipment_id) shipmentIds.push(block.shipment_id);
                const shipment = shipmentsMap[block.shipment_id];
                if (shipment) {
                    uniqueShippers.add(shipment.shipper);
                    if (shipment.invoice_no) uniqueInvoices.add(shipment.invoice_no);
                }
                if (block.hbl_no) uniqueHBLs.add(block.hbl_no);

                if (block.products && Array.isArray(block.products)) {
                    block.products.forEach(p => productsList.push(p.sales_description));
                }
            });
        }

        return {
            shippers: Array.from(uniqueShippers),
            invoices: Array.from(uniqueInvoices),
            hbls: Array.from(uniqueHBLs),
            productsList,
            shipmentIds
        };
    };

    // Derived filtered records
    const filteredRecords = records.filter(row => {
        const rData = getRowParsedData(row);

        if (filterShipper.length > 0) {
            const hasMatch = rData.shippers.some(sId => filterShipper.includes(sId.toString()));
            if (!hasMatch) return false;
        }

        if (filterPayment) {
            if (rData.shipmentIds.length === 0) return false;
            let hasUnpaid = false;
            let allPaid = true;
            rData.shipmentIds.forEach(id => {
                const s = shipmentsMap[id];
                if (s) {
                    if (s.deposit == null || s.balance == null) {
                        hasUnpaid = true;
                        allPaid = false;
                    }
                }
            });
            if (filterPayment === 'paid' && !allPaid) return false;
            if (filterPayment === 'unpaid' && !hasUnpaid) return false;
        }

        if (filterEtaFrom && row.eta < filterEtaFrom) {
            return false;
        }
        if (filterEtaTo && row.eta > filterEtaTo) {
            return false;
        }

        if (filterDeliveryStatus.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            let rowStatus = 'not_started';
            if (row.delivery) {
                if (row.delivery > today) rowStatus = 'on_delivery';
                else rowStatus = 'delivered';
            }
            if (!filterDeliveryStatus.includes(rowStatus)) return false;
        }

        if (searchContent) {
            const lowerSearch = searchContent.toLowerCase();
            const contentMatch = (row.info || '').toLowerCase().includes(lowerSearch) ||
                (row.cntr_no || '').toLowerCase().includes(lowerSearch) ||
                rData.productsList.join(' ').toLowerCase().includes(lowerSearch);
            if (!contentMatch) return false;
        }

        return true;
    });

    const handleContainerPaymentUpdate = async (containerId, sId, field, value, otherFields = {}) => {
        if (!canWrite) return;
        try {
            const db = await getDb();

            // 1. Update the Container's JSON fields
            const [cntr] = await db.select('SELECT deposit, balance, payment_date FROM containers WHERE container_id = $1', [containerId]);
            if (!cntr) return;

            let cDep = cntr.deposit ? JSON.parse(cntr.deposit) : {};
            let cBal = cntr.balance ? JSON.parse(cntr.balance) : {};
            let cPay = cntr.payment_date ? JSON.parse(cntr.payment_date) : {};

            const applyField = (f, v) => {
                if (f === 'deposit') { if (v != null) cDep[sId] = v; else delete cDep[sId]; }
                else if (f === 'balance') { if (v != null) cBal[sId] = v; else delete cBal[sId]; }
                else if (f === 'payment_date') { if (v != null) cPay[sId] = v; else delete cPay[sId]; }
            };

            applyField(field, value);
            for (const [k, v] of Object.entries(otherFields)) applyField(k, v);

            await db.execute('UPDATE containers SET deposit = $1, balance = $2, payment_date = $3 WHERE container_id = $4', [
                JSON.stringify(cDep), JSON.stringify(cBal), JSON.stringify(cPay), containerId
            ]);

            // 2. Sync UPWARD to the Shipment Order
            const allContainers = await db.select('SELECT container_id, contents, deposit, balance FROM containers');
            let allDepositPaid = true;
            let allBalancePaid = true;
            let hasContainers = false;

            for (const c of allContainers) {
                try {
                    const parsed = JSON.parse(c.contents || '[]');
                    if (parsed.some(item => item.shipment_id == sId)) {
                        hasContainers = true;
                        const depObj = c.deposit ? JSON.parse(c.deposit) : {};
                        const balObj = c.balance ? JSON.parse(c.balance) : {};

                        if (depObj[sId] == null) allDepositPaid = false;
                        if (balObj[sId] == null) allBalancePaid = false;
                    }
                } catch (e) { }
            }

            if (hasContainers) {
                const [shipment] = await db.select('SELECT shipper FROM shipments WHERE shipment_id = $1', [sId]);
                if (shipment) {
                    const [shipper] = await db.select('SELECT deposit FROM shippers WHERE shipper_id = $1', [shipment.shipper]);
                    const rate = shipper ? (shipper.deposit || 0) : 0;

                    const dbDep = allDepositPaid ? rate : null;
                    const dbBal = allBalancePaid ? (rate === 100 ? 0 : (100 - rate)) : null;

                    await db.execute(
                        'UPDATE shipments SET deposit = $1, balance = $2 WHERE shipment_id = $3',
                        [dbDep, dbBal, sId]
                    );

                    if (!allDepositPaid || (!allBalancePaid && rate < 100)) {
                        await db.execute('UPDATE shipments SET payment_date = NULL WHERE shipment_id = $1', [sId]);
                    } else if (allDepositPaid && (allBalancePaid || rate === 100)) {
                        await db.execute('UPDATE shipments SET payment_date = COALESCE(payment_date, $1) WHERE shipment_id = $2', [new Date().toISOString().split('T')[0], sId]);
                    }
                }
            }

            await loadMappings();
            await loadRecords(activeYear);
        } catch (e) {
            console.error("Failed to update container payment", e);
        }
    };

    const getEtaStyle = (etaStr, origEtaStr) => {
        if (!etaStr || !origEtaStr) return {};
        if (etaStr !== origEtaStr) {
            return { color: '#ef4444', fontWeight: 'bold' };
        }
        return {};
    };

    const getPaymentStyle = (isPaid, sId, etdStr) => {
        if (isPaid) return {};

        let period = shippersMap[sId]?.payment_period;
        if (period == null) {
            const lowerSId = String(sId).trim().toLowerCase();
            const found = Object.values(shippersMap).find(s =>
                String(s.name).trim().toLowerCase() === lowerSId ||
                String(s.shipper_id) === lowerSId
            );
            period = found?.payment_period;
        }

        if (period != null && etdStr) {
            const etd = new Date(etdStr);
            if (!isNaN(etd)) {
                const deadline = new Date(etd);
                deadline.setDate(deadline.getDate() + Number(period));

                const today = new Date();
                const diffDays = (deadline - today) / (1000 * 60 * 60 * 24);

                if (diffDays < 0) {
                    return { backgroundColor: 'rgb(255 60 60 / 85%)', color: '#fff', borderRadius: '4px', padding: '2px 4px' }; // Red for strictly overdue
                }
            }
        }

        return { backgroundColor: '#f8fafc', borderRadius: '4px', padding: '2px 4px' }; // Subtle gray for unpaid but not due or missing info
    };

    const handleManualUnsubscribe = async (containerId, subscriptionId) => {
        const confirmed = await confirm("Are you sure you want to stop tracking this container?");
        if (!confirmed) return;
        const success = await handleUnsubscribe(subscriptionId);
        if (success) {
            try {
                const db = await getDb();
                await db.execute('UPDATE containers SET subscription_id = NULL WHERE container_id = $1', [containerId]);
                loadRecords(activeYear);
                alert("Unsubscribed successfully.");
            } catch (e) {
                console.error("Failed to update DB after unsubscribe", e);
            }
        } else {
            alert("Unsubscribe failed. Please try again later.");
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dateStr;
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

    const toggleColumn = async (col) => {
        const newCols = visibleColumns.includes(col) ? visibleColumns.filter(c => c !== col) : [...visibleColumns, col];
        setVisibleColumns(newCols);
        try {
            const db = await getDb();
            await db.execute("INSERT INTO settings (key, value) VALUES ('container_list_columns', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [JSON.stringify(newCols)]);
        } catch (e) { console.error('Failed to save columns', e); }
    };

    const sortedRecords = [...filteredRecords].sort((a, b) => {
        if (!sortConfig.key) return 0;
        const key = sortConfig.key;

        let valA, valB;
        if (['cntr_no', 'pol', 'etd', 'eta', 'original_eta', 'delivery', 'info', 'last_free_dtn', 'track_status'].includes(key)) {
            valA = a[key] || '';
            valB = b[key] || '';
        } else {
            const rDataA = getRowParsedData(a);
            const rDataB = getRowParsedData(b);
            if (key === 'hbl_no') { valA = rDataA.hbls.join(','); valB = rDataB.hbls.join(','); }
            else if (key === 'shipper') { valA = rDataA.shippers.join(','); valB = rDataB.shippers.join(','); }
            else if (key === 'invoice_no') { valA = rDataA.invoices.join(','); valB = rDataB.invoices.join(','); }
            else if (key === 'contents') { valA = rDataA.productsList.join(','); valB = rDataB.productsList.join(','); }
            else { valA = ''; valB = ''; }
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

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
                        <span style={{ fontSize: '0.9rem', color: '#64748b', marginLeft: '8px' }}>
                            Subscription: {quota.usage}/{quota.max}
                        </span>
                    </div>
                    <div className="header-actions">
                        <button className="btn-upload white-bg" onClick={() => setShowColumnModal(true)}>
                            <Columns size={16} style={{ marginRight: '0' }} /> Columns
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                            <Printer size={16} style={{ marginRight: '0' }} /> Print List
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                            <Download size={16} style={{ marginRight: '0' }} /> Export HTML
                        </button>
                    </div>
                </div>

                <div style={{ padding: '12px 32px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: '250px' }}>
                        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                            type="text"
                            placeholder="Search container / products..."
                            value={searchContent}
                            onChange={e => setSearchContent(e.target.value)}
                            style={{ width: '100%', padding: '6px 10px 6px 30px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                        />
                    </div>
                    <MultiSelectDropdown
                        label="Shippers"
                        options={Object.keys(shippersMap).map(id => ({ value: id, label: shippersMap[id].name }))}
                        selected={filterShipper}
                        onChange={setFilterShipper}
                    />
                    <select
                        value={filterPayment}
                        onChange={e => setFilterPayment(e.target.value)}
                        style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem', background: 'white' }}
                    >
                        <option value="">All Payments</option>
                        <option value="paid">All Paid</option>
                        <option value="unpaid">Has Unpaid</option>
                    </select>
                    <MultiSelectDropdown
                        label="Delivery Status"
                        options={[
                            { value: 'delivered', label: 'Delivered' },
                            { value: 'on_delivery', label: 'On Delivery' },
                            { value: 'not_started', label: 'Delivery Not Started' }
                        ]}
                        selected={filterDeliveryStatus}
                        onChange={setFilterDeliveryStatus}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>ETA:</span>
                        <input
                            type="date"
                            value={filterEtaFrom}
                            onChange={e => setFilterEtaFrom(e.target.value)}
                            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                        />
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>~</span>
                        <input
                            type="date"
                            value={filterEtaTo}
                            onChange={e => setFilterEtaTo(e.target.value)}
                            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                        />
                    </div>
                </div>

                <div className="table-container container-list">
                    {loading ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading records...</div>
                    ) : (
                        <div className="excel-table-wrapper">
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        {canWrite && <th style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>Actions</th>}
                                        {visibleColumns.includes('cntr_no') && <th className="has-sort-icon" style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('cntr_no')}><SortIcon columnKey="cntr_no" /> Container No. </th>}
                                        {visibleColumns.includes('hbl_no') && <th className="has-sort-icon" style={{ width: '120px', minWidth: '120px', cursor: 'pointer' }} onClick={() => handleSort('hbl_no')}><SortIcon columnKey="hbl_no" /> HBL No.</th>}
                                        {visibleColumns.includes('shipper') && <th className="has-sort-icon" style={{ width: '150px', minWidth: '150px', cursor: 'pointer' }} onClick={() => handleSort('shipper')}><SortIcon columnKey="shipper" /> Shipper</th>}
                                        {visibleColumns.includes('invoice_no') && <th className="has-sort-icon" style={{ width: '120px', minWidth: '120px', cursor: 'pointer' }} onClick={() => handleSort('invoice_no')}><SortIcon columnKey="invoice_no" /> Invoice No.</th>}
                                        {visibleColumns.includes('payment') && <th style={{ width: '240px', minWidth: '240px' }}>Payment</th>}
                                        {visibleColumns.includes('doc') && <th style={{ width: '60px', minWidth: '60px' }}>Doc</th>}
                                        {visibleColumns.includes('contents') && <th className="has-sort-icon" style={{ width: '400px', minWidth: '250px', cursor: 'pointer' }} onClick={() => handleSort('contents')}><SortIcon columnKey="contents" /> Contents</th>}
                                        {visibleColumns.includes('tracking') && <th className="has-sort-icon" style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('track_status')}><SortIcon columnKey="track_status" /> Tracking</th>}
                                        {visibleColumns.includes('pol') && <th className="has-sort-icon" style={{ width: '150px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('pol')}><SortIcon columnKey="pol" /> POL</th>}
                                        {visibleColumns.includes('etd') && <th className="has-sort-icon" style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('etd')}><SortIcon columnKey="etd" /> ETD</th>}
                                        {visibleColumns.includes('eta') && <th className="has-sort-icon" style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('eta')}><SortIcon columnKey="eta" /> ETA</th>}
                                        {visibleColumns.includes('original_eta') && <th className="has-sort-icon" style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('original_eta')}><SortIcon columnKey="original_eta" /> Original ETA</th>}
                                        {visibleColumns.includes('delivery') && <th className="has-sort-icon" style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('delivery')}><SortIcon columnKey="delivery" /> Delivery</th>}
                                        {visibleColumns.includes('info') && <th className="has-sort-icon" style={{ width: '150px', minWidth: '150px', cursor: 'pointer' }} onClick={() => handleSort('info')}><SortIcon columnKey="info" /> Info</th>}
                                        {visibleColumns.includes('last_free_dtn') && <th className="has-sort-icon" style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('last_free_dtn')}><SortIcon columnKey="last_free_dtn" /> Last Free DTN</th>}
                                        {canWrite && <th style={{ width: '40px', minWidth: '40px' }}></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRecords.length === 0 ? (
                                        <tr>
                                            <td colSpan={canWrite ? 16 : 14} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                                                No container records found.
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedRecords.map(row => {
                                            const rData = getRowParsedData(row);
                                            return (
                                                <tr key={row.container_id}>
                                                    {canWrite && (
                                                        <td style={{ width: '120px', minWidth: '120px', textAlign: 'center', verticalAlign: 'middle' }}>
                                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                                <button className="btn-icon" onClick={() => handleEditClick(row)} title="Edit">
                                                                    <Edit size={14} />
                                                                </button>
                                                                <button
                                                                    className="btn-icon"
                                                                    title="Detail"
                                                                    onClick={() => {
                                                                        setDetailRecord(row);
                                                                        setDetailModalOpen(true);
                                                                    }}
                                                                >
                                                                    <FileText size={14} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {visibleColumns.includes('cntr_no') && <td><div className="readonly-cell">{row.cntr_no}</div></td>}
                                                    {visibleColumns.includes('hbl_no') && <td>
                                                        <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            {rData.hbls.map((hbl, i) => <div key={i}>{hbl}</div>)}
                                                            {rData.hbls.length === 0 && '-'}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('shipper') && <td>
                                                        <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            {rData.shippers.map((s, i) => <div key={i}>{shippersMap[s]?.name || s}</div>)}
                                                            {rData.shippers.length === 0 && '-'}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('invoice_no') && <td>
                                                        <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            {rData.invoices.map((inv, i) => <div key={i}>{inv}</div>)}
                                                            {rData.invoices.length === 0 && '-'}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('payment') && <td>
                                                        <div className="readonly-cell" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            {rData.shipmentIds.map((sId, i) => {
                                                                const shipment = shipmentsMap[sId];
                                                                if (!shipment) return null;
                                                                const shipper = shippersMap[shipment.shipper];
                                                                const rate = shipper ? (shipper.deposit || 0) : 0;

                                                                let cDep = {};
                                                                let cBal = {};
                                                                let cPay = {};
                                                                try { if (row.deposit) cDep = JSON.parse(row.deposit); } catch (e) { }
                                                                try { if (row.balance) cBal = JSON.parse(row.balance); } catch (e) { }
                                                                try { if (row.payment_date) cPay = JSON.parse(row.payment_date); } catch (e) { }

                                                                const isDepositPaid = cDep[sId] != null;
                                                                const isBalancePaid = cBal[sId] != null;
                                                                const currentPaymentDate = cPay[sId] || '';

                                                                const isPaid = (rate === 0 || isDepositPaid) && (rate === 100 ? isDepositPaid : isBalancePaid);
                                                                const overdueStyle = getPaymentStyle(isPaid, sId, row.etd);

                                                                return (
                                                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', ...overdueStyle }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: canWrite ? 'pointer' : 'default', fontSize: '0.8rem' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isDepositPaid}
                                                                                    disabled={!canWrite}
                                                                                    onChange={(e) => {
                                                                                        const checked = e.target.checked;
                                                                                        let dbDeposit = checked ? rate : null;
                                                                                        let dbBalance = isBalancePaid ? (cBal[sId]) : null;
                                                                                        let dbPaymentDate = currentPaymentDate;

                                                                                        if (rate === 100) {
                                                                                            if (checked) {
                                                                                                dbBalance = 0;
                                                                                                dbPaymentDate = dbPaymentDate || new Date().toISOString().split('T')[0];
                                                                                            } else {
                                                                                                dbBalance = null;
                                                                                                dbPaymentDate = null;
                                                                                            }
                                                                                        }
                                                                                        handleContainerPaymentUpdate(row.container_id, sId, 'deposit', dbDeposit, { balance: dbBalance, payment_date: dbPaymentDate });
                                                                                    }}
                                                                                />
                                                                                {rate}%
                                                                            </label>

                                                                            {rate < 100 && (
                                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: canWrite ? 'pointer' : 'default', fontSize: '0.8rem' }}>
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={isBalancePaid}
                                                                                        disabled={!canWrite}
                                                                                        onChange={(e) => {
                                                                                            const checked = e.target.checked;
                                                                                            let dbBalance = checked ? (100 - rate) : null;
                                                                                            let dbPaymentDate = (checked && isDepositPaid && !currentPaymentDate) ? new Date().toISOString().split('T')[0] : currentPaymentDate;
                                                                                            handleContainerPaymentUpdate(row.container_id, sId, 'balance', dbBalance, { payment_date: dbPaymentDate });
                                                                                        }}
                                                                                    />
                                                                                    {100 - rate}%
                                                                                </label>
                                                                            )}

                                                                            {isDepositPaid && (isBalancePaid || rate === 100) && (
                                                                                <input
                                                                                    type="date"
                                                                                    value={currentPaymentDate}
                                                                                    disabled={!canWrite}
                                                                                    onChange={(e) => handleContainerPaymentUpdate(row.container_id, sId, 'payment_date', e.target.value)}
                                                                                    style={{ padding: '0px 4px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.75rem', outline: 'none' }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            {rData.shipmentIds.length === 0 && '-'}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('doc') && <td style={{ textAlign: 'center' }}>
                                                        <div style={{
                                                            width: '12px', height: '12px', borderRadius: '50%', margin: '0 auto',
                                                            backgroundColor: (row.doc === 'true' || row.doc === '1') ? '#10b981' : '#ef4444'
                                                        }}></div>
                                                    </td>}
                                                    {visibleColumns.includes('contents') && <td>
                                                        <div className="readonly-cell" style={{ whiteSpace: 'normal', wordBreak: 'break-word', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            {rData.productsList && rData.productsList.length > 0 ? rData.productsList.map((p, idx) => <div key={idx}>{p}</div>) : '-'}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('tracking') && <td>
                                                        <div className="readonly-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {trackingIds.has(row.container_id) ? (
                                                                <span style={{ color: '#64748b', fontStyle: 'italic', fontSize: '11px' }}>Tracking...</span>
                                                            ) : row.track_status ? (
                                                                <span style={{ color: 'var(--primary-color)', fontWeight: 500, textTransform: 'capitalize', fontSize: '11px' }}>{row.track_status}</span>
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
                                                    </td>}
                                                    {visibleColumns.includes('pol') && <td><div className="readonly-cell">{row.pol}</div></td>}
                                                    {visibleColumns.includes('etd') && <td><div className="readonly-cell">{formatDate(row.etd)}</div></td>}
                                                    {visibleColumns.includes('eta') && <td><div className="readonly-cell" style={getEtaStyle(row.eta, row.original_eta)}>{formatDate(row.eta)}</div></td>}
                                                    {visibleColumns.includes('original_eta') && <td><div className="readonly-cell">{formatDate(row.original_eta)}</div></td>}
                                                    {visibleColumns.includes('delivery') && <td>
                                                        <div className="readonly-cell">
                                                            {canWrite ? (
                                                                <input
                                                                    type="date"
                                                                    className="excel-input"
                                                                    value={row.delivery || ''}
                                                                    onChange={e => handleDeliveryChange(row.container_id, e.target.value)}
                                                                />
                                                            ) : (
                                                                formatDate(row.delivery)
                                                            )}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('info') && <td>
                                                        <div className="readonly-cell" style={{ whiteSpace: 'pre-wrap' }}>
                                                            {row.info}
                                                        </div>
                                                    </td>}
                                                    {visibleColumns.includes('last_free_dtn') && <td><div className="readonly-cell">{row.last_free_dtn}</div></td>}
                                                    {canWrite && (
                                                        <td style={{ width: '40px', minWidth: '40px', textAlign: 'center', verticalAlign: 'middle' }}>
                                                            <button
                                                                className="btn-icon danger"
                                                                style={{ color: '#ef4444' }}
                                                                onClick={() => handleDeleteRow(row.container_id, row.subscription_id)}
                                                                title="Delete container"
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })
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

            {detailModalOpen && (
                <ContainerDetailModal
                    record={detailRecord}
                    onClose={() => setDetailModalOpen(false)}
                    inventoryMap={inventoryMap}
                    shippersMap={shippersMap}
                    shipmentsMap={shipmentsMap}
                    onNavigateToShipment={onNavigateToShipment}
                />
            )}
            {showColumnModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h3>Display Columns</h3>
                            <button className="btn-icon" onClick={() => setShowColumnModal(false)}><XCircle size={20} /></button>
                        </div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
                            {defaultCols.map(col => (
                                <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={visibleColumns.includes(col)} onChange={() => toggleColumn(col)} />
                                    {col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </label>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn-primary" onClick={() => setShowColumnModal(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
