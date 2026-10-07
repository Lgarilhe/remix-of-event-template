/**
 * ProfileDetailedTab : vue détaillée du profil candidat (à propos,
 * expérience, formation, compétences, langues). Design simplifié
 * (docs/design/06-simplicite.md) : des sections séparées par un filet, sans
 * cadre ni pastille de couleur ; logos de 40 px, titres de 15 px, la
 * description du poste quand elle existe.
 */

import React, { useState } from 'react';
import {
  Briefcase, GraduationCap, Building2,
  MapPin, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';

interface Props {
  /** Le linkedin_profile_data raw (JSONB) du candidat. */
  linkedinProfileData: any | null;
  /** Profile dérivé déjà parsé (skills, languages, experiences/education
   *  pré-formattés). Peut être null si pas de data. */
  enrichedProfile: EnrichedProfile | null;
}

export const ProfileDetailedTab: React.FC<Props> = ({ linkedinProfileData, enrichedProfile }) => {
  const summary = enrichedProfile?.summary || linkedinProfileData?.summary;
  const workExperience = (linkedinProfileData?.work_experience || []) as any[];
  const education = (linkedinProfileData?.education || []) as any[];
  const skills = enrichedProfile?.skills || [];
  const languages = enrichedProfile?.languages || [];

  if (!summary && workExperience.length === 0 && education.length === 0 && skills.length === 0) {
    return (
      <EmptyState
        className="border-0 py-8"
        icon={Briefcase}
        title="Profil LinkedIn non disponible"
        description="Ce candidat n'a pas encore de données LinkedIn enrichies."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* ═══ À PROPOS ═══ */}
      {summary && (
        <Section title="À propos" first>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {summary}
          </p>
        </Section>
      )}

      {/* ═══ EXPÉRIENCE PRO ═══ */}
      {workExperience.length > 0 && (
        <Section
          title="Expérience"
          subtitle={`${workExperience.length} poste${workExperience.length > 1 ? 's' : ''}`}
          first={!summary}
        >
          <ExperienceList experiences={workExperience} />
        </Section>
      )}

      {/* ═══ FORMATION ═══ */}
      {education.length > 0 && (
        <Section
          title="Formation"
          subtitle={`${education.length} école${education.length > 1 ? 's' : ''}`}
        >
          <EducationList education={education} />
        </Section>
      )}

      {/* ═══ COMPÉTENCES ═══ */}
      {skills.length > 0 && (
        <Section title="Compétences" subtitle={`${skills.length} compétence${skills.length > 1 ? 's' : ''}`}>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill, i) => (
              <Badge key={i} variant="muted">{skill}</Badge>
            ))}
          </div>
        </Section>
      )}

      {/* ═══ LANGUES ═══ */}
      {languages.length > 0 && (
        <Section title="Langues">
          <div className="flex flex-wrap gap-1.5">
            {languages.map((lang, i) => (
              <Badge key={i} variant="muted">{lang}</Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components — version "rich" avec logos plus gros + plus d'air
// ═══════════════════════════════════════════════════════════════════

/** Une section : un filet au-dessus (sauf la première), un titre, une ligne d'aide au besoin. */
function Section({
  title, subtitle, first = false, children,
}: {
  title: string;
  subtitle?: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={first ? undefined : 'border-t border-border pt-6'}>
      <h3 className="text-md font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ─── Experience list (rich) ────────────────────────────────────────

interface RawExperience {
  company?: string;
  company_logo?: string;
  logo_url?: string;
  logo?: string;
  company_picture_url?: string;
  role?: string;
  position?: string;
  title?: string;
  description?: string;
  location?: string;
  start?: { year?: number; month?: number };
  end?: { year?: number; month?: number };
  current?: boolean;
}

function ExperienceList({ experiences }: { experiences: RawExperience[] }) {
  // Tri par date de début descendante (plus récent en premier)
  const sorted = [...experiences].sort((a, b) => {
    const aYear = a.start?.year ?? 0;
    const bYear = b.start?.year ?? 0;
    if (aYear !== bYear) return bYear - aYear;
    return (b.start?.month ?? 0) - (a.start?.month ?? 0);
  });

  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sorted : sorted.slice(0, 3);
  const hidden = sorted.length - visible.length;

  return (
    <div className="space-y-4">
      {visible.map((exp, i) => (
        <ExperienceItem key={i} exp={exp} />
      ))}
      {hidden > 0 && !showAll && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)} className="-ml-2.5">
          <ChevronDown aria-hidden="true" />
          Voir {hidden} poste{hidden > 1 ? 's' : ''} de plus
        </Button>
      )}
      {showAll && sorted.length > 3 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(false)} className="-ml-2.5">
          <ChevronUp aria-hidden="true" />
          Réduire
        </Button>
      )}
    </div>
  );
}

function ExperienceItem({ exp }: { exp: RawExperience }) {
  const role = exp.role || exp.position || exp.title || 'Poste';
  const company = exp.company;
  const logo = exp.company_logo || exp.logo_url || exp.logo || exp.company_picture_url;
  const isCurrent = exp.current || !exp.end;
  const period = formatPeriod(exp.start, exp.end, isCurrent);
  const tenure = computeTenure(exp.start, exp.end);

  return (
    <div className="flex items-start gap-3.5">
      {/* Logo entreprise — 40px (vs 24px avant) */}
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5"
        />
      ) : (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <Building2 className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Titre du poste */}
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-md font-semibold leading-tight text-foreground">
            {role}
          </h4>
          {isCurrent && <Badge variant="muted">En poste</Badge>}
        </div>

        {/* Entreprise + lieu + période */}
        {company && (
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {company}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {period && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Calendar className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
              {period}
              {tenure && <span>· {tenure}</span>}
            </span>
          )}
          {exp.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
              {exp.location}
            </span>
          )}
        </div>

        {/* Description du poste — affichée si présente, line-clamp 4 */}
        {exp.description && (
          <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {exp.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Education list (rich) ─────────────────────────────────────────

interface RawEducation {
  school?: string | { name?: string; logo?: string };
  school_name?: string;
  school_logo?: string;
  school_details?: { name?: string; logo?: string; logo_url?: string; image?: string };
  logo_url?: string;
  logo?: string;
  degree?: string;
  degree_name?: string;
  field_of_study?: string;
  field?: string;
  description?: string;
  start?: { year?: number };
  end?: { year?: number };
}

function EducationList({ education }: { education: RawEducation[] }) {
  // Tri par année de début descendante
  const sorted = [...education].sort((a, b) => (b.start?.year ?? 0) - (a.start?.year ?? 0));
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sorted : sorted.slice(0, 2);
  const hidden = sorted.length - visible.length;

  return (
    <div className="space-y-4">
      {visible.map((edu, i) => (
        <EducationItem key={i} edu={edu} />
      ))}
      {hidden > 0 && !showAll && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)} className="-ml-2.5">
          <ChevronDown aria-hidden="true" />
          Voir {hidden} formation{hidden > 1 ? 's' : ''} de plus
        </Button>
      )}
      {showAll && sorted.length > 2 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(false)} className="-ml-2.5">
          <ChevronUp aria-hidden="true" />
          Réduire
        </Button>
      )}
    </div>
  );
}

function EducationItem({ edu }: { edu: RawEducation }) {
  const schoolName =
    typeof edu.school === 'string'
      ? edu.school
      : edu.school?.name || edu.school_name || edu.school_details?.name || 'École';
  const logo =
    edu.school_logo || edu.logo_url || edu.logo ||
    edu.school_details?.logo || edu.school_details?.logo_url || edu.school_details?.image ||
    (typeof edu.school === 'object' ? edu.school?.logo : undefined);

  const degree = edu.degree || edu.degree_name;
  const field = edu.field_of_study || edu.field;
  const startYear = edu.start?.year;
  const endYear = edu.end?.year;

  return (
    <div className="flex items-start gap-3.5">
      {/* Logo école — 40px */}
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5"
        />
      ) : (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <GraduationCap className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h4 className="text-md font-semibold leading-tight text-foreground">
          {schoolName}
        </h4>
        {(degree || field) && (
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {[degree, field].filter(Boolean).join(' · ')}
          </p>
        )}
        {(startYear || endYear) && (
          <p className="mt-1 inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
            {startYear || '?'} à {endYear || 'en cours'}
          </p>
        )}
        {edu.description && (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {edu.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatPeriod(
  start?: { year?: number; month?: number },
  end?: { year?: number; month?: number },
  isCurrent?: boolean,
): string | null {
  if (!start?.year) return null;
  const monthNames = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  const startStr = `${start.month ? monthNames[start.month - 1] : ''} ${start.year}`.trim();
  if (isCurrent) {
    return `${startStr} à aujourd'hui`;
  }
  if (end?.year) {
    const endStr = `${end.month ? monthNames[end.month - 1] : ''} ${end.year}`.trim();
    return `${startStr} à ${endStr}`;
  }
  return startStr;
}

function computeTenure(
  start?: { year?: number; month?: number },
  end?: { year?: number; month?: number },
): string | null {
  if (!start?.year) return null;
  const s = new Date(start.year, (start.month || 1) - 1);
  const e = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (diff < 1) return null;
  const y = Math.floor(diff / 12);
  const m = diff % 12;
  if (y > 0 && m > 0) return `${y} an${y > 1 ? 's' : ''} ${m} mois`;
  if (y > 0) return `${y} an${y > 1 ? 's' : ''}`;
  if (m > 0) return `${m} mois`;
  return null;
}
