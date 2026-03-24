import { usePendingInvitations } from '@/hooks/usePendingInvitations';
import { Button } from '@/components/ui/button';
import { UserPlus, Loader2 } from 'lucide-react';
import { useState } from 'react';

export const InvitationBanner = () => {
  const { invitations, acceptInvitation, isAccepting } = usePendingInvitations();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  if (!invitations.length) return null;

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    try {
      await acceptInvitation(id);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="space-y-2 mb-4">
      {invitations.map(inv => (
        <div
          key={inv.id}
          className="flex items-center justify-between px-4 py-3 bg-primary/10 border border-primary/20 rounded-md"
        >
          <div className="flex items-center gap-2 text-sm">
            <UserPlus className="w-4 h-4 text-primary" />
            <span>
              Vous êtes invité à rejoindre <strong>{inv.organization?.name || 'une organisation'}</strong> en tant que {inv.role === 'admin' ? 'Admin' : inv.role === 'collaborator' ? 'Collaborateur' : 'Membre'}
            </span>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => handleAccept(inv.id)}
            disabled={isAccepting}
          >
            {acceptingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Accepter
          </Button>
        </div>
      ))}
    </div>
  );
};
