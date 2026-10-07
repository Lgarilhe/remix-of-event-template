import React, { useState, useMemo, useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/layout/ErrorState';
import { Plus, Trash2, Users, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useMultiSenderTeam } from './useMultiSenderTeam';

export interface SenderAccount {
  account_id: string;
  /** Ancien champ, plus écrit : la rotation n'envoie que depuis des comptes LinkedIn. */
  email?: string;
  daily_limit: number;
  /** Nom affiché (« LinkedIn · Théo Martin »), ignoré par le moteur. */
  label?: string;
  /** Canal du compte : la rotation ne sert qu'aux étapes LinkedIn. */
  channel?: 'linkedin';
}

interface MultiSenderSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  senderAccounts: SenderAccount[];
  onSenderAccountsChange: (accounts: SenderAccount[]) => void;
  rotationMode: string;
  onRotationModeChange: (mode: string) => void;
}

/** Nom d'un expéditeur : nom du membre, sinon nom du compte LinkedIn. */
function senderLabelFor(member: { displayName: string; linkedInAccountName: string | null }): string {
  if (member.displayName && member.displayName !== 'Membre') return member.displayName;
  return member.linkedInAccountName || member.displayName || 'Membre';
}

export const MultiSenderSettings: React.FC<MultiSenderSettingsProps> = ({
  enabled,
  onEnabledChange,
  senderAccounts,
  onSenderAccountsChange,
  rotationMode,
  onRotationModeChange,
}) => {
  const [showPickerModal, setShowPickerModal] = useState(false);
  const baseId = useId();

  // Équipe chargée dès que la rotation est active : chaque expéditeur, libellé
  // ou pas, est comparé aux comptes reliés. Un libellé recopié d'une autre
  // séquence ne prouve pas que le compte est encore relié à l'équipe.
  const { data: teamMembers = [], isLoading, isError, isSuccess, refetch } = useMultiSenderTeam(showPickerModal || enabled);

  const existingSenderUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sender of senderAccounts) {
      const member = teamMembers.find(
        m => m.linkedInAccountId === sender.account_id || m.emailAccountId === sender.account_id || m.userId === sender.account_id
      );
      if (member) ids.add(member.userId);
    }
    return ids;
  }, [senderAccounts, teamMembers]);

  const handleSelectMember = (member: typeof teamMembers[number]) => {
    // Un expéditeur doit être un compte LinkedIn : la rotation ne sert qu'aux
    // étapes LinkedIn, et un compte e-mail y faisait échouer invitations et
    // messages. Le repli sur userId plaçait un identifiant d'utilisateur là où
    // le moteur attend un identifiant de compte (BUG-023). La liste désactive
    // déjà ces membres ; ce garde-fou empêche la valeur d'entrer par un autre chemin.
    const accountId = member.linkedInAccountId;
    if (!accountId) {
      toast.error('Ce membre n\'a pas de compte LinkedIn connecté');
      return;
    }
    onSenderAccountsChange([
      ...senderAccounts,
      { account_id: accountId, daily_limit: 50, label: senderLabelFor(member), channel: 'linkedin' },
    ]);
    setShowPickerModal(false);
  };

  /**
   * Ligne d'un expéditeur, d'après les comptes reliés de l'équipe. Le libellé
   * enregistré ne sert qu'à l'affichage : un compte absent de l'équipe (copie
   * d'une séquence d'une autre organisation, membre parti) est signalé.
   */
  const describeSender = (sender: SenderAccount): { title: string; kind: 'linkedin' | 'email' | 'unknown' | 'pending' } => {
    const viaLinkedIn = teamMembers.find(m => m.linkedInAccountId === sender.account_id);
    if (viaLinkedIn) return { title: `LinkedIn · ${sender.label || senderLabelFor(viaLinkedIn)}`, kind: 'linkedin' };
    const viaEmail = teamMembers.find(m => m.emailAccountId === sender.account_id);
    if (viaEmail) return { title: `E-mail · ${viaEmail.email || viaEmail.displayName}`, kind: 'email' };
    // Équipe pas encore lue (ou lecture en échec) : aucun avertissement hasardeux.
    if (!isSuccess) return { title: sender.label ? `LinkedIn · ${sender.label}` : sender.email || 'Expéditeur enregistré', kind: 'pending' };
    if (sender.label) return { title: `LinkedIn · ${sender.label}`, kind: 'unknown' };
    return { title: sender.email ? `E-mail · ${sender.email}` : 'Compte introuvable dans l\'équipe', kind: sender.email ? 'email' : 'unknown' };
  };

  const SENDER_WARNINGS: Record<string, string> = {
    email: 'Compte e-mail : la rotation n\'envoie que depuis des comptes LinkedIn et ne l\'utilise pas. Retirez-le.',
    unknown: 'Ce compte n\'est plus relié à un membre de l\'équipe : la rotation ne l\'utilise pas. Retirez-le.',
  };

  const handleRemove = (acctId: string) => {
    onSenderAccountsChange(senderAccounts.filter(s => s.account_id !== acctId));
  };

  const handleDailyLimitChange = (acctId: string, limit: number) => {
    onSenderAccountsChange(senderAccounts.map(s => s.account_id === acctId ? { ...s, daily_limit: limit } : s));
  };

  const switchId = `${baseId}-enabled`;
  const rotationId = `${baseId}-rotation`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={switchId} className="cursor-pointer leading-snug">
            Plusieurs expéditeurs
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Les nouveaux candidats sont répartis entre les comptes LinkedIn de plusieurs membres de l'équipe.
          </p>
        </div>
        <Switch id={switchId} checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          {/* Expéditeurs choisis */}
          {senderAccounts.length > 0 ? (
            <div className="space-y-2">
              <ul className="space-y-2" aria-label="Expéditeurs de la séquence">
                {senderAccounts.map(sender => {
                  const { title, kind } = describeSender(sender);
                  const warning = SENDER_WARNINGS[kind];
                  const limitId = `${baseId}-limit-${sender.account_id}`;
                  return (
                    <li key={sender.account_id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                        {kind === 'linkedin'
                          ? <ChannelIcon channel="linkedin" size="sm" decorative />
                          : kind === 'email'
                            ? <ChannelIcon channel="email" size="sm" decorative />
                            : <Users className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{title}</p>
                        {warning && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-warning">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            {warning}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Label htmlFor={limitId} className="text-xs font-normal text-muted-foreground">
                            Plus de nouveaux candidats au-delà de
                          </Label>
                          <Input
                            id={limitId}
                            type="number"
                            min={1}
                            max={200}
                            value={sender.daily_limit}
                            onChange={(e) => handleDailyLimitChange(sender.account_id, parseInt(e.target.value) || 50)}
                            className="h-7 w-16 px-2 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">actions LinkedIn par jour</span>
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemove(sender.account_id)}
                            className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                            aria-label={`Retirer ${title}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Retirer cet expéditeur</TooltipContent>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Chaque nouveau candidat est attribué à un expéditeur, qui envoie ensuite toute sa séquence. Un expéditeur qui a atteint ce nombre d'actions (invitations, messages et InMails) dans la journée ne reçoit plus de nouveaux candidats jusqu'au lendemain. Quand tous les expéditeurs l'ont atteint, les nouveaux candidats attendent le lendemain. Les plafonds d'envoi LinkedIn restent ceux du compte (Paramètres, Équipe).
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-6 text-center">
              <Users className="mx-auto mb-2 h-5 w-5 text-foreground" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">Aucun expéditeur pour l'instant.</p>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPickerModal(true)}
            className="w-full border-dashed max-md:h-11"
          >
            <Plus aria-hidden="true" />
            Ajouter un expéditeur
          </Button>

          {/* Répartition des nouveaux candidats */}
          <div>
            <Label htmlFor={rotationId} className="text-xs text-muted-foreground">Répartition des nouveaux candidats</Label>
            <Select value={rotationMode} onValueChange={onRotationModeChange}>
              <SelectTrigger id={rotationId} className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">À tour de rôle</SelectItem>
                <SelectItem value="random">Au hasard</SelectItem>
                <SelectItem value="least_used">Le moins sollicité</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Choix d'un membre de l'équipe */}
          <Dialog open={showPickerModal} onOpenChange={setShowPickerModal}>
            <DialogContent className="max-w-md gap-0 p-0">
              <DialogHeader className="border-b border-border px-5 pb-4 pt-5">
                <DialogTitle>Choisir un expéditeur</DialogTitle>
                <DialogDescription>Choisissez un membre de l'équipe qui a relié son compte LinkedIn.</DialogDescription>
              </DialogHeader>
              <div className="max-h-80 overflow-y-auto p-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner label="Chargement des membres" />
                  </div>
                ) : isError ? (
                  <div className="p-3">
                    <ErrorState
                      variant="compact"
                      title="Impossible de charger les membres"
                      description="Vérifiez votre connexion, puis réessayez."
                      onRetry={() => { void refetch(); }}
                    />
                  </div>
                ) : teamMembers.length === 0 ? (
                  <div className="py-12 text-center">
                    <Users className="mx-auto mb-2 h-6 w-6 text-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">Aucun membre trouvé.</p>
                  </div>
                ) : (
                  <ul>
                    {teamMembers.map(member => {
                      const alreadyAdded = existingSenderUserIds.has(member.userId);
                      // Seul un compte LinkedIn peut entrer dans la rotation.
                      const disabled = alreadyAdded || !member.hasLinkedIn;

                      return (
                        <li key={member.userId}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => !disabled && handleSelectMember(member)}
                            disabled={disabled}
                            className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                          >
                            <Avatar className="h-9 w-9 shrink-0">
                              <AvatarImage src={member.avatarUrl} alt="" />
                              <AvatarFallback className="bg-muted text-xs font-medium">
                                {member.displayName.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{member.displayName}</span>
                              {member.linkedInAccountName && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">LinkedIn · {member.linkedInAccountName}</span>
                              )}
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                              {member.hasLinkedIn ? (
                                <ChannelIcon channel="linkedin" size="sm" />
                              ) : (
                                <Badge variant="muted">
                                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                                  Pas de compte LinkedIn
                                </Badge>
                              )}
                              {alreadyAdded && <Badge variant="muted">Déjà ajouté</Badge>}
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {!isLoading && !isError && teamMembers.some(m => !m.hasLinkedIn) && (
                <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  Un membre sans compte LinkedIn relié ne peut pas envoyer : il doit d'abord connecter son compte dans ses paramètres.
                </p>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};
