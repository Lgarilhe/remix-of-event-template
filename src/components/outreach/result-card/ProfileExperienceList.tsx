/**
 * ProfileExperienceList — affiche TOUTES les expériences pro d'un profil LinkedIn
 * dans la card de preview, avec logo entreprise + titre + durée + période.
 *
 * Refonte UX 2026-04-27 : avant la card sourcing affichait juste 1-2 lignes
 * avec "+N autres". Maintenant on a une vraie mini-fiche profil dans la preview.
 *
 * Comportement :
 * - Affiche les 3 expériences les plus récentes par défaut
 * - Bouton "Voir N de plus" pour étendre la liste complète
 * - Sépare visuellement les jobs actuels (puce verte) des passés (puce grise)
 * - Logo entreprise affiché si dispo, sinon Building2 fallback
 */

import React, { useState, useMemo } from 'react';
import { Briefcase, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import { parseDate } from '../dateUtils';

interface Experience {
  company?: string;
  /** Logo entreprise — Unipile renvoie selon les cas l'un ou l'autre.
      Ordre de priorité observé : company_logo > logo_url > logo > company_picture_url. */
  company_logo?: string;
  logo_url?: string;
  logo?: string;
  company_picture_url?: string;
  role?: string;
  position?: string;
  start?: any;
  end?: any;
  current?: boolean;
  location?: string;
}

/** Résout l'URL du logo entreprise selon les variantes Unipile. */
function getCompanyLogo(exp: Experience): string | null {
  return exp.company_logo || exp.logo_url || exp.logo || exp.company_picture_url || null;
}

interface ProfileExperienceListProps {
  experiences: Experience[];
  defaultLimit?: number;
}

const MONTHS_FR = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

function formatDate(d: any): string {
  const parsed = parseDate(d);
  if (!parsed?.year) return '';
  if (parsed.month) return `${MONTHS_FR[parsed.month - 1]} ${parsed.year}`;
  return String(parsed.year);
}

function computeDuration(start: any, end: any): string | null {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s?.year) return null;
  const startDate = new Date(s.year, (s.month || 1) - 1);
  const endDate = e?.year ? new Date(e.year, (e.month || 12) - 1) : new Date();
  const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
  const years = Math.floor(diffMonths / 12);
  const months = diffMonths % 12;
  if (years > 0 && months > 0) return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
  if (years > 0) return `${years} an${years > 1 ? 's' : ''}`;
  if (months > 0) return `${months} mois`;
  return null;
}

export const ProfileExperienceList: React.FC<ProfileExperienceListProps> = ({
  experiences,
  defaultLimit = 3,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Trie : actuels d'abord (current=true ou pas de end date), puis passés par end date desc
  const sorted = useMemo(() => {
    return [...experiences].sort((a, b) => {
      const aIsCurrent = a.current || !a.end;
      const bIsCurrent = b.current || !b.end;
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      const aEnd = parseDate(a.end)?.year || 0;
      const bEnd = parseDate(b.end)?.year || 0;
      return bEnd - aEnd;
    });
  }, [experiences]);

  if (sorted.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, defaultLimit);
  const remaining = sorted.length - defaultLimit;

  return (
    <section className="mt-2.5 pt-2.5 border-t border-border/40">
      <header className="flex items-center gap-1.5 mb-1.5">
        <Briefcase className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Expériences
        </h4>
        <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
          {sorted.length}
        </span>
      </header>

      <ul className="space-y-1.5">
        {visible.map((exp, idx) => {
          const isCurrent = exp.current || !exp.end;
          const role = exp.role || exp.position;
          const startStr = formatDate(exp.start);
          const endStr = isCurrent ? 'Aujourd\'hui' : formatDate(exp.end);
          const duration = computeDuration(exp.start, exp.end);

          const logoUrl = getCompanyLogo(exp);
          return (
            <li key={idx} className="flex items-start gap-2 text-xs min-w-0">
              {/* Logo ou fallback */}
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={exp.company || ''}
                  className="w-7 h-7 rounded object-contain bg-card border border-border/30 shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-7 h-7 rounded bg-muted border border-border/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground/60" aria-hidden="true" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground/90 text-xs leading-tight truncate">
                  {role || 'Poste'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {exp.company || 'Entreprise'}
                </p>
                {(startStr || duration) && (
                  <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 tabular-nums">
                    {startStr && endStr ? `${startStr} — ${endStr}` : startStr || endStr}
                    {duration && (
                      <>
                        <span className="text-muted-foreground/30 mx-1" aria-hidden="true">·</span>
                        <span className={isCurrent ? 'text-success font-medium' : ''}>{duration}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-1.5 text-[11px] text-info hover:text-info/80 font-medium flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-no-detail
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
              Réduire
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
              Voir {remaining} expérience{remaining > 1 ? 's' : ''} de plus
            </>
          )}
        </button>
      )}
    </section>
  );
};
