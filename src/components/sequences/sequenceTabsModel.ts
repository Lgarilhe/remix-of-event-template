// Onglets de la page d'une séquence (lot 5c-2) : liste, onglets visibles et
// onglet par défaut. Séparé de SequenceTabs.tsx : un fichier de composant
// n'exporte que des composants (react-refresh).

export type SequenceTab = 'etapes' | 'candidats' | 'statistiques' | 'journal' | 'reglages';

export const SEQUENCE_TABS: ReadonlyArray<{ value: SequenceTab; label: string }> = [
  { value: 'etapes', label: 'Étapes' },
  { value: 'candidats', label: 'Candidats' },
  { value: 'statistiques', label: 'Statistiques' },
  { value: 'journal', label: 'Journal' },
  { value: 'reglages', label: 'Réglages' },
];

/** Onglets affichés : Statistiques et Journal après la première inscription. */
export function visibleSequenceTabs(hasEnrollments: boolean): SequenceTab[] {
  return SEQUENCE_TABS.map((t) => t.value).filter((v) => hasEnrollments || (v !== 'statistiques' && v !== 'journal'));
}

/** Onglet par défaut : « Étapes » sans inscrit, « Candidats » sinon. */
export function parseSequenceTab(raw: string | null, hasEnrollments: boolean): SequenceTab {
  const visible = visibleSequenceTabs(hasEnrollments);
  if (raw && (visible as string[]).includes(raw)) return raw as SequenceTab;
  return hasEnrollments ? 'candidats' : 'etapes';
}
