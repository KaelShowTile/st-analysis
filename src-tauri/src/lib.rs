use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use libsql::{Builder, Connection, Database, Value as LibsqlValue};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueueAction {
    pub seq_id: i64,
    pub sql_text: String,
    pub args_json: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncResult {
    pub synced_seq_id: i64,
    pub replayed_count: usize,
    pub remaining_pending: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueueStats {
    pub pending_count: i64,
    pub failed_count: i64,
}

pub struct DbState {
    pub replica_db: Arc<Mutex<Option<Database>>>,
    pub replica_path: Arc<Mutex<String>>,

    pub mirror_db: Arc<Mutex<Option<Database>>>,
    pub mirror_conn: Arc<Mutex<Option<Connection>>>,
    pub mirror_path: Arc<Mutex<String>>,

    pub queue_db: Arc<Mutex<Option<Database>>>,
    pub queue_conn: Arc<Mutex<Option<Connection>>>,
    pub queue_path: Arc<Mutex<String>>,

    pub sync_mutex: Arc<Mutex<()>>,
}

fn json_to_libsql(args: Vec<JsonValue>) -> Vec<LibsqlValue> {
    args.into_iter().map(|v| match v {
        JsonValue::Null => LibsqlValue::Null,
        JsonValue::Bool(b) => if b { LibsqlValue::Integer(1) } else { LibsqlValue::Integer(0) },
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                LibsqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                LibsqlValue::Real(f)
            } else {
                LibsqlValue::Null
            }
        },
        JsonValue::String(s) => LibsqlValue::Text(s),
        _ => LibsqlValue::Text(v.to_string()),
    }).collect()
}

#[tauri::command]
async fn init_sync_architecture(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    replica_path: String,
    mirror_path: String,
    queue_path: String,
    url: String,
    token: String,
) -> Result<(), String> {
    let _ = app.emit("init-progress", "Initializing system...");

    // 1. Initialize queue.db
    let queue_db = Builder::new_local(&queue_path)
        .build()
        .await
        .map_err(|e| format!("Failed to build queue db: {}", e))?;
    let queue_conn = queue_db.connect().map_err(|e| format!("Failed to connect queue db: {}", e))?;

    queue_conn.execute(
        "CREATE TABLE IF NOT EXISTS offline_queue (
            seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sql_text TEXT NOT NULL,
            args_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            error_msg TEXT DEFAULT NULL
        );",
        (),
    ).await.map_err(|e| format!("Failed to initialize offline_queue table: {}", e))?;

    let _ = queue_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_offline_queue_status_seq ON offline_queue(status, seq_id);",
        (),
    ).await;

    // 2. Initialize replica.db
    let replica_exists = std::path::Path::new(&replica_path).exists();
    let mirror_file = std::path::Path::new(&mirror_path);
    let mirror_exists = mirror_file.exists();

    let replica_db = Builder::new_remote_replica(&replica_path, url, token)
        .sync_protocol(libsql::SyncProtocol::V2)
        .build()
        .await
        .map_err(|e| format!("Failed to build replica db: {}", e))?;

    // Only block on network sync if neither mirror nor replica exists (fresh install)
    if !mirror_exists && !replica_exists {
        let _ = app.emit("init-progress", "Downloading initial database...");
        replica_db.sync().await.map_err(|e| format!("Initial replica sync failed: {}", e))?;
    } else {
        println!("Existing local database detected. Skipping blocking sync for instant startup.");
    }

    // 3. Initialize mirror.db
    let _ = app.emit("init-progress", "Creating mirror database...");
    if !mirror_exists && std::path::Path::new(&replica_path).exists() {
        let _ = std::fs::copy(&replica_path, &mirror_path);
    }

    let mirror_db = Builder::new_local(&mirror_path)
        .build()
        .await
        .map_err(|e| format!("Failed to build mirror db: {}", e))?;
    let mirror_conn = mirror_db.connect().map_err(|e| format!("Failed to connect mirror db: {}", e))?;

    // Store into state
    *state.replica_db.lock().await = Some(replica_db);
    *state.replica_path.lock().await = replica_path;

    *state.mirror_db.lock().await = Some(mirror_db);
    *state.mirror_conn.lock().await = Some(mirror_conn);
    *state.mirror_path.lock().await = mirror_path;

    *state.queue_db.lock().await = Some(queue_db);
    *state.queue_conn.lock().await = Some(queue_conn);
    *state.queue_path.lock().await = queue_path;

    println!("3-Database sync architecture initialized successfully.");
    Ok(())
}

