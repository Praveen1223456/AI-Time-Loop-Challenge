import { AppError } from '../utils/AppError.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} was not found.` },
  });
}

/** Central error handler. Never leaks stack traces or internal messages for unexpected errors. */
export function errorHandler(env) {
  // Express identifies error middleware by its 4-argument signature.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      const error = { code: err.code, message: err.message };
      if (err.details) error.details = err.details;
      return res.status(err.status).json({ success: false, error });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
      });
    }
    // Log without request bodies, headers or secrets.
    if (env.NODE_ENV !== 'test') {
      console.error(`[error] ${req.method} ${req.path}: ${err?.name ?? 'Error'}: ${err?.message}`);
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
    });
  };
}
