import React, { useState, useEffect } from 'react';
import { MissionContextBanner } from './MissionContextBanner';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { EmptyLinkedInAccountState } from './EmptyLinkedInAccountState';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { OutreachEmptyState } from './OutreachEmptyState';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CheckCircle2, ArrowRight } from 'lucide-react';

interface MissionOutreachProps {
  project: SourcingProject;
}

// ── Main component ──

export const MissionOutreach = ({ project }: MissionOutreachProps) => {
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const { organizationId } = useOrganization();
  const [outreachTab, setOutreachTab] = useState<'sequences' | 'invitations'>('sequences');
  const [showEmptyState, setShowEmptyState] = useState(true);

  // Enrollment stats
  const [enrollmentStats, setEnrollmentStats] = useState({ active: 0, completed: 0, replied: 0, total: 0 });
  const [goCount, setGoCount] = useState(0);

  // Fetch enrollment stats + go count for this project's sequences
  useEffect(() => {
    if (!project.id) return;
    const fetchStats = async () => {
      const { data: sequences } = await (supabase
        .from('outreach_sequences')
        .select('id') as any)
        .eq('project_id', project.id);

      if (!sequences?.length) {
        setShowEmptyState(true);
        return;
      }

      setShowEmptyState(false);

      const seqIds = sequences.map((s: any) => s.id);
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('status')
        .in('sequence_id', seqIds);

      if (!enrollments) return;
      setEnrollmentStats({
        total: enrollments.length,
        active: enrollments.filter(e => e.status === 'active').length,
        completed: enrollments.filter(e => e.status === 'completed').length,
        replied: enrollments.filter(e => e.status === 'replied').length,
      });
    };

    // Count Go-scored candidates in project
    const fetchGoCount = async () => {
      const { count } = await (supabase as any)
        .from('sourcing_project_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('recommendation', 'go');
      setGoCount(count || 0);
    };

    fetchStats();
    fetchGoCount();
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

  if (showEmptyState && enrollmentStats.total === 0) {
    return (
      <div className="border border-border bg-background">
        <OutreachEmptyState
          goCount={goCount}
          onLinkedInMessage={() => {
            setShowEmptyState(false);
            setOutreachTab('sequences');
          }}
          onInMail={() => {
            setShowEmptyState(false);
            setOutreachTab('sequences');
          }}
          onSequence={() => {
            setShowEmptyState(false);
            setOutreachTab('sequences');
          }}
        />
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
            onClick={() => { setShowEmptyState(false); setOutreachTab('sequences'); }}
            className="shrink-0 flex items-center gap-2 h-9 px-4 text-xs font-bold uppercase tracking-wider bg-foreground text-background hover:bg-foreground/90 transition-colors rounded-lg"
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
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Compte:</span>
          <select
            value={selectedAccount || ''}
            onChange={(e) => setSelectedAccount(e.target.value || null)}
            className="h-8 px-2 text-xs uppercase tracking-wider border border-border bg-background text-foreground font-medium"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name || a.identifier}</option>
            ))}
          </select>
        </div>
      )}

      {/* Enrollment stats */}
      {enrollmentStats.total > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-border">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.total} inscrits
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.active} en cours
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.replied} répondu
          </span>
          {enrollmentStats.replied > 0 && (
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              {Math.round((enrollmentStats.replied / enrollmentStats.total) * 100)}% taux de réponse
            </span>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-0 px-4 pt-3 pb-0">
        {subTabs.map((sub, idx) => (
          <button
            key={sub.value}
            onClick={() => setOutreachTab(sub.value as 'sequences' | 'invitations')}
            className={cn(
              "relative overflow-hidden flex items-center gap-1 h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border transition-colors group shrink-0",
              idx > 0 && "border-l-0",
              outreachTab === sub.value ? "bg-foreground text-background" : "bg-background text-foreground"
            )}
          >
            <span className="relative z-10">{sub.emoji}</span>
            <span className="relative z-10">{sub.label}</span>
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
