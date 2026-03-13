import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useOrganizationMembers } from '@/hooks/useOrganization';
import { UserPlus, ArrowLeft, Rocket, Loader2, X, Send } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  organizationId: string | null;
  onFinish: () => void;
  onBack: () => void;
}

export const OnboardingStepInvite = ({ organizationId, onFinish, onBack }: Props) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const { inviteMember, isInviting } = useOrganizationMembers(organizationId);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await inviteMember({ email: email.trim().toLowerCase(), role });
      setInvitedEmails(prev => [...prev, email.trim().toLowerCase()]);
      setEmail('');
    } catch {
      // handled in hook
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
          <UserPlus className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Invitez votre équipe
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ajoutez des collègues pour collaborer. Vous pourrez en inviter d'autres plus tard.
        </p>
      </div>

      <div className="space-y-4">
        <form onSubmit={handleInvite} className="flex gap-2">
          <Input
            type="email"
            placeholder="collegue@entreprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 border-foreground/20"
            autoFocus
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Membre</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="icon" disabled={isInviting || !email.trim()}>
            {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>

        {invitedEmails.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Invitations envoyées :</p>
            <div className="flex flex-wrap gap-2">
              {invitedEmails.map((em) => (
                <Badge key={em} variant="secondary" className="text-xs gap-1">
                  {em}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Button>
          <Button onClick={onFinish} className="flex-1 gap-2">
            <Rocket className="w-4 h-4" />
            {invitedEmails.length > 0 ? 'Terminer' : 'Passer et commencer'}
          </Button>
        </div>
      </div>
    </div>
  );
};
