import { useState, useEffect } from 'react';
import { getDb, getDbPath } from '../db/Database';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Settings.css';
import { Trash2, Plus, Download, Upload, DatabaseBackup, RotateCcw, FolderOpen, Edit3, X, UserCog } from 'lucide-react';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readDir, copyFile, exists } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';

export default function Settings({ currentUser }) {
    const [attributes, setAttributes] = useState([]);
    const [newType, setNewType] = useState('colour');
    const [newValue, setNewValue] = useState('');
    const [backups, setBackups] = useState([]);
    const [isRestoring, setIsRestoring] = useState(false);
    const [currentDbPath, setCurrentDbPath] = useState('');

    const isAdmin = currentUser?.username === 'admin';
    const [users, setUsers] = useState([]);
    const [showUserModal, setShowUserModal] = useState(false);
    const [editingUserId, setEditingUserId] = useState(null);
    const [userForm, setUserForm] = useState({
        username: '', password: '', 
        permissions: {
            inventory: { read: false, write: false },
            sales: { read: false, write: false },
            reports: { read: false, write: false },
            settings: { read: false, write: false }
        }
    });

    const loadDbPath = async () => {
        const path = await getDbPath();
        if (path) {
            setCurrentDbPath(path);
        } else {
            const appDir = await appDataDir();
            setCurrentDbPath(await join(appDir, 'inventory.db'));
        }
    };

    const handleMoveDatabase = async () => {
        try {
            const newPath = await save({
                filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                defaultPath: 'inventory.db'
            });

            if (newPath) {
                // Copy current DB to new path
                const appDir = await appDataDir();
                const currentCustomPath = await getDbPath();
                const sourcePath = currentCustomPath ? currentCustomPath : await join(appDir, 'inventory.db');
                
                if (await exists(sourcePath)) {
                    await copyFile(sourcePath, newPath);
                }

                // Save new path to Store
                const store = await load('settings.json', { autoSave: false });
                await store.set('customDbPath', newPath);
                await store.save();

                alert("Database successfully moved! The application will now restart to apply changes.");
                window.location.reload();
            }
        } catch (err) {
            console.error("Failed to move database:", err);
            alert("Failed to move database. Please check permissions and try again.");
        }
    };

    const loadAttributes = async () => {
        const db = await getDb();
        const results = await db.select('SELECT * FROM attributes ORDER BY type, value');
        setAttributes(results);
    };

    const loadBackups = async () => {
        try {
            const appDir = await appDataDir();
            const backupDir = await join(appDir, 'backups');
            const files = await readDir(backupDir);
            const backupFiles = files.filter(f => f.name && f.name.startsWith('inventory_backup_') && f.name.endsWith('.db'));
            backupFiles.sort((a, b) => b.name.localeCompare(a.name));
            
            const formatted = backupFiles.map(f => {
                const tsStr = f.name.replace('inventory_backup_', '').replace('.db', '');
                const ts = parseInt(tsStr, 10);
                const date = new Date(ts);
                return {
                    name: f.name,
                    time: date.toLocaleString()
                };
            });
            setBackups(formatted);
        } catch (err) {
            console.error("Could not load backups", err);
        }
    };

    const loadUsers = async () => {
        if (!isAdmin) return;
        try {
            const db = await getDb();
            const results = await db.select('SELECT id, username, password, permissions FROM users ORDER BY id ASC');
            setUsers(results.map(u => ({ ...u, permissions: JSON.parse(u.permissions) })));
        } catch (err) {
            console.error("Could not load users", err);
        }
    };

    useEffect(() => {
        loadAttributes();
        loadBackups();
        loadDbPath();
        loadUsers();
    }, []);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newValue.trim()) return;
        try {
            const db = await getDb();
            await db.execute('INSERT INTO attributes (type, value) VALUES ($1, $2)', [newType, newValue.trim()]);
            setNewValue('');
            loadAttributes();
        } catch (err) {
            console.error('Failed to add attribute', err);
        }
    };

    const handleDelete = async (id) => {
        try {
            const db = await getDb();
            await db.execute('DELETE FROM attributes WHERE id = $1', [id]);
            loadAttributes();
        } catch (err) {
            console.error('Failed to delete attribute', err);
        }
    };

    const handleSaveUser = async () => {
        if (!userForm.username || !userForm.password) return alert("Username and password are required.");
        
        const db = await getDb();
        const perms = JSON.stringify(userForm.permissions);
        
        try {
            if (editingUserId) {
                await db.execute('UPDATE users SET username = $1, password = $2, permissions = $3 WHERE id = $4', 
                    [userForm.username, userForm.password, perms, editingUserId]);
            } else {
                await db.execute('INSERT INTO users (username, password, permissions) VALUES ($1, $2, $3)', 
                    [userForm.username, userForm.password, perms]);
            }
            setShowUserModal(false);
            loadUsers();
        } catch (err) {
            console.error("Failed to save user", err);
            alert("Failed to save user (username might already exist).");
        }
    };

    const handleDeleteUser = async (id) => {
        if (id === 1) return alert("Cannot delete the admin account.");
        if (!window.confirm("Are you sure you want to delete this user?")) return;
        try {
            const db = await getDb();
            await db.execute('DELETE FROM users WHERE id = $1', [id]);
            loadUsers();
        } catch (err) {
            console.error("Failed to delete user", err);
        }
    };

    const handleRestore = async (backupName) => {
        if (isRestoring) return;
        if (!window.confirm("WARNING: Restoring a backup will overwrite your current database. Any changes made since this backup will be permanently lost. Are you sure you want to proceed?")) return;
        
        setIsRestoring(true);
        try {
            const appDir = await appDataDir();
            const dbPath = await join(appDir, 'inventory.db');
            const backupPath = await join(appDir, 'backups', backupName);
            await copyFile(backupPath, dbPath);
            alert("Database restored successfully! The application will now reload.");
            window.location.reload();
        } catch (err) {
            console.error("Restore failed", err);
            alert("Failed to restore database.");
            setIsRestoring(false);
        }
    };

    const exportCSV = async () => {
        try {
            const header = "Type,Value\n";
            const rows = attributes.map(a => `${a.type},${a.value}`).join("\n");
            const csvContent = header + rows;

            const filePath = await save({
                filters: [{
                    name: 'CSV File',
                    extensions: ['csv']
                }],
                defaultPath: 'product_parameters.csv',
            });

            if (filePath) {
                await writeTextFile(filePath, csvContent);
                alert("File exported successfully!");
            }
        } catch (e) {
            console.error('Failed to export file:', e);
            alert("Failed to export file.");
        }
    };

    const importCSV = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            const db = await getDb();
            let addedCount = 0;
            
            // Start from 1 to skip header
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length >= 2) {
                    const type = parts[0].toLowerCase().trim();
                    const value = parts[1].trim();
                    
                    if ((type === 'finish' || type === 'colour') && value) {
                        const exists = await db.select('SELECT id FROM attributes WHERE type = $1 AND value = $2', [type, value]);
                        if (exists.length === 0) {
                            await db.execute('INSERT INTO attributes (type, value) VALUES ($1, $2)', [type, value]);
                            addedCount++;
                        }
                    }
                }
            }
            alert(`Successfully imported ${addedCount} new parameters!`);
            loadAttributes();
        } catch (err) {
            console.error('Failed to import CSV', err);
            alert('Failed to import CSV. Please ensure it is a valid CSV file with Type,Value columns.');
        }
        e.target.value = ''; // Reset file input
    };

    return (
        <div className="settings-container">
            <div className="settings-card">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px'}}>
                    <div>
                        <h3 style={{margin: '0 0 4px 0'}}>Manage Product Parameters</h3>
                        <p className="subtitle" style={{margin: 0}}>Add or remove standard finishes and colours.</p>
                    </div>
                    <div style={{display: 'flex', gap: '8px'}}>
                        <label className="btn-primary" style={{cursor: 'pointer', backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', padding: '6px 12px', fontSize: '0.85rem'}}>
                            <Upload size={14} style={{marginRight: '6px'}} /> Import CSV
                            <input type="file" accept=".csv" style={{display: 'none'}} onChange={importCSV} />
                        </label>
                        <button className="btn-primary" onClick={exportCSV} style={{backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', padding: '6px 12px', fontSize: '0.85rem'}}>
                            <Download size={14} style={{marginRight: '6px'}} /> Export CSV
                        </button>
                    </div>
                </div>
                
                <form className="add-form" onSubmit={handleAdd}>
                    <select value={newType} onChange={e => setNewType(e.target.value)} className="form-select">
                        <option value="colour">Colour</option>
                        <option value="finish">Finish</option>
                    </select>
                    <input 
                        type="text" 
                        value={newValue} 
                        onChange={e => setNewValue(e.target.value)} 
                        placeholder="e.g. red, matt..." 
                        className="form-input"
                    />
                    <button type="submit" className="btn-primary">
                        <Plus size={16} /> Add
                    </button>
                </form>

                <div className="attributes-list">
                    {attributes.map(attr => (
                        <div key={attr.id} className="attribute-item">
                            <span className={`badge ${attr.type}`}>{attr.type}</span>
                            <span className="attr-value">{attr.value}</span>
                            <button onClick={() => handleDelete(attr.id)} className="btn-icon danger">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    {attributes.length === 0 && <p className="empty-text">No parameters added yet.</p>}
                </div>
            </div>

            <div className="settings-card" style={{ marginTop: '24px' }}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px'}}>
                    <div>
                        <h3 style={{margin: '0 0 4px 0'}}>Database Management</h3>
                        <p className="subtitle" style={{margin: 0}}>The system automatically backs up your database on startup (max 5 versions).</p>
                    </div>
                </div>

                <div className="attributes-list">
                    {backups.map(b => (
                        <div key={b.name} className="attribute-item" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-color)', borderRadius: '6px', marginBottom: '8px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <DatabaseBackup size={18} style={{ color: '#3b82f6' }} />
                                <div>
                                    <div style={{ fontWeight: 500 }}>{b.time}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{b.name}</div>
                                </div>
                            </div>
                            <button onClick={() => handleRestore(b.name)} disabled={isRestoring} className="btn-primary" style={{ backgroundColor: isRestoring ? '#fee2e2' : '#fef2f2', color: isRestoring ? '#9ca3af' : '#ef4444', border: '1px solid #fca5a5', cursor: isRestoring ? 'not-allowed' : 'pointer' }}>
                                <RotateCcw size={16} style={{ marginRight: '6px' }} /> {isRestoring ? 'Restoring...' : 'Restore'}
                            </button>
                        </div>
                    ))}
                    {backups.length === 0 && <p className="empty-text">No backups available yet. Restart the app to create one.</p>}
                </div>
            </div>

            <div className="settings-card" style={{ marginTop: '24px' }}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px'}}>
                    <div>
                        <h3 style={{margin: '0 0 4px 0'}}>Database Storage Location</h3>
                        <p className="subtitle" style={{margin: 0}}>Move your database to a custom folder (e.g. Google Drive) for backup or sharing.</p>
                    </div>
                </div>

                <div className="attribute-item" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-color)', borderRadius: '6px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, overflow: 'hidden' }}>
                        <FolderOpen size={18} style={{ color: '#3b82f6', flexShrink: 0 }} />
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 500 }}>Current Location</div>
                            <div style={{ fontSize: '0.8rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }} title={currentDbPath}>{currentDbPath}</div>
                        </div>
                    </div>
                    <button onClick={handleMoveDatabase} className="btn-primary" style={{ flexShrink: 0, marginLeft: '16px' }}>
                        Move Database
                    </button>
                </div>
            </div>

            {isAdmin && (
                <div className="settings-card" style={{ marginTop: '24px' }}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px'}}>
                        <div>
                            <h3 style={{margin: '0 0 4px 0'}}>User Management</h3>
                            <p className="subtitle" style={{margin: 0}}>Create users and configure page-level read/write permissions.</p>
                        </div>
                        <button className="btn-primary" onClick={() => {
                            setEditingUserId(null);
                            setUserForm({
                                username: '', password: '', 
                                permissions: {
                                    inventory: { read: false, write: false },
                                    sales: { read: false, write: false },
                                    reports: { read: false, write: false },
                                    settings: { read: false, write: false }
                                }
                            });
                            setShowUserModal(true);
                        }} style={{backgroundColor: 'var(--primary-color)'}}>
                            <Plus size={14} style={{marginRight: '6px'}} /> Add User
                        </button>
                    </div>

                    <div className="attributes-list">
                        {users.map(u => (
                            <div key={u.id} className="attribute-item" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-color)', borderRadius: '6px', marginBottom: '8px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <UserCog size={18} style={{ color: '#8b5cf6' }} />
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{u.username}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            Password: {u.password}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => {
                                        setEditingUserId(u.id);
                                        setUserForm({
                                            username: u.username,
                                            password: u.password,
                                            permissions: u.permissions
                                        });
                                        setShowUserModal(true);
                                    }} className="btn-icon">
                                        <Edit3 size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteUser(u.id)} disabled={u.id === 1} className="btn-icon danger" style={{ opacity: u.id === 1 ? 0.3 : 1 }}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showUserModal && (
                <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
                    <div className="modal-content" style={{ width: '500px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingUserId ? 'Edit User' : 'New User'}</h3>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowUserModal(false)} />
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Username</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={userForm.username}
                                    onChange={e => setUserForm({...userForm, username: e.target.value})}
                                    disabled={editingUserId === 1}
                                />
                            </div>
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Password (Plain text)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={userForm.password}
                                    onChange={e => setUserForm({...userForm, password: e.target.value})}
                                />
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Permissions</label>
                                {Object.keys(userForm.permissions).map(page => (
                                    <div key={page} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', borderBottom: '1px solid #e2e8f0' }}>
                                        <div style={{ textTransform: 'capitalize', fontWeight: '500' }}>{page}</div>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: editingUserId === 1 ? 'not-allowed' : 'pointer', opacity: editingUserId === 1 ? 0.5 : 1 }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={userForm.permissions[page].read}
                                                    disabled={editingUserId === 1}
                                                    onChange={e => {
                                                        const val = e.target.checked;
                                                        setUserForm(prev => ({
                                                            ...prev,
                                                            permissions: {
                                                                ...prev.permissions,
                                                                [page]: { ...prev.permissions[page], read: val, write: val ? prev.permissions[page].write : false }
                                                            }
                                                        }));
                                                    }}
                                                />
                                                Read
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: editingUserId === 1 ? 'not-allowed' : 'pointer', opacity: editingUserId === 1 ? 0.5 : 1 }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={userForm.permissions[page].write}
                                                    disabled={editingUserId === 1 || !userForm.permissions[page].read}
                                                    onChange={e => setUserForm(prev => ({
                                                        ...prev,
                                                        permissions: {
                                                            ...prev.permissions,
                                                            [page]: { ...prev.permissions[page], write: e.target.checked }
                                                        }
                                                    }))}
                                                />
                                                Write
                                            </label>
                                        </div>
                                    </div>
                                ))}
                                {editingUserId === 1 && <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '8px' }}>Admin permissions cannot be modified.</p>}
                            </div>

                            <button className="btn-primary" onClick={handleSaveUser} style={{ width: '100%', marginTop: '16px' }}>
                                Save User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
