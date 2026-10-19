import re

file_path = r'c:\project\st-analysis\src\components\ProductModal.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Patch getInitialProductState
content = content.replace(
    "cht_name: '',",
    "cht_name: '',\n        cht_regular_price: '',\n        cht_sales_price: '',"
)
content = content.replace(
    "gto_name: '',",
    "gto_name: '',\n        gto_regular_price: '',\n        gto_sales_price: '',"
)

# Patch handleSaveProduct UPDATE
content = content.replace(
    "cht_name = $14, gto_name = $15, st_id = $16, st_name = $17",
    "cht_name = $14, cht_regular_price = $15, cht_sales_price = $16, gto_name = $17, gto_regular_price = $18, gto_sales_price = $19, st_id = $20, st_name = $21"
)
content = content.replace(
    "WHERE product_id = $18",
    "WHERE product_id = $22"
)
content = content.replace(
    "productFormData.cht_name, productFormData.gto_name,",
    "productFormData.cht_name, productFormData.cht_regular_price || null, productFormData.cht_sales_price || null, productFormData.gto_name, productFormData.gto_regular_price || null, productFormData.gto_sales_price || null,"
)
content = content.replace(
    "productFormData.id\n                ]);",
    "productFormData.id\n                ]);"
) # Just in case

# Patch handleSaveProduct INSERT
content = content.replace(
    "cht_name, gto_name, st_id, st_name",
    "cht_name, cht_regular_price, cht_sales_price, gto_name, gto_regular_price, gto_sales_price, st_id, st_name"
)
content = content.replace(
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)"
)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("ProductModal.jsx patched successfully for save logic.")
