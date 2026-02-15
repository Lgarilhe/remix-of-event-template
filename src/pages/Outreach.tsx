import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { LinkedInAccountManager, applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { SequencesList } from '@/components/outreach/SequencesList';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { NurturingDashboard } from '@/components/outreach/NurturingDashboard';
import { InMailQueueStatus } from '@/components/outreach/InMailQueueStatus';
import { ProjectsList } from '@/components/outreach/projects';
import { Search, Users, Settings, GitBranch, MessageSquare, Sparkles, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount';
import { cn } from '@/lib/utils';

export interface LinkedInAccountSubscriptions {
  classic: boolean;
  recruiter: boolean;
  sales_navigator: boolean;
}

export interface LinkedInAccount {
  id: string;
  name: string;
  identifier: string;
  status: string;
  subscriptions?: LinkedInAccountSubscriptions;
}

const tabs = [
  { value: 'projects', label: 'Projets', shortLabel: 'Projets', icon: FolderOpen },
  { value: 'search', label: 'Recherche', shortLabel: 'Recherche', icon: Search },
  { value: 'messages', label: 'Messages', shortLabel: 'Msg', icon: MessageSquare },
  { value: 'sequences', label: 'Séquences', shortLabel: 'Séq.', icon: GitBranch },
  { value: 'nurturing', label: 'Nurturing', shortLabel: 'Nurt.', icon: Sparkles },
  { value: 'accounts', label: 'Comptes', shortLabel: '', icon: Settings },
] as const;

export default function Outreach() {
  const [rawAccounts, setRawAccounts] = useState<LinkedInAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('projects');
  const [activeProject, setActiveProject] = useState<SourcingProject | null>(null);

  const accounts = useMemo(() => rawAccounts.map(applySubscriptionOverrides), [rawAccounts]);

  const { count: initialUnreadCount, refresh: refreshUnreadCount } = useUnreadMessageCount(selectedAccount);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  useEffect(() => {
    setUnreadMessageCount(initialUnreadCount);
  }, [initialUnreadCount]);

  const handleResumeSearch = useCallback((project: SourcingProject) => {
    setActiveProject(project);
    setActiveTab('search');
  }, []);

  // Fetch connected accounts
  const fetchAccounts = async () => {
    try {
      const response = await supabase.functions.invoke('unipile-accounts', {
        body: { action: 'list' },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      setRawAccounts(response.data.accounts || []);
      
      const okAccount = response.data.accounts?.find((a: LinkedInAccount) => a.status === 'OK');
      if (okAccount && !selectedAccount) {
        setSelectedAccount(okAccount.id);
      } else if (response.data.accounts?.length > 0 && !selectedAccount) {
        setSelectedAccount(response.data.accounts[0].id);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleAccountConnected = () => {
    fetchAccounts();
    toast.success('Compte LinkedIn connecté !');
  };

  const handleAccountDisconnected = (accountId: string) => {
    setRawAccounts(prev => prev.filter(a => a.id !== accountId));
    if (selectedAccount === accountId) {
      setSelectedAccount(accounts.find(a => a.id !== accountId)?.id || null);
    }
    toast.success('Compte déconnecté');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 overflow-x-hidden">
      <SEOHead
        title="Outreach LinkedIn | Konekt"
        description="Recherchez et contactez des candidats sur LinkedIn avec les filtres Recruiter avancés"
      />
      <Navbar />

      <main className="pt-20 pb-12">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2.5 sm:gap-3 mb-1">
                  <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
                    <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Outreach</h1>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block ml-[44px] sm:ml-[52px]">
                  Sourcing, séquences & suivi candidats
                </p>
              </div>
              <InMailQueueStatus />
            </div>
          </div>

          {/* Tabs */}
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-5 sm:mb-6">
            <div className="flex gap-1 p-1 bg-white/80 backdrop-blur-sm border border-border rounded-2xl shadow-sm w-max sm:w-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="hidden sm:inline">{tab.label}{tab.value === 'accounts' ? ` (${accounts.length})` : ''}</span>
                    <span className="sm:hidden">{tab.shortLabel || tab.label}{tab.value === 'accounts' ? ` (${accounts.length})` : ''}</span>
                    {tab.value === 'messages' && unreadMessageCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[16px] text-center shadow-sm">
                        {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab panels */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'projects' && 'hidden')}>
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-border/60 p-3 sm:p-6 overflow-hidden shadow-sm">
              <ProjectsList onResumeSearch={handleResumeSearch} />
            </div>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'search' && 'hidden')}>
            {accounts.length === 0 ? (
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-border/60 p-12 text-center shadow-sm">
                <div className="p-4 rounded-2xl bg-blue-50 w-fit mx-auto mb-4">
                  <Users className="w-12 h-12 text-blue-400" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  Connectez votre compte LinkedIn
                </h2>
                <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
                  Pour rechercher des candidats, connectez d'abord un compte LinkedIn Recruiter.
                </p>
                <button
                  onClick={() => setActiveTab('accounts')}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-600/25 transition-all duration-200 font-medium text-sm"
                >
                  Connecter un compte
                </button>
              </div>
            ) : (
              <OutreachSearchProvider>
                <LinkedInSearch
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                  onAccountChange={setSelectedAccount}
                  activeProject={activeProject}
                  onProjectChange={setActiveProject}
                />
              </OutreachSearchProvider>
            )}
          </div>

          <div className={cn("mt-0", activeTab !== 'messages' && 'hidden')}>
            <MessagesInbox
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              onUnreadCountChange={setUnreadMessageCount}
            />
          </div>

          <div className={cn("mt-0", activeTab !== 'sequences' && 'hidden')}>
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-border/60 p-3 sm:p-6 shadow-sm">
              <SequencesList
                accounts={accounts}
                selectedAccount={selectedAccount}
                isVisible={activeTab === 'sequences'}
              />
            </div>
          </div>

          <div className={cn("mt-0", activeTab !== 'nurturing' && 'hidden')}>
            <NurturingDashboard
              accounts={accounts}
              selectedAccount={selectedAccount}
            />
          </div>

          <div className={cn("mt-0", activeTab !== 'accounts' && 'hidden')}>
            <LinkedInAccountManager
              accounts={accounts}
              loading={loading}
              onAccountConnected={handleAccountConnected}
              onAccountDisconnected={handleAccountDisconnected}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
