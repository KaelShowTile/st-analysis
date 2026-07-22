import React from 'react';
import { X, MapPin, Calendar, Ship, Anchor, Package, Info, Clock, Truck, FileText } from 'lucide-react';
import './Containers.css';

export default function ContainerDetailModal({ record, onClose, inventoryMap, shippersMap, shipmentsMap, onNavigateToShipment }) {
    if (!record) return null;

    let shipmentData = {};
    try {
        if (record.shippment) {
            shipmentData = JSON.parse(record.shippment);
        }
    } catch (e) {
        console.error("Failed to parse shipment data", e);
    }

    let parsedContents = [];
    try {
        if (record.contents && typeof record.contents === 'string' && record.contents.startsWith('[')) {
            parsedContents = JSON.parse(record.contents);
        }
    } catch (e) { }

    // Fallback for old data
    if (!Array.isArray(parsedContents)) parsedContents = [];

    const events = shipmentData.events || [];

    // Helper to safely render event text
    const getEventDescription = (event) => {
        if (event.action && event.action.action_name) return event.action.action_name;
        if (event.description) return event.description;
        return 'Unknown Event';
    };

    const getEventLocation = (event) => {
        if (event.location && event.location.port) {
            return `${event.location.port}${event.location.country ? ', ' + event.location.country : ''}`;
        }
        return '';
    };

    const getEventDate = (event) => {
        return event.date || event.timestamp || '';
    };

    return (
        <div className="modal-overlay" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '900px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'var(--primary-color)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Package size={20} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>{record.cntr_no || 'Unknown Container'}</h2>
                            <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '2px' }}>
                                Container Tracking Details
                            </div>
                        </div>
                    </div>
                    <button className="btn-icon" onClick={onClose} style={{ background: 'white', border: '1px solid #e2e8f0' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '24px', overflowY: 'auto', flex: 1, backgroundColor: 'white' }}>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                        {/* Basic Info */}
                        <div>
                            <h3 style={{ fontSize: '1rem', color: '#334155', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Info size={16} color="#3b82f6" /> Basic Information
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', fontSize: '0.9rem' }}>

                                <div style={{ color: '#64748b' }}>Info</div>
                                <div>{record.info || '-'}</div>

                                <div style={{ color: '#64748b' }}>Internal Memo</div>
                                <div>{record.internal_memo || '-'}</div>

                                <div style={{ color: '#64748b' }}>Docs Ready</div>
                                <div>{(record.doc === 'true' || record.doc === '1') ? 'Yes' : 'No'}</div>
                            </div>
                        </div>

                        {/* Routing Info */}
                        <div>
                            <h3 style={{ fontSize: '1rem', color: '#334155', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Anchor size={16} color="#3b82f6" /> Routing & Schedule
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', fontSize: '0.9rem' }}>
                                <div style={{ color: '#64748b' }}>Origin</div>
                                <div style={{ fontWeight: 500 }}>{record.origin || shipmentData?.origin?.port || '-'}</div>

                                <div style={{ color: '#64748b' }}>POL (ETD)</div>
                                <div style={{ fontWeight: 500 }}>{record.pol || '-'} <span style={{ color: '#94a3b8', fontWeight: 'normal' }}>({record.etd || '-'})</span></div>

                                <div style={{ color: '#64748b' }}>Destination</div>
                                <div style={{ fontWeight: 500 }}>{record.destination || shipmentData?.destination?.port || '-'}</div>

                                <div style={{ color: '#64748b' }}>ETA</div>
                                <div style={{ fontWeight: 500 }}>{record.eta || '-'}</div>

                                <div style={{ color: '#64748b' }}>Original ETA</div>
                                <div style={{ fontWeight: 500 }}>{record.original_eta || '-'}</div>

                                <div style={{ color: '#64748b' }}>Delivery / Rcvd</div>
                                <div>{record.delivery || '-'} / {record.warehouse_received || '-'}</div>

                                <div style={{ color: '#64748b' }}>Last Free DTN</div>
                                <div>{record.last_free_dtn || '-'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Shipments Section */}
                    <div style={{ marginBottom: '32px' }}>
                        <h3 style={{ fontSize: '1rem', color: '#334155', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
                            <Truck size={16} color="#3b82f6" /> Included Shipments
                        </h3>
                        {parsedContents.length === 0 ? (
                            <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>
                                No shipments attached to this container.
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '16px' }}>
                                {parsedContents.map((block, idx) => {
                                    const shp = shipmentsMap ? shipmentsMap[block.shipment_id] : null;
                                    const shipperName = shp ? (shippersMap[shp.shipper]?.shipper_name || shp.shipper) : 'Unknown';
                                    const invoiceNo = shp?.invoice_no || '-';

                                    return (
                                        <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '1.05rem' }}>{shipperName}</div>
                                                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
                                                        <span><span style={{ color: '#94a3b8' }}>Invoice:</span> {invoiceNo}</span>
                                                        <span><span style={{ color: '#94a3b8' }}>HBL:</span> {block.hbl_no || '-'}</span>
                                                    </div>
                                                </div>
                                                {block.shipment_id && onNavigateToShipment && (
                                                    <button
                                                        className="btn-secondary"
                                                        style={{ padding: '4px 8px', fontSize: '0.8rem', height: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        onClick={() => {
                                                            onClose();
                                                            onNavigateToShipment(block.shipment_id);
                                                        }}
                                                    >
                                                        <FileText size={12} /> Edit Order
                                                    </button>
                                                )}
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>Products</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                    {block.products && block.products.length > 0 ? (
                                                        block.products.map(p => (
                                                            <span key={p.product_id} style={{ background: 'white', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#475569' }}>
                                                                {p.sales_description}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>None</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Timeline */}
                    <div>
                        <h3 style={{ fontSize: '1rem', color: '#334155', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
                            <Ship size={16} color="#3b82f6" /> Tracking Events
                        </h3>

                        {events.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>
                                No tracking events available.
                            </div>
                        ) : (
                            <div style={{ position: 'relative', paddingLeft: '16px' }}>
                                {/* Vertical line */}
                                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '20px', width: '2px', backgroundColor: '#e2e8f0' }}></div>

                                {events.slice().reverse().map((ev, idx) => {
                                    const isLatest = idx === 0;
                                    return (
                                        <div key={idx} style={{ display: 'flex', marginBottom: '24px', position: 'relative', zIndex: 1 }}>
                                            <div style={{
                                                width: '10px', height: '10px',
                                                borderRadius: '50%',
                                                backgroundColor: isLatest ? '#3b82f6' : '#94a3b8',
                                                marginTop: '6px',
                                                marginLeft: '0px',
                                                border: '2px solid white',
                                                boxShadow: '0 0 0 2px ' + (isLatest ? '#bfdbfe' : '#e2e8f0')
                                            }}></div>
                                            <div style={{ marginLeft: '24px', flex: 1 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                    <div style={{ fontWeight: isLatest ? 600 : 500, color: isLatest ? '#1e293b' : '#475569', fontSize: '0.95rem' }}>
                                                        {getEventDescription(ev)}
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Clock size={12} /> {getEventDate(ev)}
                                                    </div>
                                                </div>

                                                {(getEventLocation(ev) || ev.vessel?.name) && (
                                                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: '#64748b' }}>
                                                        {getEventLocation(ev) && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <MapPin size={12} /> {getEventLocation(ev)}
                                                            </div>
                                                        )}
                                                        {ev.vessel?.name && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <Ship size={12} /> {ev.vessel.name} {ev.voyage ? `(Voy: ${ev.voyage})` : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
