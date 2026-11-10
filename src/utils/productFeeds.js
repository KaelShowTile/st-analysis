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
            const res = await tauriFetch(url, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': accessToken.trim(),
                    'Content-Type': 'application/json'
                }
            });

            if (!res.ok) {
                console.error("HTTP error fetching Shopify products:", res.status, url);
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
                        price: v.price || ''
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
        const chtShopifyDomain = await store.get('cht_shopify_domain');
        const chtShopifyAccessToken = await store.get('cht_shopify_access_token');
        const chtUrl = await store.get('cht_feed');
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
                const variants = await fetchShopifyVariants(chtShopifyDomain, chtShopifyAccessToken);
                if (variants && variants.length > 0) {
                    return variants;
                }
            }
            if (chtUrl) {
                return await fetchFeed(chtUrl);
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
