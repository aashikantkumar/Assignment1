import { createClient, RedisClientType } from 'redis';
import { config } from './config';

interface IRedisClient {
  lPush(key: string, value: string): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lTrim(key: string, start: number, stop: number): Promise<string>;
  rPop(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
  get(key: string): Promise<string | null>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// 1. Upstash REST Client Implementation
class UpstashRestClient implements IRedisClient {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    // Remove trailing slash if present
    this.url = url.endsWith('/') ? url.slice(0, -1) : url;
    this.token = token;
  }

  private async executeCommand<T>(args: any[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upstash Redis REST error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { result: T; error?: string };
    if (data.error) {
      throw new Error(`Upstash Redis command error: ${data.error}`);
    }
    return data.result;
  }

  async lPush(key: string, value: string): Promise<number> {
    return this.executeCommand<number>(['LPUSH', key, value]);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.executeCommand<string[]>(['LRANGE', key, start, stop]);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    return this.executeCommand<string>(['LTRIM', key, start, stop]);
  }

  async set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null> {
    const args: any[] = ['SET', key, value];
    if (options?.EX) {
      args.push('EX', options.EX);
    }
    if (options?.NX) {
      args.push('NX');
    }
    const res = await this.executeCommand<string | null>(args);
    // Redis returns 'OK' for success, null for NX failure
    return res;
  }

  async rPop(key: string): Promise<string | null> {
    return this.executeCommand<string | null>(['RPOP', key]);
  }

  async get(key: string): Promise<string | null> {
    return this.executeCommand<string | null>(['GET', key]);
  }

  async connect(): Promise<void> {
    console.log('Using Upstash Redis REST Client (stateless)');
  }

  async disconnect(): Promise<void> {
    // No-op for HTTP-based client
  }
}

// 2. Standard TCP Redis Client Implementation
class StandardRedisClient implements IRedisClient {
  private client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', (err) => console.error('Redis Client Error:', err));
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      console.log('Connected to standard Redis server via TCP.');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  async lPush(key: string, value: string): Promise<number> {
    await this.connect();
    return this.client.lPush(key, value);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    await this.connect();
    return this.client.lRange(key, start, stop);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    await this.connect();
    return this.client.lTrim(key, start, stop);
  }

  async set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null> {
    await this.connect();
    const redisOptions: any = {};
    if (options?.EX) redisOptions.EX = options.EX;
    if (options?.NX) redisOptions.NX = true;
    
    return this.client.set(key, value, redisOptions);
  }

  async rPop(key: string): Promise<string | null> {
    await this.connect();
    return this.client.rPop(key);
  }

  async get(key: string): Promise<string | null> {
    await this.connect();
    return this.client.get(key);
  }
}

// Factory instantiation
export const redis: IRedisClient = config.upstashRedisRestUrl && config.upstashRedisRestToken
  ? new UpstashRestClient(config.upstashRedisRestUrl, config.upstashRedisRestToken)
  : new StandardRedisClient(config.redisUrl);
