/**
 * Panne LinkedIn, en tête d'À traiter, sans titre de section (§4.0, D41).
 * Rouge permis : c'est une panne (D8). Compte 1 dans le chiffre (ligne en gras).
 * Compte restreint : même ligne, sans « reconnecter » (se reconnecter n'y change rien).
 * Hors panne et en chargement : rien (une ligne grise apparaîtrait pour
 * disparaître presque toujours). Lecture des liaisons en échec : une ligne
 * grise et « Réessayer ».
 */
import { AlertTriangle } from 'lucide-react';
import { useLinkedInOutage } from '@/hooks/sidebar/useLinkedInOutage';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

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
  if (!outage) return null;

  return (
    <SidebarSection id="linkedin-outage" state="ok" isEmpty={false}>
      <SidebarRow
        leading={<AlertTriangle className="text-destructive" />}
        title={kind === 'locked' ? 'Compte LinkedIn restreint' : 'Compte LinkedIn à reconnecter'}
        sub="Les envois sont en pause"
        strong
        to="/settings/account/connections"
      />
    </SidebarSection>
  );
}
