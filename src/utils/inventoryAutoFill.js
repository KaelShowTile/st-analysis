import { normalizeSize } from './featureExtractor';

const isNonBackorder = (item) => item.backorder !== 1 && item.backorder !== '1';

/**
 * Extract Showtile specifics & packaging dimensions from matched inventory rows
 * (assumed ordered newest-first by product_id DESC).
 */
export const extractAutoFillFromMatchedInventory = (matched) => {
    if (!matched || matched.length === 0) return null;

    const inv =
        matched.find(i => isNonBackorder(i) && i.showtile_name) ||
        matched.find(i => i.showtile_name) ||
        matched.find(i => isNonBackorder(i)) ||
        matched[0];

    let showtile_product_code = '';
    let showtile_name = '';
    const invWithShowtile =
        matched.find(i => isNonBackorder(i) && i.showtile_name) ||
        matched.find(i => i.showtile_name);
    if (invWithShowtile?.showtile_name) {
        const parts = invWithShowtile.showtile_name.trim().split(/\s+/);
        if (parts.length > 0) {
            showtile_product_code = parts[0];
            showtile_name = parts.slice(1).join(' ');
        }
    }

    const pickField = (getter) => {
        const nonBoVal = matched.filter(isNonBackorder).map(getter).find(v => v !== null && v !== undefined && v !== '');
        if (nonBoVal !== undefined) return nonBoVal;
        return matched.map(getter).find(v => v !== null && v !== undefined && v !== '');
    };

    return {
        showtile_product_code,
        showtile_name,
        showtile_price: inv.rrp || inv.price || pickField(i => i.rrp || i.price) || '',
        m2_per_box: inv.m2_per_box || pickField(i => i.m2_per_box) || '',
        pcs_per_box: inv.pcs_per_box || pickField(i => i.pcs_per_box) || '',
        box_per_pallet: inv.box_per_pallet || pickField(i => i.box_per_pallet) || ''
    };
};

/**
 * Build in-memory lookup maps over inventory rows (ordered newest-first)
 * so batch product auto-fill matches in O(1) per product.
 */
export const buildInventoryLookup = (inventoryRows = []) => {
    const byParentId = new Map();
    const byAttrKey = new Map();

    for (const row of inventoryRows) {
        if (row.product_parent_id != null && String(row.product_parent_id).trim() !== '') {
            const pidKey = String(row.product_parent_id);
            if (!byParentId.has(pidKey)) byParentId.set(pidKey, []);
            byParentId.get(pidKey).push(row);
        }

        const nameKey = (row.extracted_name || '').trim().toLowerCase();
        if (nameKey) {
            const colorKey = (row.extracted_colour || '').trim().toLowerCase();
            const finishKey = (row.extracted_finish || '').trim().toLowerCase();
            const attrKey = `${nameKey}\u0000${colorKey}\u0000${finishKey}`;
            if (!byAttrKey.has(attrKey)) byAttrKey.set(attrKey, []);
            byAttrKey.get(attrKey).push(row);
        }
    }

    return { byParentId, byAttrKey };
};

/**
 * Find all inventory rows matching a product by product_parent_id or
 * (collectionName, color, finish, normalized size), deduplicated and preserving order.
 */
export const findMatchedInventoryForProduct = ({ productId, collectionName, color, finish, size }, lookup) => {
    const seen = new Set();
    const matched = [];

    const addIfNew = (row) => {
        const uid = row.product_id ?? row.sku;
        if (uid != null && seen.has(uid)) return;
        if (uid != null) seen.add(uid);
        matched.push(row);
    };

    if (productId != null && String(productId).trim() !== '') {
        const directRows = lookup.byParentId.get(String(productId)) || [];
        for (const row of directRows) addIfNew(row);
    }

    const colName = (collectionName || '').trim().toLowerCase();
    if (colName) {
        const attrKey = `${colName}\u0000${(color || '').trim().toLowerCase()}\u0000${(finish || '').trim().toLowerCase()}`;
        const attrRows = lookup.byAttrKey.get(attrKey) || [];
        const sizeNorm = normalizeSize((size || '').trim()).toLowerCase();

        for (const row of attrRows) {
            if (!sizeNorm || normalizeSize(row.extracted_size || '').toLowerCase() === sizeNorm) {
                addIfNew(row);
            }
        }
    }

    matched.sort((a, b) => Number(b.product_id || 0) - Number(a.product_id || 0));
    return matched;
};
