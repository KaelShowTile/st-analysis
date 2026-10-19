import re

with open(r'c:\project\st-analysis\src\pages\Inventory.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the helper function to insert
helper_function = """
const extractFeatures = (salesDesc, colours, finishes) => {
    let text = salesDesc;
    let startIndex = text.indexOf(')');
    let endIndex = text.indexOf('[');

    if (startIndex === -1) startIndex = 0;
    else startIndex += 1;

    if (endIndex === -1) endIndex = text.length;

    if (startIndex < endIndex) {
        text = text.substring(startIndex, endIndex).trim();
    } else {
        text = text.trim();
    }

    let extractedSize = '';
    let extractedFinish = '';
    let extractedColour = '';
    let extractedName = '';

    let firstParamIndex = -1;
    let lastParamIndex = -1;

    const findMatch = (list, str) => {
        for (const item of list) {
            const regex = new RegExp(`\\\\b${item}\\\\b`, 'i');
            const match = str.match(regex);
            if (match) {
                return { item, index: match.index, length: match[0].length };
            }
        }
        return null;
    };

    const colourMatch = findMatch(colours, text);
    const finishMatch = findMatch(finishes, text);

    if (colourMatch) {
        extractedColour = colourMatch.item;
        firstParamIndex = colourMatch.index;
        lastParamIndex = colourMatch.index + colourMatch.length;
    }

    if (finishMatch) {
        extractedFinish = finishMatch.item;
        if (firstParamIndex === -1 || finishMatch.index < firstParamIndex) {
            firstParamIndex = finishMatch.index;
        }
        const endIdx = finishMatch.index + finishMatch.length;
        if (endIdx > lastParamIndex) {
            lastParamIndex = endIdx;
        }
    }

    const sizeRegex = /\\b\\d+(?:\\.\\d+)?\\s*[xX]\\s*\\d+(?:\\.\\d+)?(?:\\s*[xX]\\s*\\d+(?:\\.\\d+)?)?\\b/;

    if (firstParamIndex !== -1) {
        extractedName = text.substring(0, firstParamIndex).trim();
        let remainder = text.substring(lastParamIndex).trim();
        const slashIndex = remainder.indexOf('/');
        if (slashIndex !== -1) {
            remainder = remainder.substring(0, slashIndex).trim();
        }
        const sizeMatch = remainder.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = sizeMatch[0];
        }
    } else {
        const sizeMatch = text.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = sizeMatch[0];
            extractedName = text.substring(0, sizeMatch.index).trim();
        } else {
            extractedName = text.trim();
        }
    }

    const backorder = salesDesc.toLowerCase().includes('backorder') ? 1 : 0;
    let backorder_amount = 0;
    if (backorder) {
        const match = salesDesc.match(/backorder-?(\\d+(?:\\.\\d+)?)/i);
        if (match && match[1]) {
            backorder_amount = parseFloat(match[1]);
        }
    }

    return { extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount };
};
"""

auto_analysis_function = """
    const handleAutoAnalysis = async () => {
        if (!canWrite) return;
        setLoading(true);
        try {
            const db = await getDb();
            const attributes = await db.select('SELECT * FROM attributes');
            const colours = attributes.filter(a => a.type === 'colour').map(a => a.value.toLowerCase());
            const finishes = attributes.filter(a => a.type === 'finish').map(a => a.value.toLowerCase());

            // Retrieve all rows where extracted_name is empty or null
            const rows = await db.select("SELECT product_id, sku, sales_description FROM inventory WHERE extracted_name IS NULL OR extracted_name = ''");
            
            for (const row of rows) {
                const salesDesc = String(row.sales_description || '');
                const features = extractFeatures(salesDesc, colours, finishes);
                
                await db.execute(`
                    UPDATE inventory SET 
                        extracted_name = $1, extracted_colour = $2, extracted_finish = $3, 
                        extracted_size = $4, backorder = $5, backorder_amount = $6 
                    WHERE product_id = $7
                `, [features.extractedName, features.extractedColour, features.extractedFinish, features.extractedSize, features.backorder, features.backorder_amount, row.product_id]);
            }
            loadData();
            alert(`Auto Analysis complete. Processed ${rows.length} records.`);
        } catch (err) {
            console.error(err);
            alert("Auto Analysis failed");
        } finally {
            setLoading(false);
        }
    };
"""

button_html = """
                    <button 
                        className="import-button" 
                        onClick={handleAutoAnalysis}
                        disabled={!canWrite || loading}
                        style={{ 
                            cursor: canWrite ? 'pointer' : 'not-allowed',
                            opacity: canWrite ? 1 : 0.6,
                            marginRight: '10px'
                        }}
                    >
                        {loading ? 'Processing...' : 'Auto Analysis'}
                    </button>
"""

# Insert the helper function outside the component, right before `export default function Inventory`
content = content.replace("export default function Inventory({ currentUser }) {", helper_function + "\nexport default function Inventory({ currentUser }) {")

# Insert the auto analysis function right before `const processData = `
content = content.replace("    const processData = async (parsedData) => {", auto_analysis_function + "\n    const processData = async (parsedData) => {")

# Insert the button before the Import CSV button
content = content.replace("""                    <button 
                        className="import-button" """, button_html + """                    <button 
                        className="import-button" """)

# Replace the extraction logic in processData
extraction_regex = r"const salesDesc = String\(row\['Sales Description'\] \|\| ''\);[\s\S]*?(?=const sku = String\(row\['SKU'\]\)\.trim\(\);)"
replacement = """const salesDesc = String(row['Sales Description'] || '');
                    
                    const {
                        extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount
                    } = extractFeatures(salesDesc, colours, finishes);

                    """

content = re.sub(extraction_regex, replacement, content)

# Remove the old backorder extraction logic
backorder_regex = r"const backorder = sales_desc\.toLowerCase\(\)\.includes\('backorder'\) \? 1 : 0;[\s\S]*?(?=const existing = inventoryMap\.get\(sku\);)"
content = re.sub(backorder_regex, "", content)

with open(r'c:\project\st-analysis\src\pages\Inventory.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Inventory.jsx patched successfully.")
