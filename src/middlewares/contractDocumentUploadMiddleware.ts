import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

// Size limit for the signed contract PDF upload. The PRD US-016 allows
// reusing the 10MB photo cap OR making it configurable via CONTRACT_PDF_MAX_BYTES
// (default 15MB). Picked the configurable path — a signed contract with
// embedded digital signature cert chains and multi-page scans frequently
// exceeds 10MB, and a single env var is cheaper than a code change if a
// specific landlord hits the cap. Documented choice in progress.txt.
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const envRaw = process.env.CONTRACT_PDF_MAX_BYTES;
const envParsed = envRaw ? Number(envRaw) : NaN;
export const CONTRACT_PDF_MAX_BYTES =
  Number.isFinite(envParsed) && envParsed > 0 ? envParsed : DEFAULT_MAX_BYTES;

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
    return;
  }
  // Signal a different error message than the photo filter so the
  // errorHandler can emit a PDF-appropriate message while keeping the
  // PRD-required code `INVALID_FILE_TYPE`.
  cb(new Error('INVALID_PDF_FILE_TYPE'));
};

const contractDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CONTRACT_PDF_MAX_BYTES,
    files: 1,
  },
  fileFilter,
});

export const contractDocumentUploadHandler = contractDocumentUpload.single(
  'signedPdf',
);
