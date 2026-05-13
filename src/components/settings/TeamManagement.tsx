import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Briefcase, Sliders, ChevronDown, X, Plus, Save, Loader2,
  Mail, MessageSquare, Search, Eye, Gauge, Link2, Unlink, UserCog, Users,
  Trash2, Activity, Crown, Shield, User as UserIcon,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { useJobAssignments } from '@/hooks/useJobAssignments';
import { useMemberQuotas, DEFAULT_QUOTAS } from '@/hooks/useMemberQuotas';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberStats } from '@/hooks/useMemberStats';
import { useOrganization, OrganizationMember } from '@/hooks/useOrganization';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  isAdmin: boolean;
  isOwner: boolean;
  isLoading?: boolean;
  onUpdateRole: (params: { memberId: string; role: string }) => void;
  onRemove: (memberId: string) => void;
}

const QUOTA_FIELDS = [
  { key: 'max_inmails_per_day' as const, label: 'InMails', icon: Mail, max: 200 },
  { key: 'max_messages_per_day' as const, label: 'Messages', icon: MessageSquare, max: 500 },
  { key: 'max_searches_per_day' as const, label: 'Recherches', icon: Search, max: 500 },
  { key: 'max_profile_visits_per_day' as const, label: 'Visites profils', icon: Eye, max: 1000 },
];

const roleIcons: Record<string, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  member: UserIcon,
  collaborator: UserCog,
};

const roleLabels: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

