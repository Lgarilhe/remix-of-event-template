import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SendingAccountState } from './useSendingAccount';

const HEALTH_LABELS: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connecté', className: 'bg-success/10 text-success border-success/30' },
  connecting: { label: 'Connexion en cours', className: 'bg-warning/10 text-warning border-warning/30' },
  needs_reconnect: { label: 'Déconnecté', className: 'bg-destructive/10 text-destructive border-destructive/30' },
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
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug',
        blockReason ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/20',
        className,
      )}
      role={blockReason ? 'alert' : undefined}
    >
      {blockReason
        ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        : <Send className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-foreground">
          {name
            ? <>Envoyé depuis le compte LinkedIn de <strong className="font-semibold">{name}</strong></>
            : <>Envoyé depuis le compte LinkedIn sélectionné</>}
          {healthInfo && (
            <span className={cn('ml-1.5 inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium align-middle', healthInfo.className)}>
              {health === 'connecting' && <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" aria-hidden="true" />}
              {healthInfo.label}
            </span>
          )}
        </p>
        {blockReason ? (
          <p className="text-destructive">
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
