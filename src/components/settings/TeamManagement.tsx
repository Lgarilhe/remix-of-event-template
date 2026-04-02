import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Briefcase, Sliders, ChevronDown, X, Plus, Save, Loader2,
  Mail, MessageSquare, Search, Eye, Gauge, Link2, Unlink, UserCog,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { useJobAssignments } from '@/hooks/useJobAssignments';
import { useMemberQuotas, DEFAULT_QUOTAS } from '@/hooks/useMemberQuotas';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { OrganizationMember } from '@/hooks/useOrganization';
import { cn } from '@/lib/utils';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  isAdmin: boolean;
}

const QUOTA_FIELDS = [
  { key: 'max_inmails_per_day' as const, label: 'InMails', icon: Mail, max: 200 },
  { key: 'max_messages_per_day' as const, label: 'Messages', icon: MessageSquare, max: 500 },
  { key: 'max_searches_per_day' as const, label: 'Recherches', icon: Search, max: 500 },
  { key: 'max_profile_visits_per_day' as const, label: 'Visites profils', icon: Eye, max: 1000 },
];

export const TeamManagement: React.FC<TeamManagementProps> = ({
  members,
  getDisplayName,
  isAdmin,
}) => {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [selectedLinkedInId, setSelectedLinkedInId] = useState<string>('');
  const { assignments, assign, unassign, isAssigning } = useJobAssignments();
  const { upsertQuota, isSaving, getQuotaForUser } = useMemberQuotas();
  const { mappings, linkAccount, unlinkAccount, isLinking, getMappingForUser, getMappingForAccount } = useMemberLinkedInAccounts();
  const { accounts: linkedInAccounts } = useLinkedInAccounts();
  const { data: jobs = [] } = useNotionJobs();
  const [editingQuotas, setEditingQuotas] = useState<Record<string, typeof DEFAULT_QUOTAS>>({});

  const getMemberAssignments = (userId: string) =>
    assignments.filter(a => a.user_id === userId);

  const handleAssignJob = (member: OrganizationMember) => {
    if (!selectedJobId) return;
    const job = jobs.find(j => j.id === selectedJobId);
    assign({
      memberId: member.id,
      userId: member.user_id,
      jobId: selectedJobId,
      jobTitle: job?.title || selectedJobId,
    });
    setSelectedJobId('');
  };

  const handleLinkLinkedIn = (member: OrganizationMember) => {
    if (!selectedLinkedInId) return;
    const account = linkedInAccounts.find(a => a.id === selectedLinkedInId);
    linkAccount({
      userId: member.user_id,
      linkedinAccountId: selectedLinkedInId,
      linkedinAccountName: account?.name || account?.identifier || selectedLinkedInId,
    });
    setSelectedLinkedInId('');
  };

  const startEditingQuotas = (userId: string) => {
    const existing = getQuotaForUser(userId);
    setEditingQuotas(prev => ({
      ...prev,
      [userId]: {
        max_inmails_per_day: existing?.max_inmails_per_day ?? DEFAULT_QUOTAS.max_inmails_per_day,
        max_messages_per_day: existing?.max_messages_per_day ?? DEFAULT_QUOTAS.max_messages_per_day,
        max_searches_per_day: existing?.max_searches_per_day ?? DEFAULT_QUOTAS.max_searches_per_day,
        max_profile_visits_per_day: existing?.max_profile_visits_per_day ?? DEFAULT_QUOTAS.max_profile_visits_per_day,
      },
    }));
  };

  const handleSaveQuotas = (userId: string) => {
    const q = editingQuotas[userId];
    if (!q) return;
    upsertQuota({ userId, quotas: q });
    setEditingQuotas(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  // Available LinkedIn accounts = those not already linked to another member
  const getAvailableLinkedInAccounts = (currentUserId: string) => {
    return linkedInAccounts.filter(acc => {
      const mapping = getMappingForAccount(acc.id);
      return !mapping || mapping.user_id === currentUserId;
    });
  };

  if (!isAdmin) return null;

  return (
    <div className="border border-border bg-background">
      {/* Header bar */}
      <div className="bg-foreground text-background px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wider">Gestion d'équipe</span>
        </div>
        <span className="text-xs uppercase tracking-wider opacity-70">{members.length} membre{members.length > 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-border">
        {members.map((member) => {
          const isExpanded = expandedMember === member.user_id;
          const memberJobs = getMemberAssignments(member.user_id);
          const memberQuota = getQuotaForUser(member.user_id);
          const linkedInMapping = getMappingForUser(member.user_id);
          const isEditingQ = !!editingQuotas[member.user_id];

          return (
            <div key={member.id}>
              {/* Member row */}
              <button
                onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 transition-colors group",
                  isExpanded ? "bg-muted" : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center shrink-0 text-xs font-bold uppercase">
                    {getDisplayName(member.user_id).charAt(0)}
                  </div>
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-foreground truncate">{getDisplayName(member.user_id)}</p>
                      {(member.role as string) === 'collaborator' && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 border-blue-400 text-blue-600 font-semibold uppercase tracking-wider">
                          <UserCog className="w-2.5 h-2.5 mr-0.5" />
                          Externe
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {linkedInMapping ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3 object-contain" />
                          {linkedInMapping.linkedin_account_name || 'Connecté'}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50 italic">Pas de LinkedIn</span>
                      )}
                      {memberJobs.length > 0 && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-xs text-muted-foreground">{memberJobs.length} poste{memberJobs.length > 1 ? 's' : ''}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </button>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="bg-muted/30 border-t border-border">
                  {/* LinkedIn Account Linking */}
                  <div className="px-4 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compte LinkedIn</span>
                    </div>

                    {linkedInMapping ? (
                      <div className="flex items-center justify-between p-2.5 bg-background border border-border">
                        <div className="flex items-center gap-2">
                          <img src={linkedinLogo} alt="LinkedIn" className="w-6 h-6 object-contain" />
                          <div>
                            <p className="text-xs font-medium">{linkedInMapping.linkedin_account_name}</p>
                            <p className="text-xs text-muted-foreground">ID: {linkedInMapping.linkedin_account_id.slice(0, 12)}…</p>
                          </div>
                        </div>
                        <button
                          onClick={() => unlinkAccount(linkedInMapping.id)}
                          className="h-7 px-2 flex items-center gap-1 text-xs uppercase tracking-wide text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive transition-colors"
                        >
                          <Unlink className="w-3 h-3" />
                          Dissocier
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select value={selectedLinkedInId} onValueChange={setSelectedLinkedInId}>
                          <SelectTrigger className="h-8 text-xs flex-1 rounded-none border-border">
                            <SelectValue placeholder="Associer un compte LinkedIn…" />
                          </SelectTrigger>
                          <SelectContent>
                            {getAvailableLinkedInAccounts(member.user_id).map(acc => (
                              <SelectItem key={acc.id} value={acc.id} className="text-xs">
                                <span className="flex items-center gap-1.5">
                                  <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3 object-contain" />
                                  {(acc as any).name || (acc as any).identifier || acc.id}
                                  {(acc as any).status === 'OK' && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                  )}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          onClick={() => handleLinkLinkedIn(member)}
                          disabled={!selectedLinkedInId || isLinking}
                          className={cn(
                            "h-8 px-3 flex items-center gap-1 text-xs font-medium uppercase tracking-wide border border-border transition-colors",
                            selectedLinkedInId
                              ? "bg-accent text-foreground hover:opacity-90"
                              : "bg-muted text-muted-foreground cursor-not-allowed"
                          )}
                        >
                          {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                          Lier
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border" />

                  {/* Job Assignments */}
                  <div className="px-4 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Postes assignés</span>
                    </div>

                    {memberJobs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {memberJobs.map(a => (
                          <span key={a.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-foreground text-background text-xs font-medium">
                            {a.job_title || a.job_id}
                            <button onClick={() => unassign(a.id)} className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger className="h-8 text-xs flex-1 rounded-none border-border">
                          <SelectValue placeholder="Sélectionner un poste…" />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs
                            .filter(j => !memberJobs.some(a => a.job_id === j.id))
                            .map(j => (
                              <SelectItem key={j.id} value={j.id} className="text-xs">
                                {j.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <button
                        onClick={() => handleAssignJob(member)}
                        disabled={!selectedJobId || isAssigning}
                        className={cn(
                          "h-8 px-3 flex items-center gap-1 text-xs font-medium uppercase tracking-wide border border-border transition-colors",
                          selectedJobId
                            ? "bg-accent text-foreground hover:opacity-90"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        {isAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Assigner
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-border" />

                  {/* Quotas */}
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quotas journaliers</span>
                      </div>
                      {!isEditingQ && (
                        <button
                          onClick={() => startEditingQuotas(member.user_id)}
                          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground border-b border-dotted border-muted-foreground hover:border-border transition-colors"
                        >
                          Modifier
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {QUOTA_FIELDS.map(({ key, label, icon: Icon, max }) => {
                        const value = isEditingQ
                          ? (editingQuotas[member.user_id]?.[key] ?? 0)
                          : (memberQuota?.[key] ?? DEFAULT_QUOTAS[key]);
                        const pct = Math.min(100, (value / max) * 100);

                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <Icon className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">{label}</span>
                              </div>
                              {isEditingQ ? (
                                <Input
                                  type="number"
                                  min={0}
                                  max={max}
                                  className="h-6 w-16 text-xs text-right rounded-none border-border px-1.5"
                                  value={value}
                                  onChange={e => setEditingQuotas(prev => ({
                                    ...prev,
                                    [member.user_id]: {
                                      ...prev[member.user_id],
                                      [key]: parseInt(e.target.value) || 0,
                                    },
                                  }))}
                                />
                              ) : (
                                <span className="text-xs font-bold tabular-nums">{value}</span>
                              )}
                            </div>
                            <div className="h-1 bg-border w-full">
                              <div
                                className={cn(
                                  "h-full transition-all duration-300",
                                  pct >= 80 ? "bg-accent" : "bg-foreground/40"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isEditingQ && (
                      <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                        <button
                          onClick={() => handleSaveQuotas(member.user_id)}
                          disabled={isSaving}
                          className="h-8 px-4 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide bg-foreground text-background hover:opacity-90 transition-opacity"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Sauvegarder
                        </button>
                        <button
                          onClick={() => setEditingQuotas(prev => {
                            const next = { ...prev };
                            delete next[member.user_id];
                            return next;
                          })}
                          className="h-8 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground border border-border hover:border-border transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
