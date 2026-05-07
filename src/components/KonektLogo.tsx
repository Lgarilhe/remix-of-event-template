import { cn } from '@/lib/utils';

type Variant = 'full' | 'mark';
type Theme = 'auto' | 'dark' | 'light';

interface KonektLogoProps {
  /** "full" = mark + wordmark "Konekt" / "mark" = cercle seul */
  variant?: Variant;
  /**
   * "auto" : utilise konekt-logo.svg (bleu navy) — convient pour fond clair.
   *          Pour fond sombre, passer explicitement "light" (logo blanc).
   * "dark" : alias de "auto" — logo bleu navy.
   * "light" : logo blanc, pour fond sombre (sidebar, hero dark mode).
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
 *   <KonektLogo />                          // full, bleu navy (fond clair)
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
  const useWhite = theme === 'light';
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
