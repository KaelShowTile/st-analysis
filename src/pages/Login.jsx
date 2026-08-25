import { useState, useEffect } from 'react';
import { getDb, getDbPath } from '../db/Database';
import { open } from '@tauri-apps/plugin-dialog';
import { load } from '@tauri-apps/plugin-store';
import { appDataDir, join } from '@tauri-apps/api/path';
import { FolderOpen } from 'lucide-react';
import './Login.css';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [currentDbPath, setCurrentDbPath] = useState('');

    useEffect(() => {
        const loadDbPath = async () => {
            try {
                const path = await getDbPath();
                if (path) {
                    setCurrentDbPath(path);
                } else {
                    const appDir = await appDataDir();
                    setCurrentDbPath(await join(appDir, 'inventory.db'));
                }
            } catch (err) {
                console.error("Failed to load db path", err);
            }
        };
        loadDbPath();
    }, []);

    const handleConnectDatabase = async () => {
        try {
            const newPath = await open({
                filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                defaultPath: 'inventory.db'
            });

            if (newPath) {
                const store = await load('settings.json', { autoSave: false });
                await store.set('customDbPath', newPath);
                await store.save();

                alert("Successfully connected to the database! The application will now restart.");
                window.location.reload();
            }
        } catch (err) {
            console.error("Failed to connect database:", err);
            alert("Failed to connect database. Please check permissions and try again.");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!username || !password) {
            setError('Please enter both username and password.');
            return;
        }

        try {
            const db = await getDb();
            const result = await db.select(
                'SELECT * FROM users WHERE username = $1 AND password = $2',
                [username, password]
            );

            if (result.length > 0) {
                const user = result[0];
                const permissions = JSON.parse(user.permissions);
                onLogin({ id: user.id, username: user.username, permissions });
            } else {
                setError('Invalid username or password.');
            }
        } catch (err) {
            console.error("Login Error:", err);
            setError('An error occurred during login.');
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-logo">Login</div>
                <div className="login-subtitle">Sign in to access your analytics dashboard</div>

                {error && <div className="login-error">{error}</div>}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div>
                        <label>Username</label>
                        <input
                            type="text"
                            className="login-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your username"
                        />
                    </div>
                    <div>
                        <label>Password</label>
                        <input
                            type="password"
                            className="login-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                        />
                    </div>
                    <button type="submit" className="login-btn">Log In</button>
                </form>

                <div className="login-db-section">
                    <div className="login-db-header">
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>Database Storage Location</h4>
                    </div>
                    <div className="login-db-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                            <FolderOpen size={16} style={{ color: '#3b82f6', flexShrink: 0 }} />
                            <div className="login-db-path" title={currentDbPath}>
                                {currentDbPath || 'Loading...'}
                            </div>
                        </div>
                        <button onClick={handleConnectDatabase} type="button" className="login-db-btn">
                            Connect
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
