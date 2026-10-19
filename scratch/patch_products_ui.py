import re

with open('c:/project/st-analysis/src/pages/Products.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add loading state
if 'const [loadingData, setLoadingData] = useState(true);' not in content:
    content = content.replace("const [productInventory, setProductInventory] = useState([]);", "const [productInventory, setProductInventory] = useState([]);\n    const [loadingData, setLoadingData] = useState(true);")

# 2. Update loadData to set loading state
if 'setLoadingData(true)' not in content:
    content = content.replace("const loadData = async () => {\n        try {", "const loadData = async () => {\n        setLoadingData(true);\n        try {")
    content = content.replace("setExpandedCollections(expanded);\n        } catch (e) {", "setExpandedCollections(expanded);\n        } catch (e) {")
    
    # Let's use regex to append setLoadingData(false) at the end of loadData
    # loadData looks like:
    #     const loadData = async () => {
    #         setLoadingData(true);
    #         try {
    # ...
    #             setExpandedCollections(expanded);
    #         } catch (e) {
    #             console.error("Failed to load products data:", e);
    #         } finally {
    #             setLoadingData(false);
    #         }
    #     };
    #
    # Wait, there's no finally currently. It ends with:
    #         } catch (e) {
    #             console.error("Failed to load products data:", e);
    #         }
    #     };
    
    content = re.sub(r'(console\.error\("Failed to load products data:", e\);\n\s*})', r'\1 finally {\n            setLoadingData(false);\n        }', content)

# 3. Rearrange tabs and topbar
# Original topbar starts at: {/* Topbar */}
# The tabs are at: <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', backgroundColor: '#fff', padding: '8px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', flexShrink: 0 }}>
# We need to extract the tabs div, place it above Topbar, and wrap Topbar in mainTab === 'list'
# Let's extract the tabs div exactly.
tabs_div_pattern = r'(\s*<div style={{ display: \'flex\', gap: \'12px\', marginBottom: \'24px\', backgroundColor: \'#fff\', padding: \'8px\', borderRadius: \'8px\', boxShadow: \'0 1px 3px rgba\(0,0,0,0\.1\)\', flexShrink: 0 }}>\s*<button className={`tab-btn \${mainTab === \'list\'.*?</div>\s*)'
tabs_match = re.search(tabs_div_pattern, content, flags=re.DOTALL)
if tabs_match:
    tabs_str = tabs_match.group(1)
    # Remove from old position
    content = content.replace(tabs_str, "")
    
    # Insert above Topbar
    topbar_target = '            {/* Topbar */}'
    new_topbar_structure = f"""{tabs_str.rstrip()}

            {{mainTab === 'list' && (
                <>
{topbar_target}"""
    content = content.replace(topbar_target, new_topbar_structure)

# Wait, we need to handle the closing of mainTab === 'list' which is currently:
#             {mainTab === 'list' && (
#                 <>
#
#             {/* Main Area: Collections Accordion */}
# So we have an EXTRA `{mainTab === 'list' && (` because I am adding another one.
# Let's remove the old `{mainTab === 'list' && (\n                <>`
old_main_list = """            {mainTab === 'list' && (
                <>"""
content = content.replace(old_main_list, "") # It's now above Topbar!

# 4. Update the Table UI
table_start_pattern = r'\{\(mainTab === \'match\' \|\| mainTab === \'ignore\'\) && \(\s*<div style=\{\{ flex: 1, overflow: \'auto\'.*?<tbody>'
table_end_pattern = r'</tbody>\s*</table>\s*</div>\s*\)'

new_table_start = """            {(mainTab === 'match' || mainTab === 'ignore') && (
                <div className="table-container" style={{ flex: 1, overflow: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', padding: '0' }}>
                    {loadingData ? (
                        <div className="loading-spinner-container" style={{ padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={32} className="spin" style={{ color: '#3b82f6', marginBottom: '16px' }} />
                            <p style={{ color: '#64748b' }}>Loading records, please wait...</p>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Description</th>
                                    <th>Extracted Name</th>
                                    <th>Finish</th>
                                    <th>Colour</th>
                                    <th>Size</th>
                                    <th>Matched Product</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>"""

# We need to replace the table rows too
table_rows_replacement = """
                                {(mainTab === 'match' ? matchInventory : ignoreInventory).map((item, idx) => {
                                    const isMatch = mainTab === 'match';
                                    return (
                                        <tr key={item.product_id || idx}>
                                            <td>
                                                <span className="sku-badge">{item.sku}</span>
                                            </td>
                                            <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.sales_description}>
                                                {item.sales_description}
                                            </td>
                                            
                                            <td className="editable-cell product-name" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_name', val: item.extracted_name || '', options: [] })}>
                                                {item.extracted_name || '-'} <Edit2 size={12} className="edit-icon" />
                                            </td>
                                            <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_finish', val: item.extracted_finish || '', options: attributes.filter(a => a.type === 'finish').map(a => a.value) })}>
                                                {item.extracted_finish ? <span className="param-badge finish">{item.extracted_finish}</span> : '-'}
                                                <Edit2 size={12} className="edit-icon" />
                                            </td>
                                            <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_colour', val: item.extracted_colour || '', options: attributes.filter(a => a.type === 'colour').map(a => a.value) })}>
                                                {item.extracted_colour ? <span className="param-badge colour">{item.extracted_colour}</span> : '-'}
                                                <Edit2 size={12} className="edit-icon" />
                                            </td>
                                            <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'extracted_size', val: item.extracted_size || '', options: [] })}>
                                                {item.extracted_size ? <span className="param-badge size">{item.extracted_size}</span> : '-'}
                                                <Edit2 size={12} className="edit-icon" />
                                            </td>
                                            
                                            <td className="editable-cell" title="Click to edit" onClick={() => setEditModal({ show: true, item, field: 'product_parent_id', val: item.product_parent_id || '', options: products.map(p => `${p.product_id} - ${p.product_name}`) })}>
                                                {item.product_parent_id || '-'} <Edit2 size={12} className="edit-icon" />
                                            </td>
                                            
                                            <td>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button onClick={() => handleSaveMatchRow(item)} className="btn-upload" style={{ padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', background: 'var(--primary-color)', color: 'white', border: 'none' }}>Save</button>
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
                    )}
                </div>
            )}
"""

content = re.sub(r'\{\(mainTab === \'match\' \|\| mainTab === \'ignore\'\) && \(\s*<div style=\{\{ flex: 1, overflow: \'auto\'.*?<tbody>', new_table_start, content, flags=re.DOTALL)
content = re.sub(r'\{\(mainTab === \'match\' \? matchInventory : ignoreInventory\)\.map.*?\)\}\s*</tbody>\s*</table>\s*</div>\s*\)', table_rows_replacement.strip(), content, flags=re.DOTALL)


with open('c:/project/st-analysis/src/pages/Products.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
