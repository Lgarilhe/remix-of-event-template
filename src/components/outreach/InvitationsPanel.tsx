import React, { useState, useEffect, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Sparkles,
  Users,
  Clock3,
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
    <Card className="overflow-hidden border-foreground bg-background">
      <CardHeader className="border-b border-foreground bg-gradient-to-r from-background via-background to-brutal-accent/10 p-0">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-foreground bg-foreground text-background shadow-sm">
                <UserPlus className="h-5 w-5" />
              </div>

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg font-bold uppercase tracking-wide text-foreground sm:text-xl">
                    Invitations reçues
                  </CardTitle>
                  <Badge variant="default" className="rounded-none bg-foreground px-2 py-1 text-[10px] uppercase tracking-wider text-background hover:bg-foreground">
                    {loading ? '...' : `${invitations.length} en attente`}
                  </Badge>
                  {selectedCount > 0 && (
                    <Badge variant="outline" className="rounded-none border-foreground/30 bg-brutal-accent/20 px-2 py-1 text-[10px] uppercase tracking-wider">
                      {selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>

                <CardDescription className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Traitez vos demandes LinkedIn directement ici : visualisez le contexte, sélectionnez en masse et acceptez ou refusez sans quitter votre espace de travail.
                </CardDescription>

                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <div className="flex items-center gap-1.5 border border-foreground/15 bg-background px-2 py-1">
                    <Users className="h-3.5 w-3.5" />
                    <span>Compte actif</span>
                  </div>
                  <div className="flex items-center gap-1.5 border border-foreground/15 bg-background px-2 py-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Batch sécurisé</span>
                  </div>
                  <div className="flex items-center gap-1.5 border border-foreground/15 bg-background px-2 py-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>Délai anti-rate-limit</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
              {accounts.length > 1 && (
                <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
                  <SelectTrigger className="h-10 w-full rounded-none border-foreground bg-background text-sm sm:w-[240px]">
                    <SelectValue placeholder="Choisir un compte LinkedIn" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id} className="text-sm">
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
                className="h-10 w-10 rounded-none border-foreground bg-background"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {bulkProgress && (
            <div className="border border-foreground/20 bg-background/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>Traitement batch en cours</span>
                <span>{bulkProgress.done}/{bulkProgress.total}</span>
              </div>
              <Progress value={progressValue} className="h-2 rounded-none bg-muted" />
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        {invitations.length > 0 && (
          <div className="border-b border-foreground/10 bg-muted/20 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    className="border-foreground"
                  />
                  <span>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</span>
                </label>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{invitations.length} invitation{invitations.length > 1 ? 's' : ''}</span>
                  <span className="text-foreground/30">•</span>
                  <span>{selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  disabled={selectedCount === 0 || isProcessing}
                  onClick={() => setBulkConfirm('accept')}
                  className="rounded-none border border-foreground px-4 text-xs uppercase tracking-wider"
                >
                  {isProcessing && bulkConfirm === 'accept' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Tout accepter
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selectedCount === 0 || isProcessing}
                  onClick={() => setBulkConfirm('decline')}
                  className="rounded-none border border-foreground px-4 text-xs uppercase tracking-wider"
                >
                  {isProcessing && bulkConfirm === 'decline' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  Tout décliner
                </Button>
              </div>
            </div>
          </div>
        )}

        <ScrollArea className="h-full">
          {loading && invitations.length === 0 ? (
            <div className="grid gap-3 p-4 sm:p-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border border-foreground/10 bg-background p-4 animate-pulse"
                >
                  <div className="mt-1 h-4 w-4 bg-muted" />
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-40 bg-muted" />
                      <div className="h-3 w-3/4 bg-muted/70" />
                      <div className="h-3 w-2/3 bg-muted/50" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-9 w-24 bg-muted" />
                    <div className="h-9 w-24 bg-muted/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : invitations.length === 0 ? (
            <div className="flex min-h-[420px] items-center justify-center bg-gradient-to-b from-background to-muted/20 p-8">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center border border-foreground/10 bg-muted/30 text-muted-foreground">
                  <UserPlus className="h-10 w-10 opacity-50" />
                </div>
                <h3 className="mb-2 text-xl font-bold uppercase tracking-wide text-foreground">
                  Aucune invitation en attente
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Votre file est vide pour le moment. Rafraîchissez pour récupérer les nouvelles demandes ou changez de compte si vous gérez plusieurs profils.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 sm:p-4">
              <div className="grid gap-3">
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
                        'group border border-foreground/12 bg-background transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md',
                        isSelected && 'border-foreground bg-brutal-accent/10 shadow-sm',
                        isItemProcessing && 'opacity-60'
                      )}
                    >
                      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="pt-1">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleOne(invitation.id)}
                              className="border-foreground"
                              disabled={isItemProcessing}
                            />
                          </div>

                          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-foreground/10 bg-muted/50 text-sm font-bold uppercase tracking-wide text-foreground">
                            {getInitials(invitation.inviter_name)}
                          </div>

                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  {linkedinUrl ? (
                                    <a
                                      href={linkedinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex max-w-full items-center gap-1 text-lg font-semibold text-foreground hover:underline"
                                    >
                                      <span className="truncate">{invitation.inviter_name}</span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                                    </a>
                                  ) : (
                                    <span className="text-lg font-semibold text-foreground">
                                      {invitation.inviter_name}
                                    </span>
                                  )}

                                  <Badge variant="outline" className="rounded-none border-foreground/20 bg-background px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {formatRelativeDate(invitation.date, invitation.parsed_datetime)}
                                  </Badge>
                                </div>

                                {invitation.inviter_description && (
                                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                    {invitation.inviter_description}
                                  </p>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleAccept(invitation)}
                                  disabled={isItemProcessing || isProcessing}
                                  className="rounded-none border border-foreground px-3 uppercase tracking-wider"
                                >
                                  {isItemProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  Accepter
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDecline(invitation)}
                                  disabled={isItemProcessing || isProcessing}
                                  className="rounded-none border border-foreground px-3 uppercase tracking-wider"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Décliner
                                </Button>
                              </div>
                            </div>

                            {invitation.invitation_text && (
                              <div className="border-l-2 border-foreground/20 bg-muted/20 px-3 py-2">
                                <p className="text-sm italic leading-relaxed text-muted-foreground">
                                  “{invitation.invitation_text}”
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
                <div className="pt-4">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="h-11 w-full rounded-none border-foreground text-xs uppercase tracking-wider"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Chargement...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        Charger plus d’invitations
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      <AlertDialog open={!!bulkConfirm} onOpenChange={() => setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'accept' ? 'Accepter' : 'Décliner'} {selectedCount} invitation{selectedCount > 1 ? 's' : ''} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === 'accept'
                ? 'Les invitations sélectionnées seront traitées une par une avec un léger délai pour éviter les limites de débit.'
                : 'Les invitations sélectionnées seront refusées de manière séquentielle. Cette action ne peut pas être annulée.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {bulkConfirm === 'accept' ? 'Confirmer l’acceptation' : 'Confirmer le refus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
