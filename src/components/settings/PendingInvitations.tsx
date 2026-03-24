import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Clock, Mail, Link, Check, RotateCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState } from 'react';
import { toast } from 'sonner';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  token?: string;
}

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

  if (!invitations.length) return null;

  const handleCopyLink = async (inv: Invitation) => {
    const link = `${window.location.origin}/auth?invitation=${inv.token}`;
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
        Invitations en attente
      </p>
      {invitations.map(inv => {
        const isInvitationResending = isResending && resendingId === inv.id;

        return (
          <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-foreground">{inv.email}</p>
                <p className="text-[11px] text-muted-foreground">
                  {roleLabels[inv.role] || inv.role} · envoyée {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">En attente</Badge>
              {canManage && (
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
              {canManage && inv.token && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => handleCopyLink(inv)}
                  title="Copier le lien d'invitation"
                >
                  {copiedId === inv.id ? <Check className="w-3.5 h-3.5 text-primary" /> : <Link className="w-3.5 h-3.5" />}
                </Button>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => onCancel(inv.id)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
