import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import adminRoutes from './routes/admin.routes';
import locationRoutes from './routes/location.routes';
import roomRoutes from './routes/room.routes';
import inventoryRoutes from './routes/inventory.routes';
import assignmentRoutes from './routes/assignment.routes';
import fundingSourceRoutes from './routes/fundingSource.routes';
import referenceDataRoutes from './routes/referenceData.routes';
import purchaseOrderRoutes from './routes/purchaseOrder.routes';
import settingsRoutes from './routes/settings.routes';
import workOrderRoutes from './routes/work-orders.routes';
import userRoomAssignmentRoutes from './routes/userRoomAssignment.routes';
import fieldTripRoutes from './routes/fieldTrip.routes';
import transportationRequestRoutes from './routes/transportationRequest.routes';
import transportationUnitRoutes from './routes/transportationUnit.routes';
import transportationFuelStationRoutes from './routes/transportationFuelStation.routes';
import fuelConsumptionRoutes from './routes/fuelConsumption.routes';
import dotPhysicalRoutes from './routes/dotPhysical.routes';
import driverLicenseRoutes from './routes/driverLicense.routes';
import transportationReportRoutes from './routes/transportationReport.routes';
import transportationSettingsRoutes from './routes/transportationSettings.routes';
import transportationDashboardRoutes from './routes/transportationDashboard.routes';
import workOrderCategoryRoutes from './routes/workOrderCategory.routes';
import deviceAssignmentRoutes from './routes/deviceAssignment.routes';
import deviceCartRoutes from './routes/deviceCart.routes';
import damageIncidentRoutes from './routes/damageIncident.routes';
import repairTicketRoutes from './routes/repairTicket.routes';
import invoiceRoutes from './routes/invoice.routes';
import checkoutReportRoutes from './routes/checkoutReport.routes';
import damageComponentPriceRouter from './routes/damageComponentPrice.routes';
import barcodePdfRoutes from './routes/barcodePdf.routes';
import dmRolloverRoutes from './routes/dmRollover.routes';
import inventoryAuditRoutes from './routes/inventoryAudit.routes';
import { cronJobsService } from './services/cronJobs.service';
import { schedulerService } from './services/scheduler.service';
import { startEmailQueueWorker, stopEmailQueueWorker } from './services/emailQueue.service';
import { provideCsrfToken, getCsrfToken } from './middleware/csrf';
import { logger, loggers } from './lib/logger';
import { requestId, httpLogger } from './middleware/requestLogger';
import path from 'path';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Trust the nginx reverse proxy (required for express-rate-limit to use X-Forwarded-For correctly)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
// CORS_ORIGIN supports comma-separated origins, e.g.: http://localhost:5173,https://your-tunnel.devtunnels.ms
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  // Expose the CSRF token header so the browser lets JS read it cross-origin.
  // Without this, axios sees the header as empty and the in-memory token cache
  // stays null, causing every POST/PUT/DELETE to be rejected with 403.
  exposedHeaders: ['X-CSRF-Token'],
}));

// Rate limiting
// General API limit: 500 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/', limiter);

// Strict auth limit: 20 requests per 15 minutes per IP on login initiation only
// (refresh-token is excluded — legitimate users can refresh many times per session)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parsing middleware (required for CSRF protection)
app.use(cookieParser());

// Request ID and logging middleware
app.use(requestId);
app.use(httpLogger);

// Block direct static access to driver's license images — they must go through the authenticated endpoint
app.use('/uploads/driver-licenses', (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Forbidden' });
});

// Serve other uploaded files statically (damage-incident photos, etc.)
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// CSRF token provider - applies to all routes
// Provides CSRF token in response header and cookie
app.use(provideCsrfToken);

// CSRF token endpoint - allows frontend to explicitly request a token
app.get('/api/csrf-token', getCsrfToken);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
// authLimiter applied only to login + callback — NOT refresh-token (users refresh many times per session)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/callback', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', locationRoutes);
app.use('/api', roomRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', assignmentRoutes);
app.use('/api/funding-sources', fundingSourceRoutes);
app.use('/api', referenceDataRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/work-orders', workOrderRoutes);
app.use('/api', userRoomAssignmentRoutes);
app.use('/api/field-trips', fieldTripRoutes);
app.use('/api/transportation-requests', transportationRequestRoutes);
app.use('/api/transportation-units', transportationUnitRoutes);
app.use('/api/transportation/fuel-stations', transportationFuelStationRoutes);
app.use('/api/fuel-entries', fuelConsumptionRoutes);
app.use('/api/dot-physicals', dotPhysicalRoutes);
app.use('/api/driver-licenses', driverLicenseRoutes);
app.use('/api/transportation/reports', transportationReportRoutes);
app.use('/api/transportation/settings', transportationSettingsRoutes);
app.use('/api/transportation/dashboard', transportationDashboardRoutes);
app.use('/api/work-order-categories', workOrderCategoryRoutes);
app.use('/api/device-assignments', deviceAssignmentRoutes);
app.use('/api/device-carts', deviceCartRoutes);
app.use('/api/damage-incidents', damageIncidentRoutes);
app.use('/api/repair-tickets', repairTicketRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/checkout-reports', checkoutReportRoutes);
app.use('/api/damage-component-prices', damageComponentPriceRouter);
app.use('/api/device-barcodes', barcodePdfRoutes);
app.use('/api/device-management/rollover', dmRolloverRoutes);
app.use('/api', inventoryAuditRoutes);

// API info endpoint
app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'Tech Department Management API v2',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      users: '/api/users/*',
      locations: '/api/locations/*',
      equipment: '/api/equipment/*',
      purchaseOrders: '/api/purchase-orders/*',
      maintenance: '/api/maintenance/*',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  loggers.error.error('Global error handler', {
    error: {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      name: err.name,
    },
    requestId: req.id,
    url: req.url,
    method: req.method,
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// Start server
app.listen(PORT, () => {
  loggers.server.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    healthCheck: `http://localhost:${PORT}/health`,
  });
  
  // Start background schedulers
  schedulerService.start().catch((err) => {
    loggers.server.error('SchedulerService startup failed', { error: err });
  });

  // Start email queue worker
  startEmailQueueWorker().catch((err) => {
    loggers.server.error('Email queue worker startup failed', { error: err });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  loggers.server.info('SIGTERM signal received: closing HTTP server');
  cronJobsService.stop();
  schedulerService.stop();
  stopEmailQueueWorker();
  process.exit(0);
});

process.on('SIGINT', () => {
  loggers.server.info('SIGINT signal received: closing HTTP server');
  cronJobsService.stop();
  schedulerService.stop();
  stopEmailQueueWorker();
  process.exit(0);
});

export default app;
