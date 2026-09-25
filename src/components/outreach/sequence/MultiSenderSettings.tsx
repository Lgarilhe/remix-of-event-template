import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Users, Mail, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import linkedinLogo from '@/assets/linkedin-logo.svg';

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
  const { organizationId } = useOrganization();
  const [showPickerModal, setShowPickerModal] = useState(false);

  // Fetch team members with their linked accounts
  const { data: teamMembers = [], isLoading, isError } = useQuery({
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
    // Chargé aussi pour nommer les expéditeurs enregistrés sans libellé.
    enabled: !!organizationId && (showPickerModal || (enabled && senderAccounts.some(s => !s.label))),
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
   * Ligne d'un expéditeur : libellé enregistré, sinon retrouvé dans l'équipe
   * (expéditeurs ajoutés avant l'enregistrement du libellé).
   */
  const describeSender = (sender: SenderAccount): { title: string; kind: 'linkedin' | 'email' | 'unknown' | 'pending' } => {
    if (sender.label) return { title: `LinkedIn · ${sender.label}`, kind: 'linkedin' };
    const viaLinkedIn = teamMembers.find(m => m.linkedInAccountId === sender.account_id);
    if (viaLinkedIn) return { title: `LinkedIn · ${senderLabelFor(viaLinkedIn)}`, kind: 'linkedin' };
    const viaEmail = teamMembers.find(m => m.emailAccountId === sender.account_id);
    if (viaEmail) return { title: `E-mail · ${viaEmail.email || viaEmail.displayName}`, kind: 'email' };
    if (isLoading || isError) return { title: sender.email ? sender.email : 'Expéditeur enregistré', kind: 'pending' };
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="multi-sender-switch" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Plusieurs expéditeurs
        </Label>
        <Switch id="multi-sender-switch" checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-4 p-4 sm:p-5 border border-border bg-background">
          {/* Sender list */}
          {senderAccounts.length > 0 ? (
            <div className="space-y-2">
              {senderAccounts.map(sender => {
                const { title, kind } = describeSender(sender);
                const isLinkedIn = kind === 'linkedin';
                const limitId = `sender-limit-${sender.account_id}`;
                return (
                  <div key={sender.account_id} className="flex items-center gap-3 p-3 border border-border bg-muted/10">
                    <div className="w-8 h-8 bg-muted flex items-center justify-center shrink-0">
                      {isLinkedIn
                        ? <img src={linkedinLogo} alt="" aria-hidden="true" className="w-4 h-4" />
                        : kind === 'email'
                          ? <Mail className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                          : <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{title}</p>
                      {SENDER_WARNINGS[kind] && (
                        <p className="text-xs text-warning mt-0.5">{SENDER_WARNINGS[kind]}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
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
                          className="h-7 w-16 text-xs px-2"
                        />
                        <span className="text-xs text-muted-foreground">actions LinkedIn par jour</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(sender.account_id)}
                      aria-label={`Retirer ${title}`}
                      title="Retirer cet expéditeur"
                      className="text-muted-foreground hover:text-destructive h-8 w-8 p-0 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Chaque nouveau candidat est attribué à un expéditeur, qui envoie ensuite toute sa séquence. Un expéditeur qui a atteint ce nombre d'actions dans la journée ne reçoit plus de nouveaux candidats jusqu'au lendemain. Les plafonds d'envoi LinkedIn restent ceux du compte (Paramètres, Équipe).
              </p>
            </div>
          ) : (
            <div className="py-6 text-center border border-dashed border-border">
              <Users className="w-5 h-5 mx-auto text-muted-foreground/40 mb-2" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Aucun expéditeur
              </p>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPickerModal(true)}
            className="w-full border-dashed border-border h-9"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Ajouter un expéditeur
          </Button>

          {/* Rotation mode */}
          <div>
            <Label htmlFor="rotation-mode" className="text-xs text-muted-foreground">Répartition des nouveaux candidats</Label>
            <Select value={rotationMode} onValueChange={onRotationModeChange}>
              <SelectTrigger id="rotation-mode" className="mt-1.5 text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">À tour de rôle</SelectItem>
                <SelectItem value="random">Au hasard</SelectItem>
                <SelectItem value="least_used">Le moins sollicité</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Team member picker modal — z-index géré globalement par dialog.tsx (z-[9999]) */}
          <Dialog open={showPickerModal} onOpenChange={setShowPickerModal}>
            <DialogContent className="max-w-md bg-background border-border rounded-lg p-0 gap-0">
              <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
                <DialogTitle className="flex items-center gap-2.5 text-base">
                  <div className="w-8 h-8 bg-muted flex items-center justify-center">
                    <Users className="w-4 h-4 text-foreground" />
                  </div>
                  Choisir un expéditeur
                </DialogTitle>
              </DialogHeader>
              <div className="max-h-80 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin" />
                  </div>
                ) : teamMembers.length === 0 ? (
                  <div className="py-12 text-center">
                    <Users className="w-6 h-6 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">Aucun membre trouvé</p>
                  </div>
                ) : (
                  teamMembers.map(member => {
                    const alreadyAdded = existingSenderUserIds.has(member.userId);
                    // Seul un compte LinkedIn peut entrer dans la rotation.
                    const disabled = alreadyAdded || !member.hasLinkedIn;

                    return (
                      <button
                        type="button"
                        key={member.userId}
                        onClick={() => !disabled && handleSelectMember(member)}
                        disabled={disabled}
                        className={cn(
                          'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors border-b border-border/50 last:border-b-0',
                          disabled
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-muted/40 cursor-pointer active:bg-muted/60'
                        )}
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        <Avatar className="w-9 h-9 shrink-0">
                          <AvatarImage src={member.avatarUrl} />
                          <AvatarFallback className="text-xs bg-muted font-medium">
                            {member.displayName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{member.displayName}</p>
                          {member.linkedInAccountName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">LinkedIn · {member.linkedInAccountName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          {member.hasLinkedIn ? (
                            <span className="inline-flex items-center gap-1 h-6 px-1.5 border border-linkedin/20 bg-linkedin/5 text-[10px] font-medium text-linkedin">
                              <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3" />
                              ✓
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 h-6 px-1.5 border border-border text-[10px] text-muted-foreground">
                              <AlertCircle className="w-3 h-3" aria-hidden="true" /> Pas de compte LinkedIn
                            </span>
                          )}
                          {alreadyAdded && (
                            <Badge variant="secondary" className="text-[10px] h-5 rounded-full">
                              Ajouté
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {!isLoading && teamMembers.some(m => !m.hasLinkedIn) && (
                <div className="px-5 py-3 border-t border-border bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Les membres grisés doivent connecter leur compte LinkedIn dans les paramètres.
                  </p>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};
