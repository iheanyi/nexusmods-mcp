export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400,
    public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

// Never send arbitrary SDK/HTTP error messages back to a model: they may contain credentials.
export function publicError(error: unknown) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, ...error.details };
  }
  return { code: 'operation_failed', message: 'Operation failed. Check Vortex for details.' };
}
