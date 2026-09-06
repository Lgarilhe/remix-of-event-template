import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReconnectAlerts } from '@/hooks/useReconnectAlerts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';

// Fenêtre d'affichage : le problème est considéré « actif » si le dernier
// conflit date de moins d'une heure. Pendant une panne, chaque recherche
// échouée rafraîchit last_failure_at → la bannière reste. Après reconnexion,
// elle disparaît d'elle-même en ≤ 1 h (ou immédiatement via la croix).
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

const dismissKey = (accountId: string) => `li-reconnect-dismissed:${accountId}`;

// Bannière « compte à reconnecter » — s'appuie sur la boîte noire
// search_failure_log : ≥ 2 conflits de session en 12 h sur un compte de
// l'org. Remède documenté (LOGBOOK 2026-07-06) : ré-importer des cookies
// frais après chaque re-login LinkedIn dans le navigateur.
export const LinkedInReconnectBanner = () => {
  const navigate = useNavigate();
  const { data: alerts = [] } = useReconnectAlerts();
  const { accounts } = useLinkedInAccounts();
  const [dismissedTick, setDismissedTick] = useState(0);

  const now = Date.now();
  const visible = alerts.filter((a) => {
    const last = new Date(a.last_failure_at).getTime();
    if (Number.isNaN(last) || now - last > ACTIVE_WINDOW_MS) return false;
    // Une dismissal ne vaut que pour les échecs déjà vus : un conflit plus
    // récent que la croix ré-affiche la bannière.
    try {
      const dismissedAt = localStorage.getItem(dismissKey(a.account_id));
      if (dismissedAt && new Date(dismissedAt).getTime() >= last) return false;
    } catch { /* localStorage indisponible → on affiche */ }
    return true;
  });

  // dismissedTick force le re-render après clic sur la croix (localStorage
  // n'est pas réactif).
  void dismissedTick;

  if (visible.length === 0) return null;

  const dismiss = (accountId: string, lastFailureAt: string) => {
    try {
      localStorage.setItem(dismissKey(accountId), lastFailureAt);
    } catch { /* noop */ }
    setDismissedTick((t) => t + 1);
  };

  return (
    <div className="mx-2 sm:mx-0 mb-2 flex flex-col gap-2">
      {visible.map((alert) => {
        const account = accounts.find((acc) => acc.id === alert.account_id);
        const accountLabel = account?.name || 'Votre compte LinkedIn';
        return (
          <div
            key={alert.account_id}
            className="flex flex-wrap items-center gap-2 px-3 py-2 border border-amber-500/40 bg-amber-500/10 rounded-md text-xs"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
              <span className="font-semibold">{accountLabel} — session LinkedIn instable.</span>{' '}
              Plusieurs conflits de session détectés : reconnectez-vous à LinkedIn dans votre
              navigateur puis ré-importez des cookies frais (li_at + li_a) dans Konekt.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-500/50"
              onClick={() => navigate('/settings?tab=account')}
            >
              Reconnecter
            </Button>
            <button
              type="button"
              aria-label="Masquer cette alerte"
              className="p-1 rounded hover:bg-amber-500/20 text-amber-700 dark:text-amber-400"
              onClick={() => dismiss(alert.account_id, alert.last_failure_at)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
