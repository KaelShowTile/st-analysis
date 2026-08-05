import { useState } from 'react';
import ContainerList from './ContainerList';
import ShipperList from './ShipperList';
import ContainerReport from './ContainerReport';
import ShipmentOrders from './ShipmentOrders';
import OceanShippers from './OceanShippers';
import './Containers.css';

export default function Containers({ currentUser, isActive }) {
    const p = currentUser?.permissions || {};
    const [subTab, setSubTab] = useState(() => {
        if (p.containerDashboard?.read) return 'report';
        if (p.shipmentOrders?.read) return 'shipments';
        if (p.containerList?.read) return 'list';
        if (p.shippers?.read) return 'shipper';
        if (p.oceanShippers?.read ?? p.admin ?? p.shippers?.read) return 'ocean_shipper';
        return '';
    });

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
                {p.containerDashboard?.read && (
                    <button
                        className={`subnav-btn ${subTab === 'report' ? 'active' : ''}`}
                        onClick={() => setSubTab('report')}
                    >
                        Dashboard
                    </button>
                )}
                {p.shipmentOrders?.read && (
                    <button
                        className={`subnav-btn ${subTab === 'shipments' ? 'active' : ''}`}
                        onClick={() => setSubTab('shipments')}
                    >
                        Shipment Orders
                    </button>
                )}
                {p.containerList?.read && (
                    <button
                        className={`subnav-btn ${subTab === 'list' ? 'active' : ''}`}
                        onClick={() => setSubTab('list')}
                    >
                        Container List
                    </button>
                )}
                {p.shippers?.read && (
                    <button
                        className={`subnav-btn ${subTab === 'shipper' ? 'active' : ''}`}
                        onClick={() => setSubTab('shipper')}
                    >
                        Shipper
                    </button>
                )}
                {(p.oceanShippers?.read ?? p.admin ?? p.shippers?.read) && (
                    <button
                        className={`subnav-btn ${subTab === 'ocean_shipper' ? 'active' : ''}`}
                        onClick={() => setSubTab('ocean_shipper')}
                    >
                        Ocean Shippers
                    </button>
                )}
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                <div style={{ display: subTab === 'shipments' ? 'flex' : 'none', flex: 1 }}>
                    <ShipmentOrders currentUser={currentUser} initialEditId={editShipmentId} onClearEdit={() => setEditShipmentId(null)} isActive={isActive && subTab === 'shipments'} />
                </div>
                <div style={{ display: subTab === 'list' ? 'flex' : 'none', flex: 1 }}>
                    <ContainerList currentUser={currentUser} onNavigateToShipment={handleNavigateToShipment} isActive={isActive && subTab === 'list'} />
                </div>
                <div style={{ display: subTab === 'report' ? 'flex' : 'none', flex: 1 }}>
                    <ContainerReport currentUser={currentUser} onNavigateToShipment={handleNavigateToShipment} isActive={isActive && subTab === 'report'} />
                </div>
                <div style={{ display: subTab === 'shipper' ? 'flex' : 'none', flex: 1 }}>
                    <ShipperList currentUser={currentUser} isActive={isActive && subTab === 'shipper'} />
                </div>
                <div style={{ display: subTab === 'ocean_shipper' ? 'flex' : 'none', flex: 1 }}>
                    <OceanShippers currentUser={currentUser} isActive={isActive && subTab === 'ocean_shipper'} />
                </div>
            </div>
        </div>
    );
}
