import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ReceivedInvitation {
  id: string;
  inviter_name: string;
  inviter_id: string;
  inviter_public_identifier: string;
  inviter_description: string | null;
  inviter_picture_url: string | null;
  invitation_text: string | null;
  date: string;
  parsed_datetime: string | null;
  shared_secret: string;
  provider: string;
}

export function useInvitationsReceived(organizationId: string | null) {
  const [invitations, setInvitations] = useState<ReceivedInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const invoke = useCallback(async (action: string, params: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Session expirée');
      return null;
    }
    const { data, error } = await supabase.functions.invoke('unipile-accounts', {
      body: { action, organization_id: organizationId, ...params },
    });
    if (error) {
      try {
        const ctx = (error as any).context;
        if (ctx instanceof Response) {
          const body = await ctx.json();
          return { success: false, error: body.error || error.message };
        }
      } catch {}
      return { success: false, error: error.message };
    }
    return data;
  }, [organizationId]);

  const fetchInvitations = useCallback(async (accountId: string, pageCursor?: string) => {
    setLoading(true);
    try {
      const res = await invoke('list_invitations_received', {
        account_id: accountId,
        limit: 20,
        cursor: pageCursor,
      });
      if (res?.success) {
        if (pageCursor) {
          setInvitations(prev => [...prev, ...(res.invitations || [])]);
        } else {
          setInvitations(res.invitations || []);
        }
        setCursor(res.cursor || null);
      } else {
        toast.error(res?.error || 'Erreur lors du chargement des invitations');
      }
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  const acceptInvitation = useCallback(async (invitation: ReceivedInvitation, accountId: string): Promise<boolean> => {
    setIsProcessing(true);
    try {
      const res = await invoke('handle_invitation_received', {
        account_id: accountId,
        invitation_id: invitation.id,
        invitation_action: 'accept',
        shared_secret: invitation.shared_secret,
        provider: invitation.provider,
      });
      if (res?.success) {
        setInvitations(prev => prev.filter(i => i.id !== invitation.id));
        toast.success(`Invitation de ${invitation.inviter_name} acceptée`);
        return true;
      }
      toast.error(res?.error || 'Erreur');
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [invoke]);

  const declineInvitation = useCallback(async (invitation: ReceivedInvitation, accountId: string): Promise<boolean> => {
    setIsProcessing(true);
    try {
      const res = await invoke('handle_invitation_received', {
        account_id: accountId,
        invitation_id: invitation.id,
        invitation_action: 'decline',
        shared_secret: invitation.shared_secret,
        provider: invitation.provider,
      });
      if (res?.success) {
        setInvitations(prev => prev.filter(i => i.id !== invitation.id));
        toast.success(`Invitation de ${invitation.inviter_name} déclinée`);
        return true;
      }
      toast.error(res?.error || 'Erreur');
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [invoke]);

  const bulkHandle = useCallback(async (
    selectedInvitations: ReceivedInvitation[],
    accountId: string,
    action: 'accept' | 'decline',
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ succeeded: number; failed: number }> => {
    setIsProcessing(true);
    try {
      const res = await invoke('bulk_handle_invitations', {
        account_id: accountId,
        invitations: selectedInvitations.map(inv => ({
          invitation_id: inv.id,
          shared_secret: inv.shared_secret,
          action,
        })),
      });
      if (res?.success && Array.isArray(res.results)) {
        const succeeded = res.results.filter((r: any) => !r.error).length;
        const failed = res.results.filter((r: any) => r.error).length;
        const processedIds = new Set(
          res.results.filter((r: any) => !r.error).map((r: any) => r.invitation_id)
        );
        setInvitations(prev => prev.filter(i => !processedIds.has(i.id)));
        onProgress?.(succeeded, selectedInvitations.length);
        toast.success(`${succeeded} invitation(s) ${action === 'accept' ? 'acceptée(s)' : 'déclinée(s)'}${failed > 0 ? `, ${failed} erreur(s)` : ''}`);
        return { succeeded, failed };
      }
      toast.error(res?.error || 'Erreur batch');
      return { succeeded: 0, failed: selectedInvitations.length };
    } finally {
      setIsProcessing(false);
    }
  }, [invoke]);

  const bulkAccept = useCallback((selectedInvitations: ReceivedInvitation[], accountId: string, onProgress?: (p: number, t: number) => void) =>
    bulkHandle(selectedInvitations, accountId, 'accept', onProgress),
  [bulkHandle]);

  const bulkDecline = useCallback((selectedInvitations: ReceivedInvitation[], accountId: string, onProgress?: (p: number, t: number) => void) =>
    bulkHandle(selectedInvitations, accountId, 'decline', onProgress),
  [bulkHandle]);

  return {
    invitations,
    loading,
    cursor,
    fetchInvitations,
    acceptInvitation,
    declineInvitation,
    bulkAccept,
    bulkDecline,
    isProcessing,
  };
}
