import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { SequencesList } from '@/components/outreach/SequencesList';
import { NurturingDashboard } from '@/components/outreach/NurturingDashboard';
import { InMailQueueStatus } from '@/components/outreach/InMailQueueStatus';
import { ProjectsList } from '@/components/outreach/projects';
import { ICPList } from '@/components/outreach/icp';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { VivierList } from '@/components/prospection/VivierList';
import { Users, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { ICP } from '@/hooks/useICPs';
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
  { value: 'projects', label: 'Missions', shortLabel: 'Missions', emoji: '📂' },
  { value: 'sourcing', label: 'Sourcing', shortLabel: 'Source', emoji: '🔍' },
  { value: 'sequences', label: 'Séquences', shortLabel: 'Séq.', emoji: '🔗' },
  { value: 'nurturing', label: 'Suivi', shortLabel: 'Suivi', emoji: '✨' },
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
  
  const validTabs = ['projects', 'sourcing', 'sequences', 'nurturing'];
  const tabFromUrl = searchParams.get('tab');
  // Redirect old tab values
  const resolvedTab = tabFromUrl === 'search' || tabFromUrl === 'prospection' ? 'sourcing'
    : tabFromUrl === 'messages' || tabFromUrl === 'invitations' ? 'projects'
    : tabFromUrl;
  const activeTab = validTabs.includes(resolvedTab || '') ? resolvedTab! : 'projects';
  
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
  
  // Sub-tab states
  const [sourcingTab, setSourcingTab] = useState<string>('linkedin');
  const [sequencesSubTab, setSequencesSubTab] = useState<string>('sequences');

  // Get current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const allAccounts = useMemo(() => rawAccounts.map(applySubscriptionOverrides), [rawAccounts]);

  const accounts = useMemo(() => {
    if (isAdmin || isOwner) return allAccounts;
    if (!currentUserId) return allAccounts;
    
    const linkedAccountId = getUserLinkedAccountId(currentUserId);
    if (!linkedAccountId) return allAccounts;
    
    return allAccounts.filter(a => a.id === linkedAccountId);
  }, [allAccounts, isAdmin, isOwner, currentUserId, mappings, getUserLinkedAccountId]);

  const handleResumeSearch = useCallback((project: SourcingProject) => {
    setActiveProject(project);
    setSourcingTab('linkedin');
    setActiveTab('sourcing');
  }, []);

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

  // Sub-tab selector component
  const SubTabSelector = ({ items, activeValue, onChange }: { 
    items: { value: string; label: string; emoji: string }[];
    activeValue: string;
    onChange: (v: string) => void;
  }) => (
    <div className="flex flex-wrap gap-0 mb-4">
      {items.map((sub, idx) => (
        <button
          key={sub.value}
          onClick={() => onChange(sub.value)}
          className={cn(
            "relative overflow-hidden flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors group",
            idx > 0 && "border-l-0",
            activeValue === sub.value ? "bg-foreground text-background" : "bg-background text-foreground"
          )}
        >
          <span className="text-xs relative z-10">{sub.emoji}</span>
          <span className="relative z-10">{sub.label}</span>
          {activeValue !== sub.value && (
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen w-full max-w-full bg-background">
      <SEOHead
        title="Missions | Konekt"
        description="Gérez vos missions de recrutement, sourcing et prospection"
      />
      <Navbar />

      <main className="pt-20 pb-0 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header — always visible, compact */}
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight uppercase">Missions</h1>
                  {!loading && (
                    <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{accounts.length}</span> compte{accounts.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <InMailQueueStatus />
                {/* Account selector — compact */}
                {accounts.length > 1 && (
                  <select
                    value={selectedAccount || ''}
                    onChange={(e) => setSelectedAccount(e.target.value || null)}
                    className="h-[30px] px-2 text-[10px] uppercase tracking-wider border border-foreground bg-background text-foreground font-medium"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name || a.identifier}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Tabs — brutal style */}
          <div className="mb-3 md:mb-5 sm:mb-6 min-w-0">
            <div className="flex flex-wrap gap-0 w-full min-w-0">
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
                    {!isActive && (
                      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ═══ Tab: Missions (Projects) ═══ */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'projects' && 'hidden')}>
            <div className="bg-background border border-foreground p-3 sm:p-6 overflow-hidden">
              <ProjectsList onResumeSearch={handleResumeSearch} />
            </div>
          </div>

          {/* ═══ Tab: Sourcing (LinkedIn + DB + ICP) ═══ */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'sourcing' && 'hidden')}>
            {accounts.length === 0 && sourcingTab === 'linkedin' ? (
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
                  onClick={() => navigate('/settings?tab=connectors')}
                  className="relative overflow-hidden h-[34px] px-6 bg-background text-foreground border border-foreground text-xs font-medium uppercase tracking-wider group"
                >
                  <span className="relative z-10 flex items-center gap-2"><Settings className="w-4 h-4" /> Aller dans les paramètres</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                </button>
              </div>
            ) : (
              <div className="bg-background border border-foreground p-3 sm:p-6">
                <SubTabSelector
                  items={[
                    { value: 'linkedin', label: 'LinkedIn', emoji: '🔗' },
                    { value: 'database', label: 'Base de données', emoji: '🗄️' },
                    { value: 'icp', label: 'ICP', emoji: '🎯' },
                  ]}
                  activeValue={sourcingTab}
                  onChange={setSourcingTab}
                />

                <div className={cn(sourcingTab !== 'linkedin' && 'hidden')}>
                  {accounts.length > 0 ? (
                    <OutreachSearchProvider>
                      <LinkedInSearch
                        accounts={accounts}
                        selectedAccount={selectedAccount}
                        onAccountChange={setSelectedAccount}
                        activeProject={activeProject}
                        onProjectChange={setActiveProject}
                      />
                    </OutreachSearchProvider>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Connectez un compte LinkedIn pour rechercher des candidats.
                    </div>
                  )}
                </div>

                <div className={cn(sourcingTab !== 'database' && 'hidden')}>
                  <ProspectSearch
                    selectedICP={selectedICP}
                    onSelectICP={setSelectedICP}
                    onResults={setProspectResults}
                    searching={prospectSearching}
                    onSearchingChange={setProspectSearching}
                    results={prospectResults}
                  />
                </div>

                <div className={cn(sourcingTab !== 'icp' && 'hidden')}>
                  <ICPList onSearchFromICP={(icp) => { setSelectedICP(icp); setSourcingTab('database'); }} />
                </div>
              </div>
            )}
          </div>

          {/* ═══ Tab: Séquences + Invitations ═══ */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'sequences' && 'hidden')}>
            <div className="bg-background border border-foreground p-3 sm:p-6">
              <SubTabSelector
                items={[
                  { value: 'sequences', label: 'Séquences', emoji: '🔗' },
                  { value: 'invitations', label: 'Invitations', emoji: '🤝' },
                ]}
                activeValue={sequencesSubTab}
                onChange={setSequencesSubTab}
              />

              <div className={cn(sequencesSubTab !== 'sequences' && 'hidden')}>
                <SequencesList
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                  isVisible={activeTab === 'sequences' && sequencesSubTab === 'sequences'}
                />
              </div>

              <div className={cn(sequencesSubTab !== 'invitations' && 'hidden')}>
                <InvitationsPanel
                  accounts={accounts}
                  selectedAccount={selectedAccount}
                  onAccountChange={setSelectedAccount}
                  organizationId={organizationId}
                />
              </div>
            </div>
          </div>

          {/* ═══ Tab: Suivi (Nurturing) ═══ */}
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
