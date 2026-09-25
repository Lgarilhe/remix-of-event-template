import { cn } from '@/lib/utils';
import { useAppTheme } from '@/lib/theme';

type Variant = 'full' | 'mark';
type Theme = 'auto' | 'dark' | 'light';

interface KonektLogoProps {
  /** "full" = mark + wordmark "Konekt" / "mark" = cercle seul */
  variant?: Variant;
  /**
   * "auto" : suit le thème de l'application (blanc en sombre, bleu marine en clair).
   * "dark" : logo bleu marine, pour un fond clair fixe.
   * "light" : logo blanc, pour un fond sombre fixe.
   */
  theme?: Theme;
  /** Hauteur en px (la largeur s'adapte au ratio). Défaut : 32 pour mark, 36 pour full. */
  size?: number;
  className?: string;
  /** Override aria-label si besoin (par défaut "Konekt"). */
  ariaLabel?: string;
}

/**
 * Logo Konekt officiel.
 *
 * Usage :
 *   <KonektLogo theme="auto" />             // suit le thème de l'application
 *   <KonektLogo />                          // full, bleu marine (fond clair)
 *   <KonektLogo theme="light" />            // full, blanc (fond sombre)
 *   <KonektLogo variant="mark" size={28} /> // mark seul (favicon-style)
 *
 * Les fichiers sont dans `/public/konekt-{logo,mark}{,-white}.png` (PNG
 * transparents générés depuis les sources WhatsApp via scripts/convert-logos.py).
 * Pour passer en SVG natif, remplacer par .svg + ajuster l'extension ici.
 */
export const KonektLogo = ({
  variant = 'full',
  theme = 'dark',
  size,
  className,
  ariaLabel = 'Konekt',
}: KonektLogoProps) => {
  const appTheme = useAppTheme();
  const useWhite = theme === 'light' || (theme === 'auto' && appTheme === 'dark');
  const base = variant === 'mark' ? 'konekt-mark' : 'konekt-logo';
  const src = `/${base}${useWhite ? '-white' : ''}.png`;
  const defaultSize = variant === 'mark' ? 32 : 36;
  const finalSize = size ?? defaultSize;

  return (
    <img
      src={src}
      alt={ariaLabel}
      height={finalSize}
      style={{ height: finalSize, width: 'auto' }}
      className={cn('inline-block select-none', className)}
      draggable={false}
    />
  );
};

export default KonektLogo;
