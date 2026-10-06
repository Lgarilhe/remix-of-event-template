import { useCallback } from 'react';
import { useSidebar } from '@/components/ui/sidebar';

/**
 * Ferme la barre sur téléphone (Sheet), avant toute navigation ou ouverture
 * de fenêtre depuis la barre (§2.6). Sans effet sur ordinateur.
 * Hors du .tsx des composants, pour ne pas ajouter d'avertissement
 * react-refresh/only-export-components.
 */
export function useCloseMobileSidebar(): () => void {
  const { setOpenMobile } = useSidebar();
  return useCallback(() => setOpenMobile(false), [setOpenMobile]);
}
