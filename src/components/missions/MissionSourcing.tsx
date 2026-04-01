import React, { useState, useEffect, useCallback } from 'react';
import { MissionContextBanner } from './MissionContextBanner';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { EmptyLinkedInAccountState } from './EmptyLinkedInAccountState';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { countBriefFields } from '@/lib/missionUtils';
import { Sparkles, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface Suggestions {
  alt_skills: string[];
  alt_titles: string[];
  alt_locations: string[];
  alt_companies: string[];
  alt_certifications: string[];
}

interface MissionSourcingProps {
  project: SourcingProject;
}

const getSourcingTabStorageKey = (projectId: string) => `mission-sourcing-tab:${projectId}`;

// ── Main component ──

export const MissionSourcing = ({ project }: MissionSourcingProps) => {
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();

  // Check if brief has data but no filters generated yet
  const jd = (project.job_details || {}) as JobDetails;
  const briefCompletion = countBriefFields(jd);
  const hasBriefData = briefCompletion.filled >= 3 && !!jd.title;
  const hasFilters = project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0;
  const showBriefToFiltersPrompt = hasBriefData && !hasFilters;

  const { updateProject } = useSourcingProjects();
  const [isGeneratingFilters, setIsGeneratingFilters] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(() => {
    // Load from filters_snapshot if available
    const snap = project.filters_snapshot as any;
    return snap?.suggestions || null;
  });

  const handleGenerateFilters = useCallback(async () => {
    setIsGeneratingFilters(true);
    try {
      const response = await invokeWithCredits('generate-search-filters', 'filter_generation', {
        job: {
          id: project.id,
          title: jd.title || project.name,
          description: [jd.mission_description, jd.context, jd.raw_brief].filter(Boolean).join('\n\n'),
          client: jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : (project.client_name ? { name: project.client_name } : null),
          location: jd.location || null,
          skills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
          seniority: jd.seniority || null,
          xpMin: jd.experience_min,
          xpMax: jd.experience_max,
          // Additional brief data for better filter generation
          remote: jd.remote_policy || null,
          contractType: jd.contract_type || null,
          salaryMin: jd.salary_min,
          salaryMax: jd.salary_max,
          mustHave: jd.skills_must_have?.join(', ') || null,
          shouldHave: jd.skills_should_have?.join(', ') || null,
          niceToHave: jd.skills_nice_to_have?.join(', ') || null,
          sourcingCriteria: jd.skills_to_avoid?.length ? `Compétences à éviter : ${jd.skills_to_avoid.join(', ')}` : null,
          requirements: [
            ...(jd.certifications?.length ? [`Certifications : ${jd.certifications.join(', ')}`] : []),
            ...(jd.languages?.length ? [`Langues : ${jd.languages.map((l: any) => `${l.language} (${l.level})`).join(', ')}`] : []),
          ].join('. ') || null,
        },
      });
      if (response.error) throw new Error(response.error.message || 'Erreur IA');
      if (!response.data?.success) throw new Error('Génération échouée');

      const generatedFilters =
        response.data.filters && typeof response.data.filters === 'object' && !Array.isArray(response.data.filters)
          ? response.data.filters
          : {};

      const sug = (response.data.suggestions as Suggestions) || null;
      setSuggestions(sug);

      await updateProject({
        id: project.id,
        filters_snapshot: {
          ...generatedFilters,
          suggestions: sug,
          generated_at: new Date().toISOString(),
        },
      });
      toast.success('Filtres générés depuis votre brief');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la génération des filtres');
    } finally {
      setIsGeneratingFilters(false);
    }
  }, [project, jd, updateProject]);

  // Add a suggestion to the brief and update filters_snapshot
  const handleAddSuggestion = useCallback((category: keyof Suggestions, value: string) => {
    // Remove the chip from suggestions
    setSuggestions(prev => {
      if (!prev) return prev;
      return { ...prev, [category]: prev[category].filter((v: string) => v !== value) };
    });

    const currentSnapshot = (project.filters_snapshot || {}) as Record<string, any>;
    const currentJobDetails = (project.job_details || {}) as Record<string, any>;

    switch (category) {
      case 'alt_skills':
      case 'alt_certifications': {
        // Add to brief skills_should_have
        const currentSkills = (jd.skills_should_have || []) as string[];
        if (!currentSkills.includes(value)) {
          const updatedSkills = [...currentSkills, value];
          updateProject({
            id: project.id,
            job_details: { ...currentJobDetails, skills_should_have: updatedSkills } as any,
            // Also add to skills_keywords in filters_snapshot for immediate search impact
            filters_snapshot: {
              ...currentSnapshot,
              skills_keywords: [...(currentSnapshot.skills_keywords || []), value],
            },
          });
        }
        break;
      }
      case 'alt_titles': {
        // Add to role filter keywords in filters_snapshot
        const existingRole = Array.isArray(currentSnapshot.role) ? currentSnapshot.role : [];
        const currentKeywords = existingRole[0]?.keywords || '';
        const updatedKeywords = currentKeywords ? `${currentKeywords} OR "${value}"` : `"${value}"`;
        updateProject({
          id: project.id,
          filters_snapshot: {
            ...currentSnapshot,
            role: [{ keywords: updatedKeywords, priority: 'MUST_HAVE', scope: 'CURRENT' }],
          },
        });
        break;
      }
      case 'alt_locations': {
        // Add to location_keywords in filters_snapshot
        const currentLocations = currentSnapshot.location_keywords || [];
        if (!currentLocations.includes(value)) {
          updateProject({
            id: project.id,
            filters_snapshot: {
              ...currentSnapshot,
              location_keywords: [...currentLocations, value],
            },
          });
        }
        break;
      }
      case 'alt_companies': {
        // Add as company to target (CAN_HAVE = inclusive filter, not exclusive)
        const existingCompanies = Array.isArray(currentSnapshot.company_keywords) ? currentSnapshot.company_keywords : [];
        updateProject({
          id: project.id,
          filters_snapshot: {
            ...currentSnapshot,
            company_keywords: [
              ...existingCompanies,
              { keywords: value, priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
            ],
          },
        });
        break;
      }
    }
    toast.success(`"${value}" ajouté aux filtres`);
  }, [project, jd, updateProject]);

  const handleDismissSuggestion = useCallback((category: keyof Suggestions, value: string) => {
    setSuggestions(prev => {
      if (!prev) return prev;
      return { ...prev, [category]: prev[category].filter((v: string) => v !== value) };
    });
  }, []);

  // Check if there are any suggestions to show
  const hasSuggestions = suggestions && (
    suggestions.alt_skills.length > 0 ||
    suggestions.alt_titles.length > 0 ||
    suggestions.alt_locations.length > 0 ||
    suggestions.alt_companies.length > 0 ||
    suggestions.alt_certifications.length > 0
  );

  // Check if any LinkedIn account has issues
  const hasLinkedInIssue = accounts.length === 0 || accounts.every(a => a.status !== 'OK');

  const subTabs = [
    {
      value: 'linkedin',
      label: 'LinkedIn',
      icon: '🔗',
      description: 'Recherche via votre compte LinkedIn',
      badge: hasLinkedInIssue ? '⚠️' : null,
    },
    {
      value: 'database',
      label: 'Base Konekt',
      icon: '🌐',
      description: 'Recherche dans notre base de +200M profils',
      badge: null,
    },
  ];

  if (accountsLoading) {
    return (
      <div className="bg-background border border-foreground border-t-0 p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  return (
    <div className="border border-foreground border-t-0 bg-background">
      {/* Brief → Filters prompt */}
      {showBriefToFiltersPrompt && (
        <div className="border-b border-foreground bg-brutal-accent/10 p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-foreground mb-0.5">
                Brief rempli ({briefCompletion.filled}/{briefCompletion.total} champs)
              </p>
              <p className="text-xs text-muted-foreground">
                Générez les filtres de recherche automatiquement depuis votre brief.
              </p>
            </div>
            <button
              onClick={handleGenerateFilters}
              disabled={isGeneratingFilters}
              className={cn(
                "shrink-0 flex items-center gap-2 h-[36px] px-5 text-xs font-bold uppercase tracking-wider border border-foreground transition-colors",
                isGeneratingFilters
                  ? "bg-muted text-muted-foreground"
                  : "bg-foreground text-background hover:bg-foreground/90"
              )}
            >
              {isGeneratingFilters ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Génération...</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5" /> Générer les filtres</>
              )}
            </button>
          </div>
        </div>
      )}
      {/* AI Suggestions chips */}
      {hasSuggestions && (
        <div className="border-b border-foreground/10 px-4 py-3 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            Affiner les filtres
          </p>
          {([
            { key: 'alt_skills' as const, label: 'Skills', items: suggestions!.alt_skills },
            { key: 'alt_titles' as const, label: 'Titres', items: suggestions!.alt_titles },
            { key: 'alt_locations' as const, label: 'Localisation', items: suggestions!.alt_locations },
            { key: 'alt_companies' as const, label: 'Entreprises cibles', items: suggestions!.alt_companies },
            { key: 'alt_certifications' as const, label: 'Certifications', items: suggestions!.alt_certifications },
          ]).filter(g => g.items.length > 0).map(group => (
            <div key={group.key} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mr-1 shrink-0">
                {group.label}:
              </span>
              {group.items.map(item => (
                <button
                  key={item}
                  onClick={() => handleAddSuggestion(group.key, item)}
                  className="group flex items-center gap-1 h-[24px] px-2 text-xs font-medium border border-foreground/20 bg-background text-foreground hover:border-foreground hover:bg-foreground hover:text-background transition-colors"
                >
                  <Plus className="w-2.5 h-2.5 text-brutal-accent group-hover:text-background" />
                  {item}
                  <span
                    onClick={(e) => { e.stopPropagation(); handleDismissSuggestion(group.key, item); }}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5" />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Account selector (if multiple accounts) */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-foreground/10">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Compte:</span>
          <select
            value={selectedAccount || ''}
            onChange={(e) => setSelectedAccount(e.target.value || null)}
            className="h-[30px] px-2 text-xs uppercase tracking-wider border border-foreground bg-background text-foreground font-medium"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name || a.identifier}</option>
            ))}
          </select>
        </div>
      )}

      {/* Source toggle */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex gap-0">
          {subTabs.map((sub, idx) => (
            <button
              key={sub.value}
              onClick={() => setSourcingTab(sub.value as 'linkedin' | 'database')}
              className={cn(
                "relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-xs font-bold uppercase tracking-wider border border-foreground transition-colors group shrink-0",
                idx > 0 && "border-l-0",
                sourcingTab === sub.value ? "bg-foreground text-background" : "bg-background text-foreground"
              )}
            >
              <span className="relative z-10">{sub.icon}</span>
              <span className="relative z-10">{sub.label}</span>
              {sub.badge && <span className="relative z-10 text-xs">{sub.badge}</span>}
              {sourcingTab !== sub.value && (
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              )}
            </button>
          ))}
        </div>
        {/* Contextual description */}
        <p className="text-xs text-muted-foreground mt-1.5 mb-1">
          {sourcingTab === 'linkedin'
            ? accounts.length > 0
              ? 'Recherche directe via votre compte LinkedIn. Nécessite une connexion active.'
              : '⚠️ Aucun compte LinkedIn connecté. Connectez-en un dans Paramètres ou utilisez la Base Konekt.'
            : 'Recherche dans notre base de données de profils. Mêmes filtres, sans connexion LinkedIn requise.'}
        </p>
      </div>

      {/* LinkedIn sub-tab */}
      <div className={cn("p-4", sourcingTab !== 'linkedin' && 'hidden')}>
        {accounts.length > 0 ? (
          <OutreachSearchProvider>
            <LinkedInSearch
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              activeProject={project}
            />
          </OutreachSearchProvider>
        ) : (
          <EmptyLinkedInAccountState message="Pour rechercher des candidats, connectez d'abord un compte LinkedIn Recruiter." />
        )}
      </div>

      {/* Database sub-tab — same UI as LinkedIn but powered by Base Konekt */}
      <div className={cn("p-4", sourcingTab !== 'database' && 'hidden')}>
        <OutreachSearchProvider>
          <LinkedInSearch
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            activeProject={project}
            searchSource="database"
          />
        </OutreachSearchProvider>
      </div>
    </div>
  );
};
