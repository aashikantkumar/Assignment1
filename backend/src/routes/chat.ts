import { Router, Request, Response } from 'express';
import { createLLMClient, Message, estimateTokenCount } from '../lib/llmClient';
import { withLogging } from '../lib/withLogging';
import { query } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/test', async (req, res) => {
  try {
    const rawClient = createLLMClient('groq');
    const stream = await rawClient.generateStream([{ role: 'user', content: 'hello' }]);
    let chunks = 0;
    for await (const chunk of stream) chunks++;
    res.json({ success: true, chunks });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/stream
router.post('/stream', authenticate, async (req: Request, res: Response) => {
  const { sessionId, provider, model, messages } = req.body;

  if (!sessionId || !provider || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'Missing required parameters' });
  }
  
  console.log(`[ChatRoute] Stream requested for session ${sessionId}. Provider: ${provider}, Model: ${model}`);

  // Get the last user message
  const userMessage = messages[messages.length - 1];
  if (userMessage.role !== 'user') {
    return res.status(400).json({ error: 'invalid_request', message: 'Last message must be from user' });
  }

  // Set response headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Create AbortController to handle client disconnects
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[ChatRoute] Client closed connection for session ${sessionId}. Aborting stream.`);
      abortController.abort();
    }
  });

  let accumulatedContent = '';
  let promptTokens = estimateTokenCount(messages.map(m => m.content).join(' '));
  let completionTokens = 0;
  
  const selectedModel = model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-2.0-flash');

  try {
    // 1. Create LLM Client wrapped with metadata logging
    const rawClient = createLLMClient(provider);
    const loggedClient = withLogging(rawClient, sessionId);

    // 2. Fetch the stream
    const stream = await loggedClient.generateStream(messages, {
      model: selectedModel,
      temperature: 0.7,
    });

    // 3. Process stream chunks and write to SSE
    for await (const chunk of stream) {
      if (abortController.signal.aborted) {
        break;
      }

      if (chunk.delta) {
        accumulatedContent += chunk.delta;
        res.write(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`);
      }

      if (chunk.done) {
        promptTokens = chunk.usage?.promptTokens || promptTokens;
        completionTokens = chunk.usage?.completionTokens || estimateTokenCount(accumulatedContent);
        res.write(`data: ${JSON.stringify({ done: true, usage: { promptTokens, completionTokens } })}\n\n`);
      }
    }

    // 4. Update Database on successful stream completion
    if (!abortController.signal.aborted && accumulatedContent.length > 0) {
      try {
        // Ensure conversation exists
        let convResult = await query('SELECT id FROM conversations WHERE session_id = $1', [sessionId]);
        let conversationId: string;

        if (convResult.rows.length === 0) {
          const insertConv = await query(
            `INSERT INTO conversations (session_id, provider, model, message_count, total_tokens, last_message_at)
             VALUES ($1, $2, $3, 2, $4, NOW())
             RETURNING id`,
            [sessionId, provider, selectedModel, promptTokens + completionTokens]
          );
          conversationId = insertConv.rows[0].id;
        } else {
          conversationId = convResult.rows[0].id;
          await query(
            `UPDATE conversations
             SET message_count = message_count + 2,
                 total_tokens = total_tokens + $1,
                 last_message_at = NOW(),
                 status = 'active',
                 provider = $2,
                 model = $3
             WHERE id = $4`,
            [promptTokens + completionTokens, provider, selectedModel, conversationId]
          );
        }

        // Save User Message
        await query(
          'INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL \'1 second\')',
          [conversationId, 'user', userMessage.content]
        );

        // Save Assistant Message
        await query(
          'INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [conversationId, 'assistant', accumulatedContent]
        );
      } catch (dbError: any) {
        console.error('[ChatRoute] Database message logging failed:', dbError.message);
      }
    }
    res.end();
  } catch (error: any) {
    console.error('[ChatRoute] Stream execution failed:', error.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Stream generation failed' })}\n\n`);
      res.end();
    }
  }
});

export default router;
