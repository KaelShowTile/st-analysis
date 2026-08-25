import re

with open('src/pages/ContainerReport.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'const [chartData, setChartData] = useState({ monthlyArrivals: [], originStats: [], shipperStats: [] });',
    'const [chartData, setChartData] = useState({ monthlyArrivals: [], originStats: [], shipperStats: [], forwarderStats: [] });'
)

content = content.replace(
    'const [shipmentsMap, setShipmentsMap] = useState({});',
    'const [shipmentsMap, setShipmentsMap] = useState({});\n    const [forwardersMap, setForwardersMap] = useState({});'
)

content = content.replace(
    'calculateChartData(allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap);',
    'calculateChartData(allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap, forwardersMap);'
)

content = content.replace(
    '}, [allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap]);',
    '}, [allContainers, chart1Dates, chart2Dates, chart3Dates, shippersMap, shipmentsMap, forwardersMap]);'
)

content = content.replace(
    'const [containers, shippers, inventory, shipments] = await Promise.all([',
    'const [containers, shippers, inventory, shipments, oceanShippers] = await Promise.all(['
)
content = content.replace(
    "db.select('SELECT * FROM shipments')\n            ]);",
    "db.select('SELECT * FROM shipments'),\n                db.select('SELECT * FROM ocean_shippers')\n            ]);"
)

fmap_str = '''
            const smMap = {};
            shipments.forEach(s => smMap[s.shipment_id] = s);
            setShipmentsMap(smMap);

            const fMap = {};
            if (oceanShippers) {
                oceanShippers.forEach(os => fMap[os.ocean_shipper_id] = os);
            }
            setForwardersMap(fMap);
'''
content = content.replace(
    '            const smMap = {};\n            shipments.forEach(s => smMap[s.shipment_id] = s);\n            setShipmentsMap(smMap);',
    fmap_str
)

content = content.replace(
    'const calculateChartData = (containers, dates1, dates2, dates3, sMap = shippersMap, smMap = shipmentsMap) => {',
    'const calculateChartData = (containers, dates1, dates2, dates3, sMap = shippersMap, smMap = shipmentsMap, fMap = forwardersMap) => {'
)

shipper_counts_init = 'let shipperCounts = {};'
content = content.replace(shipper_counts_init, shipper_counts_init + '\n        let forwarderCounts = {};')

c_shippers_forEach = '''                cShippers.forEach(sId => {
                    const sName = sMap[sId]?.shipper_name || sMap[sId]?.name || sId;
                    shipperCounts[sName] = (shipperCounts[sName] || 0) + 1;
                });'''
c_shippers_forEach_new = c_shippers_forEach + '''
                if (c.ocean_shipper) {
                    const fName = fMap[c.ocean_shipper]?.ocean_shipper_name || c.ocean_shipper;
                    forwarderCounts[fName] = (forwarderCounts[fName] || 0) + 1;
                }'''
content = content.replace(c_shippers_forEach, c_shippers_forEach_new)

shipper_stats = '''        shipperStats = Object.keys(shipperCounts).map(name => ({
            name,
            Count: shipperCounts[name]
        })).sort((a, b) => b.Count - a.Count).slice(0, 5);'''
shipper_stats_new = '''        let forwarderStats = [];
        if (Object.keys(forwarderCounts).length > 0) {
            forwarderStats = Object.keys(forwarderCounts).map(name => ({
                name,
                Count: forwarderCounts[name]
            })).sort((a, b) => b.Count - a.Count).slice(0, 5);
        }
''' + shipper_stats
content = content.replace(shipper_stats, shipper_stats_new)

content = content.replace(
    'setChartData({ monthlyArrivals, originStats, shipperStats });',
    'setChartData({ monthlyArrivals, originStats, shipperStats, forwarderStats });'
)

content = content.replace(
    "renderList('Docs Not Ready', ['Container No', 'ETD Date']",
    "renderList('Docs Not Ready', ['Container No', 'ETA']"
)
content = content.replace(
    "<td style={{ width: '50%', padding: '8px' }}>\n                                        <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 500 }}>{item.etd || 'Unknown'}</div>\n                                    </td>",
    "<td style={{ width: '50%', padding: '8px' }}>\n                                        <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 500 }}>{item.eta || 'Unknown'}</div>\n                                    </td>"
)

content = content.replace(
    "renderList('Unpaid Containers', ['Container', 'ETD', 'Status']",
    "renderList('Unpaid Containers', ['Container', 'ETA', 'Status']"
)

grid_old = '''<div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                            Top 5 Shippers by Container Volume ({chartData.shipperStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input type="date" value={chart3Dates.start} onChange={e => setChart3Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                            <span>-</span>
                            <input type="date" value={chart3Dates.end} onChange={e => setChart3Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={chartData.shipperStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                            <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                            <Bar dataKey="Count" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                {chartData.shipperStats && chartData.shipperStats.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#34d399' : '#10b981'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>'''

grid_new = '''<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', gridColumn: '1 / -1' }}>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                Top 5 Shippers by Container Volume ({chartData.shipperStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input type="date" value={chart3Dates.start} onChange={e => setChart3Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                <span>-</span>
                                <input type="date" value={chart3Dates.end} onChange={e => setChart3Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={chartData.shipperStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                <Bar dataKey="Count" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                    {chartData.shipperStats && chartData.shipperStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#34d399' : '#10b981'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    
                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ margin: 0, color: '#475569', fontSize: '1rem', fontWeight: '600' }}>
                                Top 5 Forwarders by Container Volume ({chartData.forwarderStats?.reduce((sum, item) => sum + (item.Count || 0), 0) || 0})
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input type="date" value={chart3Dates.start} onChange={e => setChart3Dates(p => ({ ...p, start: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                                <span>-</span>
                                <input type="date" value={chart3Dates.end} onChange={e => setChart3Dates(p => ({ ...p, end: e.target.value }))} style={{ padding: '4px', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={chartData.forwarderStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                                <Bar dataKey="Count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                    {chartData.forwarderStats && chartData.forwarderStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#60a5fa' : '#3b82f6'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>'''

content = content.replace(grid_old, grid_new)

with open('src/pages/ContainerReport.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
