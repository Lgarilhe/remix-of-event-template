/** Only audited application errors may expose their message to the product. */
export function projectCandidateActionError(error: unknown, audited = false): { status: number; payload: { error: string; error_code: string } } {
  const detail = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; message?: unknown } : {};
  const actualCode = typeof detail.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(detail.code) ? detail.code : null;
  // The fallback code is public presentation only. It cannot make an unknown SQL/provider error trusted.
  const known = actualCode !== null && (audited || actualCode.startsWith('ACTION_'));
  if (!known) return { status: 503, payload: { error: 'Les actions n’ont pas pu être mises à jour. Actualisez leur état avant de réessayer.', error_code: 'ACTION_UNAVAILABLE' } };
  const status = typeof detail.status === 'number' && Number.isInteger(detail.status) && detail.status >= 400 && detail.status <= 599
    ? detail.status : /FORBIDDEN|DENIED|NOT_OWNED/.test(actualCode) ? 403 : /NOT_FOUND/.test(actualCode) ? 404 : 409;
  const message = typeof detail.message === 'string' ? detail.message : 'Les actions n’ont pas pu être mises à jour. Actualisez leur état avant de réessayer.';
  return { status, payload: { error: message, error_code: actualCode } };
}
