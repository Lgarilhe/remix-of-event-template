/**
 * QR code d'une connexion WhatsApp. Le serveur donne soit le texte à encoder,
 * soit déjà une image (adresse `data:image/`) : l'image est affichée telle
 * quelle, le texte est dessiné par src/components/connections/native/qr.ts.
 *
 * Le code est toujours noir sur blanc, dans les deux thèmes : un lecteur de
 * téléphone ne reconnaît pas un code inversé ou teinté. Les deux couleurs sont
 * donc écrites en dur sur le dessin, c'est la seule exception de l'assistant.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { encodeQr } from './qr';

/** Zone vide autour du code, en modules (la norme en demande quatre). */
const QUIET_ZONE = 4;

/** Tracé de tous les modules sombres, une bande par ligne de modules adjacents. */
function modulesPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return parts.join('');
}

export function isImageSource(value: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);
}

interface QrCodeProps {
  value: string;
  alt: string;
  className?: string;
}

/** Rend `null` quand le texte est trop long pour un QR code : l'appelant montre alors l'erreur de connexion. */
export function QrCode({ value, alt, className }: QrCodeProps) {
  const drawing = useMemo(() => {
    if (isImageSource(value)) return { kind: 'image' as const };
    try {
      const matrix = encodeQr(value);
      return { kind: 'matrix' as const, size: matrix.length + QUIET_ZONE * 2, path: modulesPath(matrix) };
    } catch {
      return null;
    }
  }, [value]);

  if (!drawing) return null;
  const frame = cn('aspect-square w-full max-w-[16rem] rounded-xl border border-border', className);
  if (drawing.kind === 'image') {
    return <img src={value} alt={alt} className={cn(frame, 'bg-white object-contain p-2')} style={{ imageRendering: 'pixelated' }} />;
  }
  return (
    <svg
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      role="img"
      aria-label={alt}
      shapeRendering="crispEdges"
      className={frame}
    >
      <rect width={drawing.size} height={drawing.size} fill="#ffffff" />
      <path d={drawing.path} fill="#000000" />
    </svg>
  );
}
