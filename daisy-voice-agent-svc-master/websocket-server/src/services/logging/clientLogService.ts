import logger from '../../utils/logger';

export type LogLevel = 'error' | 'warn' | 'info';

export interface ClientLogPayload {
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
  /** Additional ad-hoc fields the client may send */
  [key: string]: unknown;
}

export class ClientLogService {
  logError(payload: ClientLogPayload): void {
    const { message, context, ...rest } = payload;
    logger.error(message || 'client-error', {
      ...rest,
      clientContext: context,
      source: 'client',
    });
  }

  logWarn(payload: ClientLogPayload): void {
    const { message, context, ...rest } = payload;
    logger.warn(message || 'client-warn', {
      ...rest,
      clientContext: context,
      source: 'client',
    });
  }

  logInfo(payload: ClientLogPayload): void {
    const { message, context, ...rest } = payload;
    logger.info(message || 'client-info', {
      ...rest,
      clientContext: context,
      source: 'client',
    });
  }
}

export default new ClientLogService();
