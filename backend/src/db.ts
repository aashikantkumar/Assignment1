import { Pool } from 'pg';
import { config } from './config';

const sslConfig = config.databaseUrl.includes('sslmode=require') || config.databaseUrl.includes('neon.tech')
  ? { rejectUnauthorized: false }
  : undefined;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslConfig,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function runMigrations() {
  console.log('Running database migrations...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable uuid-ossp extension if available (Postgres usually has it by default or doesn't need it for gen_random_uuid in pg13+)
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Create conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        provider VARCHAR(50) NOT NULL,
        model VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP DEFAULT NOW(),
        message_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0
      )
    `);

    // Create messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create inference_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inference_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID UNIQUE NOT NULL,
        session_id UUID NOT NULL,
        provider VARCHAR(50) NOT NULL,
        model VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        latency_ms INTEGER NOT NULL,
        ttft_ms INTEGER,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        input_preview VARCHAR(200),
        output_preview VARCHAR(200),
        pii_detected BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_session_created ON inference_logs(session_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_provider_created ON inference_logs(provider, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC)
    `);

    await client.query('COMMIT');
    console.log('Database migrations completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database migrations failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
