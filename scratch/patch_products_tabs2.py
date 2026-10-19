import re
import traceback

try:
    with open('c:/project/st-analysis/src/pages/Products.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # Add states for match and ignore
    state_insert = """
    const [mainTab, setMainTab] = useState('list'); // 'list', 'match', 'ignore'
    const [matchInventory, setMatchInventory] = useState([]);
    const [ignoreInventory, setIgnoreInventory] = useState([]);
    
    const [editModal, setEditModal] = useState({ show: false, item: null, field: '', val: '', options: [] });
    
"""
    if "const [mainTab" not in content:
        content = content.replace("const [expandedCollections, setExpandedCollections] = useState({});", state_insert + "\n    const [expandedCollections, setExpandedCollections] = useState({});")

    # Add fetch logic in loadData
    fetch_logic = """
            const mInv = await db.select("SELECT product_id, sku, sales_description, extracted_name, extracted_finish, extracted_size, extracted_colour, product_parent_id, x_inactive FROM inventory WHERE (product_parent_id IS NULL OR product_parent_id = 0 OR product_parent_id = '') AND (x_inactive IS NULL OR x_inactive = '' OR x_inactive != 1) ORDER BY sales_description");
            const iInv = await db.select("SELECT product_id, sku, sales_description, extracted_name, extracted_finish, extracted_size, extracted_colour, product_parent_id, x_inactive FROM inventory WHERE (product_parent_id IS NULL OR product_parent_id = 0 OR product_parent_id = '') AND x_inactive = 1 ORDER BY sales_description");
            setMatchInventory(mInv);
            setIgnoreInventory(iInv);
"""
    if "setMatchInventory(mInv);" not in content:
        content = content.replace("setAttributes(attrs);", "setAttributes(attrs);\n" + fetch_logic)

    # Add logic for saving cell edit and save/ignore row
    save_logic = """
    const handleSaveEdit = () => {
        if (!editModal.item) return;
        const field = editModal.field;
        let newVal = editModal.val;
        
        if (mainTab === 'match') {
            setMatchInventory(prev => prev.map(i => i.product_id === editModal.item.product_id ? { ...i, [field]: newVal } : i));
        } else {
            setIgnoreInventory(prev => prev.map(i => i.product_id === editModal.item.product_id ? { ...i, [field]: newVal } : i));
        }
        setEditModal({ ...editModal, show: false });
    };

    const handleSaveMatchRow = async (item) => {
        try {
            const db = await getDb();
            let parentId = item.product_parent_id;
            if (parentId && typeof parentId === 'string' && parentId.includes(' - ')) {
                parentId = parentId.split(' - ')[0];
            }
            
            await db.execute(`
                UPDATE inventory 
                SET extracted_name = $1, extracted_finish = $2, extracted_colour = $3, extracted_size = $4, product_parent_id = $5
                WHERE product_id = $6
            `, [item.extracted_name, item.extracted_finish, item.extracted_colour, item.extracted_size, parentId || null, item.product_id]);
            
            if (parentId && parentId != '0') {
                await db.execute(`
                    UPDATE products 
                    SET cht_and_gto_stock_status = json_set(
                        COALESCE(cht_and_gto_stock_status, '{"force_in_stock":false,"backorder":false,"max_stock":0}'),
                        '$.max_stock', COALESCE((SELECT MAX(available) FROM inventory WHERE product_parent_id = products.product_id), 0),
                        '$.backorder', CASE WHEN EXISTS(SELECT 1 FROM inventory WHERE product_parent_id = products.product_id AND backorder = 1) THEN json('true') ELSE json('false') END
                    )
                    WHERE product_id = $1
                `, [parentId]);
                
                if (mainTab === 'match') {
                    setMatchInventory(prev => prev.filter(i => i.product_id !== item.product_id));
                } else {
                    setIgnoreInventory(prev => prev.filter(i => i.product_id !== item.product_id));
                }
            } else {
                alert("Saved changes.");
            }
        } catch (e) {
            console.error(e);
            alert("Error saving row");
        }
    };

    const handleIgnoreRow = async (item) => {
        try {
            const db = await getDb();
            await db.execute("UPDATE inventory SET x_inactive = 1 WHERE product_id = $1", [item.product_id]);
            setMatchInventory(prev => prev.filter(i => i.product_id !== item.product_id));
        } catch (e) {
            console.error(e);
            alert("Error ignoring row");
        }
    };

"""
    if "const handleSaveEdit = () => {" not in content:
        content = content.replace("const handleAutoFetch = async () => {", save_logic + "\n    const handleAutoFetch = async () => {")

    # Wrap the render logic
    tabs_html = """
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', backgroundColor: '#fff', padding: '8px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', flexShrink: 0 }}>
                <button className={`tab-btn ${mainTab === 'list' ? 'active' : ''}`} onClick={() => setMainTab('list')} style={{ padding: '8px 16px', border: 'none', background: mainTab === 'list' ? '#e2e8f0' : 'transparent', borderRadius: '6px', cursor: 'pointer', fontWeight: mainTab === 'list' ? 'bold' : 'normal', color: mainTab === 'list' ? '#0f172a' : '#64748b' }}>Product List</button>
                <button className={`tab-btn ${mainTab === 'match' ? 'active' : ''}`} onClick={() => setMainTab('match')} style={{ padding: '8px 16px', border: 'none', background: mainTab === 'match' ? '#e2e8f0' : 'transparent', borderRadius: '6px', cursor: 'pointer', fontWeight: mainTab === 'match' ? 'bold' : 'normal', color: mainTab === 'match' ? '#0f172a' : '#64748b' }}>Product Match</button>
                <button className={`tab-btn ${mainTab === 'ignore' ? 'active' : ''}`} onClick={() => setMainTab('ignore')} style={{ padding: '8px 16px', border: 'none', background: mainTab === 'ignore' ? '#e2e8f0' : 'transparent', borderRadius: '6px', cursor: 'pointer', fontWeight: mainTab === 'ignore' ? 'bold' : 'normal', color: mainTab === 'ignore' ? '#0f172a' : '#64748b' }}>Ignore Records</button>
            </div>
"""

    # Replace the inner structural start
    find_str = "            {/* Main Area: Collections Accordion */}"

    # The table HTML for Match and Ignore
    table_html = """
            {mainTab === 'list' && (
                <>
"""

    if "mainTab === 'list' &&" not in content:
        content = content.replace(find_str, tabs_html + table_html + "\n" + find_str)

    # Where is the end of the list? Right before showCollectionModal
    # Wait, the structure in Products.jsx ends the main area with:
    # </div>
    # {/* Collection Modal */}
    
    find_end_list = "            {/* Collection Modal */}"

    tables_insert = """
                </>
            )}
            
            {(mainTab === 'match' || mainTab === 'ignore') && (
                <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', padding: '24px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.85rem' }}>
                                <th style={{ padding: '12px 8px' }}>SKU</th>
                                <th style={{ padding: '12px 8px' }}>Description</th>
                                <th style={{ padding: '12px 8px' }}>Extracted Name</th>
                                <th style={{ padding: '12px 8px' }}>Finish</th>
                                <th style={{ padding: '12px 8px' }}>Colour</th>
                                <th style={{ padding: '12px 8px' }}>Size</th>
                                <th style={{ padding: '12px 8px' }}>Matched Product</th>
                                <th style={{ padding: '12px 8px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(mainTab === 'match' ? matchInventory : ignoreInventory).map((item, idx) => {
                                const isMatch = mainTab === 'match';
                                return (
                                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem' }}>
                                        <td style={{ padding: '12px 8px', color: '#1e293b' }}>{item.sku}</td>
                                        <td style={{ padding: '12px 8px', color: '#475569', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.sales_description}>{item.sales_description}</td>
                                        
                                        <td style={{ padding: '12px 8px', cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditModal({ show: true, item, field: 'extracted_name', val: item.extracted_name || '', options: [] })}>
                                            {item.extracted_name || '-'} <Edit2 size={12} style={{ marginLeft: '4px' }} />
                                        </td>
                                        <td style={{ padding: '12px 8px', cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditModal({ show: true, item, field: 'extracted_finish', val: item.extracted_finish || '', options: attributes.filter(a => a.type === 'finish').map(a => a.value) })}>
                                            {item.extracted_finish || '-'} <Edit2 size={12} style={{ marginLeft: '4px' }} />
                                        </td>
                                        <td style={{ padding: '12px 8px', cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditModal({ show: true, item, field: 'extracted_colour', val: item.extracted_colour || '', options: attributes.filter(a => a.type === 'colour').map(a => a.value) })}>
                                            {item.extracted_colour || '-'} <Edit2 size={12} style={{ marginLeft: '4px' }} />
                                        </td>
                                        <td style={{ padding: '12px 8px', cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditModal({ show: true, item, field: 'extracted_size', val: item.extracted_size || '', options: [] })}>
                                            {item.extracted_size || '-'} <Edit2 size={12} style={{ marginLeft: '4px' }} />
                                        </td>
                                        
                                        <td style={{ padding: '12px 8px', cursor: 'pointer', color: '#2563eb' }} onClick={() => setEditModal({ show: true, item, field: 'product_parent_id', val: item.product_parent_id || '', options: products.map(p => `${p.product_id} - ${p.product_name}`) })}>
                                            {item.product_parent_id || '-'} <Edit2 size={12} style={{ marginLeft: '4px' }} />
                                        </td>
                                        
                                        <td style={{ padding: '12px 8px' }}>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => handleSaveMatchRow(item)} className="btn-primary" style={{ padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Save</button>
                                                {isMatch && (
                                                    <button onClick={() => handleIgnoreRow(item)} className="btn-secondary" style={{ padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: '#ef4444', borderColor: '#ef4444' }}>Ignore</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {(mainTab === 'match' ? matchInventory : ignoreInventory).length === 0 && (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>No records found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            
            {editModal.show && (
                <div style={overlayStyle} onClick={() => setEditModal({ ...editModal, show: false })}>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', width: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Edit Field</h3>
                        <input
                            type="text"
                            value={editModal.val}
                            onChange={e => setEditModal({ ...editModal, val: e.target.value })}
                            list={editModal.options.length > 0 ? "products-edit-options" : undefined}
                            autoFocus
                            style={{ padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', boxSizing: 'border-box' }}
                        />
                        {editModal.options.length > 0 && (
                            <datalist id="products-edit-options">
                                {editModal.options.map((opt, i) => <option key={i} value={opt} />)}
                            </datalist>
                        )}
                        <button onClick={handleSaveEdit} className="btn-primary" style={{ padding: '8px', borderRadius: '4px', cursor: 'pointer' }}>Apply Change</button>
                    </div>
                </div>
            )}

"""
    if "mainTab === 'match' || mainTab === 'ignore'" not in content:
        content = content.replace(find_end_list, tables_insert.strip() + "\n\n" + find_end_list)

    with open('c:/project/st-analysis/src/pages/Products.jsx', 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Patch applied successfully.")
except Exception as e:
    print(traceback.format_exc())
