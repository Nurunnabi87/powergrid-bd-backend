import multer from 'multer';
import AppError from '../errors/AppError';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Memory storage: the buffer is piped to Cloudinary and never touches the
 * filesystem, which matters on serverless where the disk is read-only.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new AppError(400, 'Only JPEG, PNG or WebP images are allowed'));
    }
    cb(null, true);
  },
});

export const singleImage = (field: string) => upload.single(field);
