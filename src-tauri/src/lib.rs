use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value as JsonValue;
use libsql::{Builder, Connection, Database, Value as LibsqlValue};

struct DbState {
    db: Arc<Mutex<Option<Database>>>,
    conn: Arc<Mutex<Option<Connection>>>,
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
async fn init_turso(
    state: tauri::State<'_, DbState>,
    path: String,
    url: String,
    token: String,
) -> Result<(), String> {
    let db = Builder::new_remote_replica(&path, url, token)
        .build()
        .await
        .map_err(|e| e.to_string())?;

    let conn = db.connect().map_err(|e| e.to_string())?;
    
    // Initial sync
    db.sync().await.map_err(|e| e.to_string())?;

    *state.db.lock().await = Some(db);
    *state.conn.lock().await = Some(conn);

    Ok(())
}

#[tauri::command]
async fn init_local(
    state: tauri::State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let db = Builder::new_local(&path)
        .build()
        .await
        .map_err(|e| e.to_string())?;

    let conn = db.connect().map_err(|e| e.to_string())?;

    *state.db.lock().await = Some(db);
    *state.conn.lock().await = Some(conn);

    Ok(())
}

#[tauri::command]
async fn turso_sync(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db_guard = state.db.lock().await;
    if let Some(db) = db_guard.as_ref() {
        db.sync().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Database not initialized".to_string())
    }
}

#[tauri::command]
async fn turso_execute(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<u64, String> {
    let conn_guard = state.conn.lock().await;
    let conn = conn_guard.as_ref().ok_or("No connection")?;
    
    let libsql_args = json_to_libsql(args);
    let changed = conn.execute(&query, libsql_args).await.map_err(|e| e.to_string())?;
    
    Ok(changed)
}

#[tauri::command]
async fn turso_select(
    state: tauri::State<'_, DbState>, 
    query: String, 
    args: Vec<JsonValue>
) -> Result<Vec<serde_json::Map<String, JsonValue>>, String> {
    let conn_guard = state.conn.lock().await;
    let conn = conn_guard.as_ref().ok_or("No connection")?;
    
    let libsql_args = json_to_libsql(args);
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
    
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_state = DbState {
        db: Arc::new(Mutex::new(None)),
        conn: Arc::new(Mutex::new(None)),
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
            turso_sync,
            turso_execute,
            turso_select
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
