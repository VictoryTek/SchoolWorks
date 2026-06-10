import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError, sanitizeFilename } from '../utils/errorHandler';
import * as service from '../services/invoice.service';
import type { z } from 'zod';
import type {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  UpdateInvoiceStatusSchema,
  RecordPaymentSchema,
  ListInvoicesQuerySchema,
} from '../validators/invoice.validators';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query  = req.query as unknown as z.infer<typeof ListInvoicesQuerySchema>;
    const result = await service.getAll(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const invoice = await service.getById(id);
    res.json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data    = req.body as z.infer<typeof CreateInvoiceSchema>;
    const invoice = await service.create(data, req.user!.id);
    res.status(201).json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const data    = req.body as z.infer<typeof UpdateInvoiceSchema>;
    const invoice = await service.update(id, data);
    res.json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const data    = req.body as z.infer<typeof UpdateInvoiceStatusSchema>;
    const invoice = await service.updateStatus(id, data.status, data.notes);
    res.json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export const send = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const invoice = await service.send(id, req.user!.id);
    res.json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export const resend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const invoice = await service.resend(id, req.user!.id);
    res.json(invoice);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Get PDF
// ---------------------------------------------------------------------------

export const getPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id     = req.params['id'] as string;
    const buffer = await service.getPdf(id);
    // Fetch the invoice number for the filename
    const invoice = await service.getById(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(invoice.invoiceNumber)}.pdf"`);
    res.send(buffer);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Record Payment
// ---------------------------------------------------------------------------

export const recordPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id   = req.params['id'] as string;
    const data = req.body as z.infer<typeof RecordPaymentSchema>;
    const result = await service.recordPayment(id, data, req.user!.id);
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Waive (DELETE /:id)
// ---------------------------------------------------------------------------

export const waive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    await service.waive(id, req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
