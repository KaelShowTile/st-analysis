import { useState } from 'react';
import SalesItems from './SalesItems';
import Invoice from './Invoice';
import ProFormaInvoice from './ProFormaInvoice';
import './Containers.css';

export default function Sales({ currentUser, isActive }) {
    const [activeSubTab, setActiveSubTab] = useState('sales_items');

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
                    className={`subnav-btn ${activeSubTab === 'sales_items' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('sales_items')}
                >
                    Sales Items
                </button>
                <button
                    className={`subnav-btn ${activeSubTab === 'invoice' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('invoice')}
                >
                    Invoice
                </button>
                <button
                    className={`subnav-btn ${activeSubTab === 'pro_forma_invoice' ? 'active' : ''}`}
                    onClick={() => setActiveSubTab('pro_forma_invoice')}
                >
                    Pro Forma Invoice
                </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <div style={{ display: activeSubTab === 'sales_items' ? 'block' : 'none', height: '100%' }}>
                    <SalesItems currentUser={currentUser} isActive={isActive && activeSubTab === 'sales_items'} />
                </div>
                <div style={{ display: activeSubTab === 'invoice' ? 'block' : 'none', height: '100%' }}>
                    <Invoice currentUser={currentUser} isActive={isActive && activeSubTab === 'invoice'} />
                </div>
                <div style={{ display: activeSubTab === 'pro_forma_invoice' ? 'block' : 'none', height: '100%' }}>
                    <ProFormaInvoice currentUser={currentUser} isActive={isActive && activeSubTab === 'pro_forma_invoice'} />
                </div>
            </div>
        </div>
    );
}
