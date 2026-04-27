/**
 * ProfileEducationList — affiche les diplômes/écoles d'un profil LinkedIn
 * dans la card de preview, avec logo école + diplôme + dates.
 *
 * Refonte UX 2026-04-27 (pendant de ProfileExperienceList).
 */

import React, { useState, useMemo } from 'react';
import { GraduationCap, ChevronDown, ChevronUp } from 'lucide-react';
import { parseDate, getYear } from '../dateUtils';

interface Education {
  school?: string;
  /** Logo école — Unipile renvoie selon les cas l'un ou l'autre.
      Ordre de priorité observé : logo > school_logo > school_details.logo > school_picture_url. */
  logo?: string;
  school_logo?: string;
  school_picture_url?: string;
  school_details?: { logo?: string | null };
  degree?: string;
  field_of_study?: string;
  start?: any;
  end?: any;
}

interface ProfileEducationListProps {
  education: Education[];
  defaultLimit?: number;
}

/** Extrait un domaine canonique d'une URL (filtre linkedin/social). */
function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (/(?:^|\.)(?:linkedin|facebook|twitter|x|instagram)\.com$/.test(host)) return null;
    if (host.length < 3 || !host.includes('.')) return null;
    return host;
  } catch { return null; }
}

/** Résout l'URL du logo école : direct → Clearbit fallback depuis website. */
function getSchoolLogo(edu: Education): string | null {
  const direct = edu.logo || edu.school_logo || edu.school_details?.logo || edu.school_picture_url;
  if (direct) return direct;
  const websiteDomain = extractDomain(edu.school_details?.url || (edu as any).school_website);
  if (websiteDomain) return `https://logo.clearbit.com/${websiteDomain}`;
  const urlDomain = extractDomain((edu as any).school_url);
  return urlDomain ? `https://logo.clearbit.com/${urlDomain}` : null;
}

export const ProfileEducationList: React.FC<ProfileEducationListProps> = ({
  education,
  defaultLimit = 1,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Trie : end date desc (plus récent en premier)
  const sorted = useMemo(() => {
    return [...education].sort((a, b) => {
      const aEnd = getYear(a.end) || getYear(a.start) || 0;
      const bEnd = getYear(b.end) || getYear(b.start) || 0;
      return bEnd - aEnd;
    });
  }, [education]);

  if (sorted.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, defaultLimit);
  const remaining = sorted.length - defaultLimit;

  return (
    <section className="mt-1.5 pt-1.5 border-t border-border/40">
      <header className="flex items-center gap-1 mb-0.5">
        <GraduationCap className="w-2.5 h-2.5 text-muted-foreground/70" aria-hidden="true" />
        <h4 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
          Formation
        </h4>
        <span className="text-[9px] text-muted-foreground/50 font-mono tabular-nums">
          {sorted.length}
        </span>
      </header>

      <ul className="space-y-0.5">
        {visible.map((edu, idx) => {
          const startYear = getYear(edu.start);
          const endYear = getYear(edu.end);
          const dateRange = startYear && endYear
            ? `${startYear}-${endYear}`
            : endYear
              ? String(endYear)
              : startYear
                ? `${startYear}-…`
                : null;
          const degreeOrField = [edu.degree, edu.field_of_study].filter(Boolean).join(' · ');
          const logoUrl = getSchoolLogo(edu);

          return (
            <li key={idx} className="flex items-center gap-1.5 text-xs min-w-0 leading-tight">
              {/* Logo école compact 18×18 */}
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={edu.school || ''}
                  className="w-[18px] h-[18px] rounded-sm object-contain bg-card border border-border/30 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-[18px] h-[18px] rounded-sm bg-muted border border-border/30 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-2.5 h-2.5 text-muted-foreground/60" aria-hidden="true" />
                </div>
              )}

              {/* Tout sur 1 ligne : École · Diplôme · Dates */}
              <div className="flex-1 min-w-0 truncate text-[11px]">
                <span className="font-medium text-foreground/90">{edu.school || 'École'}</span>
                {degreeOrField && (
                  <>
                    <span className="text-muted-foreground/40"> · </span>
                    <span className="text-muted-foreground">{degreeOrField}</span>
                  </>
                )}
                {dateRange && (
                  <>
                    <span className="text-muted-foreground/30 mx-1" aria-hidden="true">·</span>
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums">{dateRange}</span>
                  </>
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
          className="mt-0.5 text-[10px] text-info hover:text-info/80 font-medium flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-no-detail
        >
          {expanded ? (
            <>
              <ChevronUp className="w-2.5 h-2.5" aria-hidden="true" />
              Réduire
            </>
          ) : (
            <>
              <ChevronDown className="w-2.5 h-2.5" aria-hidden="true" />
              {remaining} de plus
            </>
          )}
        </button>
      )}
    </section>
  );
};
