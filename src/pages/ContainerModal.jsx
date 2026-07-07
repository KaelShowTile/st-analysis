import { useState, useEffect, useRef } from 'react';
import { X, Search, Check } from 'lucide-react';
import { getDb } from '../db/Database';

export default function ContainerModal({ record, year, onClose, onSave }) {
    const [formData, setFormData] = useState({
        cntr_no: '',
        hbl_no: '',
        invoice_no: '',
        doc: 'false',
        shipper: '',
        contents: '',
        delivery: '',
        warehouse_received: '',
        info: '',
        internal_memo: '',
        last_free_dtn: ''
    });

    const [shippers, setShippers] = useState([]);
    const [inventory, setInventory] = useState([]);
    
    // Searchable dropdown states
    const [shipperSearch, setShipperSearch] = useState('');
    const [shipperOpen, setShipperOpen] = useState(false);
    
    const [contentsSearch, setContentsSearch] = useState('');
    const [contentsOpen, setContentsOpen] = useState(false);

    useEffect(() => {
        if (record) {
            setFormData({
                cntr_no: record.cntr_no || '',
                hbl_no: record.hbl_no || '',
                invoice_no: record.invoice_no || '',
                doc: record.doc === 'true' ? 'true' : 'false',
                shipper: record.shipper || '', // This is now shipper_id
                contents: record.contents || '', // This is now comma-separated product_ids
                delivery: record.delivery || '',
                warehouse_received: record.warehouse_received || '',
                info: record.info || '',
                internal_memo: record.internal_memo || '',
                last_free_dtn: record.last_free_dtn || ''
            });
        }
        
        loadOptions();
    }, [record]);

    const loadOptions = async () => {
        try {
            const db = await getDb();
            // Load shippers
            const shp = await db.select('SELECT shipper_id, shipper_name FROM shippers ORDER BY shipper_name ASC');
            setShippers(shp);
            
            // Load inventory with backorder = 1
            const inv = await db.select('SELECT product_id, sales_description FROM inventory WHERE backorder = 1 ORDER BY sales_description ASC');
            setInventory(inv);
        } catch(e) {
            console.error("Failed to load modal options", e);
        }
    };

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        // Validation could go here
        onSave({ ...formData, year: record ? record.year : year });
    };

    const filteredShippers = shippers.filter(s => 
        (s.shipper_name || '').toLowerCase().includes(shipperSearch.toLowerCase())
    );

    const filteredInventory = inventory.filter(i => 
        (i.sales_description || '').toLowerCase().includes(contentsSearch.toLowerCase())
    );

    const selectedContents = formData.contents ? formData.contents.split(',').filter(x => x) : [];
    
    const toggleContentSelection = (productId) => {
        const idStr = productId.toString();
        let newSelection;
        if (selectedContents.includes(idStr)) {
            newSelection = selectedContents.filter(id => id !== idStr);
        } else {
            newSelection = [...selectedContents, idStr];
        }
        handleChange('contents', newSelection.join(','));
    };

    // Outside click handlers would be nice, but for simplicity we rely on standard UI flows
    return (
        <div className="modal-overlay" style={overlayStyle}>
            <div className="modal-content" style={contentStyle}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                    <h3 style={{ margin: 0 }}>{record ? 'Edit Container' : 'Add Container'}</h3>
                    <button className="btn-icon" onClick={onClose}><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
                    
                    {/* Container Number */}
                    <div className="form-group">
                        <label>Container Number</label>
                        <input type="text" className="form-control" value={formData.cntr_no} onChange={e => handleChange('cntr_no', e.target.value)} />
                    </div>

                    {/* HBL No. */}
                    <div className="form-group">
                        <label>HBL No.</label>
                        <input type="text" className="form-control" value={formData.hbl_no} onChange={e => handleChange('hbl_no', e.target.value)} />
                    </div>

                    {/* Invoice No. */}
                    <div className="form-group">
                        <label>Invoice No.</label>
                        <input type="text" className="form-control" value={formData.invoice_no} onChange={e => handleChange('invoice_no', e.target.value)} />
                    </div>

                    {/* Last free DTN */}
                    <div className="form-group">
                        <label>Last free DTN</label>
                        <input type="text" className="form-control" value={formData.last_free_dtn} onChange={e => handleChange('last_free_dtn', e.target.value)} />
                    </div>

                    {/* Delivery Date */}
                    <div className="form-group">
                        <label>Delivery</label>
                        <input type="date" className="form-control" value={formData.delivery} onChange={e => handleChange('delivery', e.target.value)} />
                    </div>

                    {/* Received Date */}
                    <div className="form-group">
                        <label>Received</label>
                        <input type="date" className="form-control" value={formData.warehouse_received} onChange={e => handleChange('warehouse_received', e.target.value)} />
                    </div>

                    {/* Doc Checkbox */}
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-end', paddingBottom: '10px' }}>
                        <input 
                            type="checkbox" 
                            id="doc-checkbox"
                            checked={formData.doc === 'true'} 
                            onChange={e => handleChange('doc', e.target.checked ? 'true' : 'false')}
                            style={{ width: '18px', height: '18px' }}
                        />
                        <label htmlFor="doc-checkbox" style={{ margin: 0, cursor: 'pointer' }}>Doc</label>
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}></div> {/* Spacer */}

                    {/* Shipper Searchable Select */}
                    <div className="form-group" style={{ position: 'relative', gridColumn: '1 / -1' }}>
                        <label>Shipper</label>
                        <div 
                            className="form-control dropdown-trigger" 
                            style={{ cursor: 'pointer', minHeight: '34px', display: 'flex', alignItems: 'center' }}
                            onClick={() => setShipperOpen(!shipperOpen)}
                        >
                            {formData.shipper 
                                ? (shippers.find(s => s.shipper_id.toString() === formData.shipper.toString())?.shipper_name || 'Unknown Shipper') 
                                : <span style={{color: '#94a3b8'}}>Select a shipper...</span>}
                        </div>
                        {shipperOpen && (
                            <div className="custom-dropdown" style={dropdownStyle}>
                                <div style={{ padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
                                    <input 
                                        type="text" 
                                        autoFocus
                                        placeholder="Search..." 
                                        className="form-control" 
                                        value={shipperSearch}
                                        onChange={e => setShipperSearch(e.target.value)}
                                        onClick={e => e.stopPropagation()}
                                    />
                                </div>
                                <ul style={dropdownListStyle}>
                                    <li 
                                        style={dropdownItemStyle(formData.shipper === '')} 
                                        onClick={() => { handleChange('shipper', ''); setShipperOpen(false); }}
                                    >
                                        <em>Clear selection</em>
                                    </li>
                                    {filteredShippers.map(s => (
                                        <li 
                                            key={s.shipper_id}
                                            style={dropdownItemStyle(formData.shipper === s.shipper_id.toString())}
                                            onClick={() => { handleChange('shipper', s.shipper_id.toString()); setShipperOpen(false); }}
                                        >
                                            {s.shipper_name}
                                        </li>
                                    ))}
                                    {filteredShippers.length === 0 && <li style={{padding: '8px', color: '#94a3b8'}}>No shippers found.</li>}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Contents Multi-Select */}
                    <div className="form-group" style={{ position: 'relative', gridColumn: '1 / -1' }}>
                        <label>Contents</label>
                        <div 
                            className="form-control dropdown-trigger" 
                            style={{ cursor: 'pointer', minHeight: '34px', display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' }}
                            onClick={() => setContentsOpen(!contentsOpen)}
                        >
                            {selectedContents.length > 0 ? (
                                selectedContents.map(id => {
                                    const item = inventory.find(i => i.product_id.toString() === id);
                                    return (
                                        <span key={id} style={{ background: 'var(--primary-color)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>
                                            {item ? item.sales_description : `ID: ${id}`}
                                        </span>
                                    );
                                })
                            ) : (
                                <span style={{color: '#94a3b8'}}>Select contents...</span>
                            )}
                        </div>
                        {contentsOpen && (
                            <div className="custom-dropdown" style={dropdownStyle}>
                                <div style={{ padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
                                    <input 
                                        type="text" 
                                        autoFocus
                                        placeholder="Search..." 
                                        className="form-control" 
                                        value={contentsSearch}
                                        onChange={e => setContentsSearch(e.target.value)}
                                        onClick={e => e.stopPropagation()}
                                    />
                                </div>
                                <ul style={dropdownListStyle}>
                                    {filteredInventory.map(i => {
                                        const isSelected = selectedContents.includes(i.product_id.toString());
                                        return (
                                            <li 
                                                key={i.product_id}
                                                style={dropdownItemStyle(isSelected)}
                                                onClick={() => toggleContentSelection(i.product_id)}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: '16px', height: '16px', border: '1px solid var(--border-color)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        {isSelected && <Check size={12} />}
                                                    </div>
                                                    {i.sales_description}
                                                </div>
                                            </li>
                                        )
                                    })}
                                    {filteredInventory.length === 0 && <li style={{padding: '8px', color: '#94a3b8'}}>No items found.</li>}
                                </ul>
                                <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
                                    <button className="btn-secondary" onClick={() => setContentsOpen(false)}>Done</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* INFO Textarea */}
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>INFO</label>
                        <textarea className="form-control" rows="3" value={formData.info} onChange={e => handleChange('info', e.target.value)}></textarea>
                    </div>

                    {/* Internal Memo Textarea */}
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Internal Memo</label>
                        <textarea className="form-control" rows="3" value={formData.internal_memo} onChange={e => handleChange('internal_memo', e.target.value)}></textarea>
                    </div>

                </div>

                <div className="modal-footer" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave}>Save Container</button>
                </div>
            </div>
        </div>
    );
}

// Inline styles for modal since it might not be in Containers.css yet
const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000
};

const contentStyle = {
    backgroundColor: 'var(--bg-color)',
    borderRadius: '8px',
    padding: '24px',
    width: '600px',
    maxWidth: '90vw',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
};

const dropdownStyle = {
    position: 'absolute', top: '100%', left: 0, right: 0,
    backgroundColor: 'var(--bg-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 1001,
    marginTop: '4px'
};

const dropdownListStyle = {
    listStyle: 'none', padding: 0, margin: 0,
    maxHeight: '200px', overflowY: 'auto'
};

const dropdownItemStyle = (isActive) => ({
    padding: '8px 12px',
    cursor: 'pointer',
    backgroundColor: isActive ? 'var(--primary-color-light, rgba(59, 130, 246, 0.1))' : 'transparent',
    borderBottom: '1px solid var(--border-color)'
});
