import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
// MissionContextBanner retiré — voir patch 2026-05-20.
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { EmptyLinkedInAccountState } from './EmptyLinkedInAccountState';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  computeResponseRate,
  missionEnrollmentJobIds,
  RESPONSE_RATE_MIN_CONTACTED,
  SENT_EXECUTION_STATUSES,
} from '@/lib/sequenceErrorMessages';
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

interface MissionOutreachProps {
  project: SourcingProject;
}

interface EnrollmentStats {
  total: number;
  active: number;
  completed: number;
  replied: number;
  /** Inscriptions ayant au moins une étape envoyée (dénominateur du taux de réponse). */
  contacted: number;
}

const EMPTY_STATS: EnrollmentStats = { total: 0, active: 0, completed: 0, replied: 0, contacted: 0 };

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

  // Chiffres des inscriptions de la mission (null tant qu'ils ne sont pas connus).
  const [enrollmentStats, setEnrollmentStats] = useState<EnrollmentStats | null>(null);
  const [goCount, setGoCount] = useState(0);
  // Incrémenté à chaque rechargement de la liste des séquences (inscription,
  // pause, reprise, réponse) : les chiffres d'en-tête suivent la liste.
  const [statsVersion, setStatsVersion] = useState(0);
  const handleSequencesChanged = useCallback(() => setStatsVersion(v => v + 1), []);
  // Demande d'ouverture du choix de modèle, transmise à la liste des séquences.
  const [createRequestId, setCreateRequestId] = useState(0);

  // Chiffres d'en-tête : inscriptions de la mission par job_id (séquences de la
  // mission ET séquences partagées entre missions), comptées côté serveur par
  // statut. Avant, seules les séquences rattachées à la mission comptaient,
  // sur au plus 1 000 lignes, et les chiffres ne bougeaient plus après le
  // premier affichage.
  useEffect(() => {
    if (!project.id) return;
    let isMounted = true;
    const jobIds = missionEnrollmentJobIds(project.id, project.job_id);

    const fetchStats = async () => {
      const countByStatus = (status?: string) => {
        const q = supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .in('job_id', jobIds);
        return status ? q.eq('status', status) : q;
      };
      // Contactés = au moins une étape réellement partie chez le candidat.
      const contactedQuery = supabase
        .from('sequence_enrollments')
        .select('id, sequence_step_executions!inner(status)', { count: 'exact', head: true })
        .in('job_id', jobIds)
        .in('sequence_step_executions.status', [...SENT_EXECUTION_STATUSES]);

      const [totalRes, activeRes, completedRes, repliedRes, contactedRes] = await Promise.all([
        countByStatus(), countByStatus('active'), countByStatus('completed'), countByStatus('replied'), contactedQuery,
      ]);
      const failed = [totalRes, activeRes, completedRes, repliedRes].find(r => r.error);
      if (failed) throw failed.error;
      if (contactedRes.error) console.error('[MissionOutreach] contacted count failed:', contactedRes.error);

      const completed = completedRes.count ?? 0;
      const replied = repliedRes.count ?? 0;
      if (isMounted) {
        setEnrollmentStats({
          total: totalRes.count ?? 0,
          active: activeRes.count ?? 0,
          completed,
          replied,
          // À défaut du détail des étapes : terminés + répondus.
          contacted: contactedRes.error ? completed + replied : (contactedRes.count ?? 0),
        });
      }
    };

    // Candidats Go de la mission : une ligne par membre qui a évalué, donc
    // dédoublonnés par candidat.
    const fetchGoCount = async () => {
      const candidateIds = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('job_candidate_status')
          .select('candidate_id')
          .eq('project_id', project.id)
          .eq('recommendation', 'go')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        (data || []).forEach(row => candidateIds.add(row.candidate_id));
        if (!data || data.length < PAGE) break;
      }
      if (isMounted) setGoCount(candidateIds.size);
    };

    const loadData = async () => {
      const [statsResult, goResult] = await Promise.allSettled([fetchStats(), fetchGoCount()]);
      if (!isMounted) return;
      if (statsResult.status === 'rejected') {
        console.error('[MissionOutreach] enrollment stats failed:', statsResult.reason);
        setEnrollmentStats(null);
      }
      if (goResult.status === 'rejected') console.error('[MissionOutreach] go count failed:', goResult.reason);
      setIsLoading(false);
    };

    loadData();

    return () => { isMounted = false; };
  }, [project.id, project.job_id, statsVersion]);

  const subTabs = [
    { value: 'sequences', label: 'Séquences', emoji: '⚡' },
    { value: 'invitations', label: 'Invitations', emoji: '📨' },
  ];

  const response = computeResponseRate({
    replied: enrollmentStats?.replied ?? 0,
    contacted: enrollmentStats?.contacted ?? 0,
  });

  const openSequenceCreation = () => {
    setOutreachTab('sequences');
    setCreateRequestId(id => id + 1);
  };

  if (accountsLoading) {
    return (
      <div className="bg-background border border-border p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <EmptyLinkedInAccountState message="Pour gérer vos séquences, connectez d'abord un compte LinkedIn." />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="border border-border bg-background">
      {/* Candidats Go pas encore inscrits : chemin vers la création puis l'inscription */}
      {goCount > 0 && enrollmentStats?.total === 0 && (
        <div className="border-b border-border bg-success/5 p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {goCount > 1 ? `${goCount} candidats Go attendent un premier contact.` : '1 candidat Go attend un premier contact.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Créez une séquence puis inscrivez-les depuis l'onglet Sourcing.
            </p>
          </div>
          <button
            onClick={openSequenceCreation}
            className="shrink-0 flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-foreground text-background hover:bg-foreground/90 transition-colors rounded-lg"
          >
            Créer une séquence
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Bandeau "Contactez vos candidats" retiré (demande Laurent 2026-05-20). */}
      {/* Pas de sélecteur de compte ici : il n'agit pas sur les séquences (le
          compte d'envoi se choisit à l'inscription). L'onglet Invitations a le sien. */}

      {/* Chiffres des inscriptions de la mission */}
      {enrollmentStats && enrollmentStats.total > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-b border-border">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.total}</span> candidat{enrollmentStats.total > 1 ? 's' : ''} inscrit{enrollmentStats.total > 1 ? 's' : ''}
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.active}</span> en cours
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enrollmentStats.replied}</span> {enrollmentStats.replied > 1 ? 'ont répondu' : 'a répondu'}
          </span>
          {response.rate !== null && response.contacted >= RESPONSE_RATE_MIN_CONTACTED && (
            <span className="text-xs font-semibold text-success" title={`${response.replied} réponse(s) sur ${response.contacted} candidat(s) contacté(s)`}>
              {response.rate} % de réponse
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
            aria-pressed={outreachTab === sub.value}
          >
            <span aria-hidden="true">{sub.emoji}</span>
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
          createRequestId={createRequestId}
          onDataChanged={handleSequencesChanged}
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
