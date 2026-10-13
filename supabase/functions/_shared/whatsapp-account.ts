import { mapAccountStatus } from './unipile/status.ts';
import { phoneFromName, readableAccountName } from './connection-claim.ts';

/** Safe projection of a WhatsApp account. Never return connection credentials. */
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

/**
 * Projection of a v2 account read from the provider (`provider`, `name`, `status`,
 * `is_locked`). The v2 account has no connection parameters: the phone number is
 * the account name when it is one. The status is the Konekt vocabulary (OK,
 * CREDENTIALS, ERROR, DEGRADED, PARTIAL, LOCKED).
 */
export function projectWhatsAppAccount(value: unknown): WhatsAppAccountView | null {
  const account = record(value);
  if (account.provider !== 'whatsapp' || typeof account.id !== 'string' || !account.id) return null;
  return {
    id: account.id,
    name: readableAccountName(account.name),
    identifier: phoneFromName(account.name),
    status: mapAccountStatus(account.status, account.is_locked === true),
    type: 'WHATSAPP',
  };
}
