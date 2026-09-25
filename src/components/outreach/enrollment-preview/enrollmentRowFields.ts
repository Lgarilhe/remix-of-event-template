import type { LinkedInProfile } from '@/components/outreach/types';

/**
 * Champs d'identité et de contact posés sur chaque ligne sequence_enrollments
 * créée par l'interface (aperçu d'inscription et inscription simple).
 * - provider_id : second identifiant LinkedIn, lu par l'anti-doublon
 *   (enrollmentDuplicates) pour reconnaître un candidat inscrit sous un autre
 *   identifiant (Recruiter ou classique).
 * - email_used / phone_used : sans eux, le moteur saute toutes les étapes
 *   e-mail et WhatsApp (« No email — channel skipped »). L'adresse est stockée
 *   sans espaces et en minuscules, comme la liste de désinscription.
 */
export function enrollmentRowFields(profile: Pick<LinkedInProfile, 'provider_id' | 'contact_info'>): {
  provider_id: string | null;
  email_used: string | null;
  phone_used: string | null;
} {
  // Défensif : une valeur non textuelle (donnée importée) est ignorée plutôt que de faire échouer l'inscription.
  const firstText = (list: readonly unknown[] | undefined) => {
    const value = list?.[0];
    return typeof value === 'string' ? value.trim() : '';
  };
  const email = firstText(profile.contact_info?.emails).toLowerCase();
  const phone = firstText(profile.contact_info?.phones);
  return {
    provider_id: profile.provider_id ?? null,
    email_used: email || null,
    phone_used: phone || null,
  };
}
