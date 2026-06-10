/**
 * Winston Logger Configuration
 * Provides structured, performant, and secure logging for the Tech-V2 backend
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Custom format for structured logging (production)
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  winston.format.json()
);

// Human-readable format for development
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    const meta = metadata.metadata || metadata;
    const metaStr = Object.keys(meta).length 
      ? '\n' + JSON.stringify(meta, null, 2) 
      : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Determine log level from environment
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

// Determine if we should log to files
const shouldLogToFile = (): boolean => {
  if (process.env.LOG_TO_FILE === 'true') return true;
  if (process.env.LOG_TO_FILE === 'false') return false;
  // Default: file logging in production, optional in dev
  return process.env.NODE_ENV === 'production';
};

// Create transports based on environment
const createTransports = (): winston.transport[] => {
  const transports: winston.transport[] = [];

  // Console transport (always enabled)
  transports.push(
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? structuredFormat : devFormat,
    })
  );

  // File transports (conditional)
  if (shouldLogToFile()) {
    // Error log file (errors only)
    transports.push(
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '10m',
        maxFiles: '14d',
        zippedArchive: true,
        format: structuredFormat,
      })
    );

    // Combined log file (all levels)
    transports.push(
      new DailyRotateFile({
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '14d',
        zippedArchive: true,
        format: structuredFormat,
      })
    );

    // HTTP log file (http level)
    transports.push(
      new DailyRotateFile({
        filename: 'logs/http-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        maxSize: '20m',
        maxFiles: '7d',
        zippedArchive: true,
        format: structuredFormat,
      })
    );
  }

  return transports;
};

// Create exception/rejection handlers
const createExceptionHandlers = (): winston.transport[] => {
  if (!shouldLogToFile()) {
    return [new winston.transports.Console()];
  }

  return [
    new winston.transports.Console(),
    new DailyRotateFile({
      filename: 'logs/exceptions-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ];
};

const createRejectionHandlers = (): winston.transport[] => {
  if (!shouldLogToFile()) {
    return [new winston.transports.Console()];
  }

  return [
    new winston.transports.Console(),
    new DailyRotateFile({
      filename: 'logs/rejections-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ];
};

// Create logger instance
export const logger = winston.createLogger({
  level: getLogLevel(),
  format: process.env.NODE_ENV === 'production' ? structuredFormat : devFormat,
  defaultMeta: { 
    service: 'tech-v2-backend',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: createTransports(),
  exceptionHandlers: createExceptionHandlers(),
  rejectionHandlers: createRejectionHandlers(),
  exitOnError: false, // Don't exit on handled exceptions
});

// Handle logger errors (fallback to console)
logger.on('error', (error) => {
  console.error('[LOGGER ERROR] Winston transport failed:', error);
  // Logger failures should not crash the application
});

// Log logger initialization
if (process.env.NODE_ENV !== 'test') {
  logger.info('Logger initialized', {
    level: getLogLevel(),
    environment: process.env.NODE_ENV || 'development',
    fileLogging: shouldLogToFile(),
  });
}

// Create child loggers with context for different modules
export const createLogger = (context: string) => {
  return logger.child({ context });
};

// Pre-configured loggers for common modules
export const loggers = {
  userSync: createLogger('UserSyncService'),
  auth: createLogger('AuthController'),
  cron: createLogger('CronJobsService'),
  scheduler: createLogger('SchedulerService'),
  http: createLogger('HTTPRequest'),
  db: createLogger('Database'),
  admin: createLogger('AdminRoutes'),
  server: createLogger('Server'),
  error: createLogger('ErrorHandler'),
  config: createLogger('Configuration'),
  roomAssignments: createLogger('UserRoomAssignmentService'),
  locationSync: createLogger('LocationSyncService'),
  assignment: createLogger('AssignmentService'),
  dmRollover: createLogger('DmRolloverService'),
  driverLicense: createLogger('DriverLicenseRoutes'),
  damageIncident: createLogger('DamageIncidentController'),
  email: createLogger('EmailService'),
  fieldTrip: createLogger('FieldTripService'),
  fundingSource: createLogger('FundingSourceService'),
  inventory: createLogger('InventoryService'),
  purchaseOrder: createLogger('PurchaseOrderService'),
  settings: createLogger('SettingsService'),
  transportation: createLogger('TransportationRequestService'),
  user: createLogger('UserController'),
  workOrders: createLogger('WorkOrdersService'),
  accessControl: createLogger('AccessControl'),
};
