/**
 * Pièces communes des cartes de Connexions (LinkedIn, messagerie, WhatsApp,
 * carte de l'organisation) : une ligne de compte, l'état en un mot, l'avis
 * d'un compte à vérifier, le squelette de chargement, la confirmation de
 * dissociation et le bouton qui part vers la page de connexion.
 *
 * Même anatomie partout (docs/design/01-direction.md, § 6 et § 8) : la ligne
 * est une zone grise sans carte dans la carte, l'état est une pastille de 6 px
 * suivie d'un mot, le retrait est un bouton gris qui rougit au survol, les
 * cibles font 44 px sur téléphone.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Plug, Unlink } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { cn } from '@/lib/utils';
import { HOSTED_BUTTON, UNLINK, type ConnectionProviderId } from '@/lib/connectionCopy';
import { TONE_DOT, TONE_TEXT, type ConnectionView } from './connectionView';
import { useHostedConnect, type UseHostedConnect } from './useHostedConnect';
import type { ReturnTarget } from './returnTarget';

// ---------------------------------------------------------------------------
// État en un mot
// ---------------------------------------------------------------------------

/**
 * Pastille et mot de l'état. La zone est annoncée aux lecteurs d'écran quand
 * l'état change (synchronisation terminée, compte à reconnecter).
 */
