import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Check, Hourglass } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/layout/ErrorState';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { contractLabel } from '@/lib/connectionCopy';
import {
  hasContractChoice,
  listContracts,
  listSentInvitations,
  selectContract,
  shouldReadContracts,
  withdrawInvitation,
  withoutInvitation,
  withSelectedContract,
  type AccountsInvoke,
  type InvitationsPage,
  type LinkedInContract,
  type SearchInvoke,
  type SentInvitation,
} from './linkedInExtrasApi';
import {
  CONTRACTS_COPY,
  contractChangedText,
  contractProductLabel,
  contractUseAriaLabel,
  INVITATIONS_COPY,
  invitationAgeText,
  invitationsCountText,
  withdrawAriaLabel,
  withdrawDialogBody,
} from './linkedInExtrasCopy';

/**
 * LinkedInExtras : deux sections de la carte « Mon compte LinkedIn », montées en
 * différé par MyLinkedInAccount quand le compte est utilisable.
 *
 * - « Invitations en attente » : les invitations envoyées et pas encore acceptées,
 *   avec leur ancienneté. « Retirer » passe par une confirmation. Le retrait se fait
 *   depuis son propre compte (le serveur refuse le compte d'un collègue).
 * - « Contrat LinkedIn » : seulement quand le compte expose plus d'un contrat. Un seul
 *   contrat sert aux recherches à la fois (Recruiter et Sales Navigator ne fonctionnent
 *   pas ensemble) ; le choix passe par le serveur.
 *
 * Textes : linkedInExtrasCopy.ts. Appels et lectures : linkedInExtrasApi.ts.
 */

const searchInvoke: SearchInvoke = (body) => invokeUnipile({ body });
const accountsInvoke: AccountsInvoke = (body) => invokeEdgeFunction('unipile-accounts', body);

const INVITATIONS_KEY = 'linkedin-sent-invitations';
const CONTRACTS_KEY = 'linkedin-contracts';

export interface LinkedInExtrasProps {
  /** Compte LinkedIn relié à la personne connectée. */
  accountId: string;
  /** Offres du compte, pour ne lire les contrats que s'ils peuvent exister. */
  subscriptions?: { recruiter?: boolean; sales_navigator?: boolean } | null;
  /** Appelé après le choix d'un contrat, pour relire la liste des comptes. */
  onContractChanged?: () => void;
}

export function LinkedInExtras({ accountId, subscriptions, onContractChanged }: LinkedInExtrasProps) {
  return (
    <div className="space-y-6">
      <SentInvitationsCard accountId={accountId} />
      {shouldReadContracts(subscriptions) && <ContractCard accountId={accountId} onChanged={onContractChanged} />}
    </div>
  );
}

export default LinkedInExtras;

// ---------------------------------------------------------------------------
// Invitations en attente
// ---------------------------------------------------------------------------

type InvitationsData = InfiniteData<InvitationsPage, string | null>;

