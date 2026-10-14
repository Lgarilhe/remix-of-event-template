import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { countBriefFields } from '@/lib/missionUtils';
import { useAgent } from '@/contexts/AgentContext';
import { ArrowLeft } from 'lucide-react';
import type { JobDetails } from '@/types/jobDetails';
import { SourcingInterviewDialog } from '@/components/outreach/search/SourcingInterviewDialog';
import type { SourcingSource } from '@/components/outreach/search/SourcingSourcePicker';
import { saveGuidedBrief } from '@/lib/guidedSourcing';

interface MissionSourcingProps {
  project: SourcingProject;
  /**
   * Nouvelle page mission (SourcingScreen seulement) : sans le bandeau « Aller
   * au brief », recherche en trois groupes. Défaut : le rendu actuel.
   */
  layout?: 'default' | 'mission-v3';
  /** Phrase déjà saisie (recherche créée depuis /sourcing), lancée à l'ouverture. */
  initialPhrase?: string;
  initialSource?: SourcingSource;
  /** Recherche créée depuis /sourcing avec « Configurer les filtres » : ouvre la fenêtre des filtres. */
  startWithFilters?: boolean;
}

export const MissionSourcing = ({ project: serverProject, layout = 'default', initialPhrase, initialSource, startWithFilters }: MissionSourcingProps) => {
  const location = useLocation();
  const [start] = useState({ phrase: initialPhrase, source: initialSource,
    filters: startWithFilters ?? !!(location.state as { filters?: boolean } | null)?.filters });
  const [launch, setLaunch] = useState<{ project: SourcingProject; source: SourcingSource; version: number } | null>(null);
  const project = launch?.project.id === serverProject.id && launch.project.updated_at > serverProject.updated_at ? launch.project : serverProject;
  const [dialog, setDialog] = useState<{ phrase: string; source: SourcingSource; project: SourcingProject } | null>(null);
  const { updateProject } = useSourcingProjects();
  const navigate = useNavigate();
  useEffect(() => {
    if ((start.phrase || start.filters) && location.state) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // Consume the explicit launch once; refreshing or returning never bills another search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isV3 = layout === 'mission-v3';
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts({ selectionScope: project.id });
  const base = useBaseKonektState();

  const jd = (project.job_details || {}) as JobDetails;
  const briefCompletion = countBriefFields(jd);
  const hasBriefData = briefCompletion.filled >= 3 && !!jd.title;
  const hasFilters = project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0;
  const showBriefToFiltersPrompt = hasBriefData && !hasFilters;

  const { openContextualAgent } = useAgent();
  const [, setSearchParams] = useSearchParams();

  // CTA "Aller au brief" : redirige vers le tab brief (où vit le bouton
  // canonique "Analyser avec l'IA"). Pourquoi la redirection plutôt que
  // de générer ici : le tab brief montre la review modal qui permet à
  // l'user de valider/éditer chaque filtre avant qu'ils soient persistés
  // — meilleure qualité que la génération silencieuse historique.
  const goToBrief = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'brief');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleOpenSearchAgent = useCallback(() => {
    const jobTitle = jd.title || project.name || '';

    // Build comprehensive brief summary with ALL available fields
    const briefLines = [
      jd.title && `Poste : ${jd.title}`,
      jd.contract_type && `Contrat : ${jd.contract_type}`,
      jd.client?.name && `Client : ${jd.client.name}${jd.client.sector ? ` (${jd.client.sector})` : ''}`,
      jd.location && `Localisation : ${jd.location}`,
      jd.remote_policy && `Remote : ${jd.remote_policy}`,
      jd.seniority && `Séniorité : ${jd.seniority}`,
      (jd.experience_min != null || jd.experience_max != null) && `Expérience : ${jd.experience_min ?? '?'}-${jd.experience_max ?? '?'} ans`,
      (jd.salary_min || jd.salary_max) && `Salaire : ${jd.salary_min ?? '?'}-${jd.salary_max ?? '?'}${jd.salary_currency || '€'}${jd.salary_type === 'daily' ? '/jour' : '/an'}`,
      jd.skills_must_have?.length && `Skills must-have : ${jd.skills_must_have.join(', ')}`,
      jd.skills_should_have?.length && `Skills should-have : ${jd.skills_should_have.join(', ')}`,
      jd.skills_nice_to_have?.length && `Skills nice-to-have : ${jd.skills_nice_to_have.join(', ')}`,
      jd.skills_to_avoid?.length && `Skills à éviter : ${jd.skills_to_avoid.join(', ')}`,
      jd.certifications?.length && `Certifications : ${jd.certifications.join(', ')}`,
      jd.languages?.length && `Langues : ${jd.languages.map((l: any) => `${l.language} (${l.level})`).join(', ')}`,
      jd.mission_description && `Description : ${jd.mission_description.slice(0, 300)}`,
      jd.context && `Contexte : ${jd.context.slice(0, 200)}`,
      jd.evaluation_criteria?.length && `Critères d'évaluation (${jd.evaluation_criteria.length}) : ${jd.evaluation_criteria.slice(0, 5).map((c: any) => `${c.label}${c.deal_breaker ? ' [DEAL-BREAKER]' : ''}`).join(', ')}`,
      jd.target_companies?.length && `Entreprises cibles : ${jd.target_companies.flatMap((cat: any) => cat.companies?.map((c: any) => c.name) || []).slice(0, 5).join(', ')}`,
    ].filter(Boolean).join('\n');

    // Build access info
    const linkedInAccount = accounts.find(a => a.id === selectedAccount);
    const accessLines = [
      linkedInAccount
        ? `Compte LinkedIn : ${linkedInAccount.name || linkedInAccount.identifier} (${linkedInAccount.status})${(linkedInAccount as any).subscriptions?.recruiter ? ' — Licence Recruiter' : (linkedInAccount as any).subscriptions?.sales_navigator ? ' — Licence Sales Navigator' : ' — Licence Classic'}`
        : 'Pas de compte LinkedIn connecté',
      base.isLoading
        ? 'Base Konekt : vérification de l’accès en cours'
        : base.isError || !base.state
          ? 'Base Konekt : accès non vérifié'
          : !base.planAllows
            ? 'Base Konekt : accès non inclus dans le forfait actuel'
            : !base.isEnabled
              ? 'Base Konekt : non activée pour cette organisation'
              : `Base Konekt : activée pour cette organisation, ${base.includedRemaining} recherches incluses restantes. L’accès fournisseur et les crédits doivent encore être vérifiés au lancement.`,
      hasFilters ? `Filtres déjà générés : oui` : 'Filtres : non générés',
    ].join('\n');

    openContextualAgent({
      mode: 'sourcing',
      briefContext: (project.job_details || {}) as Record<string, unknown>,
      initialMessage: `Aide-moi à trouver des candidats pour "${jobTitle}".\n\n=== BRIEF ===\n${briefLines}\n\n=== ACCÈS ===\n${accessLines}`,
      job: undefined,
      projectId: project.id,
      accountId: selectedAccount || undefined,
    });
  }, [project, jd, accounts, selectedAccount, hasFilters, openContextualAgent, base.isLoading, base.isError, base.state, base.planAllows, base.isEnabled, base.includedRemaining]);

  if (accountsLoading) {
    return (
      <div className="bg-background border border-border p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  return (
    <div>
      {dialog && <SourcingInterviewDialog initialBrief={dialog.project.job_details ?? {}} initialMessage={dialog.phrase}
        initialSource={dialog.source} linkedinAvailable={accounts.length > 0} onClose={() => setDialog(null)}
        onConfirm={async (brief, source) => {
          const saved = await saveGuidedBrief(dialog.project, brief, updateProject);
          setLaunch(previous => ({ project: saved, source, version: (previous?.version ?? 0) + 1 }));
          setDialog(null);
        }} />}
      {/* Brief rempli mais pas encore de filtres → renvoie au brief où vit
          le bouton canonique "Analyser avec l'IA" (avec review modal).
          Avant : on avait un bouton ici qui dupliquait l'appel sans review.
          Supprimé pour éviter les divergences et garantir qu'il n'y a qu'1
          seul point de génération avec validation user. */}
      {showBriefToFiltersPrompt && !isV3 && (
        <div className="border border-border bg-accent/10 px-3 py-2 mb-2 rounded-lg flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground">
              <span className="font-semibold">Brief rempli ({briefCompletion.filled}/{briefCompletion.total} champs).</span>{' '}
              <span className="text-muted-foreground">Générez les filtres depuis le brief pour valider chaque suggestion.</span>
            </p>
          </div>
          <button
            onClick={goToBrief}
            className="shrink-0 flex items-center gap-1.5 h-7 px-3 text-xs font-bold uppercase tracking-wider rounded-md border border-border bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Aller au brief
          </button>
        </div>
      )}

      {/* Search — suggestions are shown inline in SearchFiltersPanel.
          AI Coach button ("Conseil") is now embedded in AppliedFiltersBar
          to keep chrome compact and results visible higher on the page. */}
      <OutreachSearchProvider>
        <LinkedInSearch
          key={`${project.id}:${launch?.version ?? 0}`}
          accounts={accounts}
          selectedAccount={selectedAccount}
          onAccountChange={setSelectedAccount}
          activeProject={project}
          searchSource={launch?.source ?? start.source ?? (accounts.length ? 'linkedin' : 'database')}
          onOpenSearchAgent={handleOpenSearchAgent}
          onPrepareSearch={isV3 ? (phrase, source) => setDialog({ phrase, source, project }) : undefined}
          {...(isV3 ? { layout: 'mission-v3' as const, initialPhrase: launch ? 'Chercher selon le cadrage et les critères validés.' : start.phrase, startWithFilters: !launch && start.filters } : {})}
        />
      </OutreachSearchProvider>
    </div>
  );
};
