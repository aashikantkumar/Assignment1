import cron from 'node-cron';
import { redis } from './redis';
import { query } from './db';
import { InferenceLogPayload } from './lib/withLogging';

// Function to drain up to 50 items from the queue and batch insert into Postgres
export async function drainQueue(): Promise<{ processed: number; inserted: number; duplicates: number }> {
  const batchSize = 50;
  const rawLogs: string[] = [];

  try {
    // Connect to redis
    await redis.connect();

    // Pop up to 50 items from the tail of the queue (oldest first)
    // This is thread-safe and prevents concurrent LPUSH race conditions
    for (let i = 0; i < batchSize; i++) {
      const popped = await redis.rPop('inference_queue');
      if (!popped) {
        break;
      }
      rawLogs.push(popped);
    }

    if (rawLogs.length === 0) {
      return { processed: 0, inserted: 0, duplicates: 0 };
    }

    const logsToInsert: InferenceLogPayload[] = [];
    let duplicates = 0;

    for (const rawLog of rawLogs) {
      try {
        const log: InferenceLogPayload = JSON.parse(rawLog);
        
        // Deduplication check: Set dedup:{requestId} 1 NX EX 86400
        // NX option ensures we only write if it does not exist
        const isUnique = await redis.set(`dedup:${log.requestId}`, '1', { NX: true, EX: 86400 });
        
        // In Redis, if SET NX is successful, it returns "OK" (or 1 in Upstash). If it fails, it returns null.
        if (isUnique === null || isUnique === undefined) {
          console.warn(`[CronWorker] Duplicate requestId detected: ${log.requestId}. Skipping.`);
          duplicates++;
          continue;
        }

        logsToInsert.push(log);
      } catch (err: any) {
        console.error('[CronWorker] Error parsing log payload:', err.message);
      }
    }

    if (logsToInsert.length === 0) {
      return { processed: rawLogs.length, inserted: 0, duplicates };
    }

    // Prepare batch insert SQL statement
    // We construct a query with parameterized inputs to protect against SQL injection
    const valuesPlaceholders: string[] = [];
    const flatValues: any[] = [];
    let index = 1;

    for (const log of logsToInsert) {
      valuesPlaceholders.push(`(
        $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, 
        $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, 
        $${index++}, $${index++}, $${index++}
      )`);

      flatValues.push(
        log.requestId,
        log.sessionId,
        log.provider,
        log.model,
        log.status,
        log.latencyMs,
        log.ttftMs ?? null,
        log.promptTokens,
        log.completionTokens,
        log.inputPreview ?? '',
        log.outputPreview ?? '',
        log.piiDetected,
        log.timestamp
      );
    }

    const batchInsertQuery = `
      INSERT INTO inference_logs (
        request_id, session_id, provider, model, status, latency_ms, ttft_ms, 
        prompt_tokens, completion_tokens, input_preview, output_preview, pii_detected, created_at
      ) 
      VALUES ${valuesPlaceholders.join(', ')}
      ON CONFLICT (request_id) DO NOTHING
    `;

    const result = await query(batchInsertQuery, flatValues);
    console.log(`[CronWorker] Drained ${rawLogs.length} logs. Inserted ${result.rowCount} into database. Duplicates: ${duplicates}`);

    return {
      processed: rawLogs.length,
      inserted: result.rowCount || 0,
      duplicates,
    };
  } catch (error: any) {
    console.error('[CronWorker] Queue draining failed:', error.message);
    throw error;
  }
}

// Setup node-cron to trigger every 60 seconds
export function setupCronJob() {
  console.log('Registering Redis queue drain cron job (runs every 60 seconds)...');
  cron.schedule('*/60 * * * * *', async () => {
    try {
      await drainQueue();
    } catch (err: any) {
      console.error('[CronJob] Error executing cron drain:', err.message);
    }
  });
}
