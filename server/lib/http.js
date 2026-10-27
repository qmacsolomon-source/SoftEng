/**
 * Small HTTP helpers: a typed error class plus an async route wrapper.
 */

export class ApiError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = 'You must sign in to continue.') => new ApiError(401, message);
export const forbidden = (message = 'You do not have permission to do that.') => new ApiError(403, message);
export const notFound = (message = 'The requested record was not found.') => new ApiError(404, message);
export const conflict = (message, details) => new ApiError(409, message, details);
export const serverError = (message = 'Something went wrong on the server.') => new ApiError(500, message);

/** Wraps an async Express handler so rejected promises reach the error middleware. */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Turns a Postgres/Supabase error into a friendly ApiError.
 * Database CHECK constraints are surfaced as 400 with the constraint name,
 * because they mean the client sent something invalid.
 */
export function translateDbError(error) {
  if (!error) return null;
  const code = error.code || '';
  const message = error.message || '';

  if (code === '23505' || /duplicate key/i.test(message)) {
    return conflict('A record with those details already exists.', { constraint: error.constraint });
  }
  if (code === '23503' || /foreign key/i.test(message)) {
    return badRequest('That record references something that no longer exists.', { constraint: error.constraint });
  }
  if (code === '23514' || /violates check constraint/i.test(message)) {
    return badRequest('Some values are not in the allowed range or format.', { constraint: error.constraint });
  }
  if (code === '23502' || /not-null/i.test(message)) {
    return badRequest('A required field was missing.', { constraint: error.constraint });
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return forbidden('Your role does not allow this action.');
  }
  return serverError('A database error occurred.');
}

export function ok(res, data, status = 200) {
  return res.status(status).json({ data });
}

export function created(res, data) {
  return res.status(201).json({ data });
}
