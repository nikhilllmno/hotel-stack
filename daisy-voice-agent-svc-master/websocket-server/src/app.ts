import cors from 'cors';
import express from 'express';
import 'express-async-errors';
import path from 'path';
import config from './config';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContextMiddleware } from './middleware/requestContextMiddleware';
import { requestLogger } from './middleware/requestLogger';
import router from './router';

// Built here rather than in server.ts so tests can run the real app without starting the server.
const app = express();

// Apply CORS middleware first to ensure proper headers
app.use(cors());

// Body parsing middlewares - must come before routes
// Skip JSON parsing for webhook routes to allow raw body processing for Stripe signature verification
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/webhook/stripe')) {
    next();
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: false }));

// Request context middleware - establishes AsyncLocalStorage context with requestId
app.use(requestContextMiddleware);

// Logging middleware - after parsing but before routes
app.use(requestLogger);

// Guest-facing widgets that hotels embed on their own websites (e.g. /widgets/rate-calendar.js).
// build copies src/static into dist/static, so this resolves in both ts-node and dist.
// Kept short so a widget fix reaches hotel websites within minutes of a deploy.
const widgetsDir = path.join(__dirname, 'static', 'widgets');
app.use('/widgets', express.static(widgetsDir, { maxAge: '10m' }));
// A shareable rates page per hotel, e.g. /rates/19102, for hotels that can't embed the widget.
app.get('/rates/:businessId', (_req, res) => {
  res.sendFile(path.join(widgetsDir, 'rates.html'), { maxAge: '10m' });
});

// Finally, mount the centralized router for all application routes
app.use('/', router);

// Health check endpoint for monitoring and service availability
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'daisy-voice-agent-service',
  });
});

/**
 * @deprecated This endpoint is deprecated and will be removed in a future version.
 * Please use the new health check endpoint instead.
 */
app.get('/public-url', (req, res) => {
  res.json({ publicUrl: config.PUBLIC_URL });
});

// 404 handler — must come after all routes
app.use(notFoundHandler);

// Global error handler — must be last middleware (4-param signature)
app.use(globalErrorHandler);

export default app;
