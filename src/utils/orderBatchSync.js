import { getLocalTodayStrSync } from './timezone';

/**
 * Checks if a container is delivered.
 * A container is delivered if:
 * 1. warehouse_received is '1' (or a date/truthy string other than '0')
 * 2. OR delivery date exists and is strictly before today (local date).
 */
export function isContainerDelivered(container, todayStr = getLocalTodayStrSync()) {
    if (!container) return false;
    const wr = container.warehouse_received;
    if (wr && wr !== '0') return true;
    const del = container.delivery;
    if (del && typeof del === 'string' && del.trim() !== '' && del < todayStr) return true;
    return false;
}

/**
 * Recalculates and updates order_batch status based on container_order_batch and containers.
 * Status logic:
 * - 'pending': 0 containers linked
 * - 'delivered': >= 1 container linked, and ALL linked containers are delivered
 * - 'in_transit': >= 1 container linked, but at least one container is NOT delivered yet
 *
 * Only executes UPDATE queries for rows whose current status differs from the calculated status.
 *
 * @param {object} db - Database instance from getDb()
 * @param {Array<number|string>} [specificBatchIds] - Optional array of batch IDs to update. If omitted, checks all batches.
 */
export async function syncOrderBatchStatuses(db, specificBatchIds = null) {
    try {
        const todayStr = getLocalTodayStrSync();
        let query = `
            SELECT 
                ob.order_batch_id,
                ob.status as current_status,
                COUNT(DISTINCT c.container_id) as total_containers,
                COUNT(DISTINCT CASE 
                    WHEN (c.warehouse_received IS NOT NULL AND c.warehouse_received != '' AND c.warehouse_received != '0')
                      OR (c.delivery IS NOT NULL AND c.delivery != '' AND c.delivery < $1) 
                    THEN c.container_id ELSE NULL 
                END) as delivered_containers
            FROM order_batch ob
            LEFT JOIN container_order_batch cob ON ob.order_batch_id = cob.order_batch_id
            LEFT JOIN containers c ON cob.container_id = c.container_id
        `;
        const params = [todayStr];
        if (Array.isArray(specificBatchIds) && specificBatchIds.length > 0) {
            const validIds = specificBatchIds.map(id => Number(id)).filter(id => !isNaN(id));
            if (validIds.length > 0) {
                const placeholders = validIds.map((_, i) => `$${i + 2}`).join(', ');
                query += ` WHERE ob.order_batch_id IN (${placeholders})`;
                params.push(...validIds);
            }
        }
        query += ` GROUP BY ob.order_batch_id`;

        const rows = await db.select(query, params);
        for (const row of rows) {
            let nextStatus = 'pending';
            const total = Number(row.total_containers) || 0;
            const delivered = Number(row.delivered_containers) || 0;
            if (total > 0) {
                if (delivered >= total) {
                    nextStatus = 'delivered';
                } else {
                    nextStatus = 'in_transit';
                }
            } else {
                nextStatus = 'pending';
            }

            if (row.current_status !== nextStatus) {
                await db.execute(
                    'UPDATE order_batch SET status = $1 WHERE order_batch_id = $2',
                    [nextStatus, row.order_batch_id]
                );
            }
        }
    } catch (e) {
        console.error('Failed to sync order_batch statuses:', e);
    }
}

