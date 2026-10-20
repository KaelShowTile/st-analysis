import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { ulid } from 'ulid';
import { getSetting, setSetting } from '../db/Database';

let isSyncing = false;
let debounceTimer = null;
let intervalId = null;
let lastSyncTime = null;
let lastSyncResult = null;
let lastSyncError = null;

/**
 * Get or initialize persistent Device ID (ULID based)
 */
export const getDeviceId = async () => {
    try {
        const store = await load('settings.json', { autoSave: false });
        let deviceId = await store.get('device_id');
        if (!deviceId) {
            deviceId = 'dev_' + ulid();
            await store.set('device_id', deviceId);
            await store.save();
        }
        return deviceId;
    } catch (e) {
        console.error("Error reading device_id, falling back to session ULID:", e);
        return 'dev_' + ulid();
    }
};

/**
 * Get Cloudflare Worker sync configuration
 */
export const getSyncConfig = async () => {
    const store = await load('settings.json', { autoSave: false });
    const dbType = await store.get('db_type') || 'sqlite';
    
    // Check settings table first, fallback to store
    let workerUrl = '';
    let workerSecret = '';
    try {
        workerUrl = await getSetting('sync_worker_url', '');
        workerSecret = await getSetting('sync_worker_secret', '');
    } catch (e) {}

    if (!workerUrl) {
        workerUrl = await store.get('sync_worker_url') || '';
    }
    if (!workerSecret) {
        workerSecret = await store.get('sync_worker_secret') || '';
    }

    const deviceId = await getDeviceId();
    return { dbType, workerUrl, workerSecret, deviceId };
};

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ShowTile/1.0';

/**
 * Normalize Cloudflare Worker sync endpoint URL
 */
export const normalizeWorkerUrl = (url) => {
    if (!url) return '';
    let clean = url.trim();
    if (!clean) return '';
    if (!/^https?:\/\//i.test(clean)) {
        clean = 'https://' + clean;
    }
    clean = clean.replace(/\/+$/, '');
    if (!clean.includes('/api/sync') && !clean.includes('/sync')) {
        clean = clean + '/api/sync/push';
    }
    return clean;
};

/**
 * Save Cloudflare Worker sync configuration to settings table & store
 */
export const saveSyncConfig = async ({ workerUrl, workerSecret }) => {
    try {
        const cleanUrl = normalizeWorkerUrl(workerUrl);
        const cleanSecret = (workerSecret || '').trim();

        // 1. Save to settings.json for early availability and disk persistence
        const store = await load('settings.json', { autoSave: false });
        await store.set('sync_worker_url', cleanUrl);
        await store.set('sync_worker_secret', cleanSecret);
        await store.save();

        // 2. Also save to SQLite settings table (mirror.db)
        try {
            await setSetting('sync_worker_url', cleanUrl);
            await setSetting('sync_worker_secret', cleanSecret);
        } catch (dbErr) {
            console.warn("Could not save sync config to DB settings table immediately:", dbErr);
        }

        return { workerUrl: cleanUrl, workerSecret: cleanSecret };
    } catch (e) {
        console.error("Failed to save sync config:", e);
        throw e;
    }
};

/**
 * Test connection to Cloudflare Worker endpoint and verify Turso connectivity & authentication
 */
export const testWorkerConnection = async (customUrl, customSecret) => {
    const { workerUrl: savedUrl, workerSecret: savedSecret } = await getSyncConfig();
    const targetUrl = customUrl ? normalizeWorkerUrl(customUrl) : savedUrl;
    const targetSecret = customSecret !== undefined ? (customSecret || '').trim() : savedSecret;

    if (!targetUrl) {
        throw new Error("Worker endpoint URL is required.");
    }

    let baseUrl = targetUrl;
    if (baseUrl.endsWith('/api/sync/push')) {
        baseUrl = baseUrl.replace(/\/api\/sync\/push$/, '');
    } else if (baseUrl.endsWith('/sync/push')) {
        baseUrl = baseUrl.replace(/\/sync\/push$/, '');
    } else if (baseUrl.endsWith('/sync')) {
        baseUrl = baseUrl.replace(/\/sync$/, '');
    } else if (baseUrl.endsWith('/api/sync')) {
        baseUrl = baseUrl.replace(/\/api\/sync$/, '');
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    const healthUrl = `${baseUrl}/api/health`;
    const pushUrl = targetUrl;

    // 1. Health & reachability check
    let healthData = null;
    try {
        const hResp = await tauriFetch(healthUrl, {
            method: 'GET',
            headers: { 'User-Agent': BROWSER_USER_AGENT }
        });
        if (!hResp.ok) {
            const errTxt = await hResp.text();
            throw new Error(`Worker health check failed (${hResp.status}): ${errTxt}`);
        }
        healthData = await hResp.json();
    } catch (he) {
        // Fallback to window.fetch
        try {
            const fbResp = await fetch(healthUrl);
            if (fbResp.ok) {
                healthData = await fbResp.json();
            } else {
                throw new Error(`Worker health check failed (${fbResp.status})`);
            }
        } catch (e2) {
            throw new Error(`Cannot reach Cloudflare Worker at ${healthUrl}: ${he?.message || he}`);
        }
    }

    // 2. Authentication check with empty actions array
    const pushHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_USER_AGENT
    };
    if (targetSecret) {
        pushHeaders['Authorization'] = `Bearer ${targetSecret}`;
        pushHeaders['x-api-key'] = targetSecret;
    }

    const pResp = await tauriFetch(pushUrl, {
        method: 'POST',
        headers: pushHeaders,
        body: JSON.stringify({
            device_id: 'test_probe',
            actions: []
        })
    });

    if (!pResp.ok) {
        const errTxt = await pResp.text();
        if (pResp.status === 401) {
            throw new Error("Worker rejected authentication (401 Unauthorized). Please check your API Secret.");
        }
        throw new Error(`Worker push verification failed (${pResp.status}): ${errTxt}`);
    }

    const pushData = await pResp.json();
    return {
        success: true,
        health: healthData,
        push: pushData
    };
};

