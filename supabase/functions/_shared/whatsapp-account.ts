/** Safe projection of a v1 WhatsApp account. Never return connection credentials. */
export interface WhatsAppAccountView {
  id: string;
  name: string | null;
  identifier: string | null;
  status: string;
  type: 'WHATSAPP';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function projectWhatsAppAccount(value: unknown): WhatsAppAccountView | null {
  const account = record(value);
  if (account.type !== 'WHATSAPP' || typeof account.id !== 'string' || !account.id) return null;
  const im = record(record(account.connection_params).im);
  const sources = Array.isArray(account.sources)
    ? account.sources : Object.values(record(account.sources));
  const statuses = sources.map(source => record(source).status).filter((status): status is string => typeof status === 'string');
  return {
    id: account.id,
    name: typeof account.name === 'string' ? account.name : null,
    identifier: typeof im.phone_number === 'string' ? im.phone_number : null,
    status: statuses.includes('OK') ? 'OK' : statuses[0] ?? 'UNKNOWN',
    type: 'WHATSAPP',
  };
}

/** Hosted auth returns only a browser URL; credentials stay on the server. */
export function validHostedAuthUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

/** Return only to this app's connection settings, including its own previews. */
export function whatsappReturnUrl(value: unknown, appUrl?: string, allowedOrigins = ''): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const origins = new Set(['https://konekt-app-navy.vercel.app', ...(appUrl ? [new URL(appUrl).origin] : []), ...allowedOrigins.split(',').filter(Boolean).map(origin => new URL(origin.trim()).origin)]);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const preview = /^konekt-[a-z0-9-]+-lgarilhe-konektfrs-projects\.vercel\.app$/i.test(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || (!local && !origins.has(url.origin) && !preview)) return null;
    return new URL('/settings/account/connections#whatsapp', url.origin).toString();
  } catch { return null; }
}
