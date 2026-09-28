import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { badgeVariants } from '@/components/ui/badge';
import type { SendingAccountState } from './useSendingAccount';

// État du compte : pastille du kit (jetons de statut du design), comme les autres badges d'état.
const HEALTH_LABELS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  connected: { label: 'Connecté', variant: 'success' },
  connecting: { label: 'Connexion en cours', variant: 'warning' },
  needs_reconnect: { label: 'Déconnecté', variant: 'danger' },
};

/**
 * « Envoyé depuis le compte LinkedIn de {nom} », affiché près du bouton
 * d'inscription, avec l'état du compte et, s'il bloque, la raison et le lien
 * vers les connexions.
 */
export function SendingAccountNotice({ state, className }: { state: SendingAccountState; className?: string }) {
  const { name, health, blockReason } = state;
  const healthInfo = health ? HEALTH_LABELS[health] : undefined;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug',
        blockReason ? 'border-danger/25 bg-danger-muted' : 'border-border bg-muted/20',
        className,
      )}
      role={blockReason ? 'alert' : undefined}
    >
      {blockReason
        ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        : <Send className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-foreground">
          {name
            ? <>Envoyé depuis le compte LinkedIn de <strong className="font-semibold">{name}</strong></>
            : <>Envoyé depuis le compte LinkedIn sélectionné</>}
          {healthInfo && (
            <span className={cn(badgeVariants({ variant: healthInfo.variant }), 'ml-1.5 px-1.5 py-0 align-middle text-3xs')}>
              {health === 'connecting' && <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" />}
              {healthInfo.label}
            </span>
          )}
        </p>
        {blockReason ? (
          <p className="text-danger">
            {blockReason}{' '}
            <Link to="/settings/account/connections" className="underline underline-offset-2 font-medium">
              Ouvrir mes connexions
            </Link>
          </p>
        ) : health === 'connecting' ? (
          <p className="text-muted-foreground">Les envois démarreront une fois la connexion établie.</p>
        ) : null}
      </div>
    </div>
  );
}
