import fs from 'fs';
import { Request, Response, NextFunction } from 'express';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

function allowedLabel(mimes: string[]): string {
  const labels = mimes.map((m) => MIME_TO_EXT[m] ?? m).filter(Boolean);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

// Magic byte signatures for allowed upload types
function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: RIFF????WEBP (bytes 0-3 and 8-11)
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  return null;
}

async function readMagicBytes(filePath: string): Promise<Buffer> {
  const buf = Buffer.alloc(12);
  const fd = await fs.promises.open(filePath, 'r');
  try {
    await fd.read(buf, 0, 12, 0);
  } finally {
    await fd.close();
  }
  return buf;
}

async function deleteFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => fs.promises.unlink(f.path).catch(() => undefined)));
}

/**
 * Post-Multer middleware that verifies uploaded file(s)' actual content type
 * by inspecting magic bytes rather than trusting the client-supplied MIME type.
 * Deletes the file(s) and returns 400 if the content does not match the allowed set.
 * Works with both multer.single() (req.file) and multer.array() (req.files).
 */
export function validateFileContentType(allowedMimes: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const files: Express.Multer.File[] = req.file
      ? [req.file]
      : Array.isArray(req.files)
      ? req.files
      : [];

    if (files.length === 0) {
      next();
      return;
    }

    try {
      for (const file of files) {
        const buf = await readMagicBytes(file.path);
        const detected = detectMimeFromBytes(buf);

        if (!detected || !allowedMimes.includes(detected)) {
          await deleteFiles(files);
          res.status(400).json({
            error: `Invalid file type. Only ${allowedLabel(allowedMimes)} files are accepted.`,
          });
          return;
        }
      }

      next();
    } catch {
      await deleteFiles(files);
      res.status(400).json({ error: 'Could not read the uploaded file. Please try again.' });
    }
  };
}
