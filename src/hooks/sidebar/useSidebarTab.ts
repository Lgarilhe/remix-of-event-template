import { useCallback, useState } from 'react';
import { parseSidebarTab, SIDEBAR_TAB_STORAGE_KEY, type SidebarTabId } from '@/lib/sidebarTabs';

function readStoredTab(): SidebarTabId {
  try {
    return parseSidebarTab(localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY));
  } catch {
    // Stockage indisponible (navigation privée, sites bloqués) : onglet par défaut.
    return 'todo';
  }
}

/**
 * Onglet actif de la barre, mémorisé dans le stockage local (D2, D36).
 *
 * À appeler UNE seule fois, dans AppSidebar, qui passe l'onglet et le setter en
 * props à SidebarTabs et choisit le panneau : deux appels donneraient deux
 * états, et le panneau ne suivrait plus l'onglet. Le stockage fait survivre
 * l'onglet au remontage d'AppLayout (entrée dans /settings/*).
 */
export function useSidebarTab(): [SidebarTabId, (t: SidebarTabId) => void] {
  const [tab, setTabState] = useState<SidebarTabId>(readStoredTab);

  const setTab = useCallback((next: SidebarTabId) => {
    setTabState(next);
    try {
      localStorage.setItem(SIDEBAR_TAB_STORAGE_KEY, next);
    } catch {
      // Stockage indisponible : l'onglet vaut pour la session en cours.
    }
  }, []);

  return [tab, setTab];
}
