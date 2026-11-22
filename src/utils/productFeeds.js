import { load } from '@tauri-apps/plugin-store';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const fetchShopifyVariants = async (domain, accessToken) => {
    if (!domain || !accessToken) return [];
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
    if (!cleanDomain) return [];

    let url = `https://${cleanDomain}/admin/api/2024-01/products.json?limit=250`;
    const allVariants = [];
    let pageCount = 0;
    const maxPages = 20; // safety ceiling: up to 5000 products

    while (url && pageCount < maxPages) {
        pageCount++;
        try {
            let res = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                res = await tauriFetch(url, {
                    method: 'GET',
                    headers: {
                        'X-Shopify-Access-Token': accessToken.trim(),
                        'Content-Type': 'application/json'
                    }
                });
                if (res.status !== 429) break;
                const retryAfter = parseFloat(res.headers?.get?.('retry-after') || '1');
                await new Promise(r => setTimeout(r, Math.max(500, (isNaN(retryAfter) ? 1 : retryAfter) * 1000)));
            }

            if (!res || !res.ok) {
                console.error("HTTP error fetching Shopify products:", res?.status, url);
                break;
            }

            const data = await res.json();
            const products = data.products || [];
            for (const prod of products) {
                const prodTitle = (prod.title || '').trim();
                const variants = prod.variants || [];
                for (const v of variants) {
                    const vTitle = (v.title || '').trim();
                    const fullName = vTitle && vTitle !== 'Default Title'
                        ? `${prodTitle} - ${vTitle}`
                        : prodTitle;

                    allVariants.push({
                        id: String(v.id),
                        product_id: String(prod.id),
                        inventory_item_id: String(v.inventory_item_id || ''),
                        name: fullName,
                        sku: v.sku || '',
                        price: v.price || '',
                        source: 'shopify'
                    });
                }
            }

            const linkHeader = res.headers?.get ? (res.headers.get('link') || res.headers.get('Link')) : null;
            let nextUrl = null;
            if (linkHeader) {
                const parts = linkHeader.split(',');
                for (const part of parts) {
                    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/i);
                    if (match && match[2].toLowerCase() === 'next') {
                        nextUrl = match[1];
                        break;
                    }
                }
            }
            url = nextUrl;
        } catch (err) {
            console.error("Failed to fetch Shopify products page:", err);
            break;
        }
    }

    return allVariants;
};

export const fetchProductFeeds = async () => {
    try {
        const store = await load('settings.json', { autoSave: false });
        const chtShopifyDomain = (await store.get('cht_shopify_domain') || '').trim();
        const chtShopifyAccessToken = (await store.get('cht_shopify_access_token') || '').trim();
        const gtoUrl = await store.get('gto_feed');
        const stUrl = await store.get('st_feed');

        if (!window.productFeeds) {
            window.productFeeds = { cht: [], gto: [], st: [] };
        }

        const fetchFeed = async (url) => {
            if (!url) return [];
            try {
                const res = await tauriFetch(url);
                if (!res.ok) {
                    console.error("HTTP error when fetching feed:", res.status, url);
                    return [];
                }
                const data = await res.json();
                return data.map(item => {
                    const match = item.name?.match(/(.+)\s*\(Code:(.+)\)/i);
                    let parsedName = item.name || '';
                    let parsedCode = '';
                    if (match) {
                        parsedName = match[1].trim();
                        parsedCode = match[2].trim();
                    }
                    return { ...item, parsedName, parsedCode };
                });
            } catch (e) {
                console.error("Failed to fetch feed", url, e);
                return [];
            }
        };

        const fetchStFeed = async (url) => {
            if (!url) return [];
            try {
                const res = await tauriFetch(url);
                if (!res.ok) {
                    console.error("HTTP error when fetching ST feed:", res.status, url);
                    return [];
                }
                const data = await res.json();
                if (data && data.posts) {
                    return data.posts;
                }
                return [];
            } catch (e) {
                console.error("Failed to fetch ST feed", url, e);
                return [];
            }
        };

        const fetchCht = async () => {
            if (chtShopifyDomain && chtShopifyAccessToken) {
                return await fetchShopifyVariants(chtShopifyDomain, chtShopifyAccessToken);
            }
            return [];
        };

        const [cht, gto, st] = await Promise.all([
            fetchCht(),
            fetchFeed(gtoUrl),
            fetchStFeed(stUrl)
        ]);

        window.productFeeds = { cht, gto, st };
        return window.productFeeds;
    } catch (e) {
        console.error("Error loading product feeds:", e);
        return window.productFeeds || { cht: [], gto: [], st: [] };
    }
};

if (typeof window !== 'undefined') {
    window.fetchProductFeeds = fetchProductFeeds;
}

export const buildStPriceUpdateItem = (product) => ({
    product_id: String(product.st_id),
    product_code: (product.showtile_product_code || '').toString().trim(),
    finish: (product.finish || '').toString(),
    size: (product.size || '').toString(),
    price: product.showtile_price !== null && product.showtile_price !== undefined && product.showtile_price !== ''
        ? product.showtile_price.toString()
        : '',
    suffix: (product.suffix || '').toString()
});

export const updateStPricesOnline = async (updates, { batchSize = 50 } = {}) => {
    if (!Array.isArray(updates) || updates.length === 0) {
        return { total: 0, successCount: 0, failCount: 0, results: [], errors: [] };
    }

    const store = await load('settings.json', { autoSave: false });
    const stEndpoint = await store.get('st_endpoint');
    const stKey = await store.get('st_key');

    if (!stEndpoint || !stKey) {
        throw new Error("Please configure ST Endpoint and Key in Settings first.");
    }

    let successCount = 0;
    let failCount = 0;
    const allResults = [];
    const errors = [];

    for (let i = 0; i < updates.length; i += batchSize) {
        const chunk = updates.slice(i, i + batchSize);
        try {
            const res = await tauriFetch(stEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': stKey
                },
                body: JSON.stringify({ updates: chunk })
            });

            if (res.ok) {
                const data = await res.json();
                const chunkResults = Array.isArray(data?.results) ? data.results : [];
                allResults.push(...chunkResults);

                if (chunkResults.length > 0) {
                    for (const r of chunkResults) {
                        if (r && r.status === 'success') {
                            successCount++;
                        } else {
                            failCount++;
                            if (r?.message) errors.push(r.message);
                        }
                    }
                    if (chunkResults.length < chunk.length) {
                        failCount += chunk.length - chunkResults.length;
                    }
                } else {
                    failCount += chunk.length;
                    errors.push(data?.message || 'Empty response results from server.');
                }
            } else {
                failCount += chunk.length;
                errors.push(`HTTP status: ${res.status}`);
            }
        } catch (err) {
            failCount += chunk.length;
            errors.push(err?.message || 'Error connecting to online API.');
        }
    }

    return {
        total: updates.length,
        successCount,
        failCount,
        results: allResults,
        errors
    };
};

