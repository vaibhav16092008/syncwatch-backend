import config from '../config/env.js';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevelPriority = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.info;

const formatLog = (level, message, context = {}) => {
  const timestamp = new Date().toISOString();
  const meta = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}]: ${message}${meta}`;
};

export const logger = {
  debug(message, context = {}) {
    if (LOG_LEVELS.debug >= currentLevelPriority) {
      console.debug(formatLog('debug', message, context));
    }
  },
  info(message, context = {}) {
    if (LOG_LEVELS.info >= currentLevelPriority) {
      console.log(formatLog('info', message, context));
    }
  },
  warn(message, context = {}) {
    if (LOG_LEVELS.warn >= currentLevelPriority) {
      console.warn(formatLog('warn', message, context));
    }
  },
  error(message, context = {}) {
    if (LOG_LEVELS.error >= currentLevelPriority) {
      console.error(formatLog('error', message, context));
    }
  }
};

export default logger;