/**
 * Fetch queue stats: pending actions and failed actions count
 */
export const getQueueStats = async () => {
    try {
        return await invoke('get_queue_stats');
    } catch (e) {
        console.warn("Failed to get queue stats:", e);
        return { pending_count: 0, failed_count: 0 };
    }
};

/**
 * Execute full sync pipeline:
 * Step 1: Push offline queue actions to Cloudflare Worker
 * Step 2: Pull cloud WAL to replica.db
 * Step 3: Hot-clone replica.db to mirror.db
 * Step 4: Verify sync watermark and remove committed items from offline queue
 * Step 5: Replay pending local actions onto mirror.db
 */
export const triggerFullSync = async (force = false) => {
    if (isSyncing) {
        console.log("[Sync] Sync already in progress, skipping.");
        return { inProgress: true };
    }

    const { dbType, workerUrl, workerSecret, deviceId } = await getSyncConfig();
    if (dbType !== 'turso') {
        return { skipped: true, reason: 'sqlite_mode' };
    }

    if (!navigator.onLine && !force) {
        console.log("[Sync] Device is offline, skipping remote sync.");
        return { skipped: true, reason: 'offline' };
    }

    isSyncing = true;
    window.dispatchEvent(new CustomEvent('database-sync-status', { 
        detail: { isSyncing: true, lastSyncTime, lastSyncResult, lastSyncError } 
    }));

    try {
        // Step 1: Check offline queue and push to Cloudflare Worker if URL configured
        const pendingActions = await invoke('get_pending_queue');
        if (pendingActions && pendingActions.length > 0) {
            if (!workerUrl) {
                console.warn("[Sync] Offline queue has " + pendingActions.length + " pending actions, but sync_worker_url is not configured.");
            } else {
                console.log("[Sync] Pushing " + pendingActions.length + " actions to Cloudflare Worker...");
                const payload = {
                    device_id: deviceId,
                    actions: pendingActions.map(a => {
                        let parsedArgs = [];
                        try {
                            parsedArgs = JSON.parse(a.args_json || '[]');
                        } catch (e) {
                            parsedArgs = [];
                        }
                        return {
                            seq_id: a.seq_id,
                            sql_text: a.sql_text,
                            args: parsedArgs,
                            args_json: a.args_json,
                            created_at: a.created_at
                        };
                    })
                };

                const headers = { 
                    'Content-Type': 'application/json',
                    'User-Agent': BROWSER_USER_AGENT
                };
                if (workerSecret) {
                    headers['Authorization'] = `Bearer ${workerSecret.trim()}`;
                    headers['x-api-key'] = workerSecret.trim();
                }

                const pushEndpoint = normalizeWorkerUrl(workerUrl);
                const response = await tauriFetch(pushEndpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error("[Sync] Worker push failed with status " + response.status + ":", errText);
                    if (response.status === 422 || response.status === 400) {
                        // Poison pill detection: mark problematic action as failed so queue isn't blocked forever
                        try {
                            const errJson = JSON.parse(errText);
                            const failedSeq = errJson.failed_seq_id || pendingActions[0].seq_id;
                            const errMsg = errJson.error_message || errJson.error || errText;
                            await invoke('mark_queue_failed', { 
                                seqId: failedSeq, 
                                errorMsg: errMsg 
                            });
                        } catch (pe) {
                            await invoke('mark_queue_failed', { 
                                seqId: pendingActions[0].seq_id, 
                                errorMsg: errText 
                            });
                        }
                    }
                    throw new Error(`Worker rejected payload (${response.status}): ${errText}`);
                }
                console.log("[Sync] Worker successfully accepted queue batch.");
            }
        }

        // Steps 2..5 in Rust: replica WAL sync -> mirror clone -> watermark verify -> clean queue -> replay pending
        const syncResult = await invoke('sync_replica_and_mirror', { deviceId });
        console.log("[Sync] Replica and mirror synchronized successfully:", syncResult);

        lastSyncTime = Date.now();
        lastSyncResult = syncResult;
        lastSyncError = null;

        window.dispatchEvent(new CustomEvent('database-synced', { 
            detail: { syncResult, timestamp: lastSyncTime } 
        }));

        return { success: true, result: syncResult };
    } catch (err) {
        console.error("[Sync] Sync cycle failed:", err);
        lastSyncError = err?.message || String(err);
        return { success: false, error: lastSyncError };
    } finally {
        isSyncing = false;
        window.dispatchEvent(new CustomEvent('database-sync-status', { 
            detail: { isSyncing: false, lastSyncTime, lastSyncResult, lastSyncError } 
        }));
    }
};

/**
 * Schedule a debounced sync call (e.g. 3s after a write operation)
 */
export const scheduleDebouncedSync = (delayMs = 3000) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        triggerFullSync();
    }, delayMs);
};

/**
 * Initialize automatic background sync triggers (online event + periodic interval)
 */
export const initSyncService = () => {
    // 1. Online recovery trigger
    window.addEventListener('online', () => {
        console.log("[Sync] Network online event triggered, initiating sync...");
        triggerFullSync();
    });

    // 2. Periodic background sync (every 10 minutes)
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
        triggerFullSync();
    }, 10 * 60 * 1000);

    console.log("[Sync] Sync service initialized.");
};
