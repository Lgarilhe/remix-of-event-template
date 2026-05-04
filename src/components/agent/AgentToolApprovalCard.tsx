/**
 * AgentToolApprovalCard — Bandeau d'approbation des actions proposées par l'agent IA.
 *
 * Sprint 1 (RAG_AGENT_AUDIT.md §8) — pattern human-in-the-loop.
 *
 * S'affiche quand l'agent a appelé un tool mutation et créé une row
 * agent_tool_executions avec status='proposed'. L'user voit le summary
 * du dry-run + warning éventuel + boutons Approuver / Rejeter.
 *
 * Realtime via Supabase channel : si l'agent crée une nouvelle proposition
 * pendant que l'user lit le chat, le bandeau apparaît automatiquement.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface ToolExecutionRow {
  id: string;
  tool_name: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed' | 'auto_executed';
  params: Record<string, unknown>;
  dry_run_result: {
    summary?: string;
    details?: Record<string, unknown>;
    warning?: string;
  } | null;
  proposed_at: string;
}

interface AgentToolApprovalCardProps {
  conversationId: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  update_candidate_stage: 'Modifier le stade candidat',
  add_to_shortlist: 'Ajouter à la shortlist',
  draft_outreach_message: 'Rédiger un message d\'approche',
  create_mission: 'Créer une mission',
  enroll_in_sequence: 'Enrôler dans une séquence',
  schedule_interview: 'Planifier un entretien',
};

export const AgentToolApprovalCard: React.FC<AgentToolApprovalCardProps> = ({ conversationId }) => {
  const [pending, setPending] = useState<ToolExecutionRow[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, 'approve' | 'reject' | null>>({});

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (!conversationId) {
      setPending([]);
      return;
    }

    let cancelled = false;

    const refetch = async () => {
      const { data, error } = await supabase
        .from('agent_tool_executions')
        .select('id, tool_name, status, params, dry_run_result, proposed_at')
        .eq('conversation_id', conversationId)
        .eq('status', 'proposed')
        .order('proposed_at', { ascending: false })
        .limit(10);

      if (cancelled) return;
      if (error) {
        console.warn('[AgentToolApprovalCard] fetch error:', error);
        return;
      }
      setPending((data ?? []) as ToolExecutionRow[]);
    };

    refetch();

    // Realtime : nouveau proposed → refetch ; status change → refetch (la row disparaît du bandeau)
    const channel = supabase
      .channel(`agent-tools-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_tool_executions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          refetch();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const handleAction = useCallback(
    async (executionId: string, action: 'approve' | 'reject') => {
      setActionLoading((prev) => ({ ...prev, [executionId]: action }));
      try {
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
          'agent-tool-action',
          { execution_id: executionId, action },
        );
        if (error || !data?.success) {
          toast.error(data?.error || error?.message || `Action ${action} a échoué`);
          return;
        }
        toast.success(action === 'approve' ? 'Action exécutée ✓' : 'Action rejetée');
        // Optimistic remove (realtime confirmera)
        setPending((prev) => prev.filter((p) => p.id !== executionId));
      } finally {
        setActionLoading((prev) => ({ ...prev, [executionId]: null }));
      }
    },
    [],
  );

  if (!conversationId || pending.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-muted/30">
      {pending.map((row) => {
        const summary = row.dry_run_result?.summary || `Action proposée : ${row.tool_name}`;
        const warning = row.dry_run_result?.warning;
        const label = TOOL_LABEL[row.tool_name] || row.tool_name;
        const loading = actionLoading[row.id];

        return (
          <div
            key={row.id}
            className="border border-border bg-background p-3 flex flex-col gap-2 shadow-sm"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-muted-foreground">
                    Action proposée
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground/60">
                    {label}
                  </span>
                </div>
                <p className="text-sm text-foreground leading-snug">{summary}</p>
                {warning && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction(row.id, 'reject')}
                disabled={loading !== null}
                className="h-7 px-2.5 text-xs gap-1 border-border"
              >
                {loading === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                Rejeter
              </Button>
              <Button
                size="sm"
                onClick={() => handleAction(row.id, 'approve')}
                disabled={loading !== null}
                className="h-7 px-2.5 text-xs gap-1 bg-foreground text-background hover:bg-foreground/90"
              >
                {loading === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Approuver
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
