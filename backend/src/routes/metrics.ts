import { Router, Request, Response } from 'express';
import { query } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/metrics/summary
router.get('/summary', authenticate, async (req: Request, res: Response) => {
  try {
    // 1. Grouped metrics by provider (last 24 hours)
    const providerStatsResult = await query(`
      SELECT 
        provider,
        COUNT(*) as "count",
        ROUND(AVG(latency_ms)) as "avgLatency",
        ROUND(AVG(ttft_ms)) as "avgTtft",
        SUM(prompt_tokens + completion_tokens) as "totalTokens",
        COUNT(CASE WHEN status = 'error' THEN 1 END) as "errorCount"
      FROM inference_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY provider
    `);

    // 2. Overall stats (last 24 hours)
    const overallStatsResult = await query(`
      SELECT 
        COUNT(*) as "totalRequests",
        ROUND(AVG(latency_ms)) as "avgLatency",
        ROUND(AVG(ttft_ms)) as "avgTtft",
        SUM(prompt_tokens + completion_tokens) as "totalTokens",
        COUNT(CASE WHEN status = 'error' THEN 1 END) as "errorCount",
        COUNT(CASE WHEN pii_detected = TRUE THEN 1 END) as "piiCount"
      FROM inference_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    const overall = overallStatsResult.rows[0];
    const totalRequests = parseInt(overall.totalRequests || '0', 10);
    const errorCount = parseInt(overall.errorCount || '0', 10);
    const piiCount = parseInt(overall.piiCount || '0', 10);

    const overallStats = {
      totalRequests,
      avgLatency: parseInt(overall.avgLatency || '0', 10),
      avgTtft: parseInt(overall.avgTtft || '0', 10),
      totalTokens: parseInt(overall.totalTokens || '0', 10),
      errorRate: totalRequests > 0 ? parseFloat(((errorCount / totalRequests) * 100).toFixed(2)) : 0,
      piiDetectedPercentage: totalRequests > 0 ? parseFloat(((piiCount / totalRequests) * 100).toFixed(2)) : 0,
    };

    // 3. Hourly time-series data (last 24 hours) for charts
    // We use DATE_TRUNC('hour', created_at) to bucket requests by hour
    const timeseriesResult = await query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as "hour",
        COUNT(*) as "requests",
        ROUND(AVG(latency_ms)) as "avgLatency",
        COUNT(CASE WHEN status = 'error' THEN 1 END) as "errors"
      FROM inference_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY "hour"
      ORDER BY "hour" ASC
    `);

    const timeseries = timeseriesResult.rows.map((row) => ({
      hour: new Date(row.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      requests: parseInt(row.requests, 10),
      avgLatency: parseInt(row.avgLatency || '0', 10),
      errors: parseInt(row.errors, 10),
    }));

    return res.status(200).json({
      overall: overallStats,
      providers: providerStatsResult.rows,
      timeseries,
    });
  } catch (error: any) {
    console.error('[MetricsRoute] Summary fetch failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to retrieve metrics' });
  }
});

// GET /api/metrics/logs
router.get('/logs', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        request_id as "requestId", 
        session_id as "sessionId", 
        provider, 
        model, 
        status, 
        latency_ms as "latencyMs", 
        ttft_ms as "ttftMs", 
        prompt_tokens as "promptTokens", 
        completion_tokens as "completionTokens", 
        input_preview as "inputPreview", 
        output_preview as "outputPreview", 
        pii_detected as "piiDetected", 
        created_at as "createdAt"
      FROM inference_logs
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('[MetricsRoute] Logs fetch failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to retrieve logs' });
  }
});

export default router;
