/**
 * Panne LinkedIn, en tête d'À traiter, sans titre de section (§4.0, D41).
 * Rouge permis : c'est une panne (D8). Compte 1 dans le chiffre (ligne en gras).
 * Connexion partielle (PARTIAL) : même ligne, avec la phrase de la carte de connexion.
 * Compte restreint : même ligne, sans « reconnecter » (se reconnecter n'y change rien).
 * Hors panne et en chargement : rien (une ligne grise apparaîtrait pour
 * disparaître presque toujours). Lecture des liaisons en échec : une ligne
 * grise et « Réessayer ».
 */
import { AlertTriangle } from 'lucide-react';
import { useLinkedInOutage } from '@/hooks/sidebar/useLinkedInOutage';
import { causeReason } from '@/lib/connectionCopy';
import type { LinkedInOutageKind } from '@/lib/linkedinStatus';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

/** Titre et sous-titre de la ligne selon le genre de panne (connexion partielle : la phrase de la carte). */
const ROW_COPY: Record<LinkedInOutageKind, { title: string; sub: string }> = {
  reconnect: { title: 'Compte LinkedIn à reconnecter', sub: 'Les envois sont en pause' },
  partial: { title: 'Connexion LinkedIn partielle', sub: causeReason('authentication_partial', 'linkedin') },
  locked: { title: 'Compte LinkedIn restreint', sub: 'Les envois sont en pause' },
};

export function LinkedInOutageSection() {
  const { status, outage, kind, retry } = useLinkedInOutage();

  if (status === 'error') {
    return (
      <SidebarSection
        id="linkedin-outage"
        state="error"
        onRetry={retry}
        isEmpty
        errorText="Impossible de vérifier votre compte LinkedIn."
      />
    );
  }
  if (!outage || !kind) return null;
  const copy = ROW_COPY[kind];

  return (
    <SidebarSection id="linkedin-outage" state="ok" isEmpty={false}>
      <SidebarRow
        leading={<AlertTriangle className="text-destructive" />}
        title={copy.title}
        sub={copy.sub}
        strong
        to="/settings/account/connections"
      />
    </SidebarSection>
  );
}
