import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

export type EmailConnectorProvider = 'gmail' | 'outlook' | 'email';

export interface PersonalEmailConnection {
  id: string;
  emailAccountId: string;
  emailAddress: string | null;
  provider: EmailConnectorProvider;
  accountStatus: string | null;
  connected: boolean;
}

export interface EmailConnectorStatus {
  connection: PersonalEmailConnection | null;
}

export const emailConnectorStatusQueryKey = (
  organizationId?: string | null,
  userId?: string | null,
) => ['assistant-email-connector', organizationId, userId] as const;

export function normalizeEmailProvider(provider?: string | null): EmailConnectorProvider {
  const normalized = provider?.trim().toUpperCase() ?? '';
  if (normalized.includes('GOOGLE') || normalized.includes('GMAIL')) return 'gmail';
  if (
    normalized.includes('MICROSOFT')
    || normalized.includes('OUTLOOK')
    || normalized.includes('EXCHANGE')
    || normalized.includes('OFFICE365')
    || normalized.includes('OFFICE_365')
  ) return 'outlook';
  return 'email';
}

export function isUsableEmailAccountStatus(status?: string | null): boolean {
  if (!status?.trim()) return true;
  const normalized = status.trim().toUpperCase();
  return normalized === 'OK' || normalized === 'CONNECTED';
}

export function useEmailConnectorStatus(
  organizationId?: string | null,
  userId?: string | null,
) {
  return useQuery({
    queryKey: emailConnectorStatusQueryKey(organizationId, userId),
    queryFn: async (): Promise<EmailConnectorStatus> => {
      const { data, error } = await supabase
        .from('member_email_accounts')
        .select('id, email_account_id, email_address, provider, account_status, linked_at')
        .eq('organization_id', organizationId!)
        .eq('user_id', userId!)
        .order('linked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return { connection: null };

      return {
        connection: {
          id: data.id,
          emailAccountId: data.email_account_id,
          emailAddress: data.email_address,
          provider: normalizeEmailProvider(data.provider),
          accountStatus: data.account_status,
          connected: isUsableEmailAccountStatus(data.account_status),
        },
      };
    },
    enabled: Boolean(organizationId && userId),
    staleTime: 30_000,
    retry: 1,
  });
}
