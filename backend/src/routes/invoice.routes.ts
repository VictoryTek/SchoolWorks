import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/invoice.controller';
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  UpdateInvoiceStatusSchema,
  RecordPaymentSchema,
  ListInvoicesQuerySchema,
} from '../validators/invoice.validators';
import type { AuthRequest } from '../middleware/auth';

// Rate limit invoice sends to 10 per hour per authenticated user
const sendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max:      10,
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    return authReq.user?.id ?? 'anonymous';
  },
  message:        { error: 'RATE_LIMITED', message: 'Too many invoice send requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { keyGeneratorIpFallback: false },
});

const router = Router();
router.use(authenticate);

// IMPORTANT: specific sub-resource paths declared BEFORE the bare /:id route

// Read — INVOICING 1
router.get(
  '/',
  requireDeviceManagementAccess(),
  validateRequest(ListInvoicesQuerySchema, 'query'),
  controller.list,
);

// Declare /:id/pdf, /:id/send, /:id/resend, /:id/payments BEFORE /:id
router.get(
  '/:id/pdf',
  requireDeviceManagementAccess(),
  controller.getPdf,
);

router.post(
  '/:id/send',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  sendRateLimiter,
  controller.send,
);

router.post(
  '/:id/resend',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  sendRateLimiter,
  controller.resend,
);

router.post(
  '/:id/payments',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(RecordPaymentSchema),
  controller.recordPayment,
);

router.get(
  '/:id',
  requireDeviceManagementAccess(),
  controller.getById,
);

// Write — INVOICING 2 + CSRF
router.post(
  '/',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CreateInvoiceSchema),
  controller.create,
);

router.put(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateInvoiceSchema),
  controller.update,
);

router.patch(
  '/:id/status',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateInvoiceStatusSchema),
  controller.updateStatus,
);

// Admin — INVOICING 3 + CSRF
router.delete(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  controller.waive,
);

export default router;