#[tauri::command]
async fn init_turso(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    path: String,
    url: String,
    token: String,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let parent = p.parent().unwrap_or(std::path::Path::new(""));
    let mirror_path = parent.join("mirror.db").to_str().unwrap_or("mirror.db").to_string();
    let queue_path = parent.join("queue.db").to_str().unwrap_or("queue.db").to_string();

    init_sync_architecture(app, state, path, mirror_path, queue_path, url, token).await
}

#[tauri::command]
async fn init_local(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let _ = app.emit("init-progress", "Initializing local database...");
    let mirror_db = Builder::new_local(&path)
        .build()
        .await
        .map_err(|e| e.to_string())?;
    let mirror_conn = mirror_db.connect().map_err(|e| e.to_string())?;

    *state.mirror_db.lock().await = Some(mirror_db);
    *state.mirror_conn.lock().await = Some(mirror_conn);
    *state.mirror_path.lock().await = path;

    Ok(())
}

#[tauri::command]
async fn mirror_select(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<Vec<serde_json::Map<String, JsonValue>>, String> {
    let libsql_args = json_to_libsql(args);
    for _ in 0..10 {
        let conn_guard = state.mirror_conn.lock().await;
        if let Some(conn) = conn_guard.as_ref() {
            let mut rows = conn.query(&query, libsql_args).await.map_err(|e| e.to_string())?;
            
            let mut result = Vec::new();
            while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
                let mut map = serde_json::Map::new();
                for i in 0..row.column_count() {
                    let name = row.column_name(i).unwrap_or("").to_string();
                    let value = row.get_value(i).map_err(|e| e.to_string())?;
                    let json_value = match value {
                        LibsqlValue::Null => JsonValue::Null,
                        LibsqlValue::Integer(i) => JsonValue::Number(serde_json::Number::from(i)),
                        LibsqlValue::Real(f) => serde_json::Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null),
                        LibsqlValue::Text(t) => JsonValue::String(t),
                        LibsqlValue::Blob(_) => JsonValue::String("blob".to_string()),
                    };
                    map.insert(name, json_value);
                }
                result.push(map);
            }
            return Ok(result);
        }
        drop(conn_guard);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    
    Err("No mirror connection".to_string())
}

