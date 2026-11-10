/**
 * Utility functions for extracting product parameters from sales descriptions.
 */

export const normalizeSize = (rawSize) => {
    if (!rawSize) return '';
    const parts = rawSize.split(/\s*[xX]\s*/).map(p => p.trim()).filter(Boolean);

    if (parts.length === 2) {
        const n1 = parseFloat(parts[0]);
        const n2 = parseFloat(parts[1]);
        if (!isNaN(n1) && !isNaN(n2)) {
            return n1 <= n2 
                ? `${parts[0].toLowerCase()}x${parts[1].toLowerCase()}` 
                : `${parts[1].toLowerCase()}x${parts[0].toLowerCase()}`;
        }
        return `${parts[0]}x${parts[1]}`.toLowerCase();
    }

    if (parts.length >= 3) {
        const n1 = parseFloat(parts[0]);
        const n2 = parseFloat(parts[1]);
        let first = parts[0].toLowerCase();
        let second = parts[1].toLowerCase();
        if (!isNaN(n1) && !isNaN(n2)) {
            if (n1 > n2) {
                first = parts[1].toLowerCase();
                second = parts[0].toLowerCase();
            }
        }
        const rest = parts.slice(2).join('x').toLowerCase();
        return `${first}x${second}x${rest}`;
    }

    return rawSize.toLowerCase().replace(/\s+/g, '');
};

export const findBestMatch = (list, str) => {
    if (!list || !Array.isArray(list) || list.length === 0 || !str) return null;
    let best = null;

    for (const rawItem of list) {
        const item = String(rawItem || '').trim();
        if (!item) continue;

        // Escape regex special characters
        const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Word boundary: apply \b if edge character is a word character
        const startBoundary = /^\w/.test(item) ? '\\b' : '';
        const endBoundary = /\w$/.test(item) ? '\\b' : '';
        const regex = new RegExp(`${startBoundary}${escaped}${endBoundary}`, 'i');

        const match = str.match(regex);
        if (match) {
            const itemLength = item.length;
            // Match the one with the most characters (longest string)
            if (!best || itemLength > best.item.length) {
                best = {
                    item,
                    index: match.index,
                    length: match[0].length
                };
            }
        }
    }
    return best;
};

export const extractFeatures = (salesDesc, colours, finishes) => {
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

    const colourMatch = findBestMatch(colours, text);
    const finishMatch = findBestMatch(finishes, text);

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

    const sizeRegex = /\b\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)?\b/;

    if (firstParamIndex !== -1) {
        extractedName = text.substring(0, firstParamIndex).trim();
        let remainder = text.substring(lastParamIndex).trim();
        const slashIndex = remainder.indexOf('/');
        if (slashIndex !== -1) {
            remainder = remainder.substring(0, slashIndex).trim();
        }
        const sizeMatch = remainder.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = normalizeSize(sizeMatch[0]);
        }
    } else {
        const sizeMatch = text.match(sizeRegex);
        if (sizeMatch) {
            extractedSize = normalizeSize(sizeMatch[0]);
            extractedName = text.substring(0, sizeMatch.index).trim();
        } else {
            extractedName = text.trim();
        }
    }

    const backorder = salesDesc.toLowerCase().includes('backorder') ? 1 : 0;
    let backorder_amount = 0;
    if (backorder) {
        const match = salesDesc.match(/backorder-?(\d+(?:\.\d+)?)/i);
        if (match && match[1]) {
            backorder_amount = parseFloat(match[1]);
        }
    }

    return { extractedName, extractedColour, extractedFinish, extractedSize, backorder, backorder_amount };
};

