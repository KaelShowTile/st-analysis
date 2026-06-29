import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings as SettingsIcon, Sun, Moon, Receipt, BarChart2 } from 'lucide-react';
import { getDb } from './db/Database';
import { appDataDir, join } from '@tauri-apps/api/path';
import { copyFile, mkdir, readDir, remove, exists } from '@tauri-apps/plugin-fs';
import './App.css';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

function App() {
  const [activeTab, setActiveTab] = useState('inventory');
  const [theme, setTheme] = useState('light');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const initDb = async () => {
      try {
        // Automatic DB Backup
        if (!sessionStorage.getItem('backup_done')) {
            try {
                const appDir = await appDataDir();
                const dbPath = await join(appDir, 'inventory.db');
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

  if (!dbReady) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  return (
    <div className="app-container">
      <div className="topbar">
        <div className="topbar-left">
          <div className="logo">ShowTile</div>
          <ul className="nav-menu">
            <li className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}>
              <LayoutDashboard size={18} />
              Inventory
            </li>
            <li className={`nav-item ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => setActiveTab('sales')}>
              <Receipt size={18} />
              Sales
            </li>
            <li className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
              <BarChart2 size={18} />
              Reports
            </li>
            <li className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
              <SettingsIcon size={18} />
              Settings
            </li>
          </ul>
        </div>
        <div className="topbar-right">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </div>
      <div className="main-content">
        <div className="content-area">
          {activeTab === 'inventory' && <Inventory />}
          {activeTab === 'sales' && <Sales />}
          {activeTab === 'reports' && <Reports />}
          {activeTab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}

export default App;
