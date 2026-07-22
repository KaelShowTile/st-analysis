import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Check } from 'lucide-react';
import { getDb } from '../db/Database';
import './Containers.css';

export default function ContainerModal({ record, year, onClose, onSave }) {
    const [formData, setFormData] = useState({
        cntr_no: '',
        doc: 'false',
        info: '',
        last_free_dtn: '',
        contents: [] // Array of { shipment_id, hbl_no, products: [{product_id, sales_description}] }
    });

    const [openShipments, setOpenShipments] = useState([]);
    const [inventory, setInventory] = useState([]);

    useEffect(() => {
        if (record) {
            let parsedContents = [];
            try {
                if (record.contents) {
                    parsedContents = JSON.parse(record.contents);
                }
            } catch (e) {
                console.error("Failed to parse contents JSON", e);
            }

            setFormData({
                cntr_no: record.cntr_no || '',
                doc: record.doc === 'true' || record.doc === '1' ? 'true' : 'false',
                info: record.info || '',
                last_free_dtn: record.last_free_dtn || '',
                contents: Array.isArray(parsedContents) ? parsedContents : []
            });
        }
        
        loadOptions();
    }, [record]);

    const loadOptions = async () => {
        try {
            const db = await getDb();
            // Load shipments
            const shpOrders = await db.select(`
                SELECT s.shipment_id, s.invoice_no, s.note, s.products, s.hbl_no, p.shipper_name 
                FROM shipments s 
                LEFT JOIN shippers p ON s.shipper = p.shipper_id 
                WHERE s.status = 'open' OR s.status = 'processing'
                ORDER BY s.shipment_id DESC
            `);
            setOpenShipments(shpOrders);
            
            // Load all inventory to get descriptions
            const inv = await db.select('SELECT product_id, sales_description FROM inventory');
            setInventory(inv);
        } catch(e) {
            console.error("Failed to load modal options", e);
        }
    };

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const addShipmentBlock = () => {
        setFormData(prev => ({
            ...prev,
            contents: [...prev.contents, { shipment_id: '', hbl_no: '', products: [] }]
        }));
    };

    const removeShipmentBlock = (index) => {
        setFormData(prev => ({
            ...prev,
            contents: prev.contents.filter((_, i) => i !== index)
        }));
    };

    const handleContentChange = (index, field, value) => {
        setFormData(prev => {
            const newContents = [...prev.contents];
            newContents[index] = { ...newContents[index], [field]: value };
            
            // Auto-fill HBL if they select a shipment
            if (field === 'shipment_id') {
                const selectedShp = openShipments.find(s => s.shipment_id.toString() === value.toString());
                if (selectedShp && selectedShp.hbl_no) {
                    newContents[index].hbl_no = selectedShp.hbl_no;
                }
            }
            
            return { ...prev, contents: newContents };
        });
    };

    const toggleProduct = (blockIndex, productId) => {
        setFormData(prev => {
            const newContents = [...prev.contents];
            const block = { ...newContents[blockIndex] };
            const existingIdx = block.products.findIndex(p => p.product_id.toString() === productId.toString());
            
            if (existingIdx >= 0) {
                block.products = block.products.filter((_, i) => i !== existingIdx);
            } else {
                const invItem = inventory.find(i => i.product_id.toString() === productId.toString());
                if (invItem) {
                    block.products = [...block.products, {
                        product_id: invItem.product_id,
                        sales_description: invItem.sales_description
                    }];
                }
            }
            
            newContents[blockIndex] = block;
            return { ...prev, contents: newContents };
        });
    };

    const handleSave = () => {
        // Prepare data to send back
        // onSave will need to handle JSON stringification and HBL updates
        onSave({ 
            ...record,
            cntr_no: formData.cntr_no,
            doc: formData.doc,
            info: formData.info,
            last_free_dtn: formData.last_free_dtn,
            contents: JSON.stringify(formData.contents),
            year: record ? record.year : year
        });
    };

    // Helper to get product options for a shipment
    const getShipmentProducts = (shipmentId) => {
        const shp = openShipments.find(s => s.shipment_id.toString() === shipmentId.toString());
        if (!shp || !shp.products) return [];
        const prodIds = shp.products.split(',');
        return inventory.filter(i => prodIds.includes(i.product_id.toString()));
    };

    return (
        <div className="modal-overlay" style={overlayStyle}>
            <div className="modal-content" style={contentStyle}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                    <h3 style={{ margin: 0 }}>{record ? 'Edit Container' : 'Add Container'}</h3>
                    <button className="btn-icon" onClick={onClose}><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                        <div className="form-group">
                            <label>Container Number</label>
                            <input type="text" className="form-control" value={formData.cntr_no} onChange={e => handleChange('cntr_no', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Last free DTN</label>
                            <input type="text" className="form-control" value={formData.last_free_dtn} onChange={e => handleChange('last_free_dtn', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>INFO</label>
                            <input type="text" className="form-control" value={formData.info} onChange={e => handleChange('info', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                                <input 
                                    type="checkbox" 
                                    checked={formData.doc === 'true'} 
                                    onChange={e => handleChange('doc', e.target.checked ? 'true' : 'false')}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                Docs Ready
                            </label>
                        </div>
                    </div>

                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                        <h4 style={{ margin: 0, color: '#334155' }}>Included Shipments</h4>
                        <button className="btn-secondary" onClick={addShipmentBlock} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 12px', fontSize: '0.85rem' }}>
                            <Plus size={14} /> Add Shipment
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {formData.contents.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px', background: '#f8fafc', borderRadius: '4px' }}>
                                No shipments added yet.
                            </div>
                        )}
                        {formData.contents.map((block, idx) => {
                            const availableProds = block.shipment_id ? getShipmentProducts(block.shipment_id) : [];
                            
                            return (
                                <div key={idx} style={{ padding: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', position: 'relative' }}>
                                    <button 
                                        className="btn-icon danger" 
                                        onClick={() => removeShipmentBlock(idx)}
                                        style={{ position: 'absolute', top: '12px', right: '12px', color: '#ef4444' }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                    
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px', paddingRight: '24px' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.85rem' }}>Shipment Order</label>
                                            <select 
                                                className="form-control" 
                                                value={block.shipment_id} 
                                                onChange={e => handleContentChange(idx, 'shipment_id', e.target.value)}
                                            >
                                                <option value="" disabled>Select a shipment...</option>
                                                {openShipments.map(s => (
                                                    <option key={s.shipment_id} value={s.shipment_id}>
                                                        {s.shipper_name} | Inv: {s.invoice_no} {s.note ? `| ${s.note}` : ''}
                                                    </option>
                                                ))}
                                                {/* In case it's an old saved shipment not in "open" list */}
                                                {block.shipment_id && !openShipments.find(s => s.shipment_id.toString() === block.shipment_id.toString()) && (
                                                    <option value={block.shipment_id}>Shipment ID: {block.shipment_id} (Closed/Hidden)</option>
                                                )}
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.85rem' }}>HBL No.</label>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                value={block.hbl_no} 
                                                onChange={e => handleContentChange(idx, 'hbl_no', e.target.value)}
                                                placeholder="Enter HBL"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ fontSize: '0.85rem' }}>Products from this Shipment</label>
                                        {block.shipment_id ? (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                                                {availableProds.map(p => {
                                                    const isSelected = block.products.some(selected => selected.product_id.toString() === p.product_id.toString());
                                                    return (
                                                        <div 
                                                            key={p.product_id}
                                                            onClick={() => toggleProduct(idx, p.product_id)}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.85rem',
                                                                cursor: 'pointer',
                                                                border: isSelected ? '1px solid var(--primary-color)' : '1px solid #cbd5e1',
                                                                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'white',
                                                                display: 'flex', alignItems: 'center', gap: '6px'
                                                            }}
                                                        >
                                                            {isSelected && <Check size={14} color="var(--primary-color)" />}
                                                            {p.sales_description}
                                                        </div>
                                                    );
                                                })}
                                                {availableProds.length === 0 && (
                                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No products available in this shipment.</span>
                                                )}
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Please select a shipment first.</div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
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
    width: '650px',
    maxWidth: '90vw',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
};
