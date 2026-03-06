import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Loader2 } from 'lucide-react';

interface InviteMemberFormProps {
  onInvite: (email: string, role: string) => Promise<void>;
  isLoading?: boolean;
}

export const InviteMemberForm = ({ onInvite, isLoading }: InviteMemberFormProps) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await onInvite(email.trim().toLowerCase(), role);
    setEmail('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 pt-4 border-t border-border">
      <div className="flex-1 space-y-1">
        <label className="text-xs text-muted-foreground">Email</label>
        <Input
          type="email"
          placeholder="collegue@entreprise.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="h-9 text-sm"
          required
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Rôle</label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-28 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Membre</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={isLoading || !email.trim()}>
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
        Inviter
      </Button>
    </form>
  );
};
