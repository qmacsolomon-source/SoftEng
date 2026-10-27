/**
 * Signed-URL helper. Site plans, progress photos and attachments live in private
 * buckets, so the browser can only read them through a short-lived signed URL
 * that this endpoint mints with the signed-in user's own token.
 */
import { Router } from 'express';
import { asyncHandler, badRequest, ok } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { signedUrl } from '../middleware/upload.js';

const router = Router();

const ALLOWED_BUCKETS = ['site-plans', 'progress-photos', 'attachments'];

router.get(
  '/signed-url',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bucket = String(req.query.bucket || '');
    const path = String(req.query.path || '');

    if (!ALLOWED_BUCKETS.includes(bucket)) {
      throw badRequest('That file location is not recognised.');
    }
    if (!path || path.includes('..')) {
      throw badRequest('A valid file path is required.');
    }

    const url = await signedUrl(req.db, bucket, path, 3600);
    if (!url) throw badRequest('That file could not be opened. It may have been removed.');

    return ok(res, { url, expires_in: 3600 });
  }),
);

export default router;
