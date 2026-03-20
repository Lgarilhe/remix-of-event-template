import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { SequencesList } from '@/components/outreach/SequencesList';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { NurturingDashboard } from '@/components/outreach/NurturingDashboard';
import { InMailQueueStatus } from '@/components/outreach/InMailQueueStatus';
import { ProjectsList } from '@/components/outreach/projects';
import { ICPList } from '@/components/outreach/icp';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { VivierList } from '@/components/prospection/VivierList';
import { Search, Users, Settings, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { ICP } from '@/hooks/useICPs';
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { supabase } from '@/integrations/supabase/client';
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
  { value: 'projects', label: 'Projets', shortLabel: 'Projets', emoji: '📂' },
  { value: 'search', label: 'Recherche', shortLabel: 'Recherche', emoji: '🔍' },
  { value: 'prospection', label: 'Prospection', shortLabel: 'Prosp.', emoji: '🎯' },
  { value: 'messages', label: 'Messages', shortLabel: 'Msg', emoji: '💬' },
  { value: 'invitations', label: 'Invitations', shortLabel: 'Invit.', emoji: '🤝' },
  { value: 'sequences', label: 'Séquences', shortLabel: 'Séq.', emoji: '🔗' },
  { value: 'nurturing', label: 'Nurturing', shortLabel: 'Nurt.', emoji: '✨' },
] as const;

export default function Outreach() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawAccounts, setRawAccounts] = useState<LinkedInAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  const { isAdmin, isOwner, organizationId } = useOrganization();
  const { mappings, getUserLinkedAccountId } = useMemberLinkedInAccounts();
  
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
  const [prospectResults, setProspectResults] = useState<any[]>([]);
  const [prospectSearching, setProspectSearching] = useState(false);
  const [selectedICP, setSelectedICP] = useState<ICP | null>(null);
  const [prospectionTab, setProspectionTab] = useState<'search' | 'vivier' | 'icp'>('search');

  // Get current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const allAccounts = useMemo(() => rawAccounts.map(applySubscriptionOverrides), [rawAccounts]);

  // Filter accounts based on role:
  // Admin/Owner: see all accounts
  // Member: only see their linked account
  const accounts = useMemo(() => {
    if (isAdmin || isOwner) return allAccounts;
    if (!currentUserId) return allAccounts;
    
    const linkedAccountId = getUserLinkedAccountId(currentUserId);
    if (!linkedAccountId) return allAccounts; // No mapping yet, show all (backward compat)
    
    return allAccounts.filter(a => a.id === linkedAccountId);
  }, [allAccounts, isAdmin, isOwner, currentUserId, mappings, getUserLinkedAccountId]);

  const { count: initialUnreadCount, refresh: refreshUnreadCount } = useUnreadMessageCount(selectedAccount);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  useEffect(() => {
    setUnreadMessageCount(initialUnreadCount);
  }, [initialUnreadCount]);

  const handleResumeSearch = useCallback((project: SourcingProject) => {
    setActiveProject(project);
    setActiveTab('search');
  }, []);

  const handleChatChange = useCallback((chatId: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (chatId) {
        next.set('chatId', chatId);
      } else {
        next.delete('chatId');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Fetch connected accounts
  const fetchAccounts = async () => {
    try {
      const response = await invokeEdgeFunction<{ accounts?: LinkedInAccount[] }>('unipile-accounts', {
        action: 'list',
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      setRawAccounts((response.data as any).accounts || []);
      
      const accts = (response.data as any).accounts || [];
      const okAccount = accts.find((a: LinkedInAccount) => a.status === 'OK');
      if (okAccount && !selectedAccount) {
        setSelectedAccount(okAccount.id);
      } else if (accts.length > 0 && !selectedAccount) {
        setSelectedAccount(accts[0].id);
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


  return (
    <div className="min-h-screen w-full max-w-full bg-background">
      <SEOHead
        title="Outreach LinkedIn | Konekt"
        description="Recherchez et contactez des candidats sur LinkedIn avec les filtres Recruiter avancés"
      />
      <Navbar />

      <main className="pt-20 pb-0 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header — hidden on mobile when Messages tab is active */}
          <div className="mb-6 sm:mb-8 hidden md:block">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2.5 sm:gap-3 mb-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight uppercase">Outreach</h1>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                  Sourcing, séquences & suivi candidats
                </p>
              </div>
              <InMailQueueStatus />
            </div>
          </div>

          {/* Tabs — brutal style */}
          <div className={cn("mb-3 md:mb-5 sm:mb-6 min-w-0", activeTab === 'messages' && "mb-2 md:mb-5")}>
            <div className="flex gap-0 w-full min-w-0 overflow-x-auto no-scrollbar">
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "relative overflow-hidden flex items-center justify-center gap-1 h-[34px] px-2 sm:px-4 text-[10px] sm:text-xs font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
                      index > 0 && "border-l-0",
                      isActive
                        ? "bg-brutal-accent text-foreground"
                        : "bg-background text-foreground"
                    )}
                  >
                    <span className="text-sm shrink-0 relative z-10">{tab.emoji}</span>
                    <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
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

          {/* Tab panels — Search stays mounted (CSS hidden) to preserve state; Messages is conditional (WebSocket) */}
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
                  onClick={() => navigate('/settings?tab=integrations')}
                  className="relative overflow-hidden h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
                >
                  <span className="relative z-10 flex items-center gap-2"><Settings className="w-4 h-4" /> Aller dans les paramètres</span>
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

          {/* Messages: conditional render (WebSocket connections are heavy) */}
          {activeTab === 'messages' && (
            <div className="mt-0">
              <MessagesInbox
                accounts={accounts}
                selectedAccount={selectedAccount}
                onAccountChange={setSelectedAccount}
                onUnreadCountChange={setUnreadMessageCount}
                initialChatId={searchParams.get('chatId')}
                onChatChange={handleChatChange}
              />
            </div>
          )}

          <div className={cn("mt-0 min-w-0", activeTab !== 'invitations' && 'hidden')}>
            <InvitationsPanel
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              organizationId={organizationId}
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

        </div>
      </main>
    </div>
  );
}
