import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  provider: 'groq' | 'gemini';
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  provider?: 'groq' | 'gemini';
  model?: string;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
}

export interface ILLMClient {
  generateText(messages: Message[], options?: GenerateOptions): Promise<LLMResponse>;
  generateStream(messages: Message[], options?: GenerateOptions): Promise<AsyncIterable<LLMStreamChunk>>;
  getModelName(options?: GenerateOptions): string;
}

// Helper for exponential backoff retries
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const statusCode = error.status || error.statusCode || error.response?.status;
      const isRetryable = statusCode === 429 || statusCode === 503 || statusCode === 500 || !statusCode; // retry network issues

      if (attempt > maxRetries || !isRetryable) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 100;
      console.warn(`[LLMClient] Attempt ${attempt} failed with status ${statusCode}. Retrying in ${delay.toFixed(0)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Helper to count approximate tokens if APIs do not return them
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Sane estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// 1. Groq Adapter (using OpenAI Client)
export class GroqClient implements ILLMClient {
  private openai: OpenAI;
  private defaultModel = 'llama-3.3-70b-versatile';

  constructor() {
    if (!config.groqApiKey) {
      console.warn('WARNING: GROQ_API_KEY is not set.');
    }
    this.openai = new OpenAI({
      apiKey: config.groqApiKey || 'dummy-groq-key',
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  getModelName(options?: GenerateOptions): string {
    return options?.model || this.defaultModel;
  }

  async generateText(messages: Message[], options?: GenerateOptions): Promise<LLMResponse> {
    const model = this.getModelName(options);
    return retryWithBackoff(async () => {
      const response = await this.openai.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
      });

      const content = response.choices[0]?.message?.content || '';
      const usage = response.usage;

      return {
        content,
        provider: 'groq',
        model,
        usage: {
          promptTokens: usage?.prompt_tokens || estimateTokenCount(messages.map((m) => m.content).join(' ')),
          completionTokens: usage?.completion_tokens || estimateTokenCount(content),
        },
      };
    });
  }

  async generateStream(messages: Message[], options?: GenerateOptions): Promise<AsyncIterable<LLMStreamChunk>> {
    const model = this.getModelName(options);
    const openaiInstance = this.openai;
    const temperature = options?.temperature ?? 0.7;

    // We fetch the stream creation with retry logic
    const stream = await retryWithBackoff(async () => {
      return openaiInstance.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature,
        stream: true,
        stream_options: { include_usage: true }, // Crucial for getting token usage at the end
      });
    });

    // Create custom async generator to yield unified chunks
    const generator = async function* (): AsyncGenerator<LLMStreamChunk> {
      let promptTokens = estimateTokenCount(messages.map((m) => m.content).join(' '));
      let completionTokens = 0;
      let accumulatedContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        accumulatedContent += delta;

        if (chunk.usage) {
          // Final chunk with token usage stats
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }

        yield {
          delta,
          done: false,
        };
      }

      // Estimate completion tokens if not provided by Groq
      if (completionTokens === 0) {
        completionTokens = estimateTokenCount(accumulatedContent);
      }

      yield {
        delta: '',
        done: true,
        usage: {
          promptTokens,
          completionTokens,
        },
        provider: 'groq',
        model,
      };
    };

    return generator();
  }
}

// 2. Gemini Adapter
export class GeminiClient implements ILLMClient {
  private ai: GoogleGenAI;
  private defaultModel = 'gemini-2.0-flash';

  constructor() {
    if (!config.geminiApiKey) {
      console.warn('WARNING: GEMINI_API_KEY is not set.');
    }
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey || 'dummy-gemini-key' });
  }

  getModelName(options?: GenerateOptions): string {
    return options?.model || this.defaultModel;
  }

  private mapMessagesForGemini(messages: Message[]): any[] {
    // Gemini roles: 'user' or 'model'. It expects alternating structure.
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  async generateText(messages: Message[], options?: GenerateOptions): Promise<LLMResponse> {
    const modelName = this.getModelName(options);
    return retryWithBackoff(async () => {
      // Calculate token count for input
      const geminiMessages = this.mapMessagesForGemini(messages);

      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: geminiMessages,
        config: {
          temperature: options?.temperature ?? 0.7,
        }
      });

      const content = response.text || '';

      // Calculate token usage
      let promptTokens = 0;
      try {
        const countRes = await this.ai.models.countTokens({
          model: modelName,
          contents: geminiMessages,
        });
        promptTokens = countRes.totalTokens ?? estimateTokenCount(messages.map((m) => m.content).join(' '));
      } catch {
        promptTokens = estimateTokenCount(messages.map((m) => m.content).join(' '));
      }

      const completionTokens = response.usageMetadata?.candidatesTokenCount || estimateTokenCount(content);

      return {
        content,
        provider: 'gemini',
        model: modelName,
        usage: {
          promptTokens,
          completionTokens,
        },
      };
    });
  }

  async generateStream(messages: Message[], options?: GenerateOptions): Promise<AsyncIterable<LLMStreamChunk>> {
    const modelName = this.getModelName(options);
    const geminiMessages = this.mapMessagesForGemini(messages);
    const aiInstance = this.ai;
    const temperature = options?.temperature ?? 0.7;

    const responseStream = await retryWithBackoff(async () => {
      return aiInstance.models.generateContentStream({
        model: modelName,
        contents: geminiMessages,
        config: {
          temperature,
        }
      });
    });

    const generator = async function* (): AsyncGenerator<LLMStreamChunk> {
      let accumulatedContent = '';
      let promptTokens = 0;
      let completionTokens = 0;

      // Prefetch prompt tokens count
      try {
        const countRes = await aiInstance.models.countTokens({
          model: modelName,
          contents: geminiMessages,
        });
        promptTokens = countRes.totalTokens ?? estimateTokenCount(messages.map((m) => m.content).join(' '));
      } catch {
        promptTokens = estimateTokenCount(messages.map((m) => m.content).join(' '));
      }

      for await (const chunk of responseStream) {
        const delta = chunk.text || '';
        accumulatedContent += delta;
        yield {
          delta,
          done: false,
        };
      }

      completionTokens = estimateTokenCount(accumulatedContent);

      yield {
        delta: '',
        done: true,
        usage: {
          promptTokens,
          completionTokens,
        },
        provider: 'gemini',
        model: modelName,
      };
    };

    return generator();
  }
}

// Unified Factory with Fallback capability
export function createRawLLMClient(provider: 'groq' | 'gemini'): ILLMClient {
  if (provider === 'groq') {
    return new GroqClient();
  } else if (provider === 'gemini') {
    return new GeminiClient();
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

// Wrapper Client with fallback from Groq to Gemini in case of rate limit (429)
export class FallbackLLMClient implements ILLMClient {
  private primaryProvider: 'groq' | 'gemini';
  private primaryClient: ILLMClient;
  private fallbackClient: ILLMClient;

  constructor(provider: 'groq' | 'gemini') {
    this.primaryProvider = provider;
    this.primaryClient = createRawLLMClient(provider);
    this.fallbackClient = createRawLLMClient(provider === 'groq' ? 'gemini' : 'groq');
  }

  getModelName(options?: GenerateOptions): string {
    return this.primaryClient.getModelName(options);
  }

  async generateText(messages: Message[], options?: GenerateOptions): Promise<LLMResponse> {
    try {
      return await this.primaryClient.generateText(messages, options);
    } catch (error: any) {
      const statusCode = error.status || error.statusCode || error.response?.status;
      if (statusCode === 429) {
        const fallbackProvider = this.primaryProvider === 'groq' ? 'gemini' : 'groq';
        const fallbackModel = fallbackProvider === 'gemini' ? 'gemini-2.0-flash' : 'llama-3.3-70b-versatile';
        console.warn(`[LLMClient] ${this.primaryProvider} rate limited (429). Falling back to ${fallbackProvider}.`);

        const fallbackOptions = { ...options, model: fallbackModel };
        const response = await this.fallbackClient.generateText(messages, fallbackOptions);

        return {
          ...response,
          provider: fallbackProvider,
          model: fallbackModel
        };
      }
      throw error;
    }
  }

  async generateStream(messages: Message[], options?: GenerateOptions): Promise<AsyncIterable<LLMStreamChunk>> {
    try {
      return await this.primaryClient.generateStream(messages, options);
    } catch (error: any) {
      const statusCode = error.status || error.statusCode || error.response?.status;
      if (statusCode === 429) {
        const fallbackProvider = this.primaryProvider === 'groq' ? 'gemini' : 'groq';
        const fallbackModel = fallbackProvider === 'gemini' ? 'gemini-2.0-flash' : 'llama-3.3-70b-versatile';
        console.warn(`[LLMClient] ${this.primaryProvider} rate limited (429) on stream start. Falling back to ${fallbackProvider}.`);

        const fallbackOptions = { ...options, model: fallbackModel };
        const stream = await this.fallbackClient.generateStream(messages, fallbackOptions);

        // Wrap stream to tag it with fallback provider metadata on completion
        const generator = async function* (): AsyncGenerator<LLMStreamChunk> {
          for await (const chunk of stream) {
            if (chunk.done) {
              yield {
                ...chunk,
                provider: fallbackProvider,
                model: fallbackModel,
              };
            } else {
              yield chunk;
            }
          }
        };
        return generator();
      }
      throw error;
    }
  }
}

export function createLLMClient(provider: 'groq' | 'gemini'): ILLMClient {
  return new FallbackLLMClient(provider);
}
