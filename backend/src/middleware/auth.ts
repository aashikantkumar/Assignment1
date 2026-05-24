import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header. Expected Format: Bearer <token>',
    });
  }

  const token = authHeader.split(' ')[1];
  
  if (token !== config.ingestApiKey) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid API key provided.',
    });
  }

  next();
}
