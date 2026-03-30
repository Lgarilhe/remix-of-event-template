import React, { useState, useEffect } from 'react';
import { MissionContextBanner } from './MissionContextBanner';
import { MissionAssistantButton } from './MissionAssistantButton';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { EmptyLinkedInAccountState } from './EmptyLinkedInAccountState';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { cn } from '@/lib/utils';

interface MissionSourcingProps {
  project: SourcingProject;
}

const getSourcingTabStorageKey = (projectId: string) => `mission-sourcing-tab:${projectId}`;

const getDefaultSourcingTab = (project: SourcingProject): 'linkedin' | 'database' => {
  const api = (project.filters_snapshot as { api?: string } | null)?.api;
  return api === 'database' ? 'database' : 'linkedin';
};

// ── Main component ──

export const MissionSourcing = ({ project }: MissionSourcingProps) => {
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const [sourcingTab, setSourcingTab] = useState<'linkedin' | 'database'>(() => {
    if (typeof window === 'undefined') return getDefaultSourcingTab(project);

    const savedTab = window.localStorage.getItem(getSourcingTabStorageKey(project.id));
    if (savedTab === 'linkedin' || savedTab === 'database') return savedTab;

    return getDefaultSourcingTab(project);
  });

  // Database sub-tab state
  const [prospectResults, setProspectResults] = useState<any[]>([]);
  const [prospectSearching, setProspectSearching] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedTab = window.localStorage.getItem(getSourcingTabStorageKey(project.id));
    if (savedTab === 'linkedin' || savedTab === 'database') {
      setSourcingTab(savedTab);
      return;
    }

    setSourcingTab(getDefaultSourcingTab(project));
  }, [project]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getSourcingTabStorageKey(project.id), sourcingTab);
  }, [project.id, sourcingTab]);

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
      {/* Assistant button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10">
        <MissionAssistantButton project={project} mode="sourcing" />
      </div>
      {/* Contextual onboarding banner */}
      <MissionContextBanner
        icon="💡"
        title="Comment sourcer efficacement"
        description="Sélectionnez un poste, configurez vos filtres ou utilisez Auto-fill IA, puis cliquez Rechercher. Après les résultats, scorez les profils pour que l'IA les évalue."
        storageKey={`sourcing-onboarding:${project.id}`}
        variant="info"
        className="border-b border-foreground/10 m-0"
      />
      {/* Account selector (if multiple accounts) */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-foreground/10">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Compte:</span>
          <select
            value={selectedAccount || ''}
            onChange={(e) => setSelectedAccount(e.target.value || null)}
            className="h-[30px] px-2 text-[10px] uppercase tracking-wider border border-foreground bg-background text-foreground font-medium"
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
                "relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground transition-colors group shrink-0",
                idx > 0 && "border-l-0",
                sourcingTab === sub.value ? "bg-foreground text-background" : "bg-background text-foreground"
              )}
            >
              <span className="relative z-10">{sub.icon}</span>
              <span className="relative z-10">{sub.label}</span>
              {sub.badge && <span className="relative z-10 text-[9px]">{sub.badge}</span>}
              {sourcingTab !== sub.value && (
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              )}
            </button>
          ))}
        </div>
        {/* Contextual description */}
        <p className="text-[10px] text-muted-foreground mt-1.5 mb-1">
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
