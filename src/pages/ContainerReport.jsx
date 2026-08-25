import { getLocalTodayStrSync, getLocalStrFromDate } from '../utils/timezone';
import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import ContainerDetailModal from './ContainerDetailModal';
import ContainerModal from './ContainerModal';
import './Containers.css';

export default function ContainerReport({ currentUser, onNavigateToShipment, isActive }) {
    const [chartData, setChartData] = useState({ monthlyArrivals: [], originStats: [], shipperStats: [], forwarderStats: [] });
    const [lists, setLists] = useState({
        delayed: [],
        inTransit: [],
        arrivedThisMonth: [],
        unpaid: [],
        pendingDocs: []
    });
    const [loadError, setLoadError] = useState(null);
    const [loading, setLoading] = useState(true);

    // Mappings for Detail Modal
    const [shippersMap, setShippersMap] = useState({});
    const [inventoryMap, setInventoryMap] = useState({});
    const [shipmentsMap, setShipmentsMap] = useState({});
    const [forwardersMap, setForwardersMap] = useState({});

    const currentYear = new Date().getFullYear();
    const [chart1Dates, setChart1Dates] = useState({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` });
    const [chart2Dates, setChart2Dates] = useState({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` });
    const [chart3Dates, setChart3Dates] = useState({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` });
    const [allContainers, setAllContainers] = useState([]);

    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [detailRecord, setDetailRecord] = useState(null);

    useEffect(() => {
        if (isActive !== false) {
            loadData();
        }
    }, [isActive]);

    useEffect(() => {
        if (allContainers.length > 0) {
            calculateChartData(allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap, forwardersMap);
        }
    }, [allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap, forwardersMap]);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const [containers, shippers, inventory, shipments, oceanShippers] = await Promise.all([
                db.select('SELECT * FROM containers'),
                db.select('SELECT * FROM shippers'),
                db.select('SELECT * FROM inventory'),
                db.select('SELECT * FROM shipments'),
                db.select('SELECT * FROM ocean_shippers')
            ]);

            const sMap = {};
            shippers.forEach(s => {
                sMap[s.shipper_id] = s;
                // Also map by name to support old data where names were stored instead of IDs
                sMap[s.shipper_name] = s;
            });
            setShippersMap(sMap);

            const iMap = {};
            inventory.forEach(i => iMap[i.product_id] = i);
            setInventoryMap(iMap);


            const smMap = {};
            shipments.forEach(s => smMap[s.shipment_id] = s);
            setShipmentsMap(smMap);

            const fMap = {};
            if (oceanShippers) {
                oceanShippers.forEach(os => fMap[os.ocean_shipper_id] = os);
            }
            setForwardersMap(fMap);


            setAllContainers(containers);
            calculateChartData(containers, chart1Dates, chart2Dates, chart3Dates, sMap, smMap);
            calculateLists(containers, sMap, shipments);
            setLoadError(null);
        } catch (e) {
            console.error("Failed to load container data for report", e);
            setLoadError(e.toString() + "\\n" + (e.stack || ""));
        } finally {
            setLoading(false);
        }
    };

    const calculateChartData = (containers, dates1, dates2, dates3, sMap = shippersMap, smMap = shipmentsMap, fMap = forwardersMap) => {
        const arrived = containers.filter(c => c.track_status && (c.track_status.toLowerCase() === 'delivered' || c.track_status.toLowerCase() === 'empty returned'));

        const monthMap = {};
        const start1 = new Date(dates1.start);
        const end1 = new Date(dates1.end);

        let monthlyArrivals = [];
        if (!isNaN(start1) && !isNaN(end1)) {
            const months = [];
            let curr = new Date(start1.getFullYear(), start1.getMonth(), 1);
            const endMonth = new Date(end1.getFullYear(), end1.getMonth(), 1);
            while (curr <= endMonth) {
                const label = curr.toLocaleString('default', { month: 'short', year: 'numeric' });
                months.push(label);
                monthMap[label] = 0;
                curr.setMonth(curr.getMonth() + 1);
            }

            arrived.forEach(c => {
                const dateStr = c.delivery || c.eta;
                if (!dateStr) return;
                const d = new Date(dateStr);
                if (isNaN(d)) return;
                if (d >= start1 && d <= end1) {
                    const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
                    if (monthMap[label] !== undefined) {
                        monthMap[label]++;
                    }
                }
            });

            monthlyArrivals = months.map(name => ({
                name,
                Count: monthMap[name]
            }));
        }

        const start2 = new Date(dates2.start);
        const end2 = new Date(dates2.end);
        let originStats = [];

        if (!isNaN(start2) && !isNaN(end2)) {
            const originCounts = {};
            containers.forEach(c => {
                const dateStr = c.delivery || c.eta || c.etd;
                if (!dateStr) return;
                const d = new Date(dateStr);
                if (!isNaN(d) && d >= start2 && d <= end2) {
                    const org = c.origin || 'Unknown';
                    originCounts[org] = (originCounts[org] || 0) + 1;
                }
            });

            originStats = Object.keys(originCounts).map(org => ({
                name: org,
                Count: originCounts[org]
            })).sort((a, b) => b.Count - a.Count);
        }

        const start3 = new Date(dates3.start);
        const end3 = new Date(dates3.end);
        let shipperStats = [];
        let forwarderStats = [];

        if (!isNaN(start3) && !isNaN(end3)) {
            const shipperCounts = {};
            const forwarderCounts = {};
            containers.forEach(c => {
                const dateStr = c.delivery || c.eta || c.etd;
                if (!dateStr) return;
                const d = new Date(dateStr);
                if (!isNaN(d) && d >= start3 && d <= end3) {
                    let cShippers = new Set();
                    if (c.shipper) {
                        String(c.shipper).split(',').forEach(s => cShippers.add(s.trim()));
                    }
                    try {
                        if (c.contents && typeof c.contents === 'string' && c.contents.startsWith('[')) {
                            const parsed = JSON.parse(c.contents);
                            parsed.forEach(block => {
                                if (block.shipper) {
                                    String(block.shipper).split(',').forEach(s => cShippers.add(s.trim()));
                                }
                                if (block.shipment_id) {
                                    const shipment = smMap[block.shipment_id];
                                    if (shipment && shipment.shipper) {
                                        String(shipment.shipper).split(',').forEach(s => cShippers.add(s.trim()));
                                    }
                                }
                            });
                        }
                    } catch (e) { }

                    cShippers.forEach(sId => {
                        const sName = sMap[sId]?.shipper_name || sMap[sId]?.name || sId;
                        shipperCounts[sName] = (shipperCounts[sName] || 0) + 1;
                    });

                    if (c.ocean_shipper) {
                        const fName = fMap[c.ocean_shipper]?.ocean_shipper_name || c.ocean_shipper;
                        forwarderCounts[fName] = (forwarderCounts[fName] || 0) + 1;
                    }
                }
            });

            if (Object.keys(forwarderCounts).length > 0) {
                forwarderStats = Object.keys(forwarderCounts).map(name => ({
                    name,
                    Count: forwarderCounts[name]
                })).sort((a, b) => b.Count - a.Count).slice(0, 5);
            }

            shipperStats = Object.keys(shipperCounts).map(name => ({
                name,
                Count: shipperCounts[name]
            })).sort((a, b) => b.Count - a.Count).slice(0, 5);
        }

        setChartData({ monthlyArrivals, originStats, shipperStats, forwarderStats });
    };

    const calculateLists = (containers, sMap, shipmentsData = []) => {
        const todayStr = getLocalTodayStrSync();
        const now = new Date();
        const firstDayOfMonth = getLocalStrFromDate(new Date(now.getFullYear(), now.getMonth(), 1));

        const soMap = {};
        shipmentsData.forEach(s => soMap[s.shipment_id] = s);

        const delayed = [];
        const inTransit = [];
        const unpaid = [];
        const debugLogs = [];

        const pendingDocs = containers
            .filter(c => c.doc !== 'true' && c.doc !== true)
            .sort((a, b) => {
                const dateA = a.etd ? new Date(a.etd) : new Date(0);
                const dateB = b.etd ? new Date(b.etd) : new Date(0);
                return dateA - dateB;
            });

        containers.forEach(c => {
            // 2. Delayed (ETA and Original ETA not equal, AND no delivery date)
            if (c.eta && c.original_eta && c.eta !== c.original_eta) {
                delayed.push(c);
            }

            // 3. In Transit
            if (c.delivery && c.delivery > todayStr) {
                inTransit.push(c);
            }
        });

        // 4. Unpaid Containers
        containers.forEach(c => {
            let cDep = {};
            let cBal = {};
            try { if (c.deposit) cDep = JSON.parse(c.deposit); } catch (e) { }
            try { if (c.balance) cBal = JSON.parse(c.balance); } catch (e) { }
            let parsedContents = [];
            try { if (c.contents) parsedContents = JSON.parse(c.contents); } catch (e) { }

            let hasUnpaidShipments = false;
            let isOverdue = false;
            const cShippers = new Set();

            parsedContents.forEach(block => {
                if (block.shipment_id && soMap[block.shipment_id]) {
                    const sId = block.shipment_id;
                    const shipment = soMap[sId];
                    if (shipment.shipper) {
                        String(shipment.shipper).split(',').forEach(s => cShippers.add(s.trim()));
                    }

                    const shipper = sMap[shipment.shipper];
                    const dRate = shipper ? (shipper.deposit || 0) : 0;
                    const bRate = 100 - dRate;
                    const paymentPeriod = shipper ? (shipper.payment_period || 0) : 0;

                    let isShipmentUnpaid = false;
                    if (dRate > 0 && cDep[sId] == null) {
                        isShipmentUnpaid = true;
                    }
                    if (bRate > 0 && cBal[sId] == null) {
                        isShipmentUnpaid = true;
                    }

                    if (isShipmentUnpaid) {
                        hasUnpaidShipments = true;
                        if (c.etd) {
                            const etdDateObj = new Date(c.etd);
                            if (!isNaN(etdDateObj)) {
                                etdDateObj.setUTCDate(etdDateObj.getUTCDate() + Number(paymentPeriod));
                                const overdueDateStr = getLocalStrFromDate(etdDateObj);
                                if (todayStr > overdueDateStr) {
                                    isOverdue = true;
                                }
                            }
                        }
                    }
                }
            });

            if (hasUnpaidShipments && parsedContents.length > 0 && c.etd && todayStr > c.etd) {
                let status = isOverdue ? 'Overdue' : 'Unpaid';

                const shipperNames = Array.from(cShippers).map(sId => sMap[sId]?.name || sMap[sId]?.shipper_name || sId).join(', ');

                unpaid.push({
                    ...c, // keep container details for handleRowClick
                    name: ` ${c.cntr_no || 'N/A'}`,
                    shipper_name: shipperNames,
                    dateVal: c.etd,
                    isOverdue,
                    status
                });
            }
        });

        // Sort lists (newest first based on ID for simplicity, or delivery/eta if wanted. ID is fine)
        delayed.sort((a, b) => b.container_id - a.container_id);
        inTransit.sort((a, b) => b.container_id - a.container_id);
        unpaid.sort((a, b) => b.container_id - a.container_id);

        setLists({
            pendingDocs,
            delayed,
            inTransit,
            unpaid,
            debugLogs
        });
    };

    const handleRowClick = (record, title) => {
        if (!record.container_id) {
            if (record.shipment_id && onNavigateToShipment) {
                onNavigateToShipment(record.shipment_id);
            }
            return;
        }
        setDetailRecord(record);
        if (title === 'Docs Not Ready' || title === 'Containers in Transit') {
            setEditModalOpen(true);
        } else {
            setDetailModalOpen(true);
        }
    };

    if (loading) {
        return <div style={{ padding: '24px', color: 'var(--text-color)' }}>Loading charts...</div>;
    }

    const renderList = (title, headers, items, renderColumns) => (
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: '#334155', fontSize: '1rem', fontWeight: '600' }}>{title} <span style={{ color: '#94a3b8', fontSize: '1rem' }}>({items.length})</span></h3>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: '600px' }}>
                {items.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>No records found.</div>
                ) : (
                    <table className="container-status-list" style={{ border: 'none', width: '100%' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)', color: '#64748b', fontSize: '0.85rem', textAlign: 'left' }}>
                                {headers.map((h, i) => <th key={i} style={{ padding: '8px', fontWeight: '500' }}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => (
                                <tr
                                    key={(item.container_id || item.shipment_id) + '_' + idx}
                                    onClick={() => handleRowClick(item, title)}
                                    style={{ cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    {renderColumns(item)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );

    return (
        <div className="report-dashboard" style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--bg-color)', position: 'relative' }}>
            <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {loadError && (
                    <div style={{ padding: '16px', background: '#fee2e2', borderRadius: '8px', border: '1px solid #ef4444', color: '#b91c1c', whiteSpace: 'pre-wrap' }}>
                        <strong>FATAL ERROR DURING LOAD:</strong><br />
                        {loadError}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '24px' }}>
                    {renderList('Docs Not Ready', ['Container No', 'ETA'], lists.pendingDocs, (item) => (
                        <>
                            <td style={{ width: '50%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1e293b' }}>{item.cntr_no || 'Unknown'}</div>
                            </td>
                            <td style={{ width: '50%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 500 }}>{item.etd || 'Unknown'}</div>
                            </td>
                        </>
                    ))}

                    {renderList('Delayed Containers', ['Container No', 'Original ETA', 'Current ETA'], lists.delayed, (item) => (
                        <>
                            <td style={{ width: '40%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1e293b' }}>{item.cntr_no || 'Unknown'}</div>
                            </td>
                            <td style={{ width: '30%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{item.original_eta}</div>
                            </td>
                            <td style={{ width: '30%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 600 }}>{item.eta}</div>
                            </td>
                        </>
                    ))}

                    {renderList('Containers in Transit', ['Container No', 'Delivery'], lists.inTransit, (item) => (
                        <>
                            <td style={{ width: '50%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1e293b' }}>{item.cntr_no || 'Unknown'}</div>
                            </td>
                            <td style={{ width: '50%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 500 }}>{item.delivery}</div>
                            </td>
                        </>
                    ))}

                    {renderList('Unpaid & Overdue', ['Container', 'ETA', 'Status'], lists.unpaid, (item) => (
                        <>
                            <td style={{ width: '40%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>{item.name}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.shipper_name}</div>
                            </td>
                            <td style={{ width: '35%', padding: '8px' }}>
                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                    {item.dateVal}
                                </div>
                            </td>
                            <td style={{ width: '25%', padding: '8px' }}>
                                <div style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    display: 'inline-block',
                                    backgroundColor: item.status === 'Overdue' ? '#fee2e2' : item.status === 'Pending' ? '#f1f5f9' : '#fef08a',
                                    color: item.status === 'Overdue' ? '#ef4444' : item.status === 'Pending' ? '#64748b' : '#ca8a04'
                                }}>
                                    {item.status}
                                </div>
                            </td>
                        </>
                    ))}
                </div>

                <h2 style={{ marginTop: '24px', color: '#1e293b' }}>Container Analytics Overview</h2>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                Arrived Containers ({chartData.monthlyArrivals?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input type="date" value={chart1Dates.start} onChange={e => setChart1Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                <span>-</span>
                                <input type="date" value={chart1Dates.end} onChange={e => setChart1Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={chartData.monthlyArrivals} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                <Bar dataKey="Count" fill="var(--primary-color)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                Shipments by Origin ({chartData.originStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input type="date" value={chart2Dates.start} onChange={e => setChart2Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                <span>-</span>
                                <input type="date" value={chart2Dates.end} onChange={e => setChart2Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={chartData.originStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                <Bar dataKey="Count" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                    {chartData.originStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--primary-color)' : '#38bdf8'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', gridColumn: '1 / -1' }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                    Top 5 Shippers by Container Volume ({chartData.shipperStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="date" value={chart3Dates.start} onChange={e => setChart3Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    <span>-</span>
                                    <input type="date" value={chart3Dates.end} onChange={e => setChart3Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                </div>
                            </div>
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart data={chartData.shipperStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                    <Bar dataKey="Count" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                        {chartData.shipperStats && chartData.shipperStats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#34d399' : '#10b981'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                    Top 5 Forwarders by Container Volume ({chartData.forwarderStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="date" value={chart3Dates.start} onChange={e => setChart3Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    <span>-</span>
                                    <input type="date" value={chart3Dates.end} onChange={e => setChart3Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                </div>
                            </div>
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart data={chartData.forwarderStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                    <Bar dataKey="Count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                        {chartData.forwarderStats && chartData.forwarderStats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#60a5fa' : '#3b82f6'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

            </div>

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

            {editModalOpen && (
                <ContainerModal
                    currentUser={currentUser}
                    record={detailRecord}
                    shippers={Object.values(shippersMap)}
                    onClose={() => {
                        setEditModalOpen(false);
                        loadData();
                    }}
                />
            )}
        </div>
    );
}
