/**
 * Driver License Routes
 * Mounted at /api/driver-licenses
 *
 * NOTE: Drivers (level 1) are intentionally excluded - admin/transport staff only.
 * All routes require TRANSPORTATION module level >= 2 (secretary, director, admin).
 */
import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync } from 'fs';
import { authenticate } from '../middleware/auth';
import { loggers } from '../lib/logger';
import { validateFileContentType } from '../utils/fileMagic';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import * as controller from '../controllers/driverLicense.controller';

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'driver-licenses');

// Ensure upload directory exists at startup (best-effort — directory is pre-created in Dockerfile)
try {
  mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err: unknown) {
  // Log but do not crash — the directory should already exist from the Docker image build
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== 'EEXIST') {
    loggers.driverLicense.error('Could not create driver-license upload dir', { error: (err as Error).message });
  }
}

const licenseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, WebP images and PDF files are allowed'));
    }
  },
});

const router = Router();

// NOTE: Drivers (level 1) are intentionally excluded - admin/transport staff only
// All routes require TRANSPORTATION level >= 2

// POST /api/driver-licenses/upload
router.post(
  '/upload',
  authenticate,
  validateCsrfToken,
  requireModule('TRANSPORTATION', 2),
  licenseUpload.single('licenseImage'),
  validateFileContentType(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']),
  controller.uploadLicense,
);

// GET /api/driver-licenses
router.get(
  '/',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getAll,
);

// GET /api/driver-licenses/user/:userId
router.get(
  '/user/:userId',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getByUserId,
);

// GET /api/driver-licenses/:id/image — serves document behind auth (NOT a static URL)
router.get(
  '/:id/image',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getLicenseImage,
);

// GET /api/driver-licenses/:id
router.get(
  '/:id',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getById,
);

// PUT /api/driver-licenses/:id
router.put(
  '/:id',
  authenticate,
  validateCsrfToken,
  requireModule('TRANSPORTATION', 2),
  controller.updateLicense,
);

// DELETE /api/driver-licenses/:id  — soft deactivate (level 2+)
router.delete(
  '/:id',
  authenticate,
  validateCsrfToken,
  requireModule('TRANSPORTATION', 2),
  controller.deactivateLicense,
);

// DELETE /api/driver-licenses/:id/hard  — permanent hard delete (level 3+, admin)
router.delete(
  '/:id/hard',
  authenticate,
  validateCsrfToken,
  requireModule('TRANSPORTATION', 3),
  controller.deleteLicense,
);

export default router;
