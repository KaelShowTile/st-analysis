import re

file_path = r'c:\project\st-analysis\src\pages\Inventory.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace loop start
content = content.replace(
    'for (const row of parsedData) {',
    'const chunkSize = 20;\n                for (let i = 0; i < parsedData.length; i += chunkSize) {\n                    const chunk = parsedData.slice(i, i + chunkSize);\n                    await Promise.all(chunk.map(async (row) => {'
)

# Replace continue with return in the loop
content = content.replace(
    'if (!row[''SKU''] || row[''SKU''].trim() === '''') continue; // skip invalid rows',
    'if (!row[''SKU''] || row[''SKU''].trim() === '''') return; // skip invalid rows'
)

# Replace end of loop
# The end of loop is around line 205, right before } catch (innerErr) {
content = content.replace(
    '                    , [sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty, rrp, cost, online_name, showtile, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet, stk, days, x_inactive, batch, location, extractedName, extractedFinish, extractedSize, extractedColour, backorder, backorder_amount]);\n                }\n            } catch (innerErr) {',
    '                    , [sku, stock_no, sales_desc, supplier, available, holding, so_qty, total_qty, rrp, cost, online_name, showtile, pallet_qty, box_qty, piece_qty, m2_per_box, pcs_per_box, box_per_pallet, stk, days, x_inactive, batch, location, extractedName, extractedFinish, extractedSize, extractedColour, backorder, backorder_amount]);\n                    }));\n                }\n            } catch (innerErr) {'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Patched Inventory.jsx')
