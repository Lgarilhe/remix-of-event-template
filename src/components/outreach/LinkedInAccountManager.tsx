// Ancien gestionnaire de comptes LinkedIn : l'écran (formulaires de connexion,
// vérifications, comptes de l'organisation) n'était monté nulle part et a été
// retiré. Reste la lecture d'une correction de licence gardée par l'ancien
// écran dans le navigateur, encore appliquée par useFilteredLinkedInAccounts et
// la messagerie. Plus rien n'écrit cette correction : sans valeur gardée, le
// compte est rendu tel quel. À retirer avec ces deux lecteurs, puis ce fichier.
import type { LinkedInAccount } from '@/pages/Outreach';

const OVERRIDES_KEY = 'linkedin_subscription_overrides';

function getSubscriptionOverrides(): Record<string, { recruiter?: boolean; sales_navigator?: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch { return {}; }
}

export function applySubscriptionOverrides(account: LinkedInAccount): LinkedInAccount {
  const overrides = getSubscriptionOverrides()[account.id];
  if (!overrides) return account;
  return {
    ...account,
    subscriptions: {
      classic: account.subscriptions?.classic ?? true,
      recruiter: overrides.recruiter ?? account.subscriptions?.recruiter ?? false,
      sales_navigator: overrides.sales_navigator ?? account.subscriptions?.sales_navigator ?? false,
    },
  };
}
