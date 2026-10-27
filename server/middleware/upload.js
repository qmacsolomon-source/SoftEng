/**
 * File upload handling.
 *
 * Multer keeps the file in memory, we validate type + size ourselves, then push
 * it into Supabase Storage with the signed-in user's token so the storage
 * policies apply. Files are stored under "<user id>/<timestamp>-<name>".
 */
import multer from 'multer';
import config from '../config.js';
import { badRequest } from '../lib/http.js';

const MB = 1024 * 1024;

export const MIME_GROUPS = {
  sitePlan: ['application/pdf', 'image/jpeg', 'image/png'],
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  attachment: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 3,
    fields: 60,
    fieldSize: 1 * MB,
  },
});

export function assertFileAllowed(file, allowedMimes, label = 'File') {
  if (!file) return;
  if (!allowedMimes.includes(file.mimetype)) {
    throw badRequest(
      `${label} must be one of: ${allowedMimes.map(prettyMime).join(', ')}. `
      + `The file you chose is ${prettyMime(file.mimetype)}.`,
    );
  }
  if (file.size > config.maxUploadBytes) {
    throw badRequest(`${label} is larger than the ${Math.round(config.maxUploadBytes / MB)} MB limit.`);
  }
}

export function prettyMime(mime) {
  const map = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  };
  return map[mime] || mime;
}

/** Removes anything that is not safe in an object key. */
export function safeFileName(name) {
  const base = String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-120);
  return base || 'file';
}

/**
 * Uploads a buffer and returns the storage object path.
 * @returns {Promise<string|null>} null when no file was supplied.
 */
export async function storeUpload(db, bucket, userId, file) {
  if (!file) return null;

  const objectPath = `${userId}/${Date.now()}-${safeFileName(file.originalname)}`;
  const { error } = await db.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    throw badRequest(`We could not save ${file.originalname}: ${error.message}`);
  }
  return objectPath;
}

/** Creates a short-lived signed URL for a private object. */
export async function signedUrl(db, bucket, objectPath, expiresInSeconds = 3600) {
  if (!objectPath) return null;
  const { data, error } = await db.storage.from(bucket).createSignedUrl(objectPath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