export const TeamManagement: React.FC<TeamManagementProps> = ({
  members,
  getDisplayName,
  isAdmin,
  isOwner,
  isLoading,
  onUpdateRole,
  onRemove,
}) => {
  const { organizationId } = useOrganization();
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [selectedLinkedInId, setSelectedLinkedInId] = useState<string>('');
  const [removeConfirm, setRemoveConfirm] = useState<OrganizationMember | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<{ mappingId: string; name: string } | null>(null);
  const { assignments, assign, unassign, isAssigning } = useJobAssignments();
  const { upsertQuota, isSaving, getQuotaForUser } = useMemberQuotas();
  const { linkAccount, unlinkAccount, isLinking, getMappingForUser, getMappingForAccount } = useMemberLinkedInAccounts();
  const { accounts: linkedInAccounts } = useLinkedInAccounts();
  const { data: jobs = [] } = useNotionJobs();
  const userIds = members.map(m => m.user_id);
  const { data: statsMap = {} } = useMemberStats(organizationId, userIds);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Users className="w-4 h-4" />
          Équipe
          <Badge variant="secondary" className="ml-auto text-xs">
            {members.length} membre{members.length > 1 ? 's' : ''}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <BrutalLoader compact />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((member) => {
              const isExpanded = expandedMember === member.user_id;
              const memberJobs = getMemberAssignments(member.user_id);
              const memberQuota = getQuotaForUser(member.user_id);
              const linkedInMapping = getMappingForUser(member.user_id);
              const isEditingQ = !!editingQuotas[member.user_id];
              const stats = statsMap[member.user_id] || { active_sequences: 0, candidates_30d: 0 };
              const RoleIcon = roleIcons[member.role] || UserIcon;
              const canManage = isOwner && member.role !== 'owner';

              return (
                <div key={member.id}>
                  {/* Member collapsed row */}
                  <div
                    className={cn(
                      'flex items-center justify-between gap-3 px-4 py-3 transition-colors',
                      isExpanded ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      aria-expanded={isExpanded}
                    >
                      <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center shrink-0 text-xs font-bold uppercase rounded">
                        {getDisplayName(member.user_id).charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate">{getDisplayName(member.user_id)}</p>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 gap-1 font-medium">
                            <RoleIcon className="w-2.5 h-2.5" />
                            {roleLabels[member.role] || member.role}
                          </Badge>
                          {member.role === 'collaborator' && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 border-info text-info font-semibold uppercase tracking-wider">
                              Externe
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                          {linkedInMapping ? (
                            <span className="inline-flex items-center gap-1">
                              <img src={linkedinLogo} alt="" className="w-3 h-3 object-contain" />
                              <span className="truncate max-w-[120px]">{linkedInMapping.linkedin_account_name || 'Connecté'}</span>
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/50">Pas de LinkedIn</span>
                          )}
                          <span className="text-muted-foreground/30">·</span>
                          <span title="Séquences actives">
                            <Activity className="w-3 h-3 inline mr-0.5" />
                            {stats.active_sequences} séq
                          </span>
                          <span className="text-muted-foreground/30">·</span>
                          <span title="Candidats assignés (30j)">
                            {stats.candidates_30d} cand/30j
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canManage && (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(value) => onUpdateRole({ memberId: member.id, role: value })}
                          >
                            <SelectTrigger className="w-28 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Membre</SelectItem>
                              <SelectItem value="collaborator">Collaborateur</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveConfirm(member)}
                            aria-label={`Supprimer ${getDisplayName(member.user_id)}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? 'Réduire' : 'Détails'}
                      >
                        <ChevronDown className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded panel (admin only) */}
                  {isExpanded && isAdmin && (
                    <div className="bg-muted/30 border-t border-border">
                      {/* Stats détaillées */}
                      <div className="px-4 py-4 grid grid-cols-2 gap-3">
                        <div className="border border-border bg-background p-3">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
                            <Activity className="w-3 h-3" />
                            Séquences actives
                          </div>
                          <p className="text-2xl font-bold tabular-nums mt-1">{stats.active_sequences}</p>
                        </div>
                        <div className="border border-border bg-background p-3">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
                            <Briefcase className="w-3 h-3" />
                            Candidats (30j)
                          </div>
                          <p className="text-2xl font-bold tabular-nums mt-1">{stats.candidates_30d}</p>
                        </div>
                      </div>

                      <div className="border-t border-border" />

                      {/* LinkedIn Account Linking */}
                      <div className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <img src={linkedinLogo} alt="" className="w-4 h-4 object-contain" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compte LinkedIn</span>
                        </div>

                        {linkedInMapping ? (
                          <div className="flex items-center justify-between p-2.5 bg-background border border-border">
                            <div className="flex items-center gap-2">
                              <img src={linkedinLogo} alt="" className="w-6 h-6 object-contain" />
                              <div>
                                <p className="text-xs font-medium">{linkedInMapping.linkedin_account_name}</p>
                                <p className="text-xs text-muted-foreground">ID: {linkedInMapping.linkedin_account_id.slice(0, 12)}…</p>
                              </div>
                            </div>
                            <button
                              onClick={() => setUnlinkConfirm({
                                mappingId: linkedInMapping.id,
                                name: linkedInMapping.linkedin_account_name || 'ce compte',
                              })}
                              className="h-7 px-2 flex items-center gap-1 text-xs uppercase tracking-wide text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive transition-colors"
                            >
                              <Unlink className="w-3 h-3" />
                              Dissocier
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Select value={selectedLinkedInId} onValueChange={setSelectedLinkedInId}>
                              <SelectTrigger className="h-8 text-xs flex-1 rounded-lg border-border">
                                <SelectValue placeholder="Associer un compte LinkedIn…" />
                              </SelectTrigger>
                              <SelectContent>
                                {getAvailableLinkedInAccounts(member.user_id).map(acc => (
                                  <SelectItem key={acc.id} value={acc.id} className="text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <img src={linkedinLogo} alt="" className="w-3 h-3 object-contain" />
                                      {(acc as any).name || (acc as any).identifier || acc.id}
                                      {(acc as any).status === 'OK' && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-success" />
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
                                'h-8 px-3 flex items-center gap-1 text-xs font-medium uppercase tracking-wide border border-border transition-colors',
                                selectedLinkedInId
                                  ? 'bg-accent text-foreground hover:opacity-90'
                                  : 'bg-muted text-muted-foreground cursor-not-allowed',
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
                            <SelectTrigger className="h-8 text-xs flex-1 rounded-lg border-border">
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
                              'h-8 px-3 flex items-center gap-1 text-xs font-medium uppercase tracking-wide border border-border transition-colors',
                              selectedJobId
                                ? 'bg-accent text-foreground hover:opacity-90'
                                : 'bg-muted text-muted-foreground cursor-not-allowed',
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
                                      className="h-6 w-16 text-xs text-right rounded-lg border-border px-1.5"
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
                                      'h-full transition-all duration-300',
                                      pct >= 80 ? 'bg-accent' : 'bg-foreground/40',
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

                  {/* Non-admin expanded note */}
                  {isExpanded && !isAdmin && (
                    <div className="bg-muted/30 border-t border-border px-4 py-4 text-xs text-muted-foreground italic">
                      Les détails de gestion (LinkedIn, postes, quotas) sont visibles uniquement par les administrateurs.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* AlertDialog : suppression de membre */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce membre ?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeConfirm && (
                <>
                  <strong>{getDisplayName(removeConfirm.user_id)}</strong> sera retiré de l'équipe.
                  Cette personne perd l'accès à tous les missions, candidats et données de l'agence.
                  Cette action est irréversible (vous pouvez réinviter ensuite).
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (removeConfirm) {
                  onRemove(removeConfirm.id);
                  setRemoveConfirm(null);
                }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog : dissociation LinkedIn */}
      <AlertDialog open={!!unlinkConfirm} onOpenChange={(open) => !open && setUnlinkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dissocier ce compte LinkedIn ?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkConfirm && (
                <>
                  Le compte <strong>{unlinkConfirm.name}</strong> ne sera plus rattaché à ce membre.
                  Le compte LinkedIn lui-même n'est pas affecté côté LinkedIn.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (unlinkConfirm) {
                  unlinkAccount(unlinkConfirm.mappingId);
                  setUnlinkConfirm(null);
                }
              }}
            >
              Dissocier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
