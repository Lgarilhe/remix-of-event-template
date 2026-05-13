import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MissionContextBanner } from './MissionContextBanner';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { EmptyLinkedInAccountState } from './EmptyLinkedInAccountState';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

interface MissionOutreachProps {
  project: SourcingProject;
}

// ── Main component ──

export const MissionOutreach = ({ project }: MissionOutreachProps) => {
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const { organizationId } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  // Sub-tab persistant via URL (?outreach=sequences|invitations) pour permettre
  // bookmarks et préserver l'état au refresh.
  const initialTab = searchParams.get('outreach') === 'invitations' ? 'invitations' : 'sequences';
  const [outreachTab, _setOutreachTab] = useState<'sequences' | 'invitations'>(initialTab);
  const setOutreachTab = useCallback(
    (next: 'sequences' | 'invitations') => {
      _setOutreachTab(next);
      const params = new URLSearchParams(searchParams);
      if (next === 'sequences') params.delete('outreach');
      else params.set('outreach', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [isLoading, setIsLoading] = useState(true);

  // Enrollment stats
  const [enrollmentStats, setEnrollmentStats] = useState({ active: 0, completed: 0, replied: 0, total: 0 });
  const [goCount, setGoCount] = useState(0);

  // Fetch enrollment stats + go count for this project's sequences
  useEffect(() => {
    if (!project.id) return;
    let isMounted = true;

    const fetchStats = async () => {
      const { data: sequences, error: seqError } = await (supabase
        .from('outreach_sequences')
        .select('id') as any)
        .eq('project_id', project.id);

      if (seqError) throw seqError;

      if (!sequences?.length) {
        // SequencesList gère son propre empty state ("Créer ma première
        // séquence") — pas besoin d'écran intermédiaire à 3 cards.
        return;
      }

      const seqIds = sequences.map((s: any) => s.id);
      const { data: enrollments, error: enrError } = await supabase
        .from('sequence_enrollments')
        .select('status')
        .in('sequence_id', seqIds);

      if (enrError) throw enrError;
      if (!enrollments) return;

      if (isMounted) {
        setEnrollmentStats({
          total: enrollments.length,
          active: enrollments.filter(e => e.status === 'active').length,
          completed: enrollments.filter(e => e.status === 'completed').length,
          replied: enrollments.filter(e => e.status === 'replied').length,
        });
      }
    };

    // Count Go-scored candidates in project
    const fetchGoCount = async () => {
      const { count, error } = await (supabase as any)
        .from('sourcing_project_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('recommendation', 'go');
      if (error) throw error;
      if (isMounted) setGoCount(count || 0);
    };

    const loadData = async () => {
      try {
        await Promise.all([fetchStats(), fetchGoCount()]);
      } catch (err) {
        if (!isMounted) return;
        console.error('[MissionOutreach] Load error:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();

    return () => { isMounted = false; };
  }, [project.id]);

  const subTabs = [
    { value: 'sequences', label: 'Séquences', emoji: '⚡' },
    { value: 'invitations', label: 'Invitations', emoji: '📨' },
  ];

  if (accountsLoading) {
    return (
      <div className="bg-background border border-border p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <EmptyLinkedInAccountState message="Pour gérer vos séquences d'outreach, connectez d'abord un compte LinkedIn." />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="border border-border bg-background">
      {/* Go candidates CTA — prominent when candidates exist but not enrolled */}
      {goCount > 0 && enrollmentStats.total === 0 && (
        <div className="border-b border-border bg-success/5 p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {goCount} candidat{goCount > 1 ? 's' : ''} Go prêt{goCount > 1 ? 's' : ''} à être contacté{goCount > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              Créez une séquence pour les inscrire automatiquement.
            </p>
          </div>
          <button
            onClick={() => setOutreachTab('sequences')}
            className="shrink-0 flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-foreground text-background hover:bg-foreground/90 transition-colors rounded-lg"
          >
            Créer une séquence
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Contextual banner */}
      {enrollmentStats.total === 0 && goCount === 0 && (
        <MissionContextBanner
          icon="✉️"
          title="Contactez vos candidats"
          description="Créez une séquence de messages personnalisés. L'IA adapte chaque message en fonction du profil et du poste."
          storageKey={`outreach-onboarding:${project.id}`}
          variant="info"
          className="border-b border-border"
        />
      )}
      {/* Account selector (if multiple accounts) */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">Compte :</span>
          <select
            value={selectedAccount || ''}
            onChange={(e) => setSelectedAccount(e.target.value || null)}
            className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground font-medium"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name || a.identifier}</option>
            ))}
          </select>
        </div>
      )}

      {/* Enrollment stats */}
      {enrollmentStats.total > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-b border-border">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.total}</span> inscrits
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.active}</span> en cours
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.replied}</span> répondu
          </span>
          {enrollmentStats.replied > 0 && (
            <span className="text-xs font-semibold text-success">
              {Math.round((enrollmentStats.replied / enrollmentStats.total) * 100)}% taux de réponse
            </span>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0">
        {subTabs.map((sub) => (
          <button
            key={sub.value}
            onClick={() => setOutreachTab(sub.value as 'sequences' | 'invitations')}
            className={cn(
              "flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border transition-colors shrink-0",
              outreachTab === sub.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-border hover:bg-muted/50"
            )}
          >
            <span>{sub.emoji}</span>
            <span>{sub.label}</span>
          </button>
        ))}
      </div>

      {/* Séquences sub-tab */}
      <div className={cn("p-4", outreachTab !== 'sequences' && 'hidden')}>
        <SequencesList
          accounts={accounts}
          selectedAccount={selectedAccount}
          isVisible={outreachTab === 'sequences'}
          projectId={project.id}
        />
      </div>

      {/* Invitations sub-tab */}
      <div className={cn("p-4", outreachTab !== 'invitations' && 'hidden')}>
        <InvitationsPanel
          accounts={accounts}
          selectedAccount={selectedAccount}
          onAccountChange={setSelectedAccount}
          organizationId={organizationId || null}
        />
      </div>
    </div>
  );
};
