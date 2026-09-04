import { v2 as cloudinary } from 'cloudinary';
import config from '../config';
import AppError from '../errors/AppError';

cloudinary.config({
  cloud_name: config.cloudinary.cloud_name,
  api_key: config.cloudinary.api_key,
  api_secret: config.cloudinary.api_secret,
});

export const isUploadEnabled = (): boolean =>
  Boolean(
    config.cloudinary.cloud_name &&
    config.cloudinary.api_key &&
    config.cloudinary.api_secret
  );

/**
 * Streams an in-memory buffer straight to Cloudinary. Multer keeps files in
 * memory rather than on disk because serverless filesystems are ephemeral
 * and read-only outside /tmp.
 */
export const uploadBuffer = (buffer: Buffer, folder: string): Promise<string> => {
  if (!isUploadEnabled()) {
    throw new AppError(
      503,
      'File uploads are not configured on this server (missing Cloudinary credentials)'
    );
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) {
          return reject(
            new AppError(
              502,
              `Image upload failed: ${error?.message ?? 'unknown error'}`
            )
          );
        }
        resolve(result.secure_url);
      }
    );

    stream.end(buffer);
  });
};

export default cloudinary;
