import re

file_path = r'c:\project\st-analysis\src\pages\Products.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

new_format_price = """    const formatPrice = (regular, sales) => {
        if (sales && regular) return <span>{sales} - <s style={{ color: '#94a3b8' }}>{regular}</s></span>;
        if (regular) return `${regular}`;
        if (sales) return `${sales}`;
        return '-';
    };

    const renderPriceColumn = (id, regular, sales, isSt = false, stPrice = null) => {
        if (!id) return <span style={{ color: '#94a3b8' }}>not connect</span>;
        if (isSt) {
            return stPrice || '-';
        }
        return formatPrice(regular, sales);
    };"""

content = re.sub(r'const formatPrice = \(regular, sales\) => \{.*?\};', new_format_price, content, flags=re.DOTALL)

# Insert ST Price Header
content = content.replace(
    "<th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>CHT Price</th>",
    "<th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>ST Price</th>\n                                                                <th style={{ padding: '12px 8px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', width: '150px' }}>CHT Price</th>"
)

# Insert ST Price Cell & update CHT/GTO Price Cells
old_cells = """<td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{formatPrice(product.cht_regular_price, product.cht_sales_price)}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{formatPrice(product.gto_regular_price, product.gto_sales_price)}</td>"""

new_cells = """<td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{renderPriceColumn(product.st_id, null, null, true, product.showtile_price)}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{renderPriceColumn(product.cht_id, product.cht_regular_price, product.cht_sales_price)}</td>
                                                                        <td style={{ padding: '12px 8px', fontSize: '0.9rem', color: '#475569' }}>{renderPriceColumn(product.gto_id, product.gto_regular_price, product.gto_sales_price)}</td>"""

content = content.replace(old_cells, new_cells)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Products.jsx patched successfully.")
