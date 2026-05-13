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
  Gauge, Link2, Unlink, UserCog, Users,
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

// Seul quota EFFECTIVEMENT câblé côté backend (process-sequences /
// checkQuotaForAction). Les anciens max_inmails_per_day, max_messages_per_day,
// max_searches_per_day, max_profile_visits_per_day étaient en DB mais jamais
// lus — retirés de l'UI pour ne pas mentir à l'admin. `max_actions_per_day`
// cumule InMail + message + smart_message + connection_request envoyés
// aujourd'hui pour le compte LinkedIn de l'user.
const QUOTA_FIELDS = [
  {
    key: 'max_actions_per_day' as const,
    label: 'Actions visibles / jour',
    icon: Gauge,
    max: 200,
    hint: 'InMails + messages + invitations envoyés depuis le compte LinkedIn de ce membre',
  },
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
  const [editingQuotas, setEditingQuotas] = useState<Record<string, Partial<typeof DEFAULT_QUOTAS>>>({});

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
        max_actions_per_day: existing?.max_actions_per_day ?? DEFAULT_QUOTAS.max_actions_per_day,
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
                  {/* Collapsed row */}
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
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          {linkedInMapping ? (
                            <span className="inline-flex items-center gap-1">
                              <img src={linkedinLogo} alt="" className="w-3 h-3 object-contain" />
                              <span className="truncate max-w-[120px]">{linkedInMapping.linkedin_account_name || 'Connecté'}</span>
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/50">Pas de LinkedIn</span>
                          )}
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 gap-1 font-normal">
                            <Activity className="w-2.5 h-2.5" />
                            {stats.active_sequences} séq
                          </Badge>
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 gap-1 font-normal">
                            <Briefcase className="w-2.5 h-2.5" />
                            {stats.candidates_30d} cand/30j
                          </Badge>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                        aria-label={isExpanded ? 'Réduire' : 'Détails'}
                      >
                        <ChevronDown className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')} />
                      </Button>
                    </div>
                  </div>

                  {/* Expanded panel (admin only) */}
                  {isExpanded && isAdmin && (
                    <div className="bg-muted/30 border-t border-border">
                      {/* Stats détaillées */}
                      <div className="px-4 py-4 grid grid-cols-2 gap-3">
                        <Card>
                          <CardContent className="p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
                              <Activity className="w-3 h-3" />
                              Séquences actives
                            </div>
                            <p className="text-2xl font-bold tabular-nums mt-1">{stats.active_sequences}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
                              <Briefcase className="w-3 h-3" />
                              Candidats (30j)
                            </div>
                            <p className="text-2xl font-bold tabular-nums mt-1">{stats.candidates_30d}</p>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="border-t border-border" />

                      {/* LinkedIn Account */}
                      <SectionRow
                        icon={<img src={linkedinLogo} alt="" className="w-4 h-4 object-contain" />}
                        label="Compte LinkedIn"
                      >
                        {linkedInMapping ? (
                          <div className="flex items-center justify-between p-2.5 bg-background border border-border rounded">
                            <div className="flex items-center gap-2 min-w-0">
                              <img src={linkedinLogo} alt="" className="w-6 h-6 object-contain shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{linkedInMapping.linkedin_account_name}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  ID: {linkedInMapping.linkedin_account_id.slice(0, 12)}…
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setUnlinkConfirm({
                                mappingId: linkedInMapping.id,
                                name: linkedInMapping.linkedin_account_name || 'ce compte',
                              })}
                            >
                              <Unlink className="w-3 h-3" />
                              Dissocier
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Select value={selectedLinkedInId} onValueChange={setSelectedLinkedInId}>
                              <SelectTrigger className="h-8 text-xs flex-1">
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1"
                              onClick={() => handleLinkLinkedIn(member)}
                              disabled={!selectedLinkedInId || isLinking}
                            >
                              {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                              Lier
                            </Button>
                          </div>
                        )}
                      </SectionRow>

                      <div className="border-t border-border" />

                      {/* Job Assignments */}
                      <SectionRow
                        icon={<Briefcase className="w-3.5 h-3.5 text-muted-foreground" />}
                        label="Postes assignés"
                      >
                        {memberJobs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {memberJobs.map(a => (
                              <Badge
                                key={a.id}
                                variant="default"
                                className="gap-1 font-medium"
                              >
                                {a.job_title || a.job_id}
                                <button
                                  type="button"
                                  onClick={() => unassign(a.id)}
                                  className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                                  aria-label="Retirer"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                            <SelectTrigger className="h-8 text-xs flex-1">
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            onClick={() => handleAssignJob(member)}
                            disabled={!selectedJobId || isAssigning}
                          >
                            {isAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                            Assigner
                          </Button>
                        </div>
                      </SectionRow>

                      <div className="border-t border-border" />

                      {/* Quotas */}
                      <SectionRow
                        icon={<Sliders className="w-3.5 h-3.5 text-muted-foreground" />}
                        label="Quota journalier"
                        trailing={!isEditingQ && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => startEditingQuotas(member.user_id)}
                          >
                            Modifier
                          </Button>
                        )}
                      >
                        <div className="space-y-3">
                          {QUOTA_FIELDS.map(({ key, label, icon: Icon, max, hint }) => {
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
                                      className="h-6 w-16 text-xs text-right px-1.5"
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
                                <div className="h-1 bg-border w-full rounded">
                                  <div
                                    className={cn(
                                      'h-full transition-all duration-300 rounded',
                                      pct >= 80 ? 'bg-accent' : 'bg-foreground/40',
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <p className="text-[10px] text-muted-foreground/80 mt-1">{hint}</p>
                              </div>
                            );
                          })}
                        </div>

                        {isEditingQ && (
                          <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                            <Button
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleSaveQuotas(member.user_id)}
                              disabled={isSaving}
                            >
                              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Sauvegarder
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingQuotas(prev => {
                                const next = { ...prev };
                                delete next[member.user_id];
                                return next;
                              })}
                            >
                              Annuler
                            </Button>
                          </div>
                        )}
                      </SectionRow>
                    </div>
                  )}

                  {/* Non-admin expanded note */}
                  {isExpanded && !isAdmin && (
                    <div className="bg-muted/30 border-t border-border px-4 py-4 text-xs text-muted-foreground italic">
                      Les détails de gestion (LinkedIn, postes, quota) sont visibles uniquement par les administrateurs.
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

// ─── Petit composant utilitaire pour homogénéiser les sections du panel ──
interface SectionRowProps {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}

const SectionRow: React.FC<SectionRowProps> = ({ icon, label, trailing, children }) => (
  <div className="px-4 py-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {trailing}
    </div>
    {children}
  </div>
);
