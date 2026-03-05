import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  profile_picture_url?: string | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawAccounts, setRawAccounts] = useState<LinkedInAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const validTabs = tabs.map(t => t.value) as string[];
  const tabFromUrl = searchParams.get('tab');
  const activeTab = validTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'projects';
  
  const setActiveTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  
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
    <div className="min-h-screen w-full max-w-full bg-background">
      <SEOHead
        title="Outreach LinkedIn | Konekt"
        description="Recherchez et contactez des candidats sur LinkedIn avec les filtres Recruiter avancés"
      />
      <Navbar />

      <main className="pt-20 pb-0 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2.5 sm:gap-3 mb-1">
                  <div className="h-9 w-9 sm:h-10 sm:w-10 bg-foreground text-background flex items-center justify-center border border-foreground">
                    <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight uppercase">Outreach</h1>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block ml-[44px] sm:ml-[52px]">
                  Sourcing, séquences & suivi candidats
                </p>
              </div>
              <InMailQueueStatus />
            </div>
          </div>

          {/* Tabs — brutal style */}
          <div className="mb-5 sm:mb-6 min-w-0">
            <div className="grid grid-cols-3 sm:flex gap-0 w-full min-w-0">
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "relative overflow-hidden flex items-center justify-center sm:justify-start gap-1 h-[34px] px-2 sm:px-4 text-[10px] sm:text-xs font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group min-w-0",
                      index > 0 && "sm:border-l-0",
                      isActive
                        ? "bg-brutal-accent text-foreground"
                        : "bg-background text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0 relative z-10" />
                    <span className="hidden sm:inline relative z-10 truncate">{tab.label}{tab.value === 'accounts' ? ` (${accounts.length})` : ''}</span>
                    <span className="sm:hidden relative z-10 truncate">{tab.shortLabel || tab.label}{tab.value === 'accounts' ? ` (${accounts.length})` : ''}</span>
                    {tab.value === 'messages' && unreadMessageCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold bg-red-600 text-white rounded-full min-w-[16px] text-center relative z-10">
                        {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                      </span>
                    )}
                    {!isActive && (
                      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab panels */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'projects' && 'hidden')}>
            <div className="bg-background border border-foreground p-3 sm:p-6 overflow-hidden">
              <ProjectsList onResumeSearch={handleResumeSearch} />
            </div>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'search' && 'hidden')}>
            {accounts.length === 0 ? (
              <div className="bg-background border border-foreground p-12 text-center">
                <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2 uppercase tracking-wide">
                  Connectez votre compte LinkedIn
                </h2>
                <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
                  Pour rechercher des candidats, connectez d'abord un compte LinkedIn Recruiter.
                </p>
                <button
                  onClick={() => setActiveTab('accounts')}
                  className="relative overflow-hidden h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
                >
                  <span className="relative z-10">Connecter un compte</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
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
              initialChatId={searchParams.get('chatId')}
              onChatChange={useCallback((chatId: string | null) => {
                setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  if (chatId) {
                    next.set('chatId', chatId);
                  } else {
                    next.delete('chatId');
                  }
                  return next;
                }, { replace: true });
              }, [setSearchParams])}
            />
          </div>

          <div className={cn("mt-0", activeTab !== 'sequences' && 'hidden')}>
            <div className="bg-background border border-foreground p-3 sm:p-6">
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
