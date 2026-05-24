import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { query } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

// Zod Schema for inference log validation
const InferenceLogSchema = z.object({
  requestId: z.string().uuid(),
  sessionId: z.string().uuid(),
  provider: z.enum(['groq', 'gemini']),
  model: z.string(),
  status: z.enum(['success', 'error']),
  latencyMs: z.number().int().nonnegative(),
  ttftMs: z.number().int().nonnegative().optional(),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  inputPreview: z.string().max(200).optional().default(''),
  outputPreview: z.string().max(200).optional().default(''),
  piiDetected: z.boolean().default(false),
  timestamp: z.string().datetime(),
  errorMessage: z.string().optional(),
});

// Zod Schema for message ingestion
const MessageIngestSchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  provider: z.enum(['groq', 'gemini']),
  model: z.string(),
  tokens: z.number().int().nonnegative().default(0),
});

// POST /ingest/log
router.post('/log', authenticate, async (req: Request, res: Response) => {
  const result = InferenceLogSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'validation_failed',
      details: result.error.errors,
    });
  }

  try {
    const payloadString = JSON.stringify(result.data);
    
    // Push the stringified payload onto the Redis queue
    await redis.lPush('inference_queue', payloadString);
    
    // Return 202 Accepted immediately without blocking on database insertion
    return res.status(202).json({ status: 'accepted', message: 'Log queued successfully' });
  } catch (error: any) {
    console.error('[IngestRoute] Redis LPUSH failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to queue log' });
  }
});

// POST /ingest/message
router.post('/message', authenticate, async (req: Request, res: Response) => {
  const result = MessageIngestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'validation_failed',
      details: result.error.errors,
    });
  }

  const { sessionId, role, content, provider, model, tokens } = result.data;

  try {
    // 1. Ensure conversation exists, update metadata
    const convCheck = await query('SELECT id FROM conversations WHERE session_id = $1', [sessionId]);
    let conversationId: string;

    if (convCheck.rows.length === 0) {
      // Create new conversation
      const insertConv = await query(
        `INSERT INTO conversations (session_id, provider, model, message_count, total_tokens, last_message_at)
         VALUES ($1, $2, $3, 1, $4, NOW())
         RETURNING id`,
        [sessionId, provider, model, tokens]
      );
      conversationId = insertConv.rows[0].id;
    } else {
      conversationId = convCheck.rows[0].id;
      // Update existing conversation
      await query(
        `UPDATE conversations 
         SET message_count = message_count + 1, 
             total_tokens = total_tokens + $1,
             last_message_at = NOW(),
             provider = $2,
             model = $3
         WHERE id = $4`,
        [tokens, provider, model, conversationId]
      );
    }

    // 2. Insert message
    await query(
      'INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
      [conversationId, role, content]
    );

    return res.status(201).json({ status: 'success', message: 'Message logged successfully' });
  } catch (error: any) {
    console.error('[IngestRoute] Message DB insert failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to log message' });
  }
});

export default router;
