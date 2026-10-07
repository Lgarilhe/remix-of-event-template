import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sliders, ChevronDown, Loader2,
  Gauge, Link2, Unlink, Users, Trash2,
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
import { plural } from '@/lib/plural';
import { ErrorBox } from '@/components/layout/ErrorBox';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  /** E-mail du membre (get_org_member_emails), null si inconnu. */
  getEmail?: (userId: string) => string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isLoading?: boolean;
  /** Rejette en cas d'échec (message affiché par le hook) : la confirmation reste ouverte. */
  onUpdateRole: (params: { memberId: string; role: string }) => Promise<unknown>;
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
    hint: 'InMails, messages et invitations envoyés depuis le compte LinkedIn de ce membre',
  },
];

const roleLabels: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

/** Revue design (F-09) : ce que le nouveau rôle ouvre ou ferme, lu dans la confirmation. */
const ORG_SETTINGS = 'les réglages de l’organisation (invitations et quotas de l’équipe, abonnement et crédits, règles de l’assistant)';
const roleConsequence = (role: string, name: string): string => {
  if (role === 'admin') return `${name} aura les droits d’un administrateur : en plus des missions et des candidats, ${ORG_SETTINGS}.`;
  if (role === 'member') return `${name} aura les droits d’un membre : les missions et les candidats, sans ${ORG_SETTINGS}.`;
  return `${name} aura le rôle ${roleLabels[role] || role}.`;
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
  // Changement de rôle confirmé (F-09) : il ouvre ou ferme les réglages de l'organisation.
  const [roleConfirm, setRoleConfirm] = useState<{ member: OrganizationMember; role: string } | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
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

  // Le serveur met ses inscriptions en pause (jamais un arrêt définitif) et
  // annule ses InMails programmés. « Reprendre » échouera ensuite (compte plus
  // relié) : la seule voie pour recontacter ces candidats est une autre
  // séquence, avec la dérogation « Inscrire quand même » (propriétaire ou
  // administrateur, seuls à lire cette confirmation).
  const sendingStopSentence = (): string => {
    const reenroll = ' Ses candidats resteront en pause : pour les recontacter, inscrivez-les dans une autre séquence depuis votre compte (option « Inscrire quand même »).';
    const generic = `Ses séquences en cours seront mises en pause et ses InMails programmés annulés.${reenroll}`;
    if (mappingsError || !mappingsReady) return generic;
    if (!removeAccountId) return "Aucun compte LinkedIn n'est relié à ce membre : aucun envoi LinkedIn n'est à arrêter.";
    if (!activeEnrollments.isSuccess) return generic;
    const n = activeEnrollments.data;
    return n > 0
      ? `Ses séquences en cours (${n} candidat${n > 1 ? 's' : ''}) seront mises en pause et ses InMails programmés annulés.${reenroll}`
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

  const handleConfirmRole = async () => {
    if (!roleConfirm || isChangingRole) return;
    setIsChangingRole(true);
    try {
      await onUpdateRole({ memberId: roleConfirm.member.id, role: roleConfirm.role });
      setRoleConfirm(null);
    } catch {
      // Erreur annoncée par le hook ; la confirmation reste ouverte pour réessayer.
    } finally {
      setIsChangingRole(false);
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
      {/* Revue design (F-01) : titre en casse de phrase, nombre de membres en texte discret à droite.
          Design simplifié : « Membres », la rubrique s'appelle déjà « Équipe ». */}
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" aria-hidden="true" />
          Membres
        </CardTitle>
        {!isLoading && (
          <span className="text-xs text-muted-foreground">{plural(members.length, 'membre')}</span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 py-3">
            <p role="status" className="sr-only">Chargement de l’équipe…</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3" aria-hidden="true">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {members.map((member) => {
              const isExpanded = expandedMember === member.user_id;
              const memberQuota = getQuotaForUser(member.user_id);
              const linkedInMapping = getMappingForUser(member.user_id);
              const isEditingQ = !!editingQuotas[member.user_id];
              const canManage = isOwner && member.role !== 'owner';
              const memberName = getDisplayName(member.user_id);
              const memberEmail = getEmail?.(member.user_id) ?? null;
              const panelId = `membre-${member.id}-details`;
              const quotaInputId = `membre-${member.id}-quota`;

              return (
                <div key={member.id}>
                  {/* Collapsed row. Revue design (F-16) : sous sm, rôle et retrait passent sous l'identité.
                      Design simplifié : liste à plat, la ligne part du bord du titre ; ouverte, le chevron
                      et le panneau suffisent, sans fond. */}
                  <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                      className="-mx-2 h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal px-2 py-1.5 text-left font-normal active:scale-100"
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? panelId : undefined}
                    >
                      {/* Revue design (F-18) : avatar rond et neutre, comme partout ailleurs. */}
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground-secondary"
                        aria-hidden="true"
                      >
                        {memberName.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{memberName}</span>
                          {/* Design simplifié : le rôle en texte, sans pastille. Quand le sélecteur de la
                              ligne l'affiche déjà, il n'est pas répété. */}
                          {!canManage && (
                            <span className="text-xs text-muted-foreground">{roleLabels[member.role] || member.role}</span>
                          )}
                        </span>
                        {/* Pas d'e-mail en double quand le nom affiché est déjà l'e-mail */}
                        {memberEmail && memberEmail !== memberName && (
                          <span className="block truncate text-xs text-muted-foreground">{memberEmail}</span>
                        )}
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {linkedInMapping ? (
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <img src={linkedinLogo} alt="" className="h-3 w-3 shrink-0 object-contain" />
                              <span className="max-w-40 truncate">{linkedInMapping.linkedin_account_name || 'Connecté'}</span>
                            </span>
                          ) : mappingsError ? (
                            // Lecture ratée : un compte relié ne doit pas paraître absent
                            <span>Liaison LinkedIn non chargée</span>
                          ) : !mappingsReady ? (
                            // Lecture en cours (y compris un nouvel essai) : rien n'est encore su
                            <span>Chargement de la liaison LinkedIn…</span>
                          ) : (
                            <span>Pas de LinkedIn</span>
                          )}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn('transition-transform', isExpanded && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </Button>

                    {canManage ? (
                      <div className="flex shrink-0 items-center gap-1.5 pl-11 sm:w-48 sm:justify-end sm:pl-0">
                        <Select
                          value={member.role}
                          onValueChange={(value) => {
                            // Revue design (F-09) : le rôle ne change qu'après une confirmation qui dit la conséquence.
                            if (value !== member.role) setRoleConfirm({ member, role: value });
                          }}
                        >
                          <SelectTrigger className="h-8 w-auto min-w-28 gap-2 text-xs max-md:h-11" aria-label={`Rôle de ${memberName}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Membre</SelectItem>
                            {/* Jusqu'au lot C2, « Collaborateur » n'est proposé qu'au membre
                                qui l'a déjà : ce rôle garde tous les accès d'un membre (C1, R11). */}
                            {member.role === 'collaborator' && (
                              <SelectItem value="collaborator">Collaborateur</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                              onClick={() => setRemoveConfirm(member)}
                              aria-label={`Retirer ${memberName} de l'équipe`}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Retirer de l’équipe</TooltipContent>
                        </Tooltip>
                      </div>
                    ) : isOwner ? (
                      // Même colonne vide sur la ligne du propriétaire : les chevrons restent alignés.
                      <div className="hidden sm:block sm:w-48 sm:shrink-0" aria-hidden="true" />
                    ) : null}
                  </div>

                  {/* Expanded panel (admin only) */}
                  {isExpanded && isAdmin && (
                    <div id={panelId} className="border-t border-border bg-muted/30">
                      {/* LinkedIn Account */}
                      <SectionRow
                        icon={<img src={linkedinLogo} alt="" className="h-4 w-4 object-contain" />}
                        label="Compte LinkedIn"
                      >
                        {linkedInMapping ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <img src={linkedinLogo} alt="" className="h-6 w-6 shrink-0 object-contain" />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{linkedInMapping.linkedin_account_name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  ID : {linkedInMapping.linkedin_account_id.slice(0, 12)}…
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground hover:bg-danger-muted hover:text-danger max-md:h-11"
                              onClick={() => setUnlinkConfirm({
                                mappingId: linkedInMapping.id,
                                accountId: linkedInMapping.linkedin_account_id,
                                name: linkedInMapping.linkedin_account_name || 'ce compte',
                              })}
                              disabled={isUnlinking}
                            >
                              <Unlink aria-hidden="true" />
                              Dissocier
                            </Button>
                          </div>
                        ) : mappingsError ? (
                          <ErrorBox title="Impossible de charger les comptes LinkedIn liés." onRetry={() => { void refetchMappings(); }} />
                        ) : !mappingsReady ? (
                          <div className="space-y-2">
                            <p role="status" className="sr-only">Chargement des comptes LinkedIn liés…</p>
                            <Skeleton className="h-8 w-full rounded-lg" aria-hidden="true" />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <Select value={selectedLinkedInId} onValueChange={setSelectedLinkedInId}>
                              <SelectTrigger className="h-8 min-w-48 flex-1 text-xs max-md:h-11" aria-label={`Compte LinkedIn à associer à ${memberName}`}>
                                <SelectValue placeholder="Associer un compte LinkedIn…" />
                              </SelectTrigger>
                              <SelectContent>
                                {getAvailableLinkedInAccounts(member.user_id).map(acc => (
                                  <SelectItem key={acc.id} value={acc.id} className="text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <img src={linkedinLogo} alt="" className="h-3 w-3 object-contain" />
                                      {acc.name || acc.identifier || acc.id}
                                      {acc.status === 'OK' && (
                                        <>
                                          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                                          <span className="sr-only">(connecté)</span>
                                        </>
                                      )}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {/* Liaisons non lues : « Pas de LinkedIn » peut être faux, et le
                                serveur remplacerait la liaison existante du membre. */}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="max-md:h-11"
                              onClick={() => handleLinkLinkedIn(member)}
                              disabled={!selectedLinkedInId || isLinking || !mappingsReady}
                            >
                              {isLinking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                              Lier
                            </Button>
                          </div>
                        )}
                      </SectionRow>

                      <div className="border-t border-border" />

                      {/* Quotas */}
                      <SectionRow
                        icon={<Sliders className="h-3.5 w-3.5" aria-hidden="true" />}
                        label="Quota journalier"
                        trailing={!isEditingQ && !quotasError && quotasReady && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="max-md:h-11"
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
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
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
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <Icon className="h-3 w-3" aria-hidden="true" />
                                    <label htmlFor={isEditingQ ? quotaInputId : undefined} className="text-xs text-muted-foreground">{label}</label>
                                  </div>
                                  {isEditingQ ? (
                                    <Input
                                      id={quotaInputId}
                                      type="number"
                                      min={MAX_ACTIONS_PER_DAY_MIN}
                                      max={max}
                                      className="h-7 w-20 px-1.5 text-right text-xs max-md:h-11"
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
                                    <span className="text-xs font-semibold tabular-nums">{value}</span>
                                  )}
                                </div>
                                <div className="h-1 w-full rounded-full bg-border" aria-hidden="true">
                                  <div
                                    className="h-full rounded-full bg-muted-foreground transition-all duration-300"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                                {isEditingQ && !isValidMaxActionsPerDay(value) && (
                                  <p className="mt-1 text-xs text-danger">
                                    Valeur entre {MAX_ACTIONS_PER_DAY_MIN} et {MAX_ACTIONS_PER_DAY_MAX}.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        )}

                        {isEditingQ && !quotasError && quotasReady && (
                          <div className="mt-4 flex gap-2 border-t border-border pt-3">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              className="max-md:h-11"
                              onClick={() => handleSaveQuotas(member.user_id)}
                              disabled={isSaving || !isValidMaxActionsPerDay(editingQuotas[member.user_id]?.max_actions_per_day)}
                            >
                              {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
                              Enregistrer
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="max-md:h-11"
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
                    <div id={panelId} className="border-t border-border bg-muted/30 px-4 py-4 text-xs text-muted-foreground">
                      Les détails de gestion (LinkedIn, quota) sont visibles uniquement par les administrateurs.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* AlertDialog : changement de rôle */}
      <AlertDialog open={!!roleConfirm} onOpenChange={(open) => !open && !isChangingRole && setRoleConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {roleConfirm && `Donner le rôle ${roleLabels[roleConfirm.role] || roleConfirm.role} à ${getDisplayName(roleConfirm.member.user_id)} ?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {roleConfirm && roleConsequence(roleConfirm.role, getDisplayName(roleConfirm.member.user_id))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChangingRole}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isChangingRole}
              onClick={(e) => {
                // Fermée au succès seulement : en cas d'échec, le rôle n'a pas changé.
                e.preventDefault();
                void handleConfirmRole();
              }}
            >
              {isChangingRole && <Loader2 className="animate-spin" aria-hidden="true" />}
              Changer le rôle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  {' '}Vous pourrez le réinviter plus tard.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              disabled={isRemoving}
              onClick={(e) => {
                // La confirmation reste ouverte jusqu'au résultat : fermée au
                // succès, gardée en cas d'échec (rien n'a été retiré).
                e.preventDefault();
                void handleConfirmRemove();
              }}
            >
              {isRemoving && <Loader2 className="animate-spin" aria-hidden="true" />}
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
              className="bg-destructive"
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

// Revue design (F-05) : intitulé en casse de phrase, plus de capitales espacées.
const SectionRow: React.FC<SectionRowProps> = ({ icon, label, trailing, children }) => (
  <div className="px-4 py-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-foreground">
          {label}
        </span>
      </div>
      {trailing}
    </div>
    {children}
  </div>
);
