import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Search, Package } from 'lucide-react';
import { getDb } from '../db/Database';
import './Containers.css';

/**
 * Reusable Autocomplete Input Component
 */
function AutocompleteInput({
    value,
    displayValue,
    placeholder = 'Type to search...',
    options = [],
    onSelect,
    onClear,
    disabled = false
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef(null);

    // Sync search term with displayValue when not open
    useEffect(() => {
        if (!isOpen) {
            setSearchTerm(displayValue || '');
        }
    }, [displayValue, isOpen]);

    // Handle outside clicks to close dropdown
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                setSearchTerm(displayValue || '');
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [displayValue]);

    // Filter options based on user input
    const filteredOptions = options.filter(opt => {
        if (!searchTerm || searchTerm === displayValue) return true;
        const term = searchTerm.toLowerCase();
        const label = (opt.label || '').toLowerCase();
        const sublabel = (opt.sublabel || '').toLowerCase();
        return label.includes(term) || sublabel.includes(term);
    }).slice(0, 30); // limit to top 30 for snappy rendering

    const handleInputFocus = (e) => {
        if (!disabled) {
            setIsOpen(true);
            if (e && e.target && e.target.select) {
                e.target.select();
            }
        }
    };

    const handleInputChange = (e) => {
        setSearchTerm(e.target.value);
        if (!isOpen) setIsOpen(true);
    };

    const handleSelectOption = (opt) => {
        onSelect(opt);
        setSearchTerm(opt.label);
        setIsOpen(false);
    };

    const handleClear = (e) => {
        e.stopPropagation();
        setSearchTerm('');
        if (onClear) onClear();
        setIsOpen(false);
    };

    return (
        <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                    type="text"
                    className="form-control"
                    placeholder={placeholder}
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    disabled={disabled}
                    style={{
                        paddingRight: (value || searchTerm) ? '28px' : '8px',
                        fontSize: '0.85rem'
                    }}
                />
                {(value || searchTerm) && !disabled && (
                    <button
                        type="button"
                        onClick={handleClear}
                        style={{
                            position: 'absolute',
                            right: '6px',
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    zIndex: 1050
                }}>
                    {filteredOptions.length === 0 ? (
                        <div style={{ padding: '10px 12px', fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center' }}>
                            No matches found
                        </div>
                    ) : (
                        filteredOptions.map((opt) => (
                            <div
                                key={opt.id}
                                onClick={() => handleSelectOption(opt)}
                                style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #f1f5f9',
                                    backgroundColor: opt.id === value ? '#eff6ff' : '#ffffff',
                                    transition: 'background-color 0.15s ease'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = opt.id === value ? '#eff6ff' : '#ffffff'}
                            >
                                <div style={{ fontWeight: 500, fontSize: '0.85rem', color: '#1e293b' }}>
                                    {opt.label}
                                </div>
                                {opt.sublabel && (
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                                        {opt.sublabel}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export default function ContainerModal({ record, year, onClose, onSave }) {
    const [formData, setFormData] = useState({
        cntr_no: '',
        doc: 'false',
        info: '',
        memo: '',
        ocean_shipper: '',
        last_free_dtn: '',
        freight_cost: '',
        shipping_order_detail: []
    });

    const [oceanShippers, setOceanShippers] = useState([]);
    const [shippingOrders, setShippingOrders] = useState([]);
    const [orderBatches, setOrderBatches] = useState([]);

    useEffect(() => {
        if (record) {
            let parsedDetail = [];
            try {
                if (record.shipping_order_detail) {
                    parsedDetail = JSON.parse(record.shipping_order_detail);
                }
            } catch (e) {
                console.error("Failed to parse shipping_order_detail JSON", e);
            }

            setFormData({
                cntr_no: record.cntr_no || '',
                doc: record.doc === 'true' || record.doc === '1' ? 'true' : 'false',
                info: record.info || '',
                memo: record.memo || '',
                ocean_shipper: record.ocean_shipper || '',
                last_free_dtn: record.last_free_dtn || '',
                freight_cost: record.freight_cost || '',
                shipping_order_detail: Array.isArray(parsedDetail) ? parsedDetail : []
            });
        } else {
            setFormData({
                cntr_no: '',
                doc: 'false',
                info: '',
                memo: '',
                ocean_shipper: '',
                last_free_dtn: '',
                freight_cost: '',
                shipping_order_detail: []
            });
        }

        loadOptions();
    }, [record]);

    const loadOptions = async () => {
        try {
            const db = await getDb();

            // 1. Load Ocean Shippers (forwarders)
            const osh = await db.select('SELECT * FROM ocean_shippers ORDER BY ocean_shipper_name ASC');
            setOceanShippers(osh);

            // 2. Load Shipping Orders for HBL Autocomplete
            const shpOrders = await db.select(`
                SELECT so.shipping_order_id, so.order_id, so.hbl_no, so.est_date, po.invoice_no, s.shipper_name 
                FROM shipping_order so 
                LEFT JOIN purchase_orders po ON so.order_id = po.order_id 
                LEFT JOIN shippers s ON po.shipper_id = s.shipper_id 
                WHERE so.hbl_no IS NOT NULL AND so.hbl_no != ''
                ORDER BY so.hbl_no ASC
            `);
            setShippingOrders(shpOrders);

            // 3. Load Order Batches for Batch Autocomplete
            const batches = await db.select(`
                SELECT ob.order_batch_id, ob.product_id, ob.sku, ob.description, ob.amount, ob.status, p.product_name 
                FROM order_batch ob 
                LEFT JOIN products p ON ob.product_id = p.product_id 
                ORDER BY ob.sku ASC
            `);
            setOrderBatches(batches);
        } catch (e) {
            console.error("Failed to load modal options", e);
        }
    };

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // --- Included Shipments Handlers ---
    const addShipmentBlock = () => {
        setFormData(prev => ({
            ...prev,
            shipping_order_detail: [
                ...prev.shipping_order_detail,
                {
                    shipping_order_id: '',
                    hbl_no: '',
                    additional_cost: '',
                    products: []
                }
            ]
        }));
    };

    const removeShipmentBlock = (index) => {
        setFormData(prev => ({
            ...prev,
            shipping_order_detail: prev.shipping_order_detail.filter((_, i) => i !== index)
        }));
    };

    const handleShipmentHblSelect = (shipmentIdx, selectedOption) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            updated[shipmentIdx] = {
                ...updated[shipmentIdx],
                shipping_order_id: selectedOption ? selectedOption.id : '',
                hbl_no: selectedOption ? selectedOption.label : ''
            };
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const handleShipmentHblClear = (shipmentIdx) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            updated[shipmentIdx] = {
                ...updated[shipmentIdx],
                shipping_order_id: '',
                hbl_no: ''
            };
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const handleShipmentFieldChange = (shipmentIdx, field, value) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            updated[shipmentIdx] = { ...updated[shipmentIdx], [field]: value };
            return { ...prev, shipping_order_detail: updated };
        });
    };

    // --- Batch Repeater Handlers ---
    const addBatchRow = (shipmentIdx) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            const block = { ...updated[shipmentIdx] };
            block.products = [
                ...(block.products || []),
                { order_batch_id: '', batch_label: '', amount: '', weight: '' }
            ];
            updated[shipmentIdx] = block;
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const removeBatchRow = (shipmentIdx, batchIdx) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            const block = { ...updated[shipmentIdx] };
            block.products = (block.products || []).filter((_, i) => i !== batchIdx);
            updated[shipmentIdx] = block;
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const handleBatchSelect = (shipmentIdx, batchIdx, selectedOption) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            const block = { ...updated[shipmentIdx] };
            const prods = [...(block.products || [])];
            const currentItem = { ...prods[batchIdx] };

            if (selectedOption) {
                currentItem.order_batch_id = selectedOption.id;
                currentItem.batch_label = selectedOption.label;
                // Auto-fill amount from order_batch if not already set
                if (!currentItem.amount && selectedOption.data && selectedOption.data.amount) {
                    currentItem.amount = String(selectedOption.data.amount);
                }
            } else {
                currentItem.order_batch_id = '';
                currentItem.batch_label = '';
            }

            prods[batchIdx] = currentItem;
            block.products = prods;
            updated[shipmentIdx] = block;
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const handleBatchClear = (shipmentIdx, batchIdx) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            const block = { ...updated[shipmentIdx] };
            const prods = [...(block.products || [])];
            prods[batchIdx] = {
                ...prods[batchIdx],
                order_batch_id: '',
                batch_label: '',
                amount: '',
                weight: ''
            };
            block.products = prods;
            updated[shipmentIdx] = block;
            return { ...prev, shipping_order_detail: updated };
        });
    };

    const handleBatchFieldChange = (shipmentIdx, batchIdx, field, value) => {
        setFormData(prev => {
            const updated = [...prev.shipping_order_detail];
            const block = { ...updated[shipmentIdx] };
            const prods = [...(block.products || [])];
            prods[batchIdx] = { ...prods[batchIdx], [field]: value };
            block.products = prods;
            updated[shipmentIdx] = block;
            return { ...prev, shipping_order_detail: updated };
        });
    };

    // --- Save Container ---
    const handleSave = () => {
        // Clean and prepare shipping_order_detail
        const cleanedDetail = (formData.shipping_order_detail || []).map(block => ({
            shipping_order_id: block.shipping_order_id ? Number(block.shipping_order_id) : null,
            hbl_no: block.hbl_no || '',
            additional_cost: block.additional_cost || '',
            products: (block.products || []).map(p => ({
                order_batch_id: p.order_batch_id ? Number(p.order_batch_id) : null,
                batch_label: p.batch_label || '',
                amount: p.amount ?? '',
                weight: p.weight ?? ''
            }))
        }));

        onSave({
            ...record,
            cntr_no: formData.cntr_no,
            doc: formData.doc,
            info: formData.info,
            memo: formData.memo,
            ocean_shipper: formData.ocean_shipper,
            last_free_dtn: formData.last_free_dtn,
            freight_cost: formData.freight_cost,
            shipping_order_detail: JSON.stringify(cleanedDetail),
            contents: record?.contents || '[]',
            year: record ? record.year : year
        });
    };

    // Prepare autocomplete options
    const hblOptions = shippingOrders.map(so => ({
        id: so.shipping_order_id,
        label: so.hbl_no,
        sublabel: [
            so.invoice_no ? `PO Inv: ${so.invoice_no}` : (so.order_id ? `PO #${so.order_id}` : null),
            so.shipper_name ? `Shipper: ${so.shipper_name}` : null,
            so.est_date ? `Est: ${so.est_date}` : null
        ].filter(Boolean).join(' | '),
        data: so
    }));

    const batchOptions = orderBatches.map(b => ({
        id: b.order_batch_id,
        label: b.sku ? `${b.sku} - ${b.description || ''}` : (b.description || `Batch #${b.order_batch_id}`),
        sublabel: [
            b.amount != null ? `Total Qty: ${b.amount}` : null,
            b.product_name ? `Product: ${b.product_name}` : null
        ].filter(Boolean).join(' | '),
        data: b
    }));

    return (
        <div className="modal-overlay" style={overlayStyle}>
            <div className="modal-content" style={contentStyle}>
                {/* Header */}
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                    <h3 style={{ margin: 0 }}>{record ? 'Edit Container' : 'Add Container'}</h3>
                    <button className="btn-icon" onClick={onClose}><X size={18} /></button>
                </div>

                {/* Body */}
                <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: '8px' }}>

                    {/* Basic Info Fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                        <div className="form-group">
                            <label>Container Number</label>
                            <input
                                type="text"
                                className="form-control"
                                value={formData.cntr_no}
                                onChange={e => handleChange('cntr_no', e.target.value)}
                                placeholder="e.g. MSKU1234567"
                            />
                        </div>
                        <div className="form-group">
                            <label>Last free DTN</label>
                            <input
                                type="text"
                                className="form-control"
                                value={formData.last_free_dtn}
                                onChange={e => handleChange('last_free_dtn', e.target.value)}
                                placeholder="YYYY-MM-DD"
                            />
                        </div>
                        <div className="form-group">
                            <label>Forwarder</label>
                            <select
                                className="form-control"
                                value={formData.ocean_shipper}
                                onChange={e => handleChange('ocean_shipper', e.target.value)}
                            >
                                <option value="">None</option>
                                {oceanShippers.map(os => (
                                    <option key={os.ocean_shipper_id} value={os.ocean_shipper_id}>
                                        {os.ocean_shipper_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Freight Cost (USD)</label>
                            <input
                                type="number"
                                className="form-control"
                                value={formData.freight_cost}
                                onChange={e => handleChange('freight_cost', e.target.value)}
                                placeholder="0.00"
                            />
                        </div>
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                            <label>Memo</label>
                            <textarea
                                className="form-control"
                                value={formData.memo}
                                onChange={e => handleChange('memo', e.target.value)}
                                style={{ minHeight: '70px', resize: 'vertical' }}
                                placeholder="Internal container notes..."
                            />
                        </div>
                        <div className="form-group" style={{ display: 'flex', paddingBottom: '4px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0, fontWeight: 500 }}>
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

                    {/* Included Shipments Section */}
                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                        <div>
                            <h4 style={{ margin: 0, color: '#1e293b', fontSize: '1rem' }}>Included Shipments</h4>
                            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Link shipments by HBL No. and allocate product batches</span>
                        </div>
                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={addShipmentBlock}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '0.85rem' }}
                        >
                            <Plus size={14} /> Add Shipment
                        </button>
                    </div>

                    {/* Shipments List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
                        {formData.shipping_order_detail.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '28px', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
                                No shipments added yet. Click &quot;+ Add Shipment&quot; to link a shipping order.
                            </div>
                        )}

                        {formData.shipping_order_detail.map((block, sIdx) => {
                            // Find display label for HBL if available
                            const matchedShp = shippingOrders.find(s => String(s.shipping_order_id) === String(block.shipping_order_id));
                            const hblDisplay = block.hbl_no || (matchedShp ? matchedShp.hbl_no : '');

                            return (
                                <div
                                    key={sIdx}
                                    style={{
                                        padding: '16px',
                                        background: '#ffffff',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '8px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Top bar of Shipment block */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Package size={16} color="#3b82f6" /> Shipment #{sIdx + 1}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn-icon danger"
                                            onClick={() => removeShipmentBlock(sIdx)}
                                            title="Remove this shipment"
                                            style={{ color: '#ef4444', padding: '4px', cursor: 'pointer' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    {/* HBL No Autocomplete & Additional Cost */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                                HBL No. <span style={{ color: '#ef4444' }}>*</span>
                                            </label>
                                            <AutocompleteInput
                                                value={block.shipping_order_id}
                                                displayValue={hblDisplay}
                                                placeholder="Search HBL number..."
                                                options={hblOptions}
                                                onSelect={(item) => handleShipmentHblSelect(sIdx, item)}
                                                onClear={() => handleShipmentHblClear(sIdx)}
                                            />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Additional Cost (USD)</label>
                                            <input
                                                type="number"
                                                className="form-control"
                                                placeholder="0.00"
                                                value={block.additional_cost || ''}
                                                onChange={e => handleShipmentFieldChange(sIdx, 'additional_cost', e.target.value)}
                                                style={{ fontSize: '0.85rem' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Batches Repeater inside this Shipment */}
                                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #edf2f7' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
                                                Batches in this Shipment ({block.products ? block.products.length : 0})
                                            </span>
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                onClick={() => addBatchRow(sIdx)}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', fontSize: '0.78rem' }}
                                            >
                                                <Plus size={12} /> Add Batch
                                            </button>
                                        </div>

                                        {(!block.products || block.products.length === 0) ? (
                                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '12px' }}>
                                                No batches added yet. Click &quot;+ Add Batch&quot; to assign products from order batches.
                                            </div>
                                        ) : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                                <thead>
                                                    <tr style={{ background: '#e2e8f0', color: '#334155' }}>
                                                        <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #cbd5e1' }}>
                                                            Batch (SKU &amp; Description)
                                                        </th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right', border: '1px solid #cbd5e1', width: '110px' }}>
                                                            Amount
                                                        </th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'right', border: '1px solid #cbd5e1', width: '110px' }}>
                                                            Weight (kg)
                                                        </th>
                                                        <th style={{ padding: '6px 8px', textAlign: 'center', border: '1px solid #cbd5e1', width: '40px' }}></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {block.products.map((prod, bIdx) => {
                                                        const matchedBatch = orderBatches.find(b => String(b.order_batch_id) === String(prod.order_batch_id));
                                                        const batchLabelDisplay = prod.batch_label || (matchedBatch ? (matchedBatch.sku ? `${matchedBatch.sku} - ${matchedBatch.description || ''}` : matchedBatch.description) : '');

                                                        return (
                                                            <tr key={bIdx} style={{ background: '#ffffff' }}>
                                                                <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>
                                                                    <AutocompleteInput
                                                                        value={prod.order_batch_id}
                                                                        displayValue={batchLabelDisplay}
                                                                        placeholder="Search SKU or description..."
                                                                        options={batchOptions}
                                                                        onSelect={(item) => handleBatchSelect(sIdx, bIdx, item)}
                                                                        onClear={() => handleBatchClear(sIdx, bIdx)}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>
                                                                    <input
                                                                        type="number"
                                                                        className="form-control"
                                                                        style={{ padding: '4px 6px', height: 'auto', margin: 0, textAlign: 'right', fontSize: '0.82rem' }}
                                                                        placeholder="0"
                                                                        value={prod.amount != null ? prod.amount : ''}
                                                                        onChange={e => handleBatchFieldChange(sIdx, bIdx, 'amount', e.target.value)}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '6px 8px', border: '1px solid #cbd5e1' }}>
                                                                    <input
                                                                        type="number"
                                                                        className="form-control"
                                                                        style={{ padding: '4px 6px', height: 'auto', margin: 0, textAlign: 'right', fontSize: '0.82rem' }}
                                                                        placeholder="0.00"
                                                                        value={prod.weight != null ? prod.weight : ''}
                                                                        onChange={e => handleBatchFieldChange(sIdx, bIdx, 'weight', e.target.value)}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '4px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                                                                    <button
                                                                        type="button"
                                                                        className="btn-icon danger"
                                                                        onClick={() => removeBatchRow(sIdx, bIdx)}
                                                                        title="Remove batch"
                                                                        style={{ color: '#ef4444', padding: '2px', cursor: 'pointer' }}
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button type="button" className="btn-secondary" style={{ padding: '8px 16px' }} onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="btn-primary" style={{ padding: '8px 16px' }} onClick={handleSave}>
                        Save Container
                    </button>
                </div>
            </div>
        </div>
    );
}

const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
};

const contentStyle = {
    backgroundColor: 'var(--bg-color, #ffffff)',
    borderRadius: '8px',
    padding: '24px',
    width: '760px',
    maxWidth: '92vw',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
};
