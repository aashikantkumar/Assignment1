import React, { useEffect, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area, Cell 
} from 'recharts';
import { 
  RefreshCw, Activity, Cpu, Clock, AlertTriangle, ShieldAlert 
} from 'lucide-react';
import { getMetricsSummary, getInferenceLogs } from '../api';
import type { MetricSummary, InferenceLog } from '../api';

export const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);
  const [logs, setLogs] = useState<InferenceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    
    try {
      const [sum, logData] = await Promise.all([
        getMetricsSummary(),
        getInferenceLogs(),
      ]);
      setMetrics(sum);
      setLogs(logData);
      setError(null);
    } catch (err: any) {
      console.error('[Dashboard] Data fetch failed:', err);
      setError('Failed to fetch dashboard data. Make sure the backend and databases are running.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Auto-refresh every 30s as requested in the specification
    const interval = setInterval(() => {
      loadData(true);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="dashboard-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <RefreshCw className="animate-spin text-primary" size={32} style={{ margin: '0 auto', animation: 'spin 1.5s linear infinite' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading telemetry logs & aggregation charts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '500px', textAlign: 'center', borderColor: 'var(--error)' }}>
          <AlertTriangle size={48} style={{ color: 'var(--error)', marginBottom: '16px' }} />
          <h2 style={{ marginBottom: '8px' }}>Telemetry Error</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>{error}</p>
          <button className="refresh-btn" onClick={() => loadData()} style={{ margin: '0 auto' }}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const overall = metrics?.overall;
  const providersData = metrics?.providers || [];
  const timeseriesData = metrics?.timeseries || [];

  // Colors for charts
  const COLORS = {
    groq: 'var(--accent)',
    gemini: 'var(--secondary)',
    primary: 'var(--primary)',
  };

  return (
    <div className="dashboard-container">
      {/* Dashboard Header */}
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>Observability Dashboard</h1>
          <p>Real-time analytics and audit logs from the LLM ingestion pipeline (Auto-refreshes every 30s)</p>
        </div>
        <button className="refresh-btn" onClick={() => loadData(true)} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={refreshing ? { animation: 'spin 1.5s linear infinite' } : {}} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card glass-panel">
          <div className="stat-header">
            <span>Total Requests</span>
            <Activity size={16} />
          </div>
          <div className="stat-value">{overall?.totalRequests || 0}</div>
        </div>

        <div className="stat-card glass-panel accent">
          <div className="stat-header">
            <span>Avg Latency</span>
            <Clock size={16} />
          </div>
          <div className="stat-value">{overall?.avgLatency || 0} ms</div>
        </div>

        <div className="stat-card glass-panel success">
          <div className="stat-header">
            <span>Avg TTFT</span>
            <Clock size={16} style={{ color: 'var(--secondary)' }} />
          </div>
          <div className="stat-value">{overall?.avgTtft || 0} ms</div>
        </div>

        <div className="stat-card glass-panel warning">
          <div className="stat-header">
            <span>Total Tokens</span>
            <Cpu size={16} />
          </div>
          <div className="stat-value">
            {overall?.totalTokens ? overall.totalTokens.toLocaleString() : 0}
          </div>
        </div>

        <div className="stat-card glass-panel" style={{ color: overall?.errorRate && overall.errorRate > 0 ? 'var(--error)' : 'inherit' }}>
          <div className="stat-header">
            <span>Error Rate</span>
            <AlertTriangle size={16} />
          </div>
          <div className="stat-value">{overall?.errorRate || 0}%</div>
        </div>

        <div className="stat-card glass-panel" style={{ color: overall?.piiDetectedPercentage && overall.piiDetectedPercentage > 0 ? 'var(--warning)' : 'inherit' }}>
          <div className="stat-header">
            <span>PII Redacted</span>
            <ShieldAlert size={16} />
          </div>
          <div className="stat-value">{overall?.piiDetectedPercentage || 0}%</div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Time Series Latency & Request Volume */}
        <div className="chart-card glass-panel">
          <div className="chart-title">Inference Volume & Latency Trend (Last 24 Hours)</div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseriesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="hour" stroke="var(--text-secondary)" fontSize={11} />
                <YAxis yAxisId="left" stroke="var(--text-secondary)" fontSize={11} label={{ value: 'Requests', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)' }} />
                <YAxis yAxisId="right" orientation="right" stroke="var(--text-secondary)" fontSize={11} label={{ value: 'Latency (ms)', angle: 90, position: 'insideRight', fill: 'var(--text-secondary)' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-light)', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="requests" name="Requests" stroke="var(--primary)" fillOpacity={1} fill="url(#colorReq)" />
                <Area yAxisId="right" type="monotone" dataKey="avgLatency" name="Latency (ms)" stroke="var(--accent)" fillOpacity={1} fill="url(#colorLat)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Requests by Provider */}
        <div className="chart-card glass-panel">
          <div className="chart-title">Inference Share by Provider</div>
          <div className="chart-body">
            {providersData.length === 0 ? (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                No provider distribution data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={providersData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="provider" stroke="var(--text-secondary)" fontSize={11} tickFormatter={(val) => val.toUpperCase()} />
                  <YAxis stroke="var(--text-secondary)" fontSize={11} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-light)', borderRadius: '8px' }}
                  />
                  <Bar dataKey="count" name="Total Invocations" fill="var(--primary)">
                    {providersData.map((entry, index) => {
                      const provColor = entry.provider === 'groq' ? COLORS.groq : COLORS.gemini;
                      return <Cell key={`cell-${index}`} fill={provColor} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Raw Logs Table */}
      <div className="logs-card glass-panel">
        <div className="chart-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Telemetry Stream / Audit Logs</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Showing last 100 runs</span>
        </div>

        <div className="table-container">
          {logs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No telemetry logs generated yet. Use the Chat Client to invoke LLMs.
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Request ID</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>TTFT</th>
                  <th>Tokens (P/C)</th>
                  <th>Input (Redacted)</th>
                  <th>Output (Redacted)</th>
                  <th>PII</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {log.requestId.slice(0, 8)}...
                    </td>
                    <td>
                      <span className={`badge badge-${log.provider}`}>{log.provider}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{log.model}</td>
                    <td>
                      <span className={`badge-status ${log.status === 'success' ? 'active' : 'cancelled'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td>{log.latencyMs} ms</td>
                    <td>{log.ttftMs ? `${log.ttftMs} ms` : '-'}</td>
                    <td>
                      {log.promptTokens} / {log.completionTokens}
                    </td>
                    <td>
                      <div className="preview-bubble" title={log.inputPreview}>
                        {log.inputPreview || '-'}
                      </div>
                    </td>
                    <td>
                      <div className="preview-bubble" title={log.outputPreview}>
                        {log.outputPreview || '-'}
                      </div>
                    </td>
                    <td>
                      {log.piiDetected ? (
                        <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <ShieldAlert size={14} /> Yes
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
