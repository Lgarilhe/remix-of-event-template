import React, { useState, useEffect, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import {
  RefreshCw,
  Check,
  X,
  UserPlus,
  Loader2,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInvitationsReceived, ReceivedInvitation } from '@/hooks/useInvitationsReceived';
import { LinkedInAccount } from '@/pages/Outreach';

interface InvitationsPanelProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (id: string) => void;
  organizationId: string | null;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatRelativeDate(dateStr: string, parsedDatetime: string | null) {
  if (parsedDatetime) {
    const d = new Date(parsedDatetime);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `il y a ${diffDays}j`;
    if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} sem`;
    return `il y a ${Math.floor(diffDays / 30)} mois`;
  }

  return dateStr || '';
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

  useEffect(() => {
    if (selectedAccount) {
      fetchInvitations(selectedAccount);
      setSelectedIds(new Set());
    }
  }, [selectedAccount, fetchInvitations]);

  const selectedInvitations = useMemo(
    () => invitations.filter((invitation) => selectedIds.has(invitation.id)),
    [invitations, selectedIds]
  );

  const selectedCount = selectedIds.size;
  const allSelected = invitations.length > 0 && selectedCount === invitations.length;
  const progressValue = bulkProgress ? (bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100 : 0;

  const handleRefresh = () => {
    if (!selectedAccount) return;
    fetchInvitations(selectedAccount);
    setSelectedIds(new Set());
  };

  const handleLoadMore = () => {
    if (!selectedAccount || !cursor) return;
    fetchInvitations(selectedAccount, cursor);
  };

  const handleAccept = async (invitation: ReceivedInvitation) => {
    if (!selectedAccount) return;
    setProcessingId(invitation.id);
    await acceptInvitation(invitation, selectedAccount);
    setProcessingId(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(invitation.id);
      return next;
    });
  };

  const handleDecline = async (invitation: ReceivedInvitation) => {
    if (!selectedAccount) return;
    setProcessingId(invitation.id);
    await declineInvitation(invitation, selectedAccount);
    setProcessingId(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(invitation.id);
      return next;
    });
  };

  const handleBulkConfirm = async () => {
    if (!selectedAccount || !bulkConfirm || selectedInvitations.length === 0) return;

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
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(invitations.map((invitation) => invitation.id)));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-hidden border border-border bg-background">
      {/* Header */}
      <div className="border-b border-border p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-foreground text-background">
              <UserPlus className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground truncate sm:text-base">
              Invitations reçues
            </h2>
            <Badge variant="default" className="rounded-none bg-foreground px-1.5 py-0.5 text-xs uppercase tracking-wider text-background hover:bg-foreground shrink-0">
              {loading ? '...' : invitations.length}
            </Badge>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {accounts.length > 1 && (
              <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
                <SelectTrigger className="h-8 w-[140px] rounded-none border-border bg-background text-xs hidden sm:flex">
                  <SelectValue placeholder="Compte" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id} className="text-xs">
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={loading}
              className="h-8 w-8 rounded-none border-border bg-background"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Mobile account selector */}
        {accounts.length > 1 && (
          <div className="mt-2 sm:hidden">
            <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
              <SelectTrigger className="h-8 w-full rounded-none border-border bg-background text-xs">
                <SelectValue placeholder="Compte LinkedIn" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id} className="text-xs">
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {bulkProgress && (
          <div className="mt-3 border border-border bg-background/80 p-2">
            <div className="mb-1.5 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
              <span>Batch en cours</span>
              <span>{bulkProgress.done}/{bulkProgress.total}</span>
            </div>
            <Progress value={progressValue} className="h-1.5 rounded-none bg-muted" />
          </div>
        )}
      </div>

      {/* Toolbar */}
      {invitations.length > 0 && (
        <div className="border-b border-border bg-muted/20 px-3 py-2 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                className="border-border h-3.5 w-3.5"
              />
              <span className="hidden sm:inline">{allSelected ? 'Désélectionner' : 'Tout'}</span>
              <span className="text-foreground/50">{selectedCount}/{invitations.length}</span>
            </label>

            <div className="flex items-center gap-1.5">
              <Button
                variant="default"
                size="sm"
                disabled={selectedCount === 0 || isProcessing}
                onClick={() => setBulkConfirm('accept')}
                className="rounded-none border border-border h-7 px-2 sm:px-3 text-xs uppercase tracking-wider"
              >
                {isProcessing && bulkConfirm === 'accept' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span className="hidden sm:inline ml-1">Accepter</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedCount === 0 || isProcessing}
                onClick={() => setBulkConfirm('decline')}
                className="rounded-none border border-border h-7 px-2 sm:px-3 text-xs uppercase tracking-wider"
              >
                {isProcessing && bulkConfirm === 'decline' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                <span className="hidden sm:inline ml-1">Décliner</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-h-[60vh] overflow-y-auto">
        {loading && invitations.length === 0 ? (
          <div className="grid gap-2 p-3 sm:p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="border border-border bg-background p-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-3.5 w-3.5 bg-muted shrink-0" />
                  <div className="h-9 w-9 bg-muted shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 bg-muted" />
                    <div className="h-3 w-3/4 bg-muted/60" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : invitations.length === 0 ? (
          <div className="flex min-h-[280px] items-center justify-center p-6">
            <div className="max-w-xs text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-border bg-muted/30 text-muted-foreground">
                <UserPlus className="h-7 w-7 opacity-50" />
              </div>
              <h3 className="mb-1.5 text-sm font-bold uppercase tracking-wider text-foreground">
                Aucune invitation
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Rafraîchissez pour récupérer les nouvelles demandes.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-2 sm:p-3">
            <div className="grid gap-2">
              {invitations.map((invitation) => {
                const isItemProcessing = processingId === invitation.id;
                const isSelected = selectedIds.has(invitation.id);
                const linkedinUrl = invitation.inviter_public_identifier
                  ? `https://www.linkedin.com/in/${invitation.inviter_public_identifier}`
                  : null;

                return (
                  <article
                    key={invitation.id}
                    className={cn(
                      'group border border-border bg-background transition-all duration-200 shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))]',
                      isSelected && 'border-border bg-accent/10',
                      isItemProcessing && 'opacity-60'
                    )}
                  >
                    <div className="p-3">
                      {/* Row: checkbox + avatar + info + actions */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(invitation.id)}
                          className="border-border h-3.5 w-3.5 shrink-0 mt-1"
                          disabled={isItemProcessing}
                        />

                        {linkedinUrl ? (
                          <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                            {invitation.inviter_picture_url ? (
                              <img
                                src={invitation.inviter_picture_url}
                                alt={invitation.inviter_name}
                                className="h-9 w-9 border border-border object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center border border-border bg-muted/50 text-xs font-bold uppercase tracking-wide text-foreground">
                                {getInitials(invitation.inviter_name)}
                              </div>
                            )}
                          </a>
                        ) : invitation.inviter_picture_url ? (
                          <img
                            src={invitation.inviter_picture_url}
                            alt={invitation.inviter_name}
                            className="h-9 w-9 shrink-0 border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-muted/50 text-xs font-bold uppercase tracking-wide text-foreground">
                            {getInitials(invitation.inviter_name)}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {linkedinUrl ? (
                                  <a
                                    href={linkedinUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-sm font-semibold text-foreground hover:underline truncate"
                                  >
                                    <span className="truncate">{invitation.inviter_name}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
                                  </a>
                                ) : (
                                  <span className="text-sm font-semibold text-foreground truncate">
                                    {invitation.inviter_name}
                                  </span>
                                )}
                              </div>
                              {invitation.inviter_description && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                  {invitation.inviter_description}
                                </p>
                              )}
                              <span className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5 block">
                                {formatRelativeDate(invitation.date, invitation.parsed_datetime)}
                              </span>
                            </div>

                            {/* Actions — always visible inline */}
                            <div className="flex items-center gap-1 shrink-0 ml-1">
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleAccept(invitation)}
                                disabled={isItemProcessing || isProcessing}
                                className="rounded-none border border-border h-7 px-1.5 sm:px-2.5 text-xs uppercase tracking-wider"
                              >
                                {isItemProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                <span className="ml-1 hidden sm:inline">OK</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDecline(invitation)}
                                disabled={isItemProcessing || isProcessing}
                                className="rounded-none border border-border h-7 px-1.5 sm:px-2.5 text-xs uppercase tracking-wider text-muted-foreground"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>

                          {/* Invitation text */}
                          {invitation.invitation_text && (
                            <div className="mt-1.5 border-l-2 border-border bg-muted/10 px-2.5 py-1.5">
                              <p className="text-xs italic leading-relaxed text-muted-foreground line-clamp-2">
                                "{invitation.invitation_text}"
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {cursor && (
              <div className="pt-3">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="h-9 w-full rounded-none border-border text-xs uppercase tracking-wider"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Chargement...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      Plus d'invitations
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={!!bulkConfirm} onOpenChange={() => setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'accept' ? 'Accepter' : 'Décliner'} {selectedCount} invitation{selectedCount > 1 ? 's' : ''} ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  {bulkConfirm === 'accept'
                    ? 'Les invitations sélectionnées seront acceptées.'
                    : 'Les invitations sélectionnées seront refusées. Cette action est irréversible.'}
                </p>
                <div className="rounded-none border border-amber-500/30 bg-amber-500/10 p-3 space-y-1.5">
                  <p className="font-semibold text-foreground text-xs uppercase tracking-wider flex items-center gap-1.5">
                    ⏱ Pourquoi c'est lent ?
                  </p>
                  <p className="text-xs leading-relaxed">
                    Pour protéger votre compte LinkedIn, chaque invitation est traitée individuellement avec un <span className="font-medium text-foreground">délai de ~1.5 seconde</span> entre chaque action. LinkedIn détecte et bloque les actions trop rapides.
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    Estimation : ~{Math.ceil(selectedCount * 1.5)} secondes pour {selectedCount} invitation{selectedCount > 1 ? 's' : ''}.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {bulkConfirm === 'accept' ? "Confirmer l'acceptation" : 'Confirmer le refus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
