import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MissionOutreachProps {
  project: SourcingProject;
}

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
          Pour gérer vos séquences d'outreach, connectez d'abord un compte LinkedIn.
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

export const MissionOutreach = ({ project }: MissionOutreachProps) => {
  const navigate = useNavigate();
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator, organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [outreachTab, setOutreachTab] = useState<'sequences' | 'invitations' | 'messages'>('sequences');

  // Enrollment stats
  const [enrollmentStats, setEnrollmentStats] = useState({ active: 0, completed: 0, replied: 0, total: 0 });

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

  // Fetch enrollment stats for this project's sequences
  useEffect(() => {
    if (!project.id) return;
    const fetchStats = async () => {
      const { data: sequences } = await (supabase
        .from('outreach_sequences')
        .select('id') as any)
        .eq('project_id', project.id);

      if (!sequences?.length) return;

      const seqIds = sequences.map(s => s.id);
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('status')
        .in('sequence_id', seqIds);

      if (!enrollments) return;
      setEnrollmentStats({
        total: enrollments.length,
        active: enrollments.filter(e => e.status === 'active').length,
        completed: enrollments.filter(e => e.status === 'completed').length,
        replied: enrollments.filter(e => e.status === 'replied').length,
      });
    };
    fetchStats();
  }, [project.id]);

  const subTabs = [
    { value: 'sequences', label: 'Séquences', emoji: '⚡' },
    { value: 'invitations', label: 'Invitations', emoji: '📨' },
  ];

  if (accountsLoading) {
    return (
      <div className="bg-background border border-foreground border-t-0 p-6">
        <BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']} />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <EmptyAccountState />;
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

      {/* Enrollment stats */}
      {enrollmentStats.total > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-foreground/10">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.total} inscrits
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.active} en cours
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {enrollmentStats.replied} répondu
          </span>
          {enrollmentStats.replied > 0 && (
            <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">
              {Math.round((enrollmentStats.replied / enrollmentStats.total) * 100)}% taux de réponse
            </span>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-0 px-4 pt-3 pb-0">
        {subTabs.map((sub, idx) => (
          <button
            key={sub.value}
            onClick={() => setOutreachTab(sub.value as 'sequences' | 'invitations')}
            className={cn(
              "relative overflow-hidden flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors group shrink-0",
              idx > 0 && "border-l-0",
              outreachTab === sub.value ? "bg-foreground text-background" : "bg-background text-foreground"
            )}
          >
            <span className="relative z-10">{sub.emoji}</span>
            <span className="relative z-10">{sub.label}</span>
            {outreachTab !== sub.value && (
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            )}
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