function SentInvitationsCard({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const queryKey = [INVITATIONS_KEY, accountId];

  const query = useInfiniteQuery<InvitationsPage, Error, InvitationsData, unknown[], string | null>({
    queryKey,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const result = await listSentInvitations(searchInvoke, accountId, pageParam);
      if (result.ok === false) throw new Error(result.userMessage);
      return result.page;
    },
    getNextPageParam: (last) => last.cursor,
    retry: 1,
    staleTime: 60 * 1000,
  });

  // Après un retrait (ou son échec), le bouton qui avait le focus n'existe plus ou était désactivé : le focus passe à
  // la ligne qui prend sa place, sinon au titre de la carte. Posé à la fin de la demande, appliqué au rendu suivant.
  const listRef = useRef<HTMLUListElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);

  const withdraw = useMutation({
    mutationFn: async ({ invitation, index }: { invitation: SentInvitation; index: number }) => {
      const result = await withdrawInvitation(searchInvoke, accountId, invitation.id);
      return { invitation, index, result };
    },
    onSuccess: ({ invitation, index, result }) => {
      pendingFocusIndex.current = index;
      if (result.ok === false && !result.notFound) {
        toast.error(result.userMessage);
        return;
      }
      // Retirée, ou déjà partie : la ligne disparaît dans les deux cas.
      queryClient.setQueryData<InvitationsData>(queryKey, (data) =>
        data ? { ...data, pages: data.pages.map((page) => withoutInvitation(page, invitation.id)) } : data);
      if (result.ok === false) toast.info(result.userMessage);
      else if (result.enrollmentsSynced) toast.success(INVITATIONS_COPY.withdrawn);
      else toast.warning(INVITATIONS_COPY.withdrawnNotSynced);
    },
    onError: (_error, variables) => {
      pendingFocusIndex.current = variables.index;
      toast.error(INVITATIONS_COPY.withdrawFailed);
    },
  });

  const invitations = useMemo(() => query.data?.pages.flatMap((page) => page.invitations) ?? [], [query.data]);
  const onWithdraw = useCallback(
    (invitation: SentInvitation) => {
      withdraw.mutate({ invitation, index: invitations.findIndex((i) => i.id === invitation.id) });
    },
    [withdraw, invitations],
  );

  useEffect(() => {
    const index = pendingFocusIndex.current;
    if (index === null || withdraw.isPending) return;
    pendingFocusIndex.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-withdraw]');
    const target = buttons && buttons.length > 0 ? buttons[Math.min(Math.max(index, 0), buttons.length - 1)] : titleRef.current;
    target?.focus();
  });

  const lastPage = query.data?.pages[query.data.pages.length - 1];
  const total = lastPage?.total ?? null;
  const loadingFirst = query.isPending;
  const loadFailed = query.isError && !query.data;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Hourglass className="h-4 w-4" aria-hidden="true" />
          <span ref={titleRef} tabIndex={-1} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {INVITATIONS_COPY.title}
          </span>
        </CardTitle>
        {!loadingFirst && !loadFailed && total !== null && total > 0 && (
          <span className="text-xs text-muted-foreground">{invitationsCountText(total)}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loadingFirst ? (
          <div role="status" className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3" aria-hidden="true">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
            <span className="sr-only">{INVITATIONS_COPY.loading}</span>
          </div>
        ) : loadFailed ? (
          <ErrorState
            variant="compact"
            title={INVITATIONS_COPY.loadFailedTitle}
            description={INVITATIONS_COPY.errorBody}
            onRetry={() => { void query.refetch(); }}
            retrying={query.isFetching}
          />
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{INVITATIONS_COPY.empty}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{INVITATIONS_COPY.help}</p>
            <ul ref={listRef} className="divide-y divide-border">
              {invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  pending={withdraw.isPending && withdraw.variables?.invitation.id === invitation.id}
                  disabled={withdraw.isPending}
                  onWithdraw={onWithdraw}
                />
              ))}
            </ul>
            {query.isError && (
              <p role="alert" className="text-xs text-danger">{INVITATIONS_COPY.moreError}</p>
            )}
            {query.hasNextPage && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  loading={query.isFetchingNextPage}
                  onClick={() => { void query.fetchNextPage(); }}
                >
                  {INVITATIONS_COPY.more}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InvitationRow({
  invitation,
  pending,
  disabled,
  onWithdraw,
}: {
  invitation: SentInvitation;
  pending: boolean;
  disabled: boolean;
  onWithdraw: (invitation: SentInvitation) => void;
}) {
  const name = invitation.name ?? INVITATIONS_COPY.unknownPerson;
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <PersonAvatar name={name} src={invitation.pictureUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {invitation.headline && <p className="truncate text-xs text-muted-foreground">{invitation.headline}</p>}
        <p className="text-xs text-muted-foreground">{invitationAgeText(invitation.ageDays)}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11"
            aria-label={withdrawAriaLabel(name)}
            data-withdraw=""
            disabled={disabled}
            loading={pending}
          >
            {INVITATIONS_COPY.withdraw}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{INVITATIONS_COPY.dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{withdrawDialogBody(name)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-md:h-11">{INVITATIONS_COPY.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="max-md:h-11" onClick={() => onWithdraw(invitation)}>
              {INVITATIONS_COPY.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Contrat LinkedIn
// ---------------------------------------------------------------------------

function ContractCard({ accountId, onChanged }: { accountId: string; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = [CONTRACTS_KEY, accountId];

  const query = useQuery<LinkedInContract[], Error>({
    queryKey,
    queryFn: async () => {
      const result = await listContracts(accountsInvoke, accountId);
      if (result.ok === false) throw new Error(result.userMessage);
      return result.contracts;
    },
    retry: 1,
    staleTime: 60 * 1000,
  });

  const select = useMutation({
    mutationFn: async (contract: LinkedInContract) => {
      const result = await selectContract(accountsInvoke, accountId, contract.id);
      if (result.ok === false) throw new Error(result.userMessage);
      return contract;
    },
    onSuccess: (contract) => {
      queryClient.setQueryData<LinkedInContract[]>(queryKey, (contracts) =>
        contracts ? withSelectedContract(contracts, contract.id) : contracts);
      toast.success(contractChangedText(contractLabel(contract.name)));
      onChanged?.();
    },
    onError: (failure) => { toast.error(failure.message || CONTRACTS_COPY.selectFailed); },
  });

  // Chargement : rien à montrer, la section n'existe peut-être pas (un seul contrat).
  if (query.isPending) return null;

  if (query.isError) {
    return (
      <Card>
        <CardContent className="py-5">
          <ErrorState
            variant="compact"
            title={CONTRACTS_COPY.loadFailedTitle}
            description={CONTRACTS_COPY.errorBody}
            onRetry={() => { void query.refetch(); }}
            retrying={query.isFetching}
          />
        </CardContent>
      </Card>
    );
  }

  const contracts = query.data;
  if (!hasContractChoice(contracts)) return null;

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          {CONTRACTS_COPY.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {CONTRACTS_COPY.explanation} {CONTRACTS_COPY.applies}
        </p>
        <ul className="divide-y divide-border">
          {contracts.map((contract) => {
            const name = contractLabel(contract.name);
            const product = contractProductLabel(contract.product);
            return (
              <li key={contract.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{name}</p>
                  {product && <p className="text-xs text-muted-foreground">{product}</p>}
                  {contract.description && <p className="truncate text-xs text-muted-foreground">{contract.description}</p>}
                </div>
                {contract.selected ? (
                  <Badge variant="muted" className="shrink-0">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {CONTRACTS_COPY.current}
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 max-md:h-11"
                    aria-label={contractUseAriaLabel(name)}
                    disabled={select.isPending}
                    loading={select.isPending && select.variables?.id === contract.id}
                    onClick={() => select.mutate(contract)}
                  >
                    {CONTRACTS_COPY.use}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
