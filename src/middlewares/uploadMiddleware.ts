import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 20;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error('INVALID_FILE_TYPE'));
};

export const propertyPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILE_COUNT,
  },
  fileFilter,
});

export const propertyPhotoUploadHandler = propertyPhotoUpload.array(
  'photos',
  MAX_FILE_COUNT,
);
