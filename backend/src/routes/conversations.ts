import { Router, Request, Response } from 'express';
import { query } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/conversations
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    // Fetch conversations sorted by last activity, limited to 50
    const result = await query(
      `SELECT id, session_id as "sessionId", status, provider, model, 
              created_at as "createdAt", last_message_at as "lastMessageAt", 
              message_count as "messageCount", total_tokens as "totalTokens"
       FROM conversations 
       ORDER BY last_message_at DESC 
       LIMIT 50`
    );
    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('[ConversationsRoute] Fetch failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to retrieve conversations' });
  }
});

// GET /api/conversations/:sessionId/messages
router.get('/:sessionId/messages', authenticate, async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    // Get conversation id
    const convResult = await query('SELECT id FROM conversations WHERE session_id = $1', [sessionId]);
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Conversation session not found' });
    }

    const conversationId = convResult.rows[0].id;

    // Get messages for conversation ordered by creation time
    const msgResult = await query(
      `SELECT id, role, content, created_at as "createdAt"
       FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [conversationId]
    );

    return res.status(200).json(msgResult.rows);
  } catch (error: any) {
    console.error('[ConversationsRoute] Messages fetch failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to retrieve messages' });
  }
});

// DELETE /api/conversations/:sessionId
router.delete('/:sessionId', authenticate, async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const result = await query(
      `UPDATE conversations 
       SET status = 'cancelled', last_message_at = NOW() 
       WHERE session_id = $1`,
      [sessionId]
    );
    
    // Spec: return 204 No Content
    return res.sendStatus(204);
  } catch (error: any) {
    console.error('[ConversationsRoute] Cancel failed:', error.message);
    return res.status(500).json({ error: 'internal_server_error', message: 'Failed to cancel conversation' });
  }
});

export default router;
