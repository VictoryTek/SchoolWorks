import app from './app';
import { cronJobsService } from './services/cronJobs.service';
import { schedulerService } from './services/scheduler.service';
import { startEmailQueueWorker, stopEmailQueueWorker } from './services/emailQueue.service';
import { loggers } from './lib/logger';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
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

function gracefulShutdown(signal: string) {
  loggers.server.info(`${signal} received: shutting down gracefully`);
  cronJobsService.stop();
  schedulerService.stop();
  stopEmailQueueWorker();
  server.close(() => {
    loggers.server.info('HTTP server closed');
    process.exit(0);
  });
  // Force exit if graceful close stalls
  setTimeout(() => {
    loggers.server.warn('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

export default server;