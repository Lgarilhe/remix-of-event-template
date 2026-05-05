import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { countBriefFields } from '@/lib/missionUtils';
import { useAgent } from '@/contexts/AgentContext';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import type { JobDetails } from '@/types/jobDetails';

interface MissionSourcingProps {
  project: SourcingProject;
}

export const MissionSourcing = ({ project }: MissionSourcingProps) => {
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();

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
      'Base Konekt : disponible',
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
  }, [project, jd, accounts, selectedAccount, hasFilters, openContextualAgent]);

  if (accountsLoading) {
    return (
      <div className="bg-background border border-border p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  return (
    <div className="border border-border bg-background overflow-hidden">
      {/* Brief rempli mais pas encore de filtres → renvoie au brief où vit
          le bouton canonique "Analyser avec l'IA" (avec review modal).
          Avant : on avait un bouton ici qui dupliquait l'appel sans review.
          Supprimé pour éviter les divergences et garantir qu'il n'y a qu'1
          seul point de génération avec validation user. */}
      {showBriefToFiltersPrompt && (
        <div className="border-b border-border bg-accent/10 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-0.5">
                Brief rempli ({briefCompletion.filled}/{briefCompletion.total} champs)
              </p>
              <p className="text-xs text-muted-foreground">
                Lancez l'analyse IA depuis le brief pour générer les filtres de recherche
                (avec validation des suggestions avant sauvegarde).
              </p>
            </div>
            <button
              onClick={goToBrief}
              className="shrink-0 flex items-center gap-2 h-9 px-4 sm:px-5 text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Aller au brief
            </button>
          </div>
        </div>
      )}

      {/* AI Search Agent button */}
      <div className="border-b border-border px-3 sm:px-4 py-2.5 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Recherche par filtres ou via l'assistant IA conversationnel.
        </p>
        <button
          onClick={handleOpenSearchAgent}
          className="shrink-0 flex items-center gap-2 h-8 px-3 text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors rounded-md"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Recherche IA</span>
          <span className="sm:hidden">IA</span>
        </button>
      </div>

      {/* Search — suggestions are shown inline in SearchFiltersPanel */}
      <div className="p-2.5 sm:p-4">
        <OutreachSearchProvider>
          <LinkedInSearch
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            activeProject={project}
            searchSource="linkedin"
          />
        </OutreachSearchProvider>
      </div>
    </div>
  );
};
