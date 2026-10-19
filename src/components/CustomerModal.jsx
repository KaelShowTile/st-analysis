import { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { getDb } from '../db/Database';

export const CUSTOMER_FIELDS = [
    { key: 'company', label: 'Company' },
    { key: 'abn', label: 'ABN' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'contact', label: 'Contact' },
    { key: 'email', label: 'Email' },
    { key: 'tel1', label: 'Tel 1' },
    { key: 'tel2', label: 'Tel 2' },
    { key: 'street', label: 'Street', full: true },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'postcode', label: 'Postcode' },
    { key: 'st_login_name', label: 'ST Login Name' },
    { key: 'st_login_pass', label: 'ST Login Password' },
];

const emptyForm = () => CUSTOMER_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: '' }), {});

const overlayStyle = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)'
};
const contentStyle = {
    background: 'var(--surface-color)', color: 'var(--text-color)', borderRadius: '10px', padding: '24px',
    width: '90%', maxWidth: '760px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)'
};
const labelStyle = { fontSize: '12px', fontWeight: 600, marginBottom: '4px', opacity: 0.8 };
const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
    background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '14px', outline: 'none'
};

export default function CustomerModal({ customer, onClose, onSaved }) {
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);
    const isEdit = !!customer?.customer_id;

    useEffect(() => {
        const base = emptyForm();
        if (customer) {
            for (const f of CUSTOMER_FIELDS) base[f.key] = customer[f.key] ?? '';
        }
        setForm(base);
    }, [customer]);

    const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        setSaving(true);
        try {
            const db = await getDb();
            const keys = CUSTOMER_FIELDS.map(f => f.key);
            const values = keys.map(k => String(form[k] ?? '').trim());

            if (isEdit) {
                // Only send changed columns; skip the write entirely if nothing changed.
                const changed = keys.filter((k, i) => String(customer[k] ?? '') !== values[i]);
                if (changed.length > 0) {
                    const setClause = changed.map((k, i) => `${k} = $${i + 1}`).join(', ');
                    const args = changed.map(k => values[keys.indexOf(k)]);
                    args.push(customer.customer_id);
                    // WHERE on PK => single row lookup
                    await db.execute(`UPDATE customer SET ${setClause} WHERE customer_id = $${args.length}`, args);
                }
            } else {
                const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
                await db.execute(`INSERT INTO customer (${keys.join(', ')}) VALUES (${placeholders})`, values);
            }
            if (db.sync) await db.sync();
            onSaved?.();
        } catch (err) {
            console.error('Failed to save customer', err);
            alert('Failed to save customer: ' + err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={contentStyle} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{isEdit ? 'Edit Customer' : 'Add Customer'}</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-color)' }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', paddingRight: '4px' }}>
                    {CUSTOMER_FIELDS.map(f => (
                        <div key={f.key} style={{ gridColumn: f.full ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column' }}>
                            <label style={labelStyle} htmlFor={`customer-${f.key}`}>{f.label}</label>
                            <input
                                id={`customer-${f.key}`}
                                type="text"
                                style={inputStyle}
                                value={form[f.key]}
                                onChange={e => handleChange(f.key, e.target.value)}
                            />
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-color)', cursor: 'pointer' }}
                    >
                        Cancel
                    </button>
                    <button
                        id="customer-save-btn"
                        className="btn-upload"
                        onClick={handleSave}
                        disabled={saving}
                        style={{ background: 'var(--primary-color)' }}
                    >
                        {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
