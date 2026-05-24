import { v4 as uuidv4 } from 'uuid';
import { ILLMClient, Message, LLMResponse, LLMStreamChunk, GenerateOptions, estimateTokenCount } from './llmClient';
import { redactPII } from './pii';
import { config } from '../config';

export interface InferenceLogPayload {
  requestId: string;
  sessionId: string;
  provider: 'groq' | 'gemini';
  model: string;
  timestamp: string;
  latencyMs: number;
  ttftMs?: number;
  promptTokens: number;
  completionTokens: number;
  inputPreview: string;
  outputPreview: string;
  piiDetected: boolean;
  status: 'success' | 'error';
  errorMessage?: string;
}

// Function to send ingestion log payload asynchronously (fire-and-forget)
export function fireAndForgetIngestLog(payload: InferenceLogPayload): void {
  // Construct the local ingestion URL
  const url = `http://127.0.0.1:${config.port}/ingest/log`;
  
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ingestApiKey}`,
    },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        console.error(`[LoggingSDK] Failed to ingest log. Status: ${res.status}`);
      }
    })
    .catch((err) => {
      console.error('[LoggingSDK] Error in fire-and-forget log POST:', err.message);
    });
}

export class LoggingLLMClient implements ILLMClient {
  private client: ILLMClient;
  private sessionId: string;

  constructor(client: ILLMClient, sessionId: string) {
    this.client = client;
    this.sessionId = sessionId;
  }

  getModelName(options?: GenerateOptions): string {
    return this.client.getModelName(options);
  }

  async generateText(messages: Message[], options?: GenerateOptions): Promise<LLMResponse> {
    const requestId = uuidv4();
    const startTime = performance.now();
    const model = this.getModelName(options);
    const provider = (this.client as any).primaryProvider || (this.client.constructor.name.includes('Groq') ? 'groq' : 'gemini');

    // Create previews of input
    const inputPreviewRaw = messages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 200);
    const { redactedText: inputPreview, piiDetected: inputPii } = redactPII(inputPreviewRaw);

    try {
      const response = await this.client.generateText(messages, options);
      const latencyMs = Math.round(performance.now() - startTime);

      // Create previews of output
      const outputPreviewRaw = response.content.slice(0, 200);
      const { redactedText: outputPreview, piiDetected: outputPii } = redactPII(outputPreviewRaw);
      const piiDetected = inputPii || outputPii;

      const payload: InferenceLogPayload = {
        requestId,
        sessionId: this.sessionId,
        provider: response.provider,
        model: response.model,
        timestamp: new Date().toISOString(),
        latencyMs,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        inputPreview,
        outputPreview,
        piiDetected,
        status: 'success',
      };

      // Dispatched fire-and-forget
      fireAndForgetIngestLog(payload);

      return response;
    } catch (error: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const payload: InferenceLogPayload = {
        requestId,
        sessionId: this.sessionId,
        provider,
        model,
        timestamp: new Date().toISOString(),
        latencyMs,
        promptTokens: estimateTokenCount(messages.map((m) => m.content).join(' ')),
        completionTokens: 0,
        inputPreview,
        outputPreview: '',
        piiDetected: inputPii,
        status: 'error',
        errorMessage: error.message || String(error),
      };

      fireAndForgetIngestLog(payload);
      throw error;
    }
  }

  async generateStream(messages: Message[], options?: GenerateOptions): Promise<AsyncIterable<LLMStreamChunk>> {
    const requestId = uuidv4();
    const startTime = performance.now();
    const model = this.getModelName(options);
    const provider = (this.client as any).primaryProvider || (this.client.constructor.name.includes('Groq') ? 'groq' : 'gemini');

    const inputPreviewRaw = messages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 200);
    const { redactedText: inputPreview, piiDetected: inputPii } = redactPII(inputPreviewRaw);

    let ttftMs: number | undefined = undefined;
    let accumulatedContent = '';
    let resolvedProvider: 'groq' | 'gemini' = provider;
    let resolvedModel: string = model;

    // Get the base stream
    let stream: AsyncIterable<LLMStreamChunk>;
    try {
      stream = await this.client.generateStream(messages, options);
    } catch (error: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const payload: InferenceLogPayload = {
        requestId,
        sessionId: this.sessionId,
        provider,
        model,
        timestamp: new Date().toISOString(),
        latencyMs,
        promptTokens: estimateTokenCount(messages.map((m) => m.content).join(' ')),
        completionTokens: 0,
        inputPreview,
        outputPreview: '',
        piiDetected: inputPii,
        status: 'error',
        errorMessage: error.message || String(error),
      };
      fireAndForgetIngestLog(payload);
      throw error;
    }

    const sessionId = this.sessionId;
    const clientInstance = this;

    const generator = async function* (): AsyncGenerator<LLMStreamChunk> {
      try {
        for await (const chunk of stream) {
          // Record Time to First Token (TTFT) when first content chunk is received
          if (ttftMs === undefined && chunk.delta.length > 0) {
            ttftMs = Math.round(performance.now() - startTime);
          }

          accumulatedContent += chunk.delta;

          // If chunk has usage metadata (e.g. from Groq's last chunk), check it
          if (chunk.usage) {
            // Note: OpenAI stream include_usage contains usage
          }

          yield chunk;

          // If this is the last chunk, it might signal completion
          if (chunk.done) {
            const latencyMs = Math.round(performance.now() - startTime);
            const promptTokens = chunk.usage?.promptTokens || estimateTokenCount(messages.map((m) => m.content).join(' '));
            const completionTokens = chunk.usage?.completionTokens || estimateTokenCount(accumulatedContent);

            const outputPreviewRaw = accumulatedContent.slice(0, 200);
            const { redactedText: outputPreview, piiDetected: outputPii } = redactPII(outputPreviewRaw);
            const piiDetected = inputPii || outputPii;

            if (chunk.provider) {
              resolvedProvider = chunk.provider;
            }
            if (chunk.model) {
              resolvedModel = chunk.model;
            }

            const payload: InferenceLogPayload = {
              requestId,
              sessionId,
              provider: resolvedProvider,
              model: resolvedModel,
              timestamp: new Date().toISOString(),
              latencyMs,
              ttftMs,
              promptTokens,
              completionTokens,
              inputPreview,
              outputPreview,
              piiDetected,
              status: 'success',
            };

            fireAndForgetIngestLog(payload);
          }
        }
      } catch (error: any) {
        // Stream reading failed midway
        const latencyMs = Math.round(performance.now() - startTime);
        const completionTokens = estimateTokenCount(accumulatedContent);
        const { redactedText: outputPreview, piiDetected: outputPii } = redactPII(accumulatedContent.slice(0, 200));

        const payload: InferenceLogPayload = {
          requestId,
          sessionId,
          provider: resolvedProvider,
          model: resolvedModel,
          timestamp: new Date().toISOString(),
          latencyMs,
          ttftMs,
          promptTokens: estimateTokenCount(messages.map((m) => m.content).join(' ')),
          completionTokens,
          inputPreview,
          outputPreview,
          piiDetected: inputPii || outputPii,
          status: 'error',
          errorMessage: error.message || String(error),
        };

        fireAndForgetIngestLog(payload);
        throw error;
      }
    };

    return generator();
  }
}

// SDK helper function
export function withLogging(client: ILLMClient, sessionId: string): ILLMClient {
  return new LoggingLLMClient(client, sessionId);
}
