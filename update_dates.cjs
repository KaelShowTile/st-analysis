
const fs = require('fs');
const files = [
    'src/pages/ContainerReport.jsx',
    'src/pages/ContainerList.jsx',
    'src/pages/Dashboard.jsx',
    'src/pages/Reports.jsx',
    'src/pages/ShipmentOrders.jsx'
];
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('.toISOString().split(\'T\')[0]')) {
        if (!content.includes('getLocalTodayStrSync')) {
            content = content.replace('import {', 'import { getLocalTodayStrSync, getLocalStrFromDate } from \'../utils/timezone\';\nimport {');
        }
        content = content.replace(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/g, 'getLocalTodayStrSync()');
        content = content.replace(/([a-zA-Z0-9_]+)\.toISOString\(\)\.split\('T'\)\[0\]/g, 'getLocalStrFromDate()');
        content = content.replace(/new Date\((.*?)\)\.toISOString\(\)\.split\('T'\)\[0\]/g, 'getLocalStrFromDate(new Date())');
        fs.writeFileSync(file, content);
    }
});
