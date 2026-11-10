import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Search, ChevronUp, ChevronDown, Printer, Download, RefreshCw, Box, Calendar, FileText } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getLocalTodayStrSync } from '../utils/timezone';
import { isContainerDelivered } from '../utils/orderBatchSync';
import './Containers.css';

export default function ComingContainers({ isActive }) {
    const [containers, setContainers] = useState([]);
    const [filteredContainers, setFilteredContainers] = useState([]);
    const [orderBatchesMap, setOrderBatchesMap] = useState({});

    const [filterEtaFrom, setFilterEtaFrom] = useState('');
    const [filterEtaTo, setFilterEtaTo] = useState('');
    const [searchContent, setSearchContent] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'eta', direction: 'asc' });

    const [lastUpdated, setLastUpdated] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        if (isActive !== false) {
            loadContainers();
        }
    }, [isActive]);

    // Listen to background Turso synchronization events (instant real-time update)
    useEffect(() => {
        const handleSync = () => {
            if (isActive !== false) {
                loadContainers(true);
            }
        };
        window.addEventListener('database-synced', handleSync);
        return () => window.removeEventListener('database-synced', handleSync);
    }, [isActive]);

    // 3-minute periodic check of local mirror database
    useEffect(() => {
        if (isActive === false) return;
        const timer = setInterval(() => {
            loadContainers(true);
        }, 3 * 60 * 1000);
        return () => clearInterval(timer);
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [containers, filterEtaFrom, filterEtaTo, searchContent, orderBatchesMap]);

    const loadContainers = async (isSilent = false) => {
        if (!isSilent) setIsRefreshing(true);
        try {
            const db = await getDb();
            // Fetch all containers from local mirror database
            const res = await db.select("SELECT * FROM containers");

            // Fetch order_batch for product label fallback in new structure
            const batches = await db.select("SELECT order_batch_id, sku, description FROM order_batch");
            const bMap = {};
            (batches || []).forEach(b => {
                bMap[b.order_batch_id] = b;
            });
            setOrderBatchesMap(bMap);

            const todayStr = getLocalTodayStrSync();
            const coming = res.filter(row => !isContainerDelivered(row, todayStr));

            setContainers(coming);
            setLastUpdated(new Date().toLocaleTimeString());
        } catch (e) {
            console.error("Failed to load containers", e);
        } finally {
            setIsRefreshing(false);
        }
    };

    const getRowParsedData = (row) => {
        const result = { productsList: [] };

        // 1. Try new structure: shipping_order_detail
        let isNewStructure = false;
        if (row.shipping_order_detail) {
            try {
                const parsed = typeof row.shipping_order_detail === 'string'
                    ? JSON.parse(row.shipping_order_detail)
                    : row.shipping_order_detail;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    parsed.forEach(block => {
                        if (block.products && Array.isArray(block.products)) {
                            block.products.forEach(p => {
                                let label = p.batch_label;
                                if (!label && p.order_batch_id && orderBatchesMap[p.order_batch_id]) {
                                    const b = orderBatchesMap[p.order_batch_id];
                                    label = b.sku ? `${b.sku} - ${b.description || ''}` : (b.description || `Batch #${b.order_batch_id}`);
                                }
                                if (label) {
                                    result.productsList.push(label);
                                    isNewStructure = true;
                                }
                            });
                        }
                    });
                }
            } catch (e) { }
        }

        // 2. Fall back to old structure: contents
        if (!isNewStructure && row.contents) {
            try {
                const arr = typeof row.contents === 'string' ? JSON.parse(row.contents) : row.contents;
                if (Array.isArray(arr)) {
                    arr.forEach(item => {
                        if (item.products && Array.isArray(item.products)) {
                            item.products.forEach(p => {
                                if (p.sales_description) {
                                    result.productsList.push(p.sales_description);
                                } else if (p.sku) {
                                    result.productsList.push(p.sku);
                                }
                            });
                        }
                    });
                }
            } catch (e) { }
        }

        return result;
    };

    const applyFilters = () => {
        let result = [...containers];

        if (filterEtaFrom) {
            result = result.filter(c => c.eta >= filterEtaFrom);
        }
        if (filterEtaTo) {
            result = result.filter(c => c.eta <= filterEtaTo);
        }
        if (searchContent) {
            const lowerSearch = searchContent.toLowerCase();
            result = result.filter(c => {
                if (c.cntr_no && c.cntr_no.toLowerCase().includes(lowerSearch)) return true;
                if (c.memo && c.memo.toLowerCase().includes(lowerSearch)) return true;
                const rData = getRowParsedData(c);
                return rData.productsList.some(p => p.toLowerCase().includes(lowerSearch));
            });
        }
        setFilteredContainers(result);
    };

    const sortedContainers = [...filteredContainers].sort((a, b) => {
        const key = sortConfig.key || 'eta';
        let valA = a[key];
        let valB = b[key];

        if (key === 'contents') {
            valA = getRowParsedData(a).productsList.join(', ');
            valB = getRowParsedData(b).productsList.join(', ');
        }

        // Rule: Records without ETA / Delivery date value must ALWAYS be placed at the very bottom
        const isEmptyA = valA === null || valA === undefined || String(valA).trim() === '' || String(valA).toLowerCase() === 'null';
        const isEmptyB = valB === null || valB === undefined || String(valB).trim() === '' || String(valB).toLowerCase() === 'null';

        if (isEmptyA && isEmptyB) {
            const etaA = a.eta || '';
            const etaB = b.eta || '';
            if (etaA && etaB && etaA !== etaB) return etaA < etaB ? -1 : 1;
            return (a.cntr_no || '').localeCompare(b.cntr_no || '');
        }
        if (isEmptyA) return 1;
        if (isEmptyB) return -1;

        const strA = String(valA);
        const strB = String(valB);
        if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
        return (a.cntr_no || '').localeCompare(b.cntr_no || '');
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

    const exportHTML = async (print = false) => {
        const printCols = ['cntr_no', 'contents', 'eta', 'original_eta', 'delivery', 'memo'];
        const colLabels = {
            cntr_no: 'Container No.',
            contents: 'Contents',
            eta: 'ETA',
            original_eta: 'Original ETA',
            delivery: 'Delivery',
            memo: 'Memo'
        };

        let htmlRows = '';
        sortedContainers.forEach(c => {
            htmlRows += `<tr>`;
            for (const col of printCols) {
                if (col === 'contents') {
                    htmlRows += `<td>${getRowParsedData(c).productsList.join('<br/>')}</td>`;
                } else if (col === 'eta' || col === 'original_eta') {
                    htmlRows += `<td ${col === 'eta' && c.eta !== c.original_eta ? 'style="color: #ef4444; font-weight: bold;"' : ''}>${formatDate(c[col]) || ''}</td>`;
                } else if (col === 'delivery') {
                    htmlRows += `<td>${formatDate(c[col]) || ''}</td>`;
                } else {
                    htmlRows += `<td>${c[col] || ''}</td>`;
                }
            }
            htmlRows += `</tr>`;
        });

        const headerRow = printCols.map(col => `<th>${colLabels[col]}</th>`).join('');

        const html = `<!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <title>Coming Containers</title>
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
            <h2>Coming Containers (Records: ${sortedContainers.length})</h2>
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
                    defaultPath: `coming_containers.html`,
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
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Coming Containers</h2>
                        <span style={{ fontSize: '0.85rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                            {sortedContainers.length} {sortedContainers.length === 1 ? 'container' : 'containers'}
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
                            onClick={() => loadContainers(false)}
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
                        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Search container #, products, memo..."
                                value={searchContent}
                                onChange={(e) => setSearchContent(e.target.value)}
                                style={{ width: '100%', padding: '6px 12px 6px 32px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>ETA:</span>
                            <input
                                type="date"
                                value={filterEtaFrom}
                                onChange={(e) => setFilterEtaFrom(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                title="From ETA"
                            />
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>~</span>
                            <input
                                type="date"
                                value={filterEtaTo}
                                onChange={(e) => setFilterEtaTo(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '0.85rem' }}
                                title="To ETA"
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
                            <option value="eta">ETA</option>
                            <option value="delivery">Arrival Date</option>
                            <option value="cntr_no">Container No.</option>
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

            {/* Card List Container */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                {sortedContainers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8', backgroundColor: 'white', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                        No coming containers found.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1200px', margin: '0 auto' }}>
                        {sortedContainers.map(row => {
                            const rData = getRowParsedData(row);
                            const isDelayed = row.eta && row.original_eta && row.eta !== row.original_eta;

                            return (
                                <div
                                    key={row.container_id}
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
                                    {/* Card Header: Container No on left, ETA on right */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Box size={20} color="#2563eb" />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', letterSpacing: '0.3px' }}>
                                                    {row.cntr_no || 'Pending Container #'}
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                                                    {row.delivery ? (
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', backgroundColor: '#dcfce7', color: '#15803d' }}>
                                                            Arrival Date: {formatDate(row.delivery)}
                                                        </span>
                                                    ) : (
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', backgroundColor: '#f1f5f9', color: '#475569' }}>
                                                            Not Delivered
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* ETA Display */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Calendar size={15} color={isDelayed ? '#dc2626' : '#2563eb'} />
                                                <span style={{
                                                    fontSize: '0.95rem',
                                                    fontWeight: 700,
                                                    color: isDelayed ? '#dc2626' : '#1e293b'
                                                }}>
                                                    ETA: {row.eta ? formatDate(row.eta) : <span style={{ color: '#94a3b8', fontWeight: 500 }}>TBD</span>}
                                                </span>
                                            </div>
                                            {isDelayed && (
                                                <div style={{ fontSize: '0.75rem', color: '#dc2626', backgroundColor: '#fef2f2', padding: '2px 8px', borderRadius: '4px', border: '1px solid #fecaca', fontWeight: 500 }}>
                                                    Original ETA: {formatDate(row.original_eta)}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Card Body - Products List (No transport node info) */}
                                    <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                                            Products ({rData.productsList.length})
                                        </div>
                                        {rData.productsList.length > 0 ? (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {rData.productsList.map((p, idx) => (
                                                    <div
                                                        key={idx}
                                                        style={{
                                                            fontSize: '0.9rem',
                                                            color: '#334155',
                                                            backgroundColor: '#f8fafc',
                                                            padding: '8px 12px',
                                                            borderRadius: '6px',
                                                            border: '1px solid #e2e8f0',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px'
                                                        }}
                                                    >
                                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6', flexShrink: 0 }}></span>
                                                        <span style={{ wordBreak: 'break-word' }}>{p}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                                No product details recorded.
                                            </div>
                                        )}
                                    </div>

                                    {/* Card Footer - Memo */}
                                    {row.memo && (
                                        <div style={{ marginTop: '14px', padding: '10px 14px', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                            <FileText size={15} color="#d97706" style={{ marginTop: '2px', flexShrink: 0 }} />
                                            <div style={{ fontSize: '0.85rem', color: '#92400e', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                                {row.memo}
                                            </div>
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
