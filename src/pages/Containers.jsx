import { useState } from 'react';
import ContainerList from './ContainerList';
import ShipperList from './ShipperList';
import ContainerReport from './ContainerReport';
import ShipmentOrders from './ShipmentOrders';
import './Containers.css';

export default function Containers({ currentUser }) {
    const [subTab, setSubTab] = useState('report'); // 'list', 'report', 'shipper'
    const [editShipmentId, setEditShipmentId] = useState(null);

    const handleNavigateToShipment = (id) => {
        setEditShipmentId(id);
        setSubTab('shipments');
    };

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
                    className={`subnav-btn ${subTab === 'report' ? 'active' : ''}`}
                    onClick={() => setSubTab('report')}
                >
                    Dashboard
                </button>
                <button
                    className={`subnav-btn ${subTab === 'shipments' ? 'active' : ''}`}
                    onClick={() => setSubTab('shipments')}
                >
                    Shipment Orders
                </button>
                <button
                    className={`subnav-btn ${subTab === 'list' ? 'active' : ''}`}
                    onClick={() => setSubTab('list')}
                >
                    Container List
                </button>
                <button
                    className={`subnav-btn ${subTab === 'shipper' ? 'active' : ''}`}
                    onClick={() => setSubTab('shipper')}
                >
                    Shipper
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                {subTab === 'shipments' && <ShipmentOrders currentUser={currentUser} initialEditId={editShipmentId} onClearEdit={() => setEditShipmentId(null)} />}
                {subTab === 'list' && <ContainerList currentUser={currentUser} onNavigateToShipment={handleNavigateToShipment} />}
                {subTab === 'report' && <ContainerReport currentUser={currentUser} onNavigateToShipment={handleNavigateToShipment} />}
                {subTab === 'shipper' && <ShipperList currentUser={currentUser} />}
            </div>
        </div>
    );
}
