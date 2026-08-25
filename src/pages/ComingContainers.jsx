import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { Search, ChevronUp, ChevronDown, Printer, Download } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getLocalTodayStrSync } from '../utils/timezone';
import './Containers.css';

export default function ComingContainers({ isActive }) {
    const [containers, setContainers] = useState([]);
    const [filteredContainers, setFilteredContainers] = useState([]);

    const [filterEtaFrom, setFilterEtaFrom] = useState('');
    const [filterEtaTo, setFilterEtaTo] = useState('');
    const [searchContent, setSearchContent] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'eta', direction: 'asc' });

    useEffect(() => {
        if (isActive !== false) {
            loadContainers();
        }
    }, [isActive]);

    useEffect(() => {
        applyFilters();
    }, [containers, filterEtaFrom, filterEtaTo, searchContent]);

    const loadContainers = async () => {
        try {
            const db = await getDb();
            // Fetch all containers, we'll filter delivery status in JS
            const res = await db.select("SELECT * FROM containers");

            const todayStr = getLocalTodayStrSync();
            const coming = res.filter(row => {
                let status = 'not_started';
                if (row.delivery) {
                    if (row.delivery < todayStr) {
                        status = 'delivered';
                    } else {
                        status = 'on_delivery';
                    }
                }
                return status === 'on_delivery' || status === 'not_started';
            });

            setContainers(coming);
        } catch (e) {
            console.error("Failed to load containers", e);
        }
    };

    const getRowParsedData = (row) => {
        const result = { productsList: [] };
        if (row.contents) {
            try {
                const arr = JSON.parse(row.contents);
                arr.forEach(item => {
                    if (item.products) {
                        item.products.forEach(p => {
                            result.productsList.push(p.sales_description);
                        });
                    }
                });
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
                const rData = getRowParsedData(c);
                return rData.productsList.some(p => p.toLowerCase().includes(lowerSearch));
            });
        }
        setFilteredContainers(result);
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

    const sortedContainers = [...filteredContainers].sort((a, b) => {
        const key = sortConfig.key || 'eta';
        let valA = a[key] || '';
        let valB = b[key] || '';

        if (key === 'contents') {
            valA = getRowParsedData(a).productsList.join(', ');
            valB = getRowParsedData(b).productsList.join(', ');
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const getEtaStyle = (etaStr, origEtaStr) => {
        if (!etaStr || !origEtaStr) return {};
        if (etaStr !== origEtaStr) {
            return { color: '#ef4444', fontWeight: 'bold' };
        }
        return {};
    };

    const exportHTML = async (print = false) => {
        const printCols = ['cntr_no', 'contents', 'etd', 'eta', 'delivery', 'original_eta', 'memo'];
        const colLabels = {
            cntr_no: 'Container No.',
            contents: 'Contents',
            etd: 'ETD',
            eta: 'ETA',
            delivery: 'Delivery',
            original_eta: 'Original ETA',
            memo: 'Memo'
        };

        let htmlRows = '';
        sortedContainers.forEach(c => {
            htmlRows += `<tr>`;
            for (const col of printCols) {
                if (col === 'contents') {
                    htmlRows += `<td>${getRowParsedData(c).productsList.join('<br/>')}</td>`;
                } else if (col === 'eta') {
                    htmlRows += `<td style="${c.eta !== c.original_eta ? 'color: #ef4444; font-weight: bold;' : ''}">${c.eta || ''}</td>`;
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
            <div style={{ padding: '16px 24px', backgroundColor: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Coming Containers</h2>
                    </div>
                    <div className="header-actions">
                        <button className="btn-upload white-bg" onClick={() => exportHTML(true)}>
                            <Printer size={16} style={{ marginRight: '2px' }} /> Print List
                        </button>
                        <button className="btn-upload white-bg" onClick={() => exportHTML(false)}>
                            <Download size={16} style={{ marginRight: '2px' }} /> Export HTML
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                placeholder="Search container / products..."
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
                                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                title="From ETA"
                            />
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>~</span>
                            <input
                                type="date"
                                value={filterEtaTo}
                                onChange={(e) => setFilterEtaTo(e.target.value)}
                                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none' }}
                                title="To ETA"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="table-container container-list" style={{ padding: 0, flex: 1, maxWidth: '100%' }}>
                {filteredContainers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No coming containers found.</div>
                ) : (
                    <div className="excel-table-wrapper" style={{ width: '100%', border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                        <table className="excel-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th className='has-sort-icon' style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('cntr_no')}><SortIcon columnKey="cntr_no" /> Container No.</th>
                                    <th className='has-sort-icon' style={{ width: '400px', minWidth: '250px', cursor: 'pointer' }} onClick={() => handleSort('contents')}><SortIcon columnKey="contents" /> Contents</th>
                                    <th className='has-sort-icon' style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('etd')}><SortIcon columnKey="etd" /> ETD</th>
                                    <th className='has-sort-icon' style={{ width: '100px', minWidth: '100px', cursor: 'pointer' }} onClick={() => handleSort('eta')}><SortIcon columnKey="eta" /> ETA</th>
                                    <th className='has-sort-icon' style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('delivery')}><SortIcon columnKey="delivery" /> Delivery</th>
                                    <th className='has-sort-icon' style={{ width: '130px', minWidth: '130px', cursor: 'pointer' }} onClick={() => handleSort('original_eta')}><SortIcon columnKey="original_eta" /> Original ETA</th>
                                    <th className='has-sort-icon' style={{ width: '200px', minWidth: '200px', cursor: 'pointer' }} onClick={() => handleSort('memo')}><SortIcon columnKey="memo" /> Memo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedContainers.map(row => (
                                    <tr key={row.container_id}>
                                        <td><div className="readonly-cell">{row.cntr_no}</div></td>
                                        <td>
                                            <div className="readonly-cell" style={{ whiteSpace: 'normal', wordBreak: 'break-word', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {getRowParsedData(row).productsList.map((p, idx) => <div key={idx}>{p}</div>)}
                                            </div>
                                        </td>
                                        <td><div className="readonly-cell">{row.etd}</div></td>
                                        <td><div className="readonly-cell" style={getEtaStyle(row.eta, row.original_eta)}>{row.eta}</div></td>
                                        <td><div className="readonly-cell">{row.delivery}</div></td>
                                        <td><div className="readonly-cell">{row.original_eta}</div></td>
                                        <td>
                                            <div className="readonly-cell" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {row.memo}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div >
    );
}
