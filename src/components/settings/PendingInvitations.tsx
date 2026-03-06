import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Clock, Mail } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
}

interface PendingInvitationsProps {
  invitations: Invitation[];
  onCancel: (id: string) => void;
  canManage: boolean;
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  member: 'Membre',
};

export const PendingInvitations = ({ invitations, onCancel, canManage }: PendingInvitationsProps) => {
  if (!invitations.length) return null;

  return (
    <div className="space-y-2 pt-4 border-t border-border">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        Invitations en attente
      </p>
      {invitations.map(inv => (
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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">En attente</Badge>
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
      ))}
    </div>
  );
};
