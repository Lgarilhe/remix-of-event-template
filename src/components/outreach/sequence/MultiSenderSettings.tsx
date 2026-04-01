import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Users, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newLimit, setNewLimit] = useState(50);

  const handleAdd = () => {
    if (!newEmail.trim()) return;
    onSenderAccountsChange([
      ...senderAccounts,
      { account_id: crypto.randomUUID(), email: newEmail.trim(), daily_limit: newLimit },
    ]);
    setNewEmail('');
    setNewLimit(50);
    setShowAddModal(false);
  };

  const handleRemove = (accountId: string) => {
    onSenderAccountsChange(senderAccounts.filter(s => s.account_id !== accountId));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Multi-sender
        </Label>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-3 p-3 border border-foreground/20 bg-muted/20">
          {/* Sender list */}
          {senderAccounts.length > 0 ? (
            <div className="space-y-2">
              {senderAccounts.map(sender => (
                <div key={sender.account_id} className="flex items-center gap-2 p-2 border border-foreground/10 bg-background">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sender.email}</p>
                    <p className="text-xs text-muted-foreground">{sender.daily_limit}/jour</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(sender.account_id)}
                    className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              Aucun sender configuré
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="w-full border-dashed border-foreground/30"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Ajouter un sender
          </Button>

          {/* Rotation mode */}
          <div>
            <Label className="text-xs">Mode de rotation</Label>
            <Select value={rotationMode} onValueChange={onRotationModeChange}>
              <SelectTrigger className="mt-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round-robin (équitable)</SelectItem>
                <SelectItem value="random">Aléatoire</SelectItem>
                <SelectItem value="least_used">Moins utilisé</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Add sender modal */}
          <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
            <DialogContent className="max-w-sm bg-background border-foreground rounded-none">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Ajouter un sender
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="sender@example.com"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Limite quotidienne</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newLimit}
                    onChange={(e) => setNewLimit(parseInt(e.target.value) || 50)}
                    className="mt-1"
                  />
                </div>
                <Button onClick={handleAdd} className="w-full bg-foreground text-background rounded-none">
                  Ajouter
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
};
