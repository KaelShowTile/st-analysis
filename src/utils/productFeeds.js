import { load } from '@tauri-apps/plugin-store';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const fetchProductFeeds = async () => {
    try {
        const store = await load('settings.json', { autoSave: false });
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

        const [cht, gto, st] = await Promise.all([
            fetchFeed(chtUrl),
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
