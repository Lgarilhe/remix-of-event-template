import React, { useState, useEffect, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Check, X, UserPlus, Loader2, ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInvitationsReceived, ReceivedInvitation } from '@/hooks/useInvitationsReceived';
import { LinkedInAccount } from '@/pages/Outreach';

interface InvitationsPanelProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (id: string) => void;
  organizationId: string | null;
}

export const InvitationsPanel: React.FC<InvitationsPanelProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
  organizationId,
}) => {
  const {
    invitations,
    loading,
    cursor,
    fetchInvitations,
    acceptInvitation,
    declineInvitation,
    bulkAccept,
    bulkDecline,
    isProcessing,
  } = useInvitationsReceived(organizationId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<'accept' | 'decline' | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // Fetch on mount and account change
  useEffect(() => {
    if (selectedAccount) {
      fetchInvitations(selectedAccount);
      setSelectedIds(new Set());
    }
  }, [selectedAccount]);

  const handleRefresh = () => {
    if (selectedAccount) {
      fetchInvitations(selectedAccount);
      setSelectedIds(new Set());
    }
  };

  const handleLoadMore = () => {
    if (selectedAccount && cursor) {
      fetchInvitations(selectedAccount, cursor);
    }
  };

  const handleAccept = async (inv: ReceivedInvitation) => {
    if (!selectedAccount) return;
    setProcessingId(inv.id);
    await acceptInvitation(inv, selectedAccount);
    setProcessingId(null);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(inv.id); return n; });
  };

  const handleDecline = async (inv: ReceivedInvitation) => {
    if (!selectedAccount) return;
    setProcessingId(inv.id);
    await declineInvitation(inv, selectedAccount);
    setProcessingId(null);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(inv.id); return n; });
  };

  const selectedInvitations = useMemo(
    () => invitations.filter(i => selectedIds.has(i.id)),
    [invitations, selectedIds]
  );

  const handleBulkConfirm = async () => {
    if (!selectedAccount || !bulkConfirm) return;
    setBulkProgress({ done: 0, total: selectedInvitations.length });
    const handler = bulkConfirm === 'accept' ? bulkAccept : bulkDecline;
    await handler(selectedInvitations, selectedAccount, (done, total) => {
      setBulkProgress({ done, total });
    });
    setBulkProgress(null);
    setBulkConfirm(null);
    setSelectedIds(new Set());
  };

  const toggleAll = () => {
    if (selectedIds.size === invitations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invitations.map(i => i.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const formatRelativeDate = (dateStr: string, parsedDatetime: string | null) => {
    if (parsedDatetime) {
      const d = new Date(parsedDatetime);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7) return `il y a ${diffDays}j`;
      if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)}sem`;
      return `il y a ${Math.floor(diffDays / 30)}mois`;
    }
    return dateStr || '';
  };

  return (
    <div className="bg-background border border-foreground">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-foreground space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
              Invitations reçues
            </h2>
            {!loading && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-foreground text-background min-w-[20px] text-center">
                {invitations.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Account selector */}
            {accounts.length > 1 && (
              <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
                <SelectTrigger className="h-7 text-xs border-foreground rounded-none w-[180px]">
                  <SelectValue placeholder="Compte LinkedIn" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id} className="text-xs">
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="h-7 w-7 flex items-center justify-center border border-foreground bg-background hover:bg-muted transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Bulk actions */}
        {invitations.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={selectedIds.size > 0 && selectedIds.size === invitations.length}
                onCheckedChange={toggleAll}
                className="border-foreground"
              />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {selectedIds.size > 0 ? `${selectedIds.size} sélectionné(s)` : 'Tout sélect.'}
              </span>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex gap-0">
                <button
                  onClick={() => setBulkConfirm('accept')}
                  disabled={isProcessing}
                  className="h-6 px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  ✓ Accepter ({selectedIds.size})
                </button>
                <button
                  onClick={() => setBulkConfirm('decline')}
                  disabled={isProcessing}
                  className="h-6 px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground border-l-0 bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50"
                >
                  ✕ Décliner ({selectedIds.size})
                </button>
              </div>
            )}

            {bulkProgress && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{bulkProgress.done}/{bulkProgress.total} traitées...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <ScrollArea className="max-h-[calc(100vh-300px)]">
        {loading && invitations.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 animate-pulse border border-foreground/10">
                <div className="h-10 w-10 bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted w-2/5" />
                  <div className="h-2.5 bg-muted/60 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucune invitation en attente</p>
          </div>
        ) : (
          <div className="divide-y divide-foreground/10">
            {invitations.map(inv => {
              const isItemProcessing = processingId === inv.id;
              const linkedinUrl = inv.inviter_public_identifier
                ? `https://www.linkedin.com/in/${inv.inviter_public_identifier}`
                : null;

              return (
                <div
                  key={inv.id}
                  className={cn(
                    "p-3 flex items-start gap-3 group transition-all duration-300",
                    isItemProcessing && "opacity-50"
                  )}
                >
                  {/* Checkbox */}
                  <div className="pt-1">
                    <Checkbox
                      checked={selectedIds.has(inv.id)}
                      onCheckedChange={() => toggleOne(inv.id)}
                      className="border-foreground"
                      disabled={isItemProcessing}
                    />
                  </div>

                  {/* Avatar placeholder */}
                  <div className="h-10 w-10 bg-foreground/10 flex items-center justify-center shrink-0 text-xs font-bold text-foreground">
                    {inv.inviter_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {linkedinUrl ? (
                        <a
                          href={linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-foreground hover:underline truncate flex items-center gap-1"
                        >
                          {inv.inviter_name}
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        </a>
                      ) : (
                        <span className="text-sm font-semibold text-foreground truncate">{inv.inviter_name}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelativeDate(inv.date, inv.parsed_datetime)}
                      </span>
                    </div>
                    {inv.inviter_description && (
                      <p className="text-xs text-muted-foreground truncate">{inv.inviter_description}</p>
                    )}
                    {inv.invitation_text && (
                      <p className="text-xs text-muted-foreground/80 italic mt-0.5 line-clamp-2">
                        "{inv.invitation_text}"
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-0 shrink-0 pt-0.5">
                    <button
                      onClick={() => handleAccept(inv)}
                      disabled={isItemProcessing || isProcessing}
                      className="h-7 w-7 flex items-center justify-center border border-foreground bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      title="Accepter"
                    >
                      {isItemProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDecline(inv)}
                      disabled={isItemProcessing || isProcessing}
                      className="h-7 w-7 flex items-center justify-center border border-foreground border-l-0 bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50"
                      title="Décliner"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Load more */}
            {cursor && (
              <div className="p-3">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="w-full h-7 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-background text-foreground hover:bg-foreground hover:text-background transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" />Chargement...</>
                  ) : (
                    <><ChevronDown className="w-3 h-3" />Charger plus</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Bulk confirmation dialog */}
      <AlertDialog open={!!bulkConfirm} onOpenChange={() => setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'accept' ? 'Accepter' : 'Décliner'} {selectedIds.size} invitation(s) ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === 'accept'
                ? 'Les invitations sélectionnées seront acceptées séquentiellement avec un délai entre chaque action.'
                : 'Les invitations sélectionnées seront déclinées. Cette action est irréversible.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {bulkConfirm === 'accept' ? 'Accepter tout' : 'Décliner tout'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
