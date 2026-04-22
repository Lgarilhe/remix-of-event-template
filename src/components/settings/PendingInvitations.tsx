import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Clock, Mail, Link, Check, RotateCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

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
  onCancel: (id: string) => void;
  onResend: (email: string, role: string) => Promise<void>;
  canManage: boolean;
  isResending?: boolean;
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

const getInvitationStatus = (invitation: Invitation) => {
  if (invitation.status === 'accepted') {
    return {
      label: 'Acceptée',
      className: 'border-primary/30 bg-primary/10 text-primary',
    };
  }

  if (invitation.status === 'cancelled') {
    return {
      label: 'Annulée',
      className: 'border-border bg-muted/60 text-muted-foreground',
    };
  }

  if (isExpired(invitation.expires_at)) {
    return {
      label: 'Expirée',
      className: 'border-border bg-muted/60 text-muted-foreground',
    };
  }

  return {
    label: 'En attente',
    className: 'border-accent/40 bg-accent/10 text-foreground',
  };
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
    await navigator.clipboard.writeText(link);
    setCopiedId(inv.id);
    toast.success('Lien d\'invitation copié !');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleResend = async (inv: Invitation) => {
    setResendingId(inv.id);
    try {
      await onResend(inv.email, inv.role);
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="space-y-2 pt-4 border-t border-border">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        Invitations
      </p>

      {!sortedInvitations.length ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
          Aucune invitation envoyée pour le moment.
        </div>
      ) : (
        sortedInvitations.map(inv => {
          const isInvitationResending = isResending && resendingId === inv.id;
          const status = getInvitationStatus(inv);
          const canResend = canManage && inv.status !== 'accepted';
          const canCopy = canManage && inv.status !== 'accepted' && inv.status !== 'cancelled';
          const canDelete = canManage && inv.status !== 'accepted';

          return (
            <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center shrink-0">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabels[inv.role] || inv.role} · envoyée {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true, locale: fr })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className={`text-xs ${status.className}`}>
                  {status.label}
                </Badge>
                {canResend && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => handleResend(inv)}
                    disabled={isResending}
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isInvitationResending ? 'animate-spin' : ''}`} />
                    Renvoyer
                  </Button>
                )}
                {canCopy && (inv.token || inv.id) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopyLink(inv)}
                    title="Copier le lien d'invitation"
                    aria-label="Copier le lien d'invitation"
                  >
                    {copiedId === inv.id ? <Check className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> : <Link className="w-3.5 h-3.5" aria-hidden="true" />}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onCancel(inv.id)}
                    aria-label="Annuler l'invitation"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
