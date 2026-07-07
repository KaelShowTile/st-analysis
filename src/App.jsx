import { useEffect, useState } from 'react';
import { Home, LayoutDashboard, Settings as SettingsIcon, Sun, Moon, Receipt, BarChart2, LogOut, Box } from 'lucide-react';
import { getDb, getDbPath } from './db/Database';
import { appDataDir, join } from '@tauri-apps/api/path';
import { copyFile, mkdir, readDir, remove, exists } from '@tauri-apps/plugin-fs';
import './App.css';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Containers from './pages/Containers';
import Settings from './pages/Settings';
import Login from './pages/Login';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [theme, setTheme] = useState('light');
  const [dbReady, setDbReady] = useState(false);
  
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('currentUser');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    const initDb = async () => {
      try {
        // Automatic DB Backup
        if (!sessionStorage.getItem('backup_done')) {
            try {
                const appDir = await appDataDir();
                const customDb = await getDbPath();
                const dbPath = customDb ? customDb : await join(appDir, 'inventory.db');
                if (await exists(dbPath)) {
                    const backupDir = await join(appDir, 'backups');
                    if (!(await exists(backupDir))) {
                        await mkdir(backupDir, { recursive: true });
                    }
                    
                    const timestamp = Date.now();
                    const backupPath = await join(backupDir, `inventory_backup_${timestamp}.db`);
                    await copyFile(dbPath, backupPath);
                    
                    // Cleanup old backups (keep latest 5)
                    const files = await readDir(backupDir);
                    const backups = files.filter(f => f.name && f.name.startsWith('inventory_backup_') && f.name.endsWith('.db'));
                    backups.sort((a, b) => b.name.localeCompare(a.name)); // sort descending (newest first)
                    
                    if (backups.length > 5) {
                        const toDelete = backups.slice(5);
                        for (const f of toDelete) {
                            await remove(await join(backupDir, f.name));
                        }
                    }
                    sessionStorage.setItem('backup_done', 'true');
                }
            } catch (backupErr) {
                console.error("Backup failed:", backupErr);
            }
        }

        const db = await getDb();
        const result = await db.select("SELECT value FROM settings WHERE key = 'theme'");
        if (result.length > 0) {
          const savedTheme = result[0].value;
          setTheme(savedTheme !== 'system' ? savedTheme : 'light');
        }
        
        // Refresh current user permissions from DB to handle newly added permissions
        if (currentUser) {
            const freshUser = await db.select("SELECT * FROM users WHERE id = $1", [currentUser.id]);
            if (freshUser.length > 0) {
                const updatedUser = { ...freshUser[0], permissions: JSON.parse(freshUser[0].permissions) };
                setCurrentUser(updatedUser);
                localStorage.setItem('currentUser', JSON.stringify(updatedUser));
            }
        }

        setDbReady(true);
      } catch (err) {
        console.error("Failed to initialize DB:", err);
      }
    };
    initDb();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      const db = await getDb();
      await db.execute("UPDATE settings SET value = $1 WHERE key = 'theme'", [newTheme]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogin = (user) => {
      localStorage.setItem('currentUser', JSON.stringify(user));
      setCurrentUser(user);
      setActiveTab('dashboard');
  };

  const navigateTo = (tab, reportId = null) => {
      if (reportId) setSelectedReportId(reportId);
      setActiveTab(tab);
  };

  const handleLogout = () => {
      localStorage.removeItem('currentUser');
      setCurrentUser(null);
  };

  if (!dbReady) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!currentUser) {
      return <Login onLogin={handleLogin} />;
  }

  const p = currentUser.permissions;

  return (
    <div className="app-container">
      <div className="topbar">
        <div className="topbar-left">
          <div className="logo">ShowTile</div>
          <ul className="nav-menu">
            <li className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => navigateTo('dashboard')}>
                <Home size={18} />
                Dashboard
            </li>
            {p.inventory?.read && (
                <li className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => navigateTo('inventory')}>
                  <LayoutDashboard size={18} />
                  Inventory
                </li>
            )}
            {p.sales?.read && (
                <li className={`nav-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => navigateTo('sales')}>
                  <Receipt size={18} />
                  Sales
                </li>
            )}
            {p.reports?.read && (
                <li className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => navigateTo('reports')}>
                  <BarChart2 size={18} />
                  Reports
                </li>
            )}
            {p.containers?.read && (
                <li className={`nav-item ${activeTab === 'containers' ? 'active' : ''}`} onClick={() => navigateTo('containers')}>
                  <Box size={18} />
                  Containers
                </li>
            )}
            {p.settings?.read && (
                <li className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => navigateTo('settings')}>
                  <SettingsIcon size={18} />
                  Settings
                </li>
            )}
          </ul>
        </div>
        <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-color)' }}>
              {currentUser.username}
          </div>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="theme-toggle" onClick={handleLogout} title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
      <div className="main-content">
        <div className="content-area">
          {activeTab === 'dashboard' && <Dashboard currentUser={currentUser} onNavigate={navigateTo} />}
          {activeTab === 'inventory' && p.inventory?.read && <Inventory currentUser={currentUser} />}
          {activeTab === 'sales' && p.sales?.read && <Sales currentUser={currentUser} />}
          {activeTab === 'reports' && p.reports?.read && <Reports currentUser={currentUser} initialReportId={selectedReportId} />}
          {activeTab === 'containers' && p.containers?.read && <Containers currentUser={currentUser} />}
          {activeTab === 'settings' && p.settings?.read && <Settings currentUser={currentUser} />}
        </div>
      </div>
    </div>
  );
}

export default App;
