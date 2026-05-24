const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const INGEST_API_KEY = import.meta.env.VITE_INGEST_API_KEY || 'default-secret-key-1234567890123456';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${INGEST_API_KEY}`,
});

export interface Conversation {
  id: string;
  sessionId: string;
  status: 'active' | 'cancelled';
  provider: 'groq' | 'gemini';
  model: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  totalTokens: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface MetricSummary {
  overall: {
    totalRequests: number;
    avgLatency: number;
    avgTtft: number;
    totalTokens: number;
    errorRate: number;
    piiDetectedPercentage: number;
  };
  providers: Array<{
    provider: 'groq' | 'gemini';
    count: string;
    avgLatency: string;
    avgTtft: string;
    totalTokens: string;
    errorCount: string;
  }>;
  timeseries: Array<{
    hour: string;
    requests: number;
    avgLatency: number;
    errors: number;
  }>;
}

export interface InferenceLog {
  id: string;
  requestId: string;
  sessionId: string;
  provider: 'groq' | 'gemini';
  model: string;
  status: 'success' | 'error';
  latencyMs: number;
  ttftMs?: number;
  promptTokens: number;
  completionTokens: number;
  inputPreview: string;
  outputPreview: string;
  piiDetected: boolean;
  createdAt: string;
}

// Fetch list of conversations
export async function getConversations(): Promise<Conversation[]> {
  const response = await fetch(`${API_URL}/api/conversations`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.statusText}`);
  }
  return response.json();
}

// Fetch messages for a specific conversation session
export async function getMessages(sessionId: string): Promise<Message[]> {
  const response = await fetch(`${API_URL}/api/conversations/${sessionId}/messages`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.statusText}`);
  }
  return response.json();
}

// Cancel / Archive a conversation session
export async function cancelConversation(sessionId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/conversations/${sessionId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to cancel conversation: ${response.statusText}`);
  }
}

// Fetch metrics summary for dashboard
export async function getMetricsSummary(): Promise<MetricSummary> {
  const response = await fetch(`${API_URL}/api/metrics/summary`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch metrics: ${response.statusText}`);
  }
  return response.json();
}

// Fetch detailed log history for dashboard
export async function getInferenceLogs(): Promise<InferenceLog[]> {
  const response = await fetch(`${API_URL}/api/metrics/logs`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.statusText}`);
  }
  return response.json();
}

// Streaming generator for chat response
export async function* streamChatResponse(
  sessionId: string,
  provider: 'groq' | 'gemini',
  model: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  abortSignal: AbortSignal
): AsyncGenerator<{ delta?: string; done?: boolean; usage?: { promptTokens: number; completionTokens: number }; error?: string }> {
  
  const response = await fetch(`${API_URL}/api/chat/stream`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ sessionId, provider, model, messages }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Streaming failed (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder('utf-8');

  if (!reader) {
    throw new Error('ReadableStream not supported by response body.');
  }

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6);
        try {
          const parsed = JSON.parse(dataStr);
          yield parsed;
        } catch (err) {
          console.warn('Failed to parse SSE data stream JSON:', dataStr, err);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
