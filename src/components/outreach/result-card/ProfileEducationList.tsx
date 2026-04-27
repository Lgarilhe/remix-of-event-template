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
  school_picture_url?: string;
  degree?: string;
  field_of_study?: string;
  start?: any;
  end?: any;
}

interface ProfileEducationListProps {
  education: Education[];
  defaultLimit?: number;
}

export const ProfileEducationList: React.FC<ProfileEducationListProps> = ({
  education,
  defaultLimit = 2,
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
    <section className="mt-2 pt-2 border-t border-border/40">
      <header className="flex items-center gap-1.5 mb-1.5">
        <GraduationCap className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Formation
        </h4>
        <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
          {sorted.length}
        </span>
      </header>

      <ul className="space-y-1.5">
        {visible.map((edu, idx) => {
          const startYear = getYear(edu.start);
          const endYear = getYear(edu.end);
          const dateRange = startYear && endYear
            ? `${startYear} — ${endYear}`
            : endYear
              ? String(endYear)
              : startYear
                ? `${startYear} — …`
                : null;

          const degreeOrField = [edu.degree, edu.field_of_study].filter(Boolean).join(' · ');

          return (
            <li key={idx} className="flex items-start gap-2 text-xs min-w-0">
              {/* Logo école */}
              {edu.school_picture_url ? (
                <img
                  src={edu.school_picture_url}
                  alt={edu.school || ''}
                  className="w-7 h-7 rounded object-contain bg-card border border-border/30 shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-7 h-7 rounded bg-muted border border-border/30 flex items-center justify-center shrink-0 mt-0.5">
                  <GraduationCap className="w-3.5 h-3.5 text-muted-foreground/60" aria-hidden="true" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground/90 text-xs leading-tight truncate">
                  {edu.school || 'École'}
                </p>
                {degreeOrField && (
                  <p className="text-xs text-muted-foreground truncate">
                    {degreeOrField}
                  </p>
                )}
                {dateRange && (
                  <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 tabular-nums">
                    {dateRange}
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
              Voir {remaining} de plus
            </>
          )}
        </button>
      )}
    </section>
  );
};
