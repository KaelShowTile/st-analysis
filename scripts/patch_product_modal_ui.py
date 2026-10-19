import re

file_path = r'c:\project\st-analysis\src\components\ProductModal.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

cht_prices = """                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Regular Price</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.cht_regular_price || ''} onChange={e => setProductFormData({ ...productFormData, cht_regular_price: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Sales Price</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.cht_sales_price || ''} onChange={e => setProductFormData({ ...productFormData, cht_sales_price: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                </div>"""

gto_prices = """                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Regular Price</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.gto_regular_price || ''} onChange={e => setProductFormData({ ...productFormData, gto_regular_price: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#475569' }}>Sales Price</label>
                                        <input type="number" step="0.01" className="form-control" value={productFormData.gto_sales_price || ''} onChange={e => setProductFormData({ ...productFormData, gto_sales_price: e.target.value })} style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                    </div>
                                </div>"""

# Replace in CHT Tab
content = re.sub(r'(CHT Name.*?</label>.*?</div>\s*)}?\s*</div>\s*</div>\s*)}', r'\1' + cht_prices + '\n                          </div>\n                      )}', content, flags=re.DOTALL)

# Replace in GTO Tab
content = re.sub(r'(GTO Name.*?</label>.*?</div>\s*)}?\s*</div>\s*</div>\s*)}', r'\1' + gto_prices + '\n                          </div>\n                      )}', content, flags=re.DOTALL)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("ProductModal.jsx UI patched successfully.")
