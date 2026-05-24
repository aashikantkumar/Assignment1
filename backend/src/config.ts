import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory or parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: process.env.PORT || '4000',
  nodeEnv: process.env.NODE_ENV || 'development',
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/llm_logging?sslmode=disable',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  ingestApiKey: process.env.INGEST_API_KEY || 'default-secret-key-1234567890123456',
};

// Log keys config status (without displaying sensitive values)
console.log('--- Config Status ---');
console.log(`Port: ${config.port}`);
console.log(`Node Env: ${config.nodeEnv}`);
console.log(`Groq API Key: ${config.groqApiKey ? 'Configured' : 'MISSING'}`);
console.log(`Gemini API Key: ${config.geminiApiKey ? 'Configured' : 'MISSING'}`);
console.log(`Database URL: ${config.databaseUrl ? 'Configured' : 'MISSING'}`);
console.log(`Redis URL: ${config.redisUrl ? 'Configured' : 'MISSING'}`);
console.log(`Upstash Redis REST: ${config.upstashRedisRestUrl ? 'Configured' : 'MISSING'}`);
console.log(`Ingest API Key: ${config.ingestApiKey ? 'Configured' : 'MISSING'}`);
console.log('---------------------');
