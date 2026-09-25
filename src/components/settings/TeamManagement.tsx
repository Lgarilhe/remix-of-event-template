import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Sliders, ChevronDown, Save, Loader2,
  Gauge, Link2, Unlink, UserCog, Users,
  Trash2, Crown, Shield, User as UserIcon,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import {
  useMemberQuotas, DEFAULT_QUOTAS,
  MAX_ACTIONS_PER_DAY_MIN, MAX_ACTIONS_PER_DAY_MAX, isValidMaxActionsPerDay,
} from '@/hooks/useMemberQuotas';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization, type OrganizationMember } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { ErrorBox } from '@/components/marketplace/ErrorBox';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  /** E-mail du membre (get_org_member_emails), null si inconnu. */
  getEmail?: (userId: string) => string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isLoading?: boolean;
  onUpdateRole: (params: { memberId: string; role: string }) => void;
  /** Arrête les envois du membre puis le retire (rejette en cas d'échec, rien n'est retiré). */
  onRemove: (params: { memberId: string; userId: string }) => Promise<unknown>;
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
    max: MAX_ACTIONS_PER_DAY_MAX,
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
  getEmail,
  isAdmin,
  isOwner,
  isLoading,
  onUpdateRole,
  onRemove,
}) => {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [selectedLinkedInId, setSelectedLinkedInId] = useState<string>('');
  const [removeConfirm, setRemoveConfirm] = useState<OrganizationMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  // accountId : compte affiché à l'ouverture de la confirmation, transmis au
  // serveur qui refuse une liaison repointée entre-temps.
  const [unlinkConfirm, setUnlinkConfirm] = useState<{ mappingId: string; accountId: string; name: string } | null>(null);
  const {
    upsertQuota, isSaving, getQuotaForUser, isReady: quotasReady, isError: quotasError, refetch: refetchQuotas,
  } = useMemberQuotas();
  const {
    linkAccount, unlinkAccount, isLinking, isUnlinking, isReady: mappingsReady,
    isError: mappingsError, refetch: refetchMappings,
    getMappingForUser, getMappingForAccount,
  } = useMemberLinkedInAccounts();
  const { accounts: linkedInAccounts } = useLinkedInAccounts();
  const { organizationId } = useOrganization();
  const [editingQuotas, setEditingQuotas] = useState<Record<string, Partial<typeof DEFAULT_QUOTAS>>>({});

  const handleLinkLinkedIn = (member: OrganizationMember) => {
    if (!selectedLinkedInId) return;
    // Liaison par le serveur (claim_linkedin_account), qui prend le nom du
    // compte chez le prestataire ; le hook vérifie le résultat et l'annonce.
    linkAccount({ userId: member.user_id, linkedinAccountId: selectedLinkedInId });
    setSelectedLinkedInId('');
  };

  const startEditingQuotas = (userId: string) => {
    // Quotas non lus : l'éditeur partirait de 80 et écraserait la valeur enregistrée.
    if (!quotasReady) return;
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
    if (!q || !isValidMaxActionsPerDay(q.max_actions_per_day)) return;
    // L'éditeur ne se ferme qu'après l'enregistrement confirmé (ligne relue) :
    // sur erreur, il reste ouvert avec la saisie.
    upsertQuota({ userId, quotas: q }, {
      onSuccess: () => setEditingQuotas(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      }),
    });
  };

  // Retrait d'un membre : ses inscriptions en cours depuis son compte LinkedIn
  // relié, comptées pour la confirmation (le serveur les met en pause avant
  // le retrait).
  const removeAccountId = removeConfirm
    ? getMappingForUser(removeConfirm.user_id)?.linkedin_account_id ?? null
    : null;
  const activeEnrollments = useQuery({
    queryKey: ['member-active-enrollments', organizationId, removeAccountId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId!)
        .eq('account_id', removeAccountId!)
        .eq('status', 'active');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organizationId && !!removeAccountId,
    staleTime: 0,
  });

  const sendingStopSentence = (): string => {
    const generic = 'Ses séquences en cours et ses InMails programmés seront arrêtés.';
    if (mappingsError || !mappingsReady) return generic;
    if (!removeAccountId) return "Aucun compte LinkedIn n'est relié à ce membre : aucun envoi LinkedIn n'est à arrêter.";
    if (!activeEnrollments.isSuccess) return generic;
    const n = activeEnrollments.data;
    return n > 0
      ? `Ses séquences en cours (${n} candidat${n > 1 ? 's' : ''}) et ses InMails programmés seront arrêtés.`
      : "Aucune séquence n'est en cours depuis son compte LinkedIn ; ses InMails programmés seront annulés.";
  };

  const handleConfirmRemove = async () => {
    if (!removeConfirm || isRemoving) return;
    setIsRemoving(true);
    try {
      await onRemove({ memberId: removeConfirm.id, userId: removeConfirm.user_id });
      setRemoveConfirm(null);
    } catch {
      // Erreur annoncée par le hook ; la confirmation reste ouverte pour réessayer.
    } finally {
      setIsRemoving(false);
    }
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
              const memberQuota = getQuotaForUser(member.user_id);
              const linkedInMapping = getMappingForUser(member.user_id);
              const isEditingQ = !!editingQuotas[member.user_id];
              const RoleIcon = roleIcons[member.role] || UserIcon;
              const canManage = isOwner && member.role !== 'owner';
              const memberName = getDisplayName(member.user_id);
              const memberEmail = getEmail?.(member.user_id) ?? null;

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
                        {memberName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate">{memberName}</p>
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
                        {/* Pas d'e-mail en double quand le nom affiché est déjà l'e-mail */}
                        {memberEmail && memberEmail !== memberName && (
                          <p className="text-xs text-muted-foreground truncate">{memberEmail}</p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          {linkedInMapping ? (
                            <span className="inline-flex items-center gap-1">
                              <img src={linkedinLogo} alt="" className="w-3 h-3 object-contain" />
                              <span className="truncate max-w-[120px]">{linkedInMapping.linkedin_account_name || 'Connecté'}</span>
                            </span>
                          ) : mappingsError ? (
                            // Lecture ratée : un compte relié ne doit pas paraître absent
                            <span className="italic text-muted-foreground/50">Liaison LinkedIn non chargée</span>
                          ) : !mappingsReady ? (
                            // Lecture en cours (y compris un nouvel essai) : rien n'est encore su
                            <Loader2 className="w-3 h-3 animate-spin" aria-label="Chargement de la liaison LinkedIn" />
                          ) : (
                            <span className="italic text-muted-foreground/50">Pas de LinkedIn</span>
                          )}
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
                            aria-label={`Retirer ${memberName} de l'équipe`}
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
                                accountId: linkedInMapping.linkedin_account_id,
                                name: linkedInMapping.linkedin_account_name || 'ce compte',
                              })}
                              disabled={isUnlinking}
                            >
                              <Unlink className="w-3 h-3" />
                              Dissocier
                            </Button>
                          </div>
                        ) : mappingsError ? (
                          <ErrorBox title="Impossible de charger les comptes LinkedIn liés." onRetry={() => { void refetchMappings(); }} />
                        ) : !mappingsReady ? (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-label="Chargement des comptes LinkedIn liés" />
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
                            {/* Liaisons non lues : « Pas de LinkedIn » peut être faux, et le
                                serveur remplacerait la liaison existante du membre. */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1"
                              onClick={() => handleLinkLinkedIn(member)}
                              disabled={!selectedLinkedInId || isLinking || !mappingsReady}
                            >
                              {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                              Lier
                            </Button>
                          </div>
                        )}
                      </SectionRow>

                      <div className="border-t border-border" />

                      {/* Quotas */}
                      <SectionRow
                        icon={<Sliders className="w-3.5 h-3.5 text-muted-foreground" />}
                        label="Quota journalier"
                        trailing={!isEditingQ && !quotasError && quotasReady && (
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
                        {quotasError ? (
                          // Lecture ratée : pas de 80 par défaut affiché comme la vraie valeur
                          <ErrorBox title="Impossible de charger les quotas." onRetry={() => { void refetchQuotas(); }} />
                        ) : !quotasReady ? (
                          // Lecture en cours : ni 80 par défaut affiché comme la vraie valeur, ni « Modifier »
                          <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                            Chargement du quota…
                          </div>
                        ) : (
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
                                      min={MAX_ACTIONS_PER_DAY_MIN}
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
                                {isEditingQ && !isValidMaxActionsPerDay(value) && (
                                  <p className="text-[10px] text-destructive mt-1">
                                    Valeur entre {MAX_ACTIONS_PER_DAY_MIN} et {MAX_ACTIONS_PER_DAY_MAX}.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        )}

                        {isEditingQ && !quotasError && quotasReady && (
                          <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                            <Button
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleSaveQuotas(member.user_id)}
                              disabled={isSaving || !isValidMaxActionsPerDay(editingQuotas[member.user_id]?.max_actions_per_day)}
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
                      Les détails de gestion (LinkedIn, quota) sont visibles uniquement par les administrateurs.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* AlertDialog : suppression de membre */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && !isRemoving && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce membre de l'équipe ?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeConfirm && (
                <>
                  <strong>{getDisplayName(removeConfirm.user_id)}</strong> sera retiré de l'équipe et perdra
                  l'accès aux missions, candidats et données de l'organisation.
                  {' '}{sendingStopSentence()}
                  {' '}Vous pourrez réinscrire ses candidats depuis votre compte, et le réinviter plus tard.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={isRemoving}
              onClick={(e) => {
                // La confirmation reste ouverte jusqu'au résultat : fermée au
                // succès, gardée en cas d'échec (rien n'a été retiré).
                e.preventDefault();
                void handleConfirmRemove();
              }}
            >
              {isRemoving && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Retirer de l'équipe
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
                  Les relances qui partent de ce compte seront mises en pause et ses InMails programmés annulés.
                  La session LinkedIn reste ouverte : si le compte est relié de nouveau, les relances pourront
                  être reprises depuis la liste des inscrits.
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
                  unlinkAccount({ mappingId: unlinkConfirm.mappingId, expectedAccountId: unlinkConfirm.accountId });
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
