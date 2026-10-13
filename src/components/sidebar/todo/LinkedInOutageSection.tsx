/**
 * Panne LinkedIn, en tête d'À traiter, sans titre de section (§4.0, D41).
 * Rouge permis : c'est une panne (D8). Compte 1 dans le chiffre (ligne en gras).
 * Connexion partielle (PARTIAL) : même ligne, dont le sous-titre dit le geste en quelques mots. La ligne
 * n'a qu'une ligne de sous-titre dans la barre de 256 px (SidebarRow le coupe) : 30 caractères au plus
 * (mesuré dans la colonne de 195 px : 29 tiennent, 36 sont coupés), sinon le geste n'apparaît qu'au survol,
 * que le toucher n'a pas. La phrase entière de la carte de connexion reste au bandeau du tableau de bord et à la
 * notification, et la ligne la porte aussi dans son texte de survol (`hint` de SidebarRow, ROW_HINT).
 * Compte restreint : même ligne, sans « reconnecter » (se reconnecter n'y change rien).
 * Hors panne et en chargement : rien (une ligne grise apparaîtrait pour
 * disparaître presque toujours). Lecture des liaisons en échec : une ligne
 * grise et « Réessayer ».
 */
import { AlertTriangle } from 'lucide-react';
import { useLinkedInOutage } from '@/hooks/sidebar/useLinkedInOutage';
import type { LinkedInOutageKind } from '@/lib/linkedinStatus';
import { OUTAGE_ROW_HINT, causeReason, healthReason } from '@/lib/connectionCopy';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

/**
 * Titre et sous-titre de la ligne selon le genre de panne. Le sous-titre tient sur une ligne de la barre
 * latérale : 30 caractères au plus (garde : tests/ux/etat-compte-alertes.test.mjs).
 */
const ROW_COPY: Record<LinkedInOutageKind, { title: string; sub: string }> = {
  reconnect: { title: 'Compte LinkedIn à reconnecter', sub: 'Les envois sont en pause' },
  partial: { title: 'Connexion LinkedIn partielle', sub: 'Reconnectez le compte' },
  locked: { title: 'Compte LinkedIn restreint', sub: 'Les envois sont en pause' },
};

/**
 * Phrase entière de chaque genre de panne, au survol et au toucher long de la ligne (le sous-titre est court) : celle de la
 * carte de connexion pour la connexion partielle et l'accès restreint, une phrase valable pour toute cause pour « à
 * reconnecter » (la ligne ne distingue pas une session expirée d'une panne).
 */
const ROW_HINT: Record<LinkedInOutageKind, string> = {
  reconnect: OUTAGE_ROW_HINT.reconnect,
  partial: causeReason('authentication_partial', 'linkedin'),
  locked: healthReason('locked', 'linkedin'),
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
        hint={ROW_HINT[kind]}
        strong
        to="/settings/account/connections"
      />
    </SidebarSection>
  );
}
