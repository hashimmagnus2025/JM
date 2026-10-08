/**
 * Worker entry point (BullMQ consumers: reminders, penalty accrual, reconciliation, exports, imports).
 * Phase 0 placeholder — queues arrive with the phases that need them (14 reminders, 16 exports, 17 imports).
 */
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
logger.info('worker started (no queues registered yet)');
