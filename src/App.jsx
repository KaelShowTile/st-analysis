import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings as SettingsIcon, Sun, Moon, Receipt, BarChart2 } from 'lucide-react';
import { getDb } from './db/Database';
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