export function ConnectionStateLine({ view, children }: { view: ConnectionView; children?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs" aria-live="polite">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[view.tone])} aria-hidden="true" />
      <span className={TONE_TEXT[view.tone]}>{view.label}</span>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Ligne d'un compte
// ---------------------------------------------------------------------------

interface AccountRowProps {
  leading: ReactNode;
  name: string;
  view: ConnectionView;
  /** Texte à la suite de l'état (fournisseur, offre). */
  inline?: ReactNode;
  /** Lignes de détail sous l'état : phrase d'explication, offre, date de liaison. */
  details?: ReactNode;
  actions?: ReactNode;
}

/** Sur téléphone les gestes passent sous l'identité, en pleine largeur. */
export function AccountRow({ leading, name, view, inline, details, actions }: AccountRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0 space-y-0.5">
          <p className="break-words text-sm font-medium text-foreground">{name}</p>
          <ConnectionStateLine view={view}>{inline}</ConnectionStateLine>
          {details}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

/** Ligne de détail sous l'état (phrase d'explication, offre, date de liaison). */
export function DetailLine({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Avis dans une carte
// ---------------------------------------------------------------------------

const NOTICE_TILE: Record<'warning' | 'danger' | 'info', string> = {
  warning: 'bg-warning-muted text-warning',
  danger: 'bg-danger-muted text-danger',
  info: 'bg-info-muted text-info',
};

/** Avis dans la carte : même anatomie que l'état d'erreur compact du kit. */
export function ConnectionNotice({
  tone = 'warning',
  title,
  children,
}: {
  tone?: 'warning' | 'danger' | 'info';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', NOTICE_TILE[tone])}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-foreground">{title}</p>
        {children && <div className="mt-1 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

/** Squelette d'une ligne de compte : annoncé une fois, jamais un faux « non connecté » en attendant. */
export function ConnectionSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" aria-hidden="true" />
      <div className="flex-1 space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dissociation
// ---------------------------------------------------------------------------

/**
 * Dissocier, retirer ou déconnecter : geste de retrait, gris au repos et rouge
 * au survol, toujours derrière une confirmation.
 */
export function RemovalDialog({
  triggerLabel = UNLINK.confirm,
  title,
  body,
  confirmLabel = UNLINK.confirm,
  disabled,
  loading,
  onConfirm,
  icon = true,
  triggerAriaLabel,
}: {
  triggerLabel?: string;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  icon?: boolean;
  /** Nom accessible du bouton quand plusieurs lignes en portent un : il nomme le compte visé. */
  triggerAriaLabel?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-danger max-sm:flex-1 max-md:h-11"
          disabled={disabled}
          loading={loading}
          aria-label={triggerAriaLabel}
        >
          {icon && !loading && <Unlink aria-hidden="true" />}
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="max-md:h-11">{UNLINK.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="max-md:h-11" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

interface ConnectButtonProps extends Pick<ButtonProps, 'variant' | 'size' | 'className'> {
  provider: ConnectionProviderId;
  label: string;
  /** Compte à reconnecter ; absent pour une nouvelle connexion. */
  reconnectAccountId?: string | null;
  returnTo?: ReturnTarget;
  onLeave?: () => void;
  /** Une phrase sous le bouton dit que la personne quitte Konekt quelques instants. */
  help?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Bouton qui envoie vers la page de connexion dans l'onglet courant. L'attente
 * et l'échec sont affichés ici : jamais une fenêtre qui s'ouvre après coup,
 * jamais le texte brut du prestataire.
 */
export function HostedConnectButton({
  provider,
  label,
  reconnectAccountId,
  returnTo,
  onLeave,
  help = false,
  icon,
  variant = 'primary',
  size = 'sm',
  className,
  disabled,
}: ConnectButtonProps) {
  const hosted = useHostedConnect();
  const busy = hosted.busy;
  const errorId = `connexion-erreur-${provider}-${reconnectAccountId ?? 'nouveau'}`;
  return (
    <div className={cn('space-y-2', className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        className="w-full max-md:h-11"
        loading={busy}
        disabled={disabled || busy}
        aria-describedby={hosted.error ? errorId : undefined}
        onClick={() => { void hosted.start({ provider, reconnectAccountId, returnTo, onLeave }); }}
      >
        {!busy && icon}
        {hostedLabel(hosted, provider, label)}
      </Button>
      {hosted.error && (
        <p id={errorId} role="alert" className="text-sm text-danger">{hosted.error}</p>
      )}
      {help && !hosted.error && <p className="text-xs text-muted-foreground">{HOSTED_BUTTON.help(provider)}</p>}
    </div>
  );
}

/** Libellé d'un bouton de connexion selon l'avancement du départ (au repos : le libellé du geste). */
function hostedLabel(hosted: UseHostedConnect, provider: ConnectionProviderId, idle: string): string {
  if (hosted.provider !== provider) return idle;
  return hosted.phase === 'redirecting' ? HOSTED_BUTTON.redirecting : hosted.phase === 'starting' ? HOSTED_BUTTON.starting : idle;
}

/**
 * « Reconnecter » dans la ligne d'un compte. L'état du départ vit dans la carte
 * (`hosted`), pour que l'échec s'écrive sous la ligne, en pleine largeur
 * (HostedError), et non dans la colonne étroite des gestes.
 */
export function ReconnectButton({
  hosted,
  provider,
  accountId,
  startsNew = false,
  label,
  ariaLabel,
  returnTo,
  disabled,
  className,
}: {
  hosted: UseHostedConnect;
  provider: ConnectionProviderId;
  accountId: string;
  /** Le compte n'existe plus chez le prestataire : le geste ouvre une nouvelle connexion qui remplace la liaison. */
  startsNew?: boolean;
  label: string;
  /** Nom accessible quand plusieurs lignes portent le même bouton : il nomme le compte visé. */
  ariaLabel?: string;
  returnTo?: ReturnTarget;
  disabled?: boolean;
  className?: string;
}) {
  const mine = hosted.busy && hosted.provider === provider;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('max-md:h-11', className)}
      loading={mine}
      disabled={disabled || hosted.busy}
      aria-label={mine ? undefined : ariaLabel}
      onClick={() => { void hosted.start({ provider, reconnectAccountId: startsNew ? null : accountId, returnTo }); }}
    >
      {!mine && <Plug aria-hidden="true" />}
      {hostedLabel(hosted, provider, label)}
    </Button>
  );
}

/** Échec du départ vers la page de connexion : une phrase de Konekt, annoncée aux lecteurs d'écran. */
export function HostedError({ hosted }: { hosted: UseHostedConnect }) {
  if (!hosted.error) return null;
  return <p role="alert" className="text-sm text-danger">{hosted.error}</p>;
}
