/**
 * Quand rouvrir la liste des boîtes e-mail à l'ouverture de Connexions, sans React.
 *
 * La carte relit la liste à chaque ouverture : l'état d'une boîte se lit au moment de l'afficher
 * (le webhook a pu la passer « à reconnecter » depuis la dernière lecture). Sauf quand une lecture
 * vient d'aboutir : au chargement de la page, la barre latérale lit la même liste quelques centaines
 * de millisecondes avant la carte, et la refaire serait un second appel pour la même information.
 */

/** Une lecture plus récente que ce délai (en ms) vient d'être faite : l'ouverture de la carte ne la répète pas. */
export const EMAIL_LIST_JUST_READ_MS = 10_000;

/** Valeur de `refetchOnMount` pour une lecture reçue à `dataUpdatedAt` (0 : jamais lue). */
export function rereadOnMount(dataUpdatedAt: number, now: number = Date.now()): 'always' | false {
  return now - dataUpdatedAt < EMAIL_LIST_JUST_READ_MS ? false : 'always';
}
