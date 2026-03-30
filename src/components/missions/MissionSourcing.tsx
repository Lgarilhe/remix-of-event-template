import React, { useState, useEffect, useMemo } from 'react';
import { MissionContextBanner } from './MissionContextBanner';
import { useNavigate } from 'react-router-dom';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MissionSourcingProps {
  project: SourcingProject;
}

const getSourcingTabStorageKey = (projectId: string) => `mission-sourcing-tab:${projectId}`;

const getDefaultSourcingTab = (project: SourcingProject): 'linkedin' | 'database' => {
  const api = (project.filters_snapshot as { api?: string } | null)?.api;
  return api === 'database' ? 'database' : 'linkedin';
};

// ── Empty state when no LinkedIn account is connected ──

const EmptyAccountState = () => {
  const navigate = useNavigate();
  return (
    <div className="bg-background border border-foreground border-t-0 p-6 sm:p-8">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 border border-foreground flex items-center justify-center mb-4">
          <Users className="w-5 h-5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-2">
          Connectez votre compte LinkedIn
        </h2>
        <p className="text-xs text-muted-foreground max-w-md mb-6">
          Pour rechercher des candidats, connectez d'abord un compte LinkedIn Recruiter.
        </p>
        <button
          onClick={() => navigate('/settings?tab=connectors')}
          className="relative overflow-hidden h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
        >
          <span className="relative z-10 flex items-center gap-2">
            <Settings className="w-3.5 h-3.5" />
            Aller dans les paramètres
          </span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
      </div>
    </div>
  );
};

// ── Main component ──

export const MissionSourcing = ({ project }: MissionSourcingProps) => {
  const navigate = useNavigate();
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sourcingTab, setSourcingTab] = useState<'linkedin' | 'database'>(() => {
    if (typeof window === 'undefined') return getDefaultSourcingTab(project);

    const savedTab = window.localStorage.getItem(getSourcingTabStorageKey(project.id));
    if (savedTab === 'linkedin' || savedTab === 'database') return savedTab;

    return getDefaultSourcingTab(project);
  });

  // Database sub-tab state
  const [prospectResults, setProspectResults] = useState<any[]>([]);
  const [prospectSearching, setProspectSearching] = useState(false);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Apply subscription overrides + filter by member mapping
  const allAccounts = useMemo(
    () => (rawAccounts as LinkedInAccount[]).map(applySubscriptionOverrides),
    [rawAccounts]
  );

  const accounts = useMemo(() => {
    if ((isAdmin || isOwner) && !isCollaborator) return allAccounts;
    if (!currentUserId) return allAccounts;
    const linkedAccountId = getUserLinkedAccountId(currentUserId);
    if (!linkedAccountId) return allAccounts;
    return allAccounts.filter(a => a.id === linkedAccountId);
  }, [allAccounts, isAdmin, isOwner, isCollaborator, currentUserId, getUserLinkedAccountId]);

  // Auto-select first OK account
  useEffect(() => {
    if (selectedAccount || accounts.length === 0) return;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelectedAccount(okAccount?.id || accounts[0]?.id || null);
  }, [accounts, selectedAccount]);

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
          <EmptyAccountState />
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
