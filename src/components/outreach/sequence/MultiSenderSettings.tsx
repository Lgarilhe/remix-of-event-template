import React, { useState, useMemo, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Plus, Trash2, Users, Mail, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface SenderAccount {
  account_id: string;
  email: string;
  daily_limit: number;
}

interface MultiSenderSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  senderAccounts: SenderAccount[];
  onSenderAccountsChange: (accounts: SenderAccount[]) => void;
  rotationMode: string;
  onRotationModeChange: (mode: string) => void;
}

export const MultiSenderSettings: React.FC<MultiSenderSettingsProps> = ({
  enabled,
  onEnabledChange,
  senderAccounts,
  onSenderAccountsChange,
  rotationMode,
  onRotationModeChange,
}) => {
  const { organizationId } = useOrganization();
  const [showPickerModal, setShowPickerModal] = useState(false);
  const baseId = useId();

  // Fetch team members with their linked accounts
  const { data: teamMembers = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['multi-sender-team', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const [membersRes, linkedInRes, emailRes] = await Promise.all([
        supabase
          .from('organization_members')
          .select('user_id, role')
          .eq('organization_id', organizationId),
        supabase
          .from('member_linkedin_accounts')
          .select('user_id, linkedin_account_id, linkedin_account_name')
          .eq('organization_id', organizationId),
        supabase
          .from('member_email_accounts')
          .select('user_id, email_account_id, email_address')
          .eq('organization_id', organizationId),
      ]);

      if (membersRes.error) throw membersRes.error;
      const members = membersRes.data || [];

      const userIds = members.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p as { user_id: string; display_name: string | null }]));
      const linkedInMap = new Map((linkedInRes.data || []).map(l => [l.user_id, l]));
      const emailMap = new Map((emailRes.data || []).map(e => [e.user_id, e]));

      return members.map(m => {
        const profile = profileMap.get(m.user_id);
        const linkedin = linkedInMap.get(m.user_id);
        const email = emailMap.get(m.user_id);
        const displayName = profile?.display_name || 'Membre';
        return {
          userId: m.user_id,
          role: m.role,
          displayName,
          email: email?.email_address || '',
          avatarUrl: '',
          hasLinkedIn: !!linkedin,
          linkedInAccountId: linkedin?.linkedin_account_id || null,
          linkedInAccountName: linkedin?.linkedin_account_name || null,
          hasEmail: !!email,
          emailAccountId: email?.email_account_id || null,
        };
      });
    },
    enabled: !!organizationId && showPickerModal,
    staleTime: 30_000,
  });

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
    // Un expéditeur doit être un compte d'envoi. Le repli sur userId plaçait un
    // identifiant d'utilisateur là où le moteur attend un identifiant de compte
    // (assigned_sender_id) : tous les envois de ce sender échouaient (BUG-023).
    // La liste désactive déjà ces membres ; ce garde-fou empêche la valeur
    // d'entrer en base par un autre chemin.
    const accountId = member.linkedInAccountId || member.emailAccountId;
    if (!accountId) {
      toast.error("Ce membre n'a relié aucun compte LinkedIn ni e-mail");
      return;
    }
    onSenderAccountsChange([
      ...senderAccounts,
      { account_id: accountId, email: member.email, daily_limit: 50 },
    ]);
    setShowPickerModal(false);
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
            Les envois sont répartis entre plusieurs comptes de l'équipe.
          </p>
        </div>
        <Switch id={switchId} checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          {/* Expéditeurs choisis */}
          {senderAccounts.length > 0 ? (
            <ul className="space-y-2" aria-label="Expéditeurs de la séquence">
              {senderAccounts.map(sender => {
                const limitId = `${baseId}-limit-${sender.account_id}`;
                const senderName = sender.email || 'ce compte';
                return (
                  <li key={sender.account_id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Mail className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{sender.email || 'Compte sans adresse'}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <label htmlFor={limitId} className="sr-only">
                          {`Limite d'envois par jour pour ${senderName}`}
                        </label>
                        <Input
                          id={limitId}
                          type="number"
                          min={1}
                          max={200}
                          value={sender.daily_limit}
                          onChange={(e) => handleDailyLimitChange(sender.account_id, parseInt(e.target.value) || 50)}
                          className="h-7 w-16 px-2 text-xs"
                        />
                        <span className="text-xs text-muted-foreground" aria-hidden="true">envois par jour</span>
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
                          aria-label={`Retirer l'expéditeur ${senderName}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Retirer</TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-6 text-center">
              <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
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

          {/* Répartition des envois */}
          <div>
            <Label htmlFor={rotationId} className="text-xs text-muted-foreground">Répartition des envois</Label>
            <Select value={rotationMode} onValueChange={onRotationModeChange}>
              <SelectTrigger id={rotationId} className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">À tour de rôle</SelectItem>
                <SelectItem value="random">Au hasard</SelectItem>
                <SelectItem value="least_used">Au compte le moins sollicité</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Choix d'un membre de l'équipe */}
          <Dialog open={showPickerModal} onOpenChange={setShowPickerModal}>
            <DialogContent className="max-w-md gap-0 p-0">
              <DialogHeader className="border-b border-border px-5 pb-4 pt-5">
                <DialogTitle>Ajouter un expéditeur</DialogTitle>
                <DialogDescription>Choisissez un membre de l'équipe qui a relié un compte d'envoi.</DialogDescription>
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
                    <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">Aucun membre trouvé.</p>
                  </div>
                ) : (
                  <ul>
                    {teamMembers.map(member => {
                      const alreadyAdded = existingSenderUserIds.has(member.userId);
                      const hasAnyAccount = member.hasLinkedIn || member.hasEmail;
                      const disabled = alreadyAdded || !hasAnyAccount;

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
                              {member.email && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{member.email}</span>
                              )}
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                              {member.hasLinkedIn && <ChannelIcon channel="linkedin" size="sm" />}
                              {member.hasEmail && <ChannelIcon channel="email" size="sm" />}
                              {!hasAnyAccount && (
                                <Badge variant="muted">
                                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                                  Aucun compte
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
              {!isLoading && !isError && teamMembers.some(m => !m.hasLinkedIn && !m.hasEmail) && (
                <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  Un membre sans compte LinkedIn ni e-mail relié ne peut pas envoyer : il doit d'abord connecter un compte dans ses paramètres.
                </p>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};
