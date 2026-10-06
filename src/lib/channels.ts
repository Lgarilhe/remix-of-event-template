/**
 * Canaux de contact : une seule table pour la messagerie, l'éditeur de
 * séquence, la préparation et le suivi (revue design D-16, D-65, D-66).
 *
 * LinkedIn et WhatsApp se reconnaissent à leur logo officiel, l'e-mail et
 * l'appel à leur icône, en gris. La couleur d'un canal reste dans son logo :
 * jamais sur une action, un statut ou un bouton (01-direction.md, § 2).
 */

export type Channel = 'linkedin' | 'email' | 'whatsapp' | 'call';

export const CHANNELS: Record<Channel, { label: string }> = {
  linkedin: { label: 'LinkedIn' },
  email: { label: 'E-mail' },
  whatsapp: { label: 'WhatsApp' },
  call: { label: 'Appel' },
};

export function channelLabel(channel: Channel): string {
  return CHANNELS[channel].label;
}

/**
 * Canal d'un compte de messagerie d'après son type (« LINKEDIN »,
 * « WHATSAPP », « MAIL », « GOOGLE_OAUTH »…). LinkedIn par défaut : c'est le
 * seul canal de la messagerie aujourd'hui.
 */
export function channelOfAccount(accountType?: string | null): Channel {
  const lower = (accountType ?? '').toLowerCase();
  if (lower.includes('whatsapp') || lower === 'wa') return 'whatsapp';
  if (lower.includes('mail') || lower.includes('google') || lower.includes('outlook') || lower === 'imap') return 'email';
  return 'linkedin';
}
