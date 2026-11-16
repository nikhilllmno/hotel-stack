import http from 'http';
import app from './app';
import config from './config';
import { initializeConversationSessionEventHandlers } from './events/conversationSessionEventHandlers';
import { initializePaymentEventHandlers } from './events/paymentEventHandlers';
import { initializeSmsEventHandlers } from './events/smsEventHandlers';
import { initializeWebReservationEventHandlers } from './events/webReservationEventHandlers';
import logger from './utils/logger';
import { validateAllConfig } from './utils/validateConfig';

const server = http.createServer(app);

process.on('unhandledRejection', (reason) => {
  const errorDetails =
    reason instanceof Error
      ? { message: reason.message, stack: reason.stack }
      : { details: reason };
  logger.error('Unhandled promise rejection', { err: errorDetails });
});

process.on('uncaughtException', (err) => {
  const errorDetails =
    err instanceof Error
      ? { message: err.message, stack: err.stack }
      : { details: err };
  logger.error('Uncaught exception — shutting down', { err: errorDetails });

  // Stop accepting new connections and drain in-flight requests before exiting.
  server.close(() => process.exit(1));
  // Force-kill if connections fail to drain within the timeout.
  setTimeout(() => process.exit(1), 5000).unref();
});
server.listen(config.PORT, async () => {
  logger.info(`Server running on ${config.HOST}:${config.PORT}`);

  // Validate configuration at startup
  try {
    validateAllConfig();
  } catch (error) {
    logger.error(
      'Configuration validation failed. Server will continue but some features may not work correctly.',
    );
  }

  // Initialize SMS event handlers for conversation tracking
  initializeSmsEventHandlers();
  // Session activity from ConversationService → SessionService (no circular import)
  initializeConversationSessionEventHandlers();
  // Initialize web reservation event handlers for session creation
  initializeWebReservationEventHandlers();
  // Initialize payment event handlers. Used in scenarios like Shift4 refunds
  initializePaymentEventHandlers();
});
