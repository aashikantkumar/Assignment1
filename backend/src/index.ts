import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import { runMigrations } from './db';
import { setupCronJob, drainQueue } from './cron';
import ingestRouter from './routes/ingest';
import chatRouter from './routes/chat';
import conversationsRouter from './routes/conversations';
import metricsRouter from './routes/metrics';
import { authenticate } from './middleware/auth';

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for simplicity in development and docker deployment
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// Root/Health route
app.get('/health', (req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    providers: ['groq', 'gemini'],
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.use('/ingest', ingestRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/metrics', metricsRouter);

// POST /worker/drain - Expose endpoint to manually trigger Redis queue drain
app.post('/worker/drain', authenticate, async (req: Request, res: Response) => {
  try {
    const stats = await drainQueue();
    return res.status(200).json({
      status: 'success',
      message: 'Queue drained successfully',
      stats,
    });
  } catch (error: any) {
    console.error('[ManualDrain] Worker execution failed:', error.message);
    return res.status(500).json({
      error: 'drain_failed',
      message: error.message || 'Error occurred during queue drain',
    });
  }
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('[GlobalErrorHandler] Unhandled error:', err);
  return res.status(500).json({
    error: 'internal_server_error',
    message: err.message || 'An unexpected error occurred',
  });
});

// Start Server
async function startServer() {
  try {
    // 1. Run migrations
    await runMigrations();

    // 2. Setup Cron worker
    setupCronJob();

    // 3. Listen
    const port = parseInt(config.port, 10);
    app.listen(port, '0.0.0.0', () => {
      console.log(`=========================================`);
      console.log(`Backend Server running on port ${port}`);
      console.log(`Health Check: http://localhost:${port}/health`);
      console.log(`=========================================`);
    });
  } catch (error) {
    console.error('Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
