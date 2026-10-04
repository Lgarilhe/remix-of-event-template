// Refonte mission, lot 3 : onglet de la fiche gardé d'un candidat à l'autre
// pendant la session (la fiche est remontée à chaque candidat). Module à part
// pour que l'écran Pipeline puisse choisir l'onglet (« Répondre » ouvre
// Échanges) sans importer la fiche, chargée à la demande.
import type { CandidatePanelTabKey } from './CandidatePanelTabs';

let rememberedTab: CandidatePanelTabKey = 'apercu';

export function getRememberedPanelTab(): CandidatePanelTabKey {
  return rememberedTab;
}

export function rememberPanelTab(key: CandidatePanelTabKey): void {
  rememberedTab = key;
}
