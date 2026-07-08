import { useState, useEffect } from 'react';
import { getDb } from '../db/Database';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import './Containers.css'; // or create a specific CSS if needed

export default function ContainerReport() {
    const [chartData, setChartData] = useState({ monthlyArrivals: [], originStats: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = await getDb();
            const containers = await db.select('SELECT cntr_no, eta, delivery, origin, track_status, year FROM containers');
            calculateChartData(containers);
        } catch (e) {
            console.error("Failed to load container data for report", e);
        } finally {
            setLoading(false);
        }
    };

    const calculateChartData = (containers) => {
        // 1. Last 4 months arrivals
        const arrived = containers.filter(c => c.track_status && (c.track_status.toLowerCase() === 'delivered' || c.track_status.toLowerCase() === 'empty returned'));
        
        const now = new Date();
        const monthMap = {};
        
        // Generate last 4 months array
        const last4Months = [];
        for (let i = 3; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
            last4Months.push(label);
            monthMap[label] = 0;
        }

        arrived.forEach(c => {
            const dateStr = c.delivery || c.eta;
            if (!dateStr) return;
            const d = new Date(dateStr);
            if (isNaN(d)) return;
            const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
            if (monthMap[label] !== undefined) {
                monthMap[label]++;
            }
        });

        const monthlyArrivals = last4Months.map(name => ({
            name,
            Count: monthMap[name]
        }));

        // 2. Current year origin
        const currentYearStr = String(now.getFullYear());
        const thisYearContainers = containers.filter(c => String(c.year) === currentYearStr);
        const originCounts = {};
        thisYearContainers.forEach(c => {
            const org = c.origin || 'Unknown';
            originCounts[org] = (originCounts[org] || 0) + 1;
        });

        const originStats = Object.keys(originCounts).map(org => ({
            name: org,
            Count: originCounts[org]
        })).sort((a, b) => b.Count - a.Count);

        setChartData({ monthlyArrivals, originStats });
    };

    if (loading) {
        return <div style={{ padding: '24px', color: 'var(--text-color)' }}>Loading charts...</div>;
    }

    return (
        <div className="report-dashboard" style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--bg-color)' }}>
            <div style={{ padding: '32px' }}>
                <h2 style={{ marginBottom: '24px', color: '#1e293b' }}>Container Analytics Overview</h2>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ marginBottom: '24px', color: '#475569', fontSize: '1rem', fontWeight: '600' }}>Arrived Containers (Last 4 Months)</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData.monthlyArrivals} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} />
                                <Bar dataKey="Count" fill="var(--primary-color)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ marginBottom: '24px', color: '#475569', fontSize: '1rem', fontWeight: '600' }}>Shipments by Origin ({new Date().getFullYear()})</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData.originStats} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} />
                                <Bar dataKey="Count" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                    {chartData.originStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--primary-color)' : '#38bdf8'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
