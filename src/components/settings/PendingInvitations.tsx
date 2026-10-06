import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { X, Mail, Link, Check, RotateCw, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/relativeTime';
import { cn } from '@/lib/utils';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  accepted_at?: string | null;
  token?: string;
}

const isExpired = (expiresAt?: string) => {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
};

interface PendingInvitationsProps {
  invitations: Invitation[];
  /** Rejette en cas d'échec : la confirmation reste ouverte et le motif s'affiche. */
  onCancel: (id: string) => Promise<unknown>;
  onResend: (email: string, role: string) => Promise<void>;
  canManage: boolean;
  isResending?: boolean;
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

/** « envoyée il y a 3 j », ou « envoyée le 12 sept. » au-delà de 30 jours (timeAgo rend alors la date). */
const sentLabel = (createdAt: string) => {
  const ago = timeAgo(createdAt);
  if (!ago) return 'envoyée';
  return ago.startsWith('il y a') || ago.startsWith('à l') ? `envoyée ${ago}` : `envoyée le ${ago}`;
};

/**
 * Revue design (F-14) : un état en mot, précédé d'une pastille de 6 px. La
 * couleur ne sert qu'aux écarts : une invitation expirée demande un renvoi.
 * Design simplifié (règle 7) : une invitation acceptée ne demande rien, sa
 * pastille reste neutre.
 */
const getInvitationStatus = (invitation: Invitation): { label: string; dot: string } => {
  if (invitation.status === 'accepted') return { label: 'Acceptée', dot: 'bg-muted-foreground' };
  if (invitation.status === 'cancelled') return { label: 'Annulée', dot: 'bg-muted-foreground' };
  if (isExpired(invitation.expires_at)) return { label: 'Expirée', dot: 'bg-warning' };
  return { label: 'En attente', dot: 'bg-muted-foreground' };
};

export const PendingInvitations = ({
  invitations,
  onCancel,
  onResend,
  canManage,
  isResending = false,
}: PendingInvitationsProps) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  // Revue design (F-21) : annuler une invitation passe par une confirmation.
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const sortedInvitations = useMemo(() => {
    const priority: Record<string, number> = {
      pending: 0,
      expired: 1,
      accepted: 2,
      cancelled: 3,
    };

    return [...invitations].sort((a, b) => {
      const aStatus = isExpired(a.expires_at) && a.status === 'pending' ? 'expired' : a.status;
      const bStatus = isExpired(b.expires_at) && b.status === 'pending' ? 'expired' : b.status;

      return (priority[aStatus] ?? 99) - (priority[bStatus] ?? 99);
    });
  }, [invitations]);

  const handleCopyLink = async (inv: Invitation) => {
    const link = `${window.location.origin}/auth?invitation=${inv.token ?? inv.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      toast.error('Le lien n’a pas pu être copié. Réessayez.');
      return;
    }
    setCopiedId(inv.id);
    toast.success('Lien d’invitation copié');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleResend = async (inv: Invitation) => {
    setResendingId(inv.id);
    try {
      await onResend(inv.email, inv.role);
    } catch {
      // Échec déjà annoncé par le hook (toast).
    } finally {
      setResendingId(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget || isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancel(cancelTarget.id);
      setCancelTarget(null);
    } catch (err) {
      console.error('[PendingInvitations] cancel failed:', err);
      toast.error('L’invitation n’a pas pu être annulée. Réessayez.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Design simplifié : sans invitation, rien n'est écrit (le formulaire suit) ; les
  // invitations forment une liste à plat, séparée par des filets fins.
  return (
    <>
      {sortedInvitations.length > 0 && (
        <div className="divide-y divide-border">
        {sortedInvitations.map(inv => {
          const isInvitationResending = isResending && resendingId === inv.id;
          const status = getInvitationStatus(inv);
          const canResend = canManage && inv.status !== 'accepted';
          const canCopy = canManage && inv.status !== 'accepted' && inv.status !== 'cancelled';
          const canDelete = canManage && inv.status !== 'accepted';

          return (
            <div
              key={inv.id}
              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted" aria-hidden="true">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabels[inv.role] || inv.role} · {sentLabel(inv.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pl-9 sm:pl-0">
                <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-foreground">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
                  {status.label}
                </span>
                {canResend && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-foreground max-md:h-11"
                    onClick={() => handleResend(inv)}
                    disabled={isResending}
                  >
                    <RotateCw className={cn(isInvitationResending && 'animate-spin')} aria-hidden="true" />
                    Renvoyer
                  </Button>
                )}
                {canCopy && (inv.token || inv.id) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                        onClick={() => handleCopyLink(inv)}
                        aria-label={`Copier le lien d'invitation de ${inv.email}`}
                      >
                        {copiedId === inv.id ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copier le lien d’invitation</TooltipContent>
                  </Tooltip>
                )}
                {canDelete && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                        onClick={() => setCancelTarget(inv)}
                        aria-label={`Annuler l'invitation de ${inv.email}`}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Annuler l’invitation</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
        </div>
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && !isCancelling && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette invitation ?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <>
                  Le lien envoyé à <strong>{cancelTarget.email}</strong> ne fonctionnera plus. Vous pourrez
                  inviter cette personne de nouveau.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Garder l’invitation</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              disabled={isCancelling}
              onClick={(e) => {
                // Fermée au succès seulement : en cas d'échec, l'invitation est toujours valable.
                e.preventDefault();
                void handleConfirmCancel();
              }}
            >
              {isCancelling && <Loader2 className="animate-spin" aria-hidden="true" />}
              Annuler l’invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
