import { useState } from 'react';
import ContainerList from './ContainerList';
import ShipperList from './ShipperList';
import './Containers.css';

export default function Containers({ currentUser }) {
    const [subTab, setSubTab] = useState('list'); // 'list', 'report', 'shipper'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="containers-subnav" style={{ 
                display: 'flex', 
                gap: '16px', 
                padding: '12px 24px', 
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                zIndex: 10
            }}>
                <button 
                    className={`subnav-btn ${subTab === 'list' ? 'active' : ''}`}
                    onClick={() => setSubTab('list')}
                >
                    Container List
                </button>
                <button 
                    className={`subnav-btn ${subTab === 'report' ? 'active' : ''}`}
                    onClick={() => setSubTab('report')}
                >
                    Container Report
                </button>
                <button 
                    className={`subnav-btn ${subTab === 'shipper' ? 'active' : ''}`}
                    onClick={() => setSubTab('shipper')}
                >
                    Shipper
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                {subTab === 'list' && <ContainerList currentUser={currentUser} />}
                {subTab === 'report' && (
                    <div style={{ padding: '24px', color: 'var(--text-color)' }}>
                        <h3>Container Report</h3>
                        <p>This page is currently a placeholder.</p>
                    </div>
                )}
                {subTab === 'shipper' && <ShipperList currentUser={currentUser} />}
            </div>
        </div>
    );
}
