import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { syncOrderBatchStatuses, isContainerDelivered } from '../utils/orderBatchSync';
import { getLocalTodayStrSync } from '../utils/timezone';
import { Search, ChevronUp, ChevronDown, Printer, Download, RefreshCw, Package, Calendar, Clock, CheckCircle2 } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Containers.css';

export default function ComingProducts({ isActive }) {
    const [batches, setBatches] = useState([]);
    const [filteredBatches, setFilteredBatches] = useState([]);

    const [filterEstDateFrom, setFilterEstDateFrom] = useState('');
    const [filterEstDateTo, setFilterEstDateTo] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'delivery', direction: 'asc' });

    const [lastUpdated, setLastUpdated] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        if (isActive !== false) {
            loadInitialData();
        }
    }, [isActive]);

    // Listen to background Turso synchronization events (instant real-time update)
    useEffect(() => {
        const handleSync = () => {
            if (isActive !== false) {
                loadInitialData(true);
            }
        };
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, [isActive]);

    // 3-minute periodic check of local mirror database
    useEffect(() => {
        if (isActive === false) return;
        const timer = setInterval(() => {
            loadInitialData(true);
        }, 3 * 60 * 1000);
        return () => clearInterval(timer);
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [batches, filterEstDateFrom, filterEstDateTo, searchQuery]);

    const loadInitialData = async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        try {
            const db = await getDb();
            // 1. Sync batch statuses based on current container delivery state
            await syncOrderBatchStatuses(db);

            // 2. Fetch all batches that are NOT delivered
            const batchRows = await db.select(`
                SELECT order_batch_id, product_id, sku, description, amount, status, created_date, order_id
                FROM order_batch
                WHERE status != 'delivered' OR status IS NULL
                ORDER BY order_batch_id DESC
            `);

            // 3. Fetch container associations for all batches
            const cobRows = await db.select(`
                SELECT cob.id as cob_id, cob.order_batch_id, cob.container_id, cob.amount as cob_amount, cob.weight,
                       c.cntr_no, c.eta, c.delivery, c.warehouse_received
                FROM container_order_batch cob
                JOIN containers c ON cob.container_id = c.container_id
                ORDER BY c.delivery ASC, c.eta ASC, cob.id ASC
            `);

            // Map containers by order_batch_id
            const cobByBatch = {};
            for (const row of cobRows) {
                if (!cobByBatch[row.order_batch_id]) {
                    cobByBatch[row.order_batch_id] = [];
                }
                cobByBatch[row.order_batch_id].push(row);
            }

            const combined = batchRows.map(b => ({
                ...b,
                containers: cobByBatch[b.order_batch_id] || []
            }));

            setBatches(combined);
            setLastUpdated(new Date().toLocaleTimeString());
        } catch (e) {
            console.error("Failed to load coming products data", e);
        } finally {
            setIsRefreshing(false);
        }
    };

    const applyFilters = () => {
        let result = [...batches];

        // 1. Search filter: SKU and description
        if (searchQuery.trim()) {
            const lowerSearch = searchQuery.trim().toLowerCase();
            result = result.filter(b => {
                const skuMatch = b.sku && b.sku.toLowerCase().includes(lowerSearch);
                const descMatch = b.description && b.description.toLowerCase().includes(lowerSearch);
                return skuMatch || descMatch;
            });
        }

        // 2. Est. Date filter: match against Delivery Date column in containers
        if (filterEstDateFrom || filterEstDateTo) {
            result = result.filter(b => {
                if (!b.containers || b.containers.length === 0) return false;
                return b.containers.some(c => {
                    if (!c.delivery) return false;
                    if (filterEstDateFrom && c.delivery < filterEstDateFrom) return false;
                    if (filterEstDateTo && c.delivery > filterEstDateTo) return false;
                    return true;
                });
            });
        }

        setFilteredBatches(result);
    };

    const sortedBatches = [...filteredBatches].sort((a, b) => {
        const key = sortConfig.key || 'delivery'; // 'delivery' or 'eta'

        const getBatchSortDate = (batch) => {
            if (!batch.containers || batch.containers.length === 0) return null;
            const validDates = batch.containers
                .map(c => c[key])
                .filter(d => d && String(d).trim() !== '')
                .sort();
            return validDates.length > 0 ? validDates[0] : null;
        };

        const dateA = getBatchSortDate(a);
        const dateB = getBatchSortDate(b);

        // Batches without date/containers must ALWAYS be placed at the very bottom
        if (!dateA && !dateB) {
            return (a.sku || '').localeCompare(b.sku || '');
        }
        if (!dateA) return 1;
        if (!dateB) return -1;

        if (dateA < dateB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (dateA > dateB) return sortConfig.direction === 'asc' ? 1 : -1;

        return (a.sku || '').localeCompare(b.sku || '');
    });

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        if (dateStr.includes('T')) {
            const [d, t] = dateStr.split('T');
            const parts = d.split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]} ${t}`;
        }
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dateStr;
    };

    const formatNumber = (val) => {
        if (val == null || val === '') return '-';
        const num = Number(val);
        if (isNaN(num)) return val;
        return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    const todayStr = getLocalTodayStrSync();

    const exportHTML = async (print = false) => {
        let htmlRows = '';

        sortedBatches.forEach(batch => {
            const conts = batch.containers || [];
            const statusLabel = batch.status === 'in_transit' ? 'In Transit' : 'Pending';
            const statusClass = batch.status === 'in_transit' ? 'badge-transit' : 'badge-pending';
            const totalSqmStr = formatNumber(batch.amount);

            if (conts.length === 0) {
                htmlRows += `
                    <tr>
                        <td class="batch-title">${batch.sku || '-'}</td>
                        <td>${batch.description || '-'}</td>
                        <td style="text-align: right; font-weight: 600;">${totalSqmStr} m²</td>
                        <td style="text-align: center;"><span class="${statusClass}">${statusLabel}</span></td>
                        <td style="color: #94a3b8; font-style: italic;">Pending assignment</td>
                        <td style="text-align: right;">-</td>
                        <td style="text-align: center;">-</td>
                        <td style="text-align: center;">-</td>
                    </tr>
                `;
            } else {
                conts.forEach((c, idx) => {
                    const delivered = isContainerDelivered(c, todayStr);
                    const deliveryDisplay = delivered
                        ? `<span class="badge-delivered">delivered</span>`
                        : (formatDate(c.delivery) || '-');
                    const etaDisplay = formatDate(c.eta) || '-';
                    const amountDisplay = c.cob_amount != null ? `${formatNumber(c.cob_amount)} m²` : '-';

                    if (idx === 0) {
                        htmlRows += `
                            <tr>
                                <td class="batch-title" rowspan="${conts.length}">${batch.sku || '-'}</td>
                                <td rowspan="${conts.length}">${batch.description || '-'}</td>
                                <td rowspan="${conts.length}" style="text-align: right; font-weight: 600;">${totalSqmStr} m²</td>
                                <td rowspan="${conts.length}" style="text-align: center;"><span class="${statusClass}">${statusLabel}</span></td>
                                <td><b>${c.cntr_no || ('#' + c.container_id)}</b></td>
                                <td style="text-align: right;">${amountDisplay}</td>
                                <td style="text-align: center;">${etaDisplay}</td>
                                <td style="text-align: center;">${deliveryDisplay}</td>
                            </tr>
                        `;
                    } else {
                        htmlRows += `
                            <tr>
                                <td><b>${c.cntr_no || ('#' + c.container_id)}</b></td>
                                <td style="text-align: right;">${amountDisplay}</td>
                                <td style="text-align: center;">${etaDisplay}</td>
                                <td style="text-align: center;">${deliveryDisplay}</td>
                            </tr>
                        `;
                    }
                });
            }
        });

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Coming Products</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; vertical-align: middle; }
    .report-table th { background: #f8fafc; font-weight: 700; color: #475569; }
    .batch-title { font-weight: 700; color: #0f172a; }
    .badge-delivered { display: inline-block; padding: 2px 6px; font-weight: 600; color: #15803d; background: #dcfce7; border-radius: 4px; font-size: 10px; border: 1px solid #bbf7d0; }
    .badge-pending { display: inline-block; padding: 2px 6px; font-weight: 600; color: #1d4ed8; background: #eff6ff; border-radius: 4px; font-size: 10px; border: 1px solid #bfdbfe; }
    .badge-transit { display: inline-block; padding: 2px 6px; font-weight: 600; color: #b45309; background: #fef3c7; border-radius: 4px; font-size: 10px; border: 1px solid #fde68a; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { margin: 10mm; }
    }
</style>
</head>
<body>
    <h2>Coming Products (Batches: ${sortedBatches.length})</h2>
    <div class="subtitle">Generated: ${new Date().toLocaleString()}</div>
    <table class="report-table">
        <thead>
            <tr>
                <th>SKU</th>
                <th>Description</th>
                <th style="text-align: right;">Total SQM</th>
                <th style="text-align: center;">Status</th>
                <th>Container No.</th>
                <th style="text-align: right;">Amount</th>
                <th style="text-align: center;">ETA</th>
                <th style="text-align: center;">Delivery Date</th>
            </tr>
        </thead>
        <tbody>
            ${htmlRows || '<tr><td colspan="8" style="text-align:center; padding: 20px; color: #94a3b8;">No coming products found.</td></tr>'}
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
            {/* Top Toolbar */}
            <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Coming Products</h2>
                        <span style={{ fontSize: '0.85rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                            {sortedBatches.length} {sortedBatches.length === 1 ? 'batch' : 'batches'}
                        </span>
                        {lastUpdated && (
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Updated: {lastUpdated}
                            </span>
                        )}
                    </div>
                    <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            className="btn-upload white-bg"
                            onClick={() => loadInitialData(false)}
                            disabled={isRefreshing}
                            title="Refresh from local mirror database"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <RefreshCw size={14} className={isRefreshing ? "spin" : ""} />
                            <span>Refresh</span>
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                            <Printer size={16} style={{ marginRight: '2px' }} /> Print
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                            <Download size={16} style={{ marginRight: '2px' }} /> Export HTML
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Search SKU, description..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '6px 12px 6px 32px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Est. Date:</span>
                            <input
                                type="date"
                                value={filterEstDateFrom}
                                onChange={(e) => setFilterEstDateFrom(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                title="From Date"
                            />
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>~</span>
                            <input
                                type="date"
                                value={filterEstDateTo}
                                onChange={(e) => setFilterEstDateTo(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                title="To Date"
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Sort by:</span>
                        <select
                            value={sortConfig.key}
                            onChange={(e) => setSortConfig(prev => ({ ...prev, key: e.target.value }))}
                            style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', outline: 'none', backgroundColor: 'white' }}
                        >
                            <option value="delivery">Delivery Date</option>
                            <option value="eta">ETA</option>
                        </select>
                        <button
                            className="btn-upload white-bg"
                            onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                            style={{ padding: '6px 10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title={sortConfig.direction === 'asc' ? 'Ascending (Earliest / A-Z)' : 'Descending (Latest / Z-A)'}
                        >
                            {sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {sortConfig.direction === 'asc' ? 'Asc' : 'Desc'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Batch Card List Container */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                {sortedBatches.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8', backgroundColor: 'white', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                        No coming products found.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1200px', margin: '0 auto' }}>
                        {sortedBatches.map(batch => {
                            const conts = batch.containers || [];
                            const isPending = !batch.status || batch.status === 'pending';

                            return (
                                <div
                                    key={batch.order_batch_id}
                                    style={{
                                        backgroundColor: 'white',
                                        borderRadius: '8px',
                                        border: '1px solid #e2e8f0',
                                        padding: '18px 22px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                        display: 'flex',
                                        flexDirection: 'column'
                                    }}
                                >
                                    {/* Card Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px' }}>
                                            <div style={{
                                                width: '38px',
                                                height: '38px',
                                                borderRadius: '8px',
                                                backgroundColor: isPending ? '#eff6ff' : '#fef3c7',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0
                                            }}>
                                                <Package size={20} color={isPending ? '#2563eb' : '#d97706'} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                                                        {batch.sku || `Batch #${batch.order_batch_id}`} - {batch.description || 'No description'}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        padding: '2px 8px',
                                                        borderRadius: '10px',
                                                        backgroundColor: isPending ? '#eff6ff' : '#fef3c7',
                                                        color: isPending ? '#1d4ed8' : '#b45309',
                                                        border: isPending ? '1px solid #bfdbfe' : '1px solid #fde68a'
                                                    }}>
                                                        {isPending ? 'Pending' : 'In Transit'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Total Batch SQM */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Total Quantity
                                            </span>
                                            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                                                {formatNumber(batch.amount)} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#64748b' }}>m²</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Card Body - Container Details Table */}
                                    {conts.length === 0 ? (
                                        <div style={{
                                            marginTop: '14px',
                                            padding: '12px 16px',
                                            backgroundColor: '#f8fafc',
                                            borderRadius: '6px',
                                            border: '1px dashed #cbd5e1',
                                            color: '#64748b',
                                            fontSize: '0.85rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <Clock size={16} color="#94a3b8" />
                                            <span>Pending container assignment</span>
                                        </div>
                                    ) : (
                                        <div style={{ marginTop: '14px', overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                                                <thead>
                                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                        <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569' }}>Container No.</th>
                                                        <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Amount</th>
                                                        <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>ETA</th>
                                                        <th style={{ padding: '8px 12px', fontWeight: 600, color: '#475569', textAlign: 'center' }}>Delivery Date</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {conts.map((c, cIdx) => {
                                                        const delivered = isContainerDelivered(c, todayStr);
                                                        return (
                                                            <tr
                                                                key={c.cob_id || cIdx}
                                                                style={{
                                                                    borderBottom: cIdx < conts.length - 1 ? '1px solid #f1f5f9' : 'none',
                                                                    backgroundColor: cIdx % 2 === 0 ? '#ffffff' : '#fafafa'
                                                                }}
                                                            >
                                                                <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1e293b' }}>
                                                                    {c.cntr_no || `#${c.container_id}`}
                                                                </td>
                                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: '#0f172a' }}>
                                                                    {c.cob_amount != null ? `${formatNumber(c.cob_amount)} m²` : '-'}
                                                                </td>
                                                                <td style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>
                                                                    {formatDate(c.eta) || '-'}
                                                                </td>
                                                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                                    {delivered ? (
                                                                        <span style={{
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            fontSize: '0.75rem',
                                                                            fontWeight: 600,
                                                                            color: '#15803d',
                                                                            backgroundColor: '#dcfce7',
                                                                            border: '1px solid #bbf7d0',
                                                                            padding: '2px 8px',
                                                                            borderRadius: '10px'
                                                                        }}>
                                                                            <CheckCircle2 size={12} /> delivered
                                                                        </span>
                                                                    ) : (
                                                                        formatDate(c.delivery) || <span style={{ color: '#94a3b8' }}>-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
