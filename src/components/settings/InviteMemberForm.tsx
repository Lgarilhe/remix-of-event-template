import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus } from 'lucide-react';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { toast } from 'sonner';

interface InviteMemberFormProps {
  onInvite: (email: string, role: string) => Promise<void>;
  isLoading?: boolean;
}

/** Revue design (F-15, F-16) : libellés reliés aux champs, rôle lisible en entier, champs empilés sur téléphone. */
export const InviteMemberForm = ({ onInvite, isLoading }: InviteMemberFormProps) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const { canInviteMember, seatLimitMessage, isLoading: isQuotaLoading, isFree } = useQuotaGate();
  const seatsExhausted = !isQuotaLoading && !canInviteMember;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (isQuotaLoading) {
      toast.info('Vérification des limites en cours…');
      return;
    }
    if (!canInviteMember) {
      toast.error(seatLimitMessage);
      return;
    }
    try {
      await onInvite(email.trim().toLowerCase(), role);
      setEmail('');
    } catch {
      // Échec annoncé par le hook : la saisie reste pour réessayer.
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2 border-t border-border pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label htmlFor="invite-email" className="text-xs text-muted-foreground">E-mail</label>
          <Input
            id="invite-email"
            type="email"
            placeholder="collegue@entreprise.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="max-md:h-11"
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="text-xs text-muted-foreground">Rôle</label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="invite-role" className="w-full min-w-28 gap-2 sm:w-auto max-md:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Membre</SelectItem>
              {/* Pas de « Collaborateur » jusqu'au lot C2 : ce rôle est un membre
                  complet de l'organisation, pas un accès restreint (C1, R11). */}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="submit"
          variant="primary"
          className="max-md:h-11"
          disabled={isLoading || isQuotaLoading || seatsExhausted || !email.trim()}
          loading={isLoading || isQuotaLoading}
        >
          {!(isLoading || isQuotaLoading) && <UserPlus aria-hidden="true" />}
          Inviter
        </Button>
      </div>
      {seatsExhausted && (
        <p className="text-xs text-muted-foreground">
          {isFree ? 'Choisissez un plan pour inviter votre équipe.' : seatLimitMessage}{' '}
          <Link to={isFree ? '/pricing' : '/settings/org/billing'} className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
            {isFree ? 'Voir les plans' : 'Ajouter un siège'}
          </Link>
        </p>
      )}
    </form>
  );
};
