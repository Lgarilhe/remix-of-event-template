/**
 * Nombre suivi de son nom, accordé : « 0 candidat », « 1 candidat »,
 * « 3 candidats ». En français, 0 et 1 restent au singulier ; le nombre
 * s'écrit à la française (« 1 200 »). Revue design D-71 : jamais « (s) ».
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`;
}
