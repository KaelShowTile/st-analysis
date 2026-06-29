import { useState, useEffect, useMemo } from 'react';
import { getDb } from '../db/Database';
import { Plus, Search, Trash2, Save, X, PlusCircle, Sparkles, Download, RefreshCw, Printer } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Reports.css';

export default function Reports() {
    const [reports, setReports] = useState([]);
    const [activeReport, setActiveReport] = useState(null);
    const [inventoryMap, setInventoryMap] = useState({});
    const [inventoryList, setInventoryList] = useState([]);
    const [attributes, setAttributes] = useState({ finishes: [], colours: [] });
    const [savingReport, setSavingReport] = useState(false);

    // Modals
    const [showAddReport, setShowAddReport] = useState(false);
    const [editReportId, setEditReportId] = useState(null);
    const [newReportName, setNewReportName] = useState('');
    const [reportSearchTerm, setReportSearchTerm] = useState('');
    const [selectedProducts, setSelectedProducts] = useState([]);

    const [showAddFinish, setShowAddFinish] = useState(false);
    const [showAddSize, setShowAddSize] = useState(false);
    const [newSizeName, setNewSizeName] = useState('');
    const [showAddColour, setShowAddColour] = useState(false);

    // Sort state for reports list
    const [reportSortDir, setReportSortDir] = useState('az'); // 'az' or 'za'

    const [skuModal, setSkuModal] = useState({ show: false, finishIdx: -1, sizeIdx: -1, colour: '', selectedSkus: [] });
    const [skuSearchTerm, setSkuSearchTerm] = useState('');

    const [activeFinishIdx, setActiveFinishIdx] = useState(0);
    const [salesData, setSalesData] = useState({});

    const loadCoreData = async () => {
        const db = await getDb();

        // Load Reports
        const reps = await db.select('SELECT id, name, end_date FROM reports ORDER BY id DESC');
        setReports(reps);

        // Load Inventory
        const inv = await db.select('SELECT sku, available, total_qty, days, extracted_name, extracted_finish, extracted_size, extracted_colour, backorder, backorder_amount FROM inventory');
        const map = {};
        inv.forEach(item => {
            map[item.sku] = item;
        });
        setInventoryMap(map);
        setInventoryList(inv);

        // Load Sales
        const sales = await db.select('SELECT sku, date, qty FROM sales');
        const sMap = {};
        sales.forEach(s => {
            if (!sMap[s.sku]) sMap[s.sku] = [];
            sMap[s.sku].push(s);
        });
        setSalesData(sMap);

        // Load Attributes
        const attrs = await db.select('SELECT type, value FROM attributes');
        const f = attrs.filter(a => a.type === 'finish').map(a => a.value);
        const c = attrs.filter(a => a.type === 'colour').map(a => a.value);
        setAttributes({ finishes: f, colours: c });
    };

    useEffect(() => {
        loadCoreData();
    }, []);

    const loadReportData = async (id) => {
        const db = await getDb();
        const res = await db.select('SELECT * FROM reports WHERE id = $1', [id]);
        if (res.length > 0) {
            const r = res[0];
            let parsedData = { finishes: [] };
            if (r.data) {
                try { parsedData = JSON.parse(r.data); } catch (e) { console.error("Parse err", e); }
            }
            if (!r.start_date && r.end_date) {
                const ed = new Date(r.end_date);
                ed.setDate(ed.getDate() - 30);
                r.start_date = ed.toISOString().split('T')[0];
            }
            setActiveReport({ ...r, data: parsedData });
            setActiveFinishIdx(0);
        }
    };

    const saveReportData = async () => {
        if (!activeReport) return;
        setSavingReport(true);
        try {
            const db = await getDb();
            const jsonStr = JSON.stringify(activeReport.data);
            await db.execute('UPDATE reports SET end_date = $1, start_date = $2, data = $3 WHERE id = $4',
                [activeReport.end_date, activeReport.start_date, jsonStr, activeReport.id]);

            const reps = await db.select('SELECT id, name, end_date FROM reports ORDER BY id DESC');
            setReports(reps);
        } catch (err) {
            console.error("Failed to save report data", err);
        } finally {
            setSavingReport(false);
        }
    };

    const generateReportHTML = (smallerFont = false) => {
        if (!activeReport || !activeReport.data) return '';

        let htmlRows = '';

        activeReport.data.finishes.forEach(finish => {
            htmlRows += `
                <tr class="finish-row">
                    <td colspan="9">Finish: ${finish.name}</td>
                </tr>
            `;

            finish.sizes.forEach((size) => {
                if (size.deleted) return;
                const sizeRowSpan = Math.max(1, finish.colours.filter(c => !size.cells[c]?.deleted).reduce((acc, c) => acc + Math.max(1, size.cells[c].skus.length), 0));
                let isFirstColour = true;

                finish.colours.forEach(colour => {
                    const cell = size.cells[colour];
                    if (!cell || cell.deleted) return;

                    const { skus, rowSpan, skuStats, cellTotalSale, total, cycle, isLowStock, order } = getCellCalculations(cell);

                    const totalStyle = isLowStock ? 'background-color: #fef08a; font-weight: bold;' : 'font-weight: bold;';

                    if (skus.length === 0) {
                        htmlRows += `<tr>`;
                        if (isFirstColour) {
                            htmlRows += `<td rowspan="${sizeRowSpan}" style="font-weight: bold;">${size.name}</td>`;
                            isFirstColour = false;
                        }
                        htmlRows += `
                            <td>${colour}</td>
                            <td colspan="3" style="color: #94a3b8; font-style: italic;">No SKUs selected</td>
                            <td>${order}</td>
                            <td style="${totalStyle}">${total.toFixed(2)}</td>
                            <td>0</td>
                            <td>0</td>
                        </tr>`;
                    } else {
                        htmlRows += `<tr>`;
                        if (isFirstColour) {
                            htmlRows += `<td rowspan="${sizeRowSpan}" style="font-weight: bold;">${size.name}</td>`;
                            isFirstColour = false;
                        }

                        htmlRows += `
                            <td rowspan="${rowSpan}">${colour}</td>
                            <td><span class="sku-badge">${skuStats[0].sku}</span></td>
                            <td>${skuStats[0].inv.days || '-'}</td>
                            <td class="num">${skuStats[0].inv.available}</td>
                            <td rowspan="${rowSpan}">${order}</td>
                            <td rowspan="${rowSpan}" style="${totalStyle}">${total.toFixed(2)}</td>
                            <td rowspan="${rowSpan}" style="font-weight: bold; color: #3b82f6;">${cellTotalSale.toFixed(2)}</td>
                            <td rowspan="${rowSpan}" style="font-weight: bold; color: #3b82f6;">${cycle.toFixed(2)}</td>
                        </tr>`;

                        for (let i = 1; i < skuStats.length; i++) {
                            htmlRows += `
                                <tr>
                                    <td><span class="sku-badge">${skuStats[i].sku}</span></td>
                                    <td>${skuStats[i].inv.days || '-'}</td>
                                    <td class="num">${skuStats[i].inv.available}</td>
                                </tr>
                            `;
                        }
                    }
                });
            });
        });

        const fontSize = smallerFont ? '10px' : '13px';
        const paddingSize = smallerFont ? '4px' : '10px';
        const badgeSize = smallerFont ? '9px' : '11px';

        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${activeReport.name}</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { margin-top: 0; color: #0f172a; margin-bottom: 20px; }
    .report-table { width: 100%; border-collapse: collapse; font-size: ${fontSize}; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: ${paddingSize}; text-align: center; }
    .report-table th { background: #f8fafc; font-weight: bold; color: #475569; }
    .finish-row { background: #e2e8f0; font-weight: bold; text-align: left; }
    .sku-badge { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: ${badgeSize}; }
    .num { font-family: monospace; }
    @media print {
        body { padding: 0; margin: 0; }
        @page { size: portrait; margin: 0; }
    }
</style>
</head>
<body>
    <table style="width: 100%; border: none; border-collapse: collapse;">
        <thead style="border: none;">
            <tr><td style="height: 1.5cm; border: none; padding: 0;"></td></tr>
        </thead>
        <tfoot style="border: none;">
            <tr><td style="height: 1.5cm; border: none; padding: 0;"></td></tr>
        </tfoot>
        <tbody style="border: none;">
            <tr><td style="border: none; padding: 0 1.5cm;">
                <h2>${activeReport.name} (Start: ${activeReport.start_date || 'N/A'} - End: ${activeReport.end_date || 'N/A'})</h2>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th style="width: 80px;">Size</th>
                            <th style="width: 80px;">Colour</th>
                            <th style="width: 150px;">SKU</th>
                            <th style="width: 100px;">In-date</th>
                            <th style="width: 80px;">Available</th>
                            <th style="width: 80px;">Order</th>
                            <th style="width: 80px;">Total</th>
                            <th style="width: 80px;">Sale</th>
                            <th style="width: 80px;">Cycle</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${htmlRows}
                    </tbody>
                </table>
            </td></tr>
        </tbody>
    </table>
</body>
</html>`;
    };

    const exportReportHTML = async () => {
        const htmlContent = generateReportHTML(false);
        if (!htmlContent) return;

        try {
            const filePath = await save({
                filters: [{ name: 'HTML Document', extensions: ['html'] }],
                defaultPath: `${activeReport.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.html`
            });

            if (filePath) {
                await writeTextFile(filePath, htmlContent);
            }
        } catch (err) {
            console.error("Export failed", err);
        }
    };

    const printReport = () => {
        const htmlContent = generateReportHTML(true);
        if (!htmlContent) return;

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(htmlContent);
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
    };

    const saveReportSettings = async (name) => {
        if (!name) return;
        const db = await getDb();

        if (editReportId) {
            // Update existing report
            const currentData = activeReport.data || { finishes: [] };
            currentData.productNames = selectedProducts;
            const jsonData = JSON.stringify(currentData);

            await db.execute('UPDATE reports SET name = $1, data = $2 WHERE id = $3', [name, jsonData, editReportId]);
            await loadCoreData();
            loadReportData(editReportId);
        } else {
            // Create new report
            const today = new Date();
            const endStr = today.toISOString().split('T')[0];
            today.setDate(today.getDate() - 30);
            const startStr = today.toISOString().split('T')[0];

            const emptyData = JSON.stringify({ finishes: [], productNames: selectedProducts });
            const result = await db.execute('INSERT INTO reports (name, start_date, end_date, data) VALUES ($1, $2, $3, $4)',
                [name, startStr, endStr, emptyData]);
            await loadCoreData();
            loadReportData(result.lastInsertId);
        }

        setShowAddReport(false);
        setNewReportName('');
        setSelectedProducts([]);
        setEditReportId(null);
        setReportSearchTerm('');
    };

    const updateActiveReportData = (newData) => {
        setActiveReport({ ...activeReport, data: newData });
    };

    const deleteReport = async (id) => {
        if (!window.confirm("Delete this report?")) return;
        const db = await getDb();
        await db.execute('DELETE FROM reports WHERE id = $1', [id]);
        if (activeReport && activeReport.id === id) setActiveReport(null);
        loadCoreData();
    };

    const generateReportData = (reportObj, invList) => {
        let matches = [];
        const isMultiProduct = reportObj.data && reportObj.data.productNames && reportObj.data.productNames.length > 1;

        if (reportObj.data && reportObj.data.productNames && reportObj.data.productNames.length > 0) {
            const pNames = reportObj.data.productNames.map(n => n.toLowerCase());
            matches = invList.filter(i => pNames.includes((i.extracted_name || '').toLowerCase()));
        } else {
            const name = (reportObj.name || '').toLowerCase();
            matches = invList.filter(i => (i.extracted_name || '').toLowerCase() === name);
        }

        const newData = { finishes: [], unmappedSkus: [], productNames: reportObj.data?.productNames || [] };
        const grouped = {};

        matches.forEach(item => {
            const pName = item.extracted_name;
            const fName = item.extracted_finish;
            const sNameRaw = item.extracted_size;
            const cName = item.extracted_colour;

            if (!fName || !sNameRaw || !cName) {
                newData.unmappedSkus.push(item);
                return;
            }

            let sName = sNameRaw;
            if (isMultiProduct && pName) {
                sName = `${pName} - ${sNameRaw}`;
            }

            let finish = newData.finishes.find(f => f.name === fName);
            if (!finish) {
                finish = { name: fName, colours: [], sizes: [] };
                newData.finishes.push(finish);
            }

            if (!finish.colours.includes(cName)) {
                finish.colours.push(cName);
            }

            let sizeObj = finish.sizes.find(s => s.name === sName);
            if (!sizeObj) {
                sizeObj = { name: sName, cells: {} };
                finish.sizes.push(sizeObj);
            }

            const key = `${fName}|${sName}|${cName}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
        });

        newData.finishes.forEach(finish => {
            finish.sizes.forEach(sz => {
                finish.colours.forEach(c => {
                    if (!sz.cells[c]) sz.cells[c] = { skus: [], order: 0 };

                    const items = grouped[`${finish.name}|${sz.name}|${c}`] || [];
                    const normals = items.filter(i => i.backorder !== 1);
                    const backorders = items.filter(i => i.backorder === 1);

                    normals.sort((a, b) => {
                        const dA = a.days || '';
                        const dB = b.days || '';
                        return dB.localeCompare(dA);
                    });

                    sz.cells[c].skus = normals.slice(0, 4).map(i => i.sku);

                    let backorderSum = 0;
                    backorders.forEach(b => {
                        backorderSum += Number(b.backorder_amount) || 0;
                    });
                    sz.cells[c].order = backorderSum;
                });
            });
        });

        return newData;
    };

    const updateAllReports = async () => {
        if (!window.confirm("This will overwrite all tables and Order inputs for ALL reports in the database based on the current inventory. This action cannot be undone. Continue?")) return;
        setSavingReport(true);
        try {
            const db = await getDb();
            const allReports = await db.select('SELECT id, name, data FROM reports');

            for (const r of allReports) {
                const parsedReport = { ...r, data: JSON.parse(r.data) };
                const newData = generateReportData(parsedReport, inventoryList);
                const jsonStr = JSON.stringify(newData);
                await db.execute('UPDATE reports SET data = $1 WHERE id = $2', [jsonStr, r.id]);

                if (activeReport && activeReport.id === r.id) {
                    setActiveReport({ ...activeReport, data: newData });
                    setActiveFinishIdx(0);
                }
            }
            alert("All reports have been successfully updated!");
        } catch (err) {
            console.error("Failed to update all reports", err);
            alert("Error updating all reports");
        } finally {
            setSavingReport(false);
        }
    };

    const setLastMonth = () => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);

        const format = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        setActiveReport({
            ...activeReport,
            start_date: format(firstDay),
            end_date: format(lastDay)
        });
    };

    const toggleProductSelection = (pName) => {
        if (selectedProducts.includes(pName)) {
            setSelectedProducts(selectedProducts.filter(p => p !== pName));
        } else {
            setSelectedProducts([...selectedProducts, pName]);
        }
    };

    const uniqueProductNames = useMemo(() => {
        const names = new Set(inventoryList.map(i => i.extracted_name).filter(Boolean));
        return Array.from(names).filter(n => n.toLowerCase().includes(reportSearchTerm.toLowerCase()));
    }, [inventoryList, reportSearchTerm]);

    const cloneData = () => JSON.parse(JSON.stringify(activeReport.data));

    const handleAddFinish = (finishName) => {
        const d = cloneData();
        if (d.finishes.find(f => f.name === finishName)) return;
        d.finishes.push({ name: finishName, sizes: [], colours: [] });
        updateActiveReportData(d);
        setShowAddFinish(false);
        setActiveFinishIdx(d.finishes.length - 1);
    };

    const deleteFinishTab = (idx) => {
        if (!window.confirm("Delete this Finish tab and all its tables?")) return;
        const d = cloneData();
        d.finishes.splice(idx, 1);
        updateActiveReportData(d);
        setActiveFinishIdx(Math.max(0, idx - 1));
    };

    const handleAddSize = () => {
        if (!newSizeName) return;
        const d = cloneData();
        const finish = d.finishes[activeFinishIdx];
        if (finish.sizes.find(s => s.name === newSizeName)) return;

        const newSize = { name: newSizeName, cells: {} };
        finish.colours.forEach(c => {
            newSize.cells[c] = { skus: [], order: 0 };
        });
        finish.sizes.push(newSize);
        updateActiveReportData(d);
        setShowAddSize(false);
        setNewSizeName('');
    };

    const handleAddColour = (colourName) => {
        const d = cloneData();
        const finish = d.finishes[activeFinishIdx];
        if (finish.colours.includes(colourName)) {
            finish.sizes.forEach(size => {
                if (size.cells[colourName]) {
                    size.cells[colourName].deleted = false;
                }
            });
            updateActiveReportData(d);
            setShowAddColour(false);
            return;
        }

        finish.colours.push(colourName);
        finish.sizes.forEach(size => {
            size.cells[colourName] = { skus: [], order: 0 };
        });
        updateActiveReportData(d);
        setShowAddColour(false);
    };

    const handleDeleteSize = (sizeIdx) => {
        if (!window.confirm("Delete this size table?")) return;
        const d = cloneData();
        d.finishes[activeFinishIdx].sizes.splice(sizeIdx, 1);
        updateActiveReportData(d);
    };

    const handleDeleteColour = (sizeIdx, colourName) => {
        if (!window.confirm(`Delete row ${colourName} from this table?`)) return;
        const d = cloneData();
        if (!d.finishes[activeFinishIdx].sizes[sizeIdx].cells[colourName]) return;
        d.finishes[activeFinishIdx].sizes[sizeIdx].cells[colourName].deleted = true;
        updateActiveReportData(d);
    };

    const autoGenerate = async () => {
        if (!window.confirm("This will overwrite all existing tables and Order inputs in this report. Continue?")) return;

        const newData = generateReportData(activeReport, inventoryList);

        setActiveReport({ ...activeReport, data: newData });
        setActiveFinishIdx(0);

        try {
            const db = await getDb();
            const jsonStr = JSON.stringify(newData);
            await db.execute('UPDATE reports SET end_date = $1, start_date = $2, data = $3 WHERE id = $4',
                [activeReport.end_date, activeReport.start_date, jsonStr, activeReport.id]);
            alert(`Auto Generate Complete!`);
        } catch (err) {
            console.error("Save failed during auto generate", err);
        }
    };

    const updateCellOrder = (sizeIdx, colour, orderVal) => {
        const d = cloneData();
        d.finishes[activeFinishIdx].sizes[sizeIdx].cells[colour].order = parseFloat(orderVal) || 0;
        updateActiveReportData(d);
    };

    const openSkuModal = (sizeIdx, colour, currentSkus) => {
        setSkuModal({ show: true, finishIdx: activeFinishIdx, sizeIdx, colour, selectedSkus: [...currentSkus] });
        setSkuSearchTerm('');
    };

    const saveSkusFromModal = () => {
        const d = cloneData();
        d.finishes[skuModal.finishIdx].sizes[skuModal.sizeIdx].cells[skuModal.colour].skus = skuModal.selectedSkus;
        updateActiveReportData(d);
        setSkuModal({ ...skuModal, show: false });
    };

    const toggleSkuModalSelection = (sku) => {
        const current = [...skuModal.selectedSkus];
        if (current.includes(sku)) {
            setSkuModal({ ...skuModal, selectedSkus: current.filter(s => s !== sku) });
        } else {
            setSkuModal({ ...skuModal, selectedSkus: [...current, sku] });
        }
    };

    const toDateInt = (dateStr) => {
        if (!dateStr) return 0;
        const s = String(dateStr).trim().split(' ')[0];
        const parts = s.split('/');
        if (parts.length === 3) {
            const d = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            const y = parts[2];
            return parseInt(`${y}${m}${d}`, 10);
        }
        const partsDash = s.split('-');
        if (partsDash.length >= 3) {
            const y = partsDash[0];
            const m = partsDash[1].padStart(2, '0');
            const d = parseInt(partsDash[2], 10).toString().padStart(2, '0');
            return parseInt(`${y}${m}${d}`, 10);
        }
        return 0;
    };

    const getCellCalculations = (cell) => {
        const skus = cell.skus || [];
        const rowSpan = Math.max(1, skus.length);

        let sumAvailable = 0;
        let sumDailyAvg = 0;
        let validSkuCount = 0;
        let cellTotalSale = 0;

        const endInt = activeReport.end_date ? toDateInt(activeReport.end_date) : 99999999;
        const startInt = activeReport.start_date ? toDateInt(activeReport.start_date) : 0;

        const skuStats = skus.map(sku => {
            const cleanSku = String(sku).trim();
            const inv = inventoryMap[sku] || { available: 0, total_qty: 0, days: null };
            sumAvailable += inv.available;

            const skuSales = salesData[cleanSku] || salesData[sku] || [];
            let cycleSalesSum = 0;
            let rangeSalesSum = 0;

            const inInt = inv.days ? toDateInt(inv.days) : null;
            skuSales.forEach(sale => {
                const sInt = toDateInt(sale.date);
                if (!sInt) return;
                const netQty = Number(sale.qty) || 0;
                if (inInt !== null && sInt >= inInt && sInt <= endInt) cycleSalesSum += netQty;
                if (sInt >= startInt && sInt <= endInt) rangeSalesSum += netQty;
            });

            cellTotalSale += rangeSalesSum;

            let dailyAvg = 0;
            if (inInt !== null) {
                const toJsDate = (intVal) => {
                    const str = String(intVal);
                    return new Date(`${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}T00:00:00`);
                };
                const inDate = toJsDate(inInt);
                const endDate = toJsDate(endInt === 99999999 ? toDateInt(new Date().toISOString()) : endInt);
                let diffDays = Math.max(1, (endDate - inDate) / (1000 * 60 * 60 * 24));

                const combinedSales = cycleSalesSum + (Number(inv.holding) || 0) + (Number(inv.so_qty) || 0);
                dailyAvg = combinedSales / diffDays;

                sumDailyAvg += dailyAvg;
                validSkuCount++;
            }
            return { sku, inv, dailyAvg };
        });

        const total = sumAvailable + (cell.order || 0);
        const cycle = validSkuCount > 0 ? (sumDailyAvg / validSkuCount) * 30 : 0;
        const isLowStock = cycle > 0 && total < (2 * cycle);

        return { skus, rowSpan, skuStats, cellTotalSale, total, cycle, isLowStock, order: cell.order || 0 };
    };

    const renderCellRows = (sizeIdx, size, colour) => {
        const cell = size.cells[colour];
        const { skus, rowSpan, skuStats, cellTotalSale, total, cycle, isLowStock, order } = getCellCalculations(cell);

        const totalStyle = { fontWeight: 'bold' };
        if (isLowStock) totalStyle.backgroundColor = '#ffe000';

        if (skus.length === 0) {
            return (
                <tr key={`${size.name}-${colour}-empty`}>
                    <td>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <Trash2 size={14} style={{ cursor: 'pointer', opacity: 0.5, color: '#ef4444', marginTop: '3px', marginRight: '3px', width: '12' }} onClick={() => handleDeleteColour(sizeIdx, colour)} />
                            <span style={{ textTransform: 'capitalize' }}>{colour} <span className="action-text" style={{ fontSize: '0.8rem', marginLeft: '6px' }} onClick={() => openSkuModal(sizeIdx, colour, [])}>[+SKU]</span></span>
                        </div>
                    </td>
                    <td colSpan="3" style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center' }}>No SKUs selected</td>
                    <td><input className="order-input" type="number" value={order} onChange={e => updateCellOrder(sizeIdx, colour, e.target.value)} /></td>
                    <td style={totalStyle}>{parseFloat(total.toFixed(2))}</td>
                    <td>0</td>
                    <td>0</td>
                </tr>
            );
        }

        return (
            <>
                <tr key={`${size.name}-${colour}-main`}>
                    <td rowSpan={rowSpan} style={{ minWidth: '150px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', flexDirection: 'row', height: '100%', minHeight: '40px' }}>
                            <Trash2 size={14} style={{ cursor: 'pointer', opacity: 0.5, color: '#ef4444', marginTop: '3px', marginRight: '3px' }} onClick={() => handleDeleteColour(sizeIdx, colour)} />
                            <div style={{ textTransform: 'capitalize' }}>
                                {colour} <span className="action-text" style={{ fontSize: '0.8rem', marginLeft: '2px' }} onClick={() => openSkuModal(sizeIdx, colour, skus)}>[Edit]</span>
                            </div>
                        </div>
                    </td>
                    <td><span className="sku-badge">{skuStats[0].sku}</span></td>
                    <td>{skuStats[0].inv.days || '-'}</td>
                    <td className="num">{skuStats[0].inv.available}</td>
                    <td rowSpan={rowSpan}>
                        <input className="order-input" type="number" value={order} onChange={e => updateCellOrder(sizeIdx, colour, e.target.value)} />
                    </td>
                    <td rowSpan={rowSpan} style={totalStyle}>{parseFloat(total.toFixed(2))}</td>
                    <td rowSpan={rowSpan} style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{parseFloat(cellTotalSale.toFixed(2))}</td>
                    <td rowSpan={rowSpan} style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{parseFloat(cycle.toFixed(2))}</td>
                </tr >
                {
                    skuStats.slice(1).map((s, i) => (
                        <tr key={`${size.name}-${colour}-sub-${i}`}>
                            <td><span className="sku-badge">{s.sku}</span></td>
                            <td>{s.inv.days || '-'}</td>
                            <td className="num">{s.inv.available}</td>
                        </tr>
                    ))
                }
            </>
        );
    };

    const toggleReportSort = () => {
        setReportSortDir(prev => prev === 'az' ? 'za' : 'az');
    };

    const sortedReports = [...reports].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return reportSortDir === 'az' ? -1 : 1;
        if (nameA > nameB) return reportSortDir === 'az' ? 1 : -1;
        return 0;
    });

    return (
        <div className="reports-layout">
            <div className="reports-sidebar">
                <div className="sidebar-header">
                    <button className="btn-upload btn-full" onClick={() => {
                        setEditReportId(null);
                        setNewReportName('');
                        setSelectedProducts([]);
                        setShowAddReport(true);
                    }} style={{ marginBottom: '8px' }}>
                        <Plus size={18} /> New Report
                    </button>
                    <button className="btn-upload btn-full" onClick={updateAllReports} disabled={savingReport} style={{ background: '#3b82f6', color: 'white', border: 'none', marginBottom: '8px' }}>
                        <RefreshCw size={18} /> {savingReport ? 'Updating...' : 'Update All Reports'}
                    </button>
                    <button className="btn-upload btn-full" onClick={toggleReportSort} style={{ background: 'var(--surface-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)' }}>
                        Sort: {reportSortDir === 'az' ? 'A-Z' : 'Z-A'}
                    </button>
                </div>
                <div className="reports-list">
                    {sortedReports.map(r => (
                        <div
                            key={r.id}
                            className={`report-item ${activeReport?.id === r.id ? 'active' : ''}`}
                            onClick={() => loadReportData(r.id)}
                        >
                            <span>{r.name}</span>
                            <Trash2 size={14} style={{ opacity: 0.6 }} onClick={(e) => { e.stopPropagation(); deleteReport(r.id); }} />
                        </div>
                    ))}
                    {reports.length === 0 && <div style={{ padding: '12px', color: '#64748b', fontSize: '0.9rem', textAlign: 'center' }}>No reports yet</div>}
                </div>
            </div>

            <div className="reports-content">
                {!activeReport ? (
                    <div className="report-empty-state">Select a report or create a new one to begin</div>
                ) : (
                    <>
                        <div className="report-topbar">
                            <div className="report-title-area">
                                <h2>{activeReport.name}</h2>
                                <button className="btn-upload" style={{ margin: '5px 15px 0', background: 'transparent', border: '1px solid #cbd5e1', color: '#64748b', padding: '4px 8px', fontSize: '12px', float: 'left' }} onClick={() => {
                                    setEditReportId(activeReport.id);
                                    setNewReportName(activeReport.name);
                                    setSelectedProducts(activeReport.data?.productNames || []);
                                    setShowAddReport(true);
                                }}>
                                    Edit Settings
                                </button>
                                <div className="date-picker-row">
                                    <label>Start Date:</label>
                                    <input
                                        type="date"
                                        value={activeReport.start_date}
                                        onChange={e => setActiveReport({ ...activeReport, start_date: e.target.value })}
                                    />
                                    <label>End Date:</label>
                                    <input
                                        type="date"
                                        value={activeReport.end_date}
                                        onChange={e => setActiveReport({ ...activeReport, end_date: e.target.value })}
                                    />
                                    <button className="btn-upload" onClick={setLastMonth} style={{ marginLeft: '10px', height: '32px', fontSize: '12px' }}>Last Month</button>
                                </div>
                            </div>
                            <div className="report-actions" style={{ display: 'flex', alignItems: 'center' }}>
                                <span className="status-text" style={{ marginRight: '10px' }}>{savingReport ? 'Saving...' : ''}</span>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn-upload" onClick={printReport} style={{ background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1' }}>
                                        <Printer size={16} /> Print Report
                                    </button>
                                    <button className="btn-upload" onClick={exportReportHTML} style={{ background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1' }}>
                                        <Download size={16} /> Export HTML
                                    </button>
                                    <button className="btn-upload" onClick={autoGenerate} style={{ background: 'var(--bg-color)', color: 'var(--text-color)' }}>
                                        <Sparkles size={16} /> Auto Generate
                                    </button>
                                    <button className="btn-upload" onClick={saveReportData} disabled={savingReport}>
                                        <Save size={16} /> {savingReport ? 'Saving...' : 'Save Report'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="finish-tabs-bar">
                            {activeReport.data.finishes.map((f, i) => (
                                <button
                                    key={i}
                                    className={`finish-tab ${activeFinishIdx === i ? 'active' : ''}`}
                                    onClick={() => setActiveFinishIdx(i)}
                                >
                                    {f.name}
                                    {activeFinishIdx === i && <Trash2 size={14} style={{ marginLeft: '5px', marginBottom: '-1px', opacity: 0.5, color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); deleteFinishTab(i); }} />}
                                </button>
                            ))}
                            <button className="finish-tab" onClick={() => setShowAddFinish(true)} style={{ color: 'var(--primary-color)' }}>
                                + Add Finish
                            </button>
                        </div>

                        <div className="grand-matrix-container">
                            {activeReport.data.finishes.length === 0 ? (
                                <div style={{ color: '#64748b', marginTop: '24px' }}>Add a Finish tab to start building tables.</div>
                            ) : (
                                <div className="sizes-horizontal-scroll">
                                    {activeReport.data.finishes[activeFinishIdx].sizes.map((size, sizeIdx) => (
                                        <div className="size-table-card" key={size.name}>
                                            <div className="size-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <h3>Size: {size.name}</h3>
                                                <Trash2 size={16} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={() => handleDeleteSize(sizeIdx)} />
                                            </div>
                                            <table className="report-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '120px' }}>Colour</th>
                                                        <th>SKU</th>
                                                        <th>In-date</th>
                                                        <th className="num">Available</th>
                                                        <th className="num" style={{ width: '80px' }}>Order</th>
                                                        <th className="num" style={{ width: '80px' }}>Total</th>
                                                        <th className="num" style={{ width: '80px' }}>Sale</th>
                                                        <th className="num" style={{ width: '80px' }}>Cycle</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {activeReport.data.finishes[activeFinishIdx].colours
                                                        .filter(colour => !size.cells[colour]?.deleted)
                                                        .map(colour => (
                                                            renderCellRows(sizeIdx, size, colour)
                                                        ))}
                                                    <tr>
                                                        <td colSpan="8" style={{ textAlign: 'center', backgroundColor: 'var(--bg-color)' }}>
                                                            <span className="action-text" onClick={() => setShowAddColour(true)}>+ Add New Colour Row</span>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}

                                    <div className="size-table-card" style={{ minWidth: '992px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', cursor: 'pointer', backgroundColor: 'transparent', borderStyle: 'dashed' }} onClick={() => setShowAddSize(true)}>
                                        <div style={{ textAlign: 'center', color: 'var(--primary-color)' }}>
                                            <PlusCircle size={32} style={{ margin: '0 auto 12px' }} />
                                            <div style={{ fontWeight: 600 }}>Add Size Table</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeReport.data.unmappedSkus && activeReport.data.unmappedSkus.length > 0 && (
                                <div style={{ marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
                                    <h3 style={{ color: '#991b1b', marginBottom: '16px' }}>Unmapped SKUs (Missing Parameters)</h3>
                                    <table className="report-table" style={{ width: 'auto', minWidth: '600px' }}>
                                        <thead>
                                            <tr>
                                                <th>SKU</th>
                                                <th>Finish</th>
                                                <th>Size</th>
                                                <th>Colour</th>
                                                <th>Days</th>
                                                <th>Available</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeReport.data.unmappedSkus.map(i => (
                                                <tr key={i.sku}>
                                                    <td><span className="sku-badge">{i.sku}</span></td>
                                                    <td>{i.extracted_finish || <span style={{ color: '#94a3b8' }}>-</span>}</td>
                                                    <td>{i.extracted_size || <span style={{ color: '#94a3b8' }}>-</span>}</td>
                                                    <td>{i.extracted_colour || <span style={{ color: '#94a3b8' }}>-</span>}</td>
                                                    <td>{i.days || '-'}</td>
                                                    <td className="num">{i.available}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {showAddReport && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ width: '500px' }}>
                        <h3>{editReportId ? 'Edit Report' : 'Create New Report'}</h3>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Custom Report Name</label>
                            <input
                                autoFocus
                                type="text"
                                className="search-input"
                                value={newReportName}
                                onChange={(e) => setNewReportName(e.target.value)}
                                placeholder="e.g. Matt Collection"
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Select Products to Include</label>
                            <input
                                type="text"
                                className="search-input"
                                value={reportSearchTerm}
                                onChange={(e) => setReportSearchTerm(e.target.value)}
                                placeholder="Search products..."
                                style={{ marginBottom: '8px', width: '100%' }}
                            />
                            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '8px' }}>
                                {uniqueProductNames.filter(p => p.toLowerCase().includes(reportSearchTerm.toLowerCase())).map(product => (
                                    <label key={product} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedProducts.includes(product)}
                                            onChange={() => toggleProductSelection(product)}
                                            style={{ marginRight: '8px' }}
                                        />
                                        {product}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="modal-actions" style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                            <button className="btn-primary" onClick={() => { setShowAddReport(false); setEditReportId(null); setNewReportName(''); setSelectedProducts([]); setReportSearchTerm(''); }}>Cancel</button>
                            <button className="btn-primary" onClick={() => saveReportSettings(newReportName)} disabled={!newReportName || selectedProducts.length === 0}>
                                {editReportId ? 'Save Changes' : 'Create Report'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAddFinish && (
                <div className="modal-overlay" onClick={() => setShowAddFinish(false)}>
                    <div className="modal-content" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Select Finish</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowAddFinish(false)} />
                        </div>
                        <div className="modal-body">
                            <div className="select-list">
                                {attributes.finishes.map(f => (
                                    <div key={f} className="select-item" onClick={() => handleAddFinish(f)}>{f}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showAddColour && (
                <div className="modal-overlay" onClick={() => setShowAddColour(false)}>
                    <div className="modal-content" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Colour Row (Syncs across all Sizes)</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowAddColour(false)} />
                        </div>
                        <div className="modal-body">
                            <div className="select-list">
                                {attributes.colours.map(c => (
                                    <div key={c} className="select-item" onClick={() => handleAddColour(c)}>{c}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showAddSize && (
                <div className="modal-overlay" onClick={() => setShowAddSize(false)}>
                    <div className="modal-content" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Size Table</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowAddSize(false)} />
                        </div>
                        <div className="modal-body">
                            <input
                                className="search-input" style={{ width: '100%' }}
                                value={newSizeName} onChange={e => setNewSizeName(e.target.value)}
                                placeholder="e.g. 600x600"
                            />
                        </div>
                        <div className="modal-footer">
                            <button className="btn-upload" onClick={handleAddSize}>Add Size</button>
                        </div>
                    </div>
                </div>
            )}

            {skuModal.show && (
                <div className="modal-overlay" onClick={() => setSkuModal({ ...skuModal, show: false })}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Select SKUs for {skuModal.colour}</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setSkuModal({ ...skuModal, show: false })} />
                        </div>
                        <div className="modal-body">
                            <input
                                className="search-input" style={{ width: '100%' }}
                                value={skuSearchTerm} onChange={e => setSkuSearchTerm(e.target.value)}
                                placeholder="Search inventory SKUs..."
                            />
                            <div className="select-list">
                                {inventoryList.filter(i => i.sku.toLowerCase().includes(skuSearchTerm.toLowerCase())).slice(0, 100).map(i => (
                                    <label key={i.sku} className="sku-checkbox-item">
                                        <input
                                            type="checkbox"
                                            checked={skuModal.selectedSkus.includes(i.sku)}
                                            onChange={() => toggleSkuModalSelection(i.sku)}
                                        />
                                        <div>
                                            <div style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{i.sku}</div>
                                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{i.extracted_name}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-upload" onClick={saveSkusFromModal}>Save SKUs</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
