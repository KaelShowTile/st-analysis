import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import './Settings.css';
import { Trash2, Plus, Download, Upload } from 'lucide-react';

export default function Settings() {
    const [attributes, setAttributes] = useState([]);
    const [newType, setNewType] = useState('colour');
    const [newValue, setNewValue] = useState('');

    const loadAttributes = async () => {
        const db = await getDb();
        const results = await db.select('SELECT * FROM attributes ORDER BY type, value');
        setAttributes(results);
    };

    useEffect(() => {
        loadAttributes();
    }, []);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newValue.trim()) return;
        try {
            const db = await getDb();
            await db.execute('INSERT INTO attributes (type, value) VALUES ($1, $2)', [newType, newValue.trim()]);
            setNewValue('');
            loadAttributes();
        } catch (err) {
            console.error('Failed to add attribute', err);
        }
    };

    const handleDelete = async (id) => {
        try {
            const db = await getDb();
            await db.execute('DELETE FROM attributes WHERE id = $1', [id]);
            loadAttributes();
        } catch (err) {
            console.error('Failed to delete attribute', err);
        }
    };

    const exportCSV = async () => {
        try {
            const header = "Type,Value\n";
            const rows = attributes.map(a => `${a.type},${a.value}`).join("\n");
            const csvContent = header + rows;

            const filePath = await save({
                filters: [{
                    name: 'CSV File',
                    extensions: ['csv']
                }],
                defaultPath: 'product_parameters.csv',
            });

            if (filePath) {
                await writeTextFile(filePath, csvContent);
                alert("File exported successfully!");
            }
        } catch (e) {
            console.error('Failed to export file:', e);
            alert("Failed to export file.");
        }
    };

    const importCSV = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            const db = await getDb();
            let addedCount = 0;
            
            // Start from 1 to skip header
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length >= 2) {
                    const type = parts[0].toLowerCase().trim();
                    const value = parts[1].trim();
                    
                    if ((type === 'finish' || type === 'colour') && value) {
                        const exists = await db.select('SELECT id FROM attributes WHERE type = $1 AND value = $2', [type, value]);
                        if (exists.length === 0) {
                            await db.execute('INSERT INTO attributes (type, value) VALUES ($1, $2)', [type, value]);
                            addedCount++;
                        }
                    }
                }
            }
            alert(`Successfully imported ${addedCount} new parameters!`);
            loadAttributes();
        } catch (err) {
            console.error('Failed to import CSV', err);
            alert('Failed to import CSV. Please ensure it is a valid CSV file with Type,Value columns.');
        }
        e.target.value = ''; // Reset file input
    };

    return (
        <div className="settings-container">
            <div className="settings-card">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px'}}>
                    <div>
                        <h3 style={{margin: '0 0 4px 0'}}>Manage Product Parameters</h3>
                        <p className="subtitle" style={{margin: 0}}>Add or remove standard finishes and colours.</p>
                    </div>
                    <div style={{display: 'flex', gap: '8px'}}>
                        <label className="btn-primary" style={{cursor: 'pointer', backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', padding: '6px 12px', fontSize: '0.85rem'}}>
                            <Upload size={14} style={{marginRight: '6px'}} /> Import CSV
                            <input type="file" accept=".csv" style={{display: 'none'}} onChange={importCSV} />
                        </label>
                        <button className="btn-primary" onClick={exportCSV} style={{backgroundColor: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', padding: '6px 12px', fontSize: '0.85rem'}}>
                            <Download size={14} style={{marginRight: '6px'}} /> Export CSV
                        </button>
                    </div>
                </div>
                
                <form className="add-form" onSubmit={handleAdd}>
                    <select value={newType} onChange={e => setNewType(e.target.value)} className="form-select">
                        <option value="colour">Colour</option>
                        <option value="finish">Finish</option>
                    </select>
                    <input 
                        type="text" 
                        value={newValue} 
                        onChange={e => setNewValue(e.target.value)} 
                        placeholder="e.g. red, matt..." 
                        className="form-input"
                    />
                    <button type="submit" className="btn-primary">
                        <Plus size={16} /> Add
                    </button>
                </form>

                <div className="attributes-list">
                    {attributes.map(attr => (
                        <div key={attr.id} className="attribute-item">
                            <span className={`badge ${attr.type}`}>{attr.type}</span>
                            <span className="attr-value">{attr.value}</span>
                            <button onClick={() => handleDelete(attr.id)} className="btn-icon danger">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    {attributes.length === 0 && <p className="empty-text">No parameters added yet.</p>}
                </div>
            </div>
        </div>
    );
}