#[tauri::command]
async fn mirror_execute(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<u64, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    
    let args_str = serde_json::to_string(&args).map_err(|e| e.to_string())?;

    // 1. If queue is initialized, record into queue.db
    {
        let q_guard = state.queue_conn.lock().await;
        if let Some(q_conn) = q_guard.as_ref() {
            q_conn.execute(
                "INSERT INTO offline_queue (sql_text, args_json, created_at, status) VALUES (?1, ?2, ?3, 'pending')",
                vec![
                    LibsqlValue::Text(query.clone()),
                    LibsqlValue::Text(args_str),
                    LibsqlValue::Integer(now),
                ],
            ).await.map_err(|e| format!("Failed to record in offline queue: {}", e))?;
        }
    }

    // 2. Execute on mirror.db (with retry if mirror is reconnecting)
    for _ in 0..10 {
        let m_guard = state.mirror_conn.lock().await;
        if let Some(m_conn) = m_guard.as_ref() {
            let libsql_args = json_to_libsql(args.clone());
            let changed = m_conn.execute(&query, libsql_args).await.map_err(|e| format!("Failed to execute on mirror: {}", e))?;
            return Ok(changed);
        }
        drop(m_guard);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    Err("No mirror connection".to_string())
}

// Aliases for seamless backward compatibility
#[tauri::command]
async fn turso_select(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<Vec<serde_json::Map<String, JsonValue>>, String> {
    mirror_select(state, query, args).await
}

#[tauri::command]
async fn turso_execute(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<u64, String> {
    mirror_execute(state, query, args).await
}

#[tauri::command]
async fn turso_sync(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db_guard = state.replica_db.lock().await;
    if let Some(db) = db_guard.as_ref() {
        db.sync().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Replica database not initialized".to_string())
    }
}

#[tauri::command]
async fn get_pending_queue(state: tauri::State<'_, DbState>) -> Result<Vec<QueueAction>, String> {
    let q_guard = state.queue_conn.lock().await;
    let q_conn = match q_guard.as_ref() {
        Some(c) => c,
        None => return Ok(Vec::new()),
    };

    let mut rows = q_conn.query(
        "SELECT seq_id, sql_text, args_json, created_at FROM offline_queue WHERE status = 'pending' ORDER BY seq_id ASC",
        (),
    ).await.map_err(|e| e.to_string())?;

    let mut actions = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        actions.push(QueueAction {
            seq_id: row.get::<i64>(0).unwrap_or(0),
            sql_text: row.get::<String>(1).unwrap_or_default(),
            args_json: row.get::<String>(2).unwrap_or_default(),
            created_at: row.get::<i64>(3).unwrap_or(0),
        });
    }

    Ok(actions)
}

#[tauri::command]
async fn mark_queue_failed(
    state: tauri::State<'_, DbState>,
    seq_id: i64,
    error_msg: String,
) -> Result<(), String> {
    let q_guard = state.queue_conn.lock().await;
    let q_conn = q_guard.as_ref().ok_or("Queue DB not initialized")?;

    q_conn.execute(
        "UPDATE offline_queue SET status = 'failed', error_msg = ?1 WHERE seq_id = ?2",
        vec![LibsqlValue::Text(error_msg), LibsqlValue::Integer(seq_id)],
    ).await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_queue_stats(state: tauri::State<'_, DbState>) -> Result<QueueStats, String> {
    let q_guard = state.queue_conn.lock().await;
    let q_conn = match q_guard.as_ref() {
        Some(c) => c,
        None => return Ok(QueueStats { pending_count: 0, failed_count: 0 }),
    };

    let mut p_rows = q_conn.query("SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'", ()).await.map_err(|e| e.to_string())?;
    let pending_count = if let Some(r) = p_rows.next().await.map_err(|e| e.to_string())? {
        r.get::<i64>(0).unwrap_or(0)
    } else {
        0
    };

    let mut f_rows = q_conn.query("SELECT COUNT(*) FROM offline_queue WHERE status = 'failed'", ()).await.map_err(|e| e.to_string())?;
    let failed_count = if let Some(r) = f_rows.next().await.map_err(|e| e.to_string())? {
        r.get::<i64>(0).unwrap_or(0)
    } else {
        0
    };

    Ok(QueueStats { pending_count, failed_count })
}

#[tauri::command]
async fn sync_replica_and_mirror(
    state: tauri::State<'_, DbState>,
    device_id: String,
) -> Result<SyncResult, String> {
    let _lock = state.sync_mutex.lock().await;

    let replica_path = state.replica_path.lock().await.clone();
    let mirror_path = state.mirror_path.lock().await.clone();

    if replica_path.is_empty() || mirror_path.is_empty() {
        return Err("Sync architecture not initialized".to_string());
    }

    // Step 2: Pull cloud WAL frames onto replica.db
    {
        let replica_guard = state.replica_db.lock().await;
        let replica = replica_guard.as_ref().ok_or("Replica DB not initialized")?;
        replica.sync().await.map_err(|e| format!("Replica sync failed: {}", e))?;
    }

    // Step 3: Clone replica.db to mirror.db (with Windows safe release)
    {
        let mut m_conn_guard = state.mirror_conn.lock().await;
        *m_conn_guard = None;
        let mut m_db_guard = state.mirror_db.lock().await;
        *m_db_guard = None;
    }
    // Give Windows OS time to release file handles
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;

    // Overwrite mirror.db with replica.db
    std::fs::copy(&replica_path, &mirror_path).map_err(|e| format!("Failed to copy replica to mirror: {}", e))?;
    
    let replica_wal = format!("{}-wal", replica_path);
    let mirror_wal = format!("{}-wal", mirror_path);
    if std::path::Path::new(&replica_wal).exists() {
        let _ = std::fs::copy(&replica_wal, &mirror_wal);
    } else {
        let _ = std::fs::remove_file(&mirror_wal);
    }

    let replica_shm = format!("{}-shm", replica_path);
    let mirror_shm = format!("{}-shm", mirror_path);
    if std::path::Path::new(&replica_shm).exists() {
        let _ = std::fs::copy(&replica_shm, &mirror_shm);
    } else {
        let _ = std::fs::remove_file(&mirror_shm);
    }

    // Reconnect mirror.db
    let new_mirror_db = Builder::new_local(&mirror_path)
        .build()
        .await
        .map_err(|e| format!("Failed to reopen mirror db: {}", e))?;
    let new_mirror_conn = new_mirror_db.connect().map_err(|e| format!("Failed to reconnect mirror db: {}", e))?;

    *state.mirror_db.lock().await = Some(new_mirror_db);
    *state.mirror_conn.lock().await = Some(new_mirror_conn);

    // Step 4: Verify watermark & clean queue
    let mirror_conn_guard = state.mirror_conn.lock().await;
    let mirror_conn = mirror_conn_guard.as_ref().ok_or("No mirror connection")?;

    let _ = mirror_conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_watermarks (
            device_id TEXT PRIMARY KEY,
            last_seq_id INTEGER,
            updated_at INTEGER
        );",
        (),
    ).await;

    let mut watermark_rows = mirror_conn.query(
        "SELECT last_seq_id FROM sync_watermarks WHERE device_id = ?1",
        vec![LibsqlValue::Text(device_id.clone())],
    ).await.map_err(|e| format!("Failed to query sync_watermarks: {}", e))?;

    let synced_seq_id = if let Some(row) = watermark_rows.next().await.map_err(|e| e.to_string())? {
        row.get::<i64>(0).unwrap_or(0)
    } else {
        0
    };

    if synced_seq_id > 0 {
        let q_guard = state.queue_conn.lock().await;
        if let Some(q_conn) = q_guard.as_ref() {
            let _ = q_conn.execute(
                "DELETE FROM offline_queue WHERE seq_id <= ?1 AND status = 'pending'",
                vec![LibsqlValue::Integer(synced_seq_id)],
            ).await;
        }
    }

    // Step 5: Replay pending actions (seq_id > synced_seq_id)
    let pending_actions: Vec<(i64, String, String)> = {
        let q_guard = state.queue_conn.lock().await;
        if let Some(q_conn) = q_guard.as_ref() {
            let mut q_rows = q_conn.query(
                "SELECT seq_id, sql_text, args_json FROM offline_queue WHERE seq_id > ?1 AND status = 'pending' ORDER BY seq_id ASC",
                vec![LibsqlValue::Integer(synced_seq_id)],
            ).await.map_err(|e| e.to_string())?;

            let mut list = Vec::new();
            while let Some(r) = q_rows.next().await.map_err(|e| e.to_string())? {
                let sid: i64 = r.get(0).unwrap_or(0);
                let sql: String = r.get(1).unwrap_or_default();
                let args: String = r.get(2).unwrap_or_default();
                list.push((sid, sql, args));
            }
            list
        } else {
            Vec::new()
        }
    };

    let total_pending = pending_actions.len();
    let mut replayed_count = 0;
    for (_sid, sql, args_str) in pending_actions {
        let args_val: Vec<JsonValue> = serde_json::from_str(&args_str).unwrap_or_default();
        let libsql_args = json_to_libsql(args_val);
        if let Err(e) = mirror_conn.execute(&sql, libsql_args).await {
            eprintln!("Warning: Replay SQL failed: {} for SQL: {}", e, sql);
        } else {
            replayed_count += 1;
        }
    }

    Ok(SyncResult {
        synced_seq_id,
        replayed_count,
        remaining_pending: total_pending - replayed_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_state = DbState {
        replica_db: Arc::new(Mutex::new(None)),
        replica_path: Arc::new(Mutex::new(String::new())),

        mirror_db: Arc::new(Mutex::new(None)),
        mirror_conn: Arc::new(Mutex::new(None)),
        mirror_path: Arc::new(Mutex::new(String::new())),

        queue_db: Arc::new(Mutex::new(None)),
        queue_conn: Arc::new(Mutex::new(None)),
        queue_path: Arc::new(Mutex::new(String::new())),

        sync_mutex: Arc::new(Mutex::new(())),
    };

    tauri::Builder::default()
        .manage(db_state)
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_local,
            init_turso,
            init_sync_architecture,
            mirror_select,
            mirror_execute,
            turso_select,
            turso_execute,
            turso_sync,
            get_pending_queue,
            mark_queue_failed,
            get_queue_stats,
            sync_replica_and_mirror
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

