import { useEffect, useState } from 'react';

/**
 * Thème de l'application : sombre par défaut (:root), clair quand <html> porte
 * la classe .light (posée par main.tsx, la barre latérale, la palette et
 * l'accueil). Les composants qui ont besoin du thème en JavaScript le lisent
 * ici plutôt que par next-themes, dont aucun fournisseur n'est monté.
 */
export type AppTheme = 'dark' | 'light';

export function getAppTheme(): AppTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

/** Applique un thème et le mémorise (clé lue par main.tsx au démarrage). */
export function setAppTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem('konekt-theme', theme);
  } catch {
    // stockage indisponible : le choix vaut pour la session en cours
  }
}

/** Thème courant, mis à jour quand la classe de <html> change. */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(getAppTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getAppTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
