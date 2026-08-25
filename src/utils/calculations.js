import { getSetting } from '../db/Database';

export const getLocalTodayStr = async () => {
    let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
        const storedTz = await getSetting('timezone');
        if (storedTz) {
            tz = storedTz;
        }
    } catch(e) {}
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
};

export const toDateInt = (dateStr) => {
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

export const getCellCalculations = (cell, reportStartDate, reportEndDate, inventoryMap, salesData) => {
    const skus = cell.skus || [];
    const rowSpan = Math.max(1, skus.length);

    let sumAvailable = 0;
    let sumDailyAvg = 0;
    let validSkuCount = 0;
    let cellTotalSale = 0;

    const endInt = reportEndDate ? toDateInt(reportEndDate) : 99999999;
    const startInt = reportStartDate ? toDateInt(reportStartDate) : 0;

    const skuStats = skus.map(sku => {
        const cleanSku = String(sku).trim();
        const inv = inventoryMap[sku] || { available: 0, total_qty: 0, days: null };
        sumAvailable += inv.available;

        const skuSales = salesData[cleanSku] || salesData[sku] || [];
        let rangeSalesSum = 0;

        const inInt = inv.days ? toDateInt(inv.days) : null;

        // Sum ALL sales qty for this SKU (no date filter) for cycle calculation
        let totalSalesQty = 0;
        skuSales.forEach(sale => {
            const sInt = toDateInt(sale.date);
            if (!sInt) return;
            const netQty = Number(sale.qty) || 0;
            // Range sales for the "Sale" column (unchanged)
            if (sInt >= startInt && sInt <= endInt) rangeSalesSum += netQty;
            // Total historical sales for cycle calculation
            totalSalesQty += netQty;
        });

        cellTotalSale += rangeSalesSum;

        let dailyAvg = 0;
        if (inInt !== null) {
            const toJsDate = (intVal) => {
                const str = String(intVal);
                return new Date(`${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}T00:00:00`);
            };
            const inDate = toJsDate(inInt);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Days from in-date to today
            const diffDays = Math.max(1, (today - inDate) / (1000 * 60 * 60 * 24));

            // Daily avg = total sales qty / days since in-date
            dailyAvg = totalSalesQty / diffDays;

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
