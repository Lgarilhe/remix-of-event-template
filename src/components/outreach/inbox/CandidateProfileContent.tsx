import type { ReactNode } from 'react';
import type { LinkedInProfile } from '@/components/outreach/types';
import { normalizeCandidateProfile, profilePeriod } from '@/lib/candidateProfile';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3"><h4 className="text-sm font-semibold text-foreground">{title}</h4>{children}</section>;
}

function Description({ children }: { children?: string }) {
  return children ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{children}</p> : null;
}

/** Même lecture complète dans le contexte de la messagerie et dans la fiche du pipeline. */
export function CandidateProfileContent({ profile }: { profile: LinkedInProfile }) {
  const data = normalizeCandidateProfile(profile, profile.id, profile.name);
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]" data-component="candidate-profile">
    {(data.headline || data.location || data.industry) && <div className="space-y-1"><Description>{data.headline}</Description><p className="text-xs text-muted-foreground">{[data.location, data.industry].filter(Boolean).join(' · ')}</p></div>}
    {data.summary && <Section title="À propos"><Description>{data.summary}</Description></Section>}
    <Section title="Expériences">{data.work_experience?.length ? data.work_experience.map((job, index) => <article key={index} className="space-y-1 border-l-2 border-border pl-3"><p className="text-sm font-medium text-foreground">{job.role || 'Poste non renseigné'}</p><Description>{job.company}</Description><p className="text-xs text-muted-foreground">{[profilePeriod(job.start, job.end, job.current), job.location].filter(Boolean).join(' · ')}</p><Description>{job.description}</Description></article>) : <p className="text-xs text-muted-foreground">Aucune expérience renseignée.</p>}</Section>
    <Section title="Formations">{data.education?.length ? data.education.map((school, index) => <article key={index} className="space-y-1 border-l-2 border-border pl-3"><p className="text-sm font-medium text-foreground">{school.school || 'Établissement non renseigné'}</p><Description>{[school.degree, school.field_of_study].filter(Boolean).join(' · ')}</Description><p className="text-xs text-muted-foreground">{profilePeriod(school.start, school.end)}</p><Description>{school.description}</Description><Description>{school.activities}</Description></article>) : <p className="text-xs text-muted-foreground">Aucune formation renseignée.</p>}</Section>
    {!!data.skills?.length && <Section title="Compétences"><div className="flex flex-wrap gap-1.5">{data.skills.map((skill, index) => <span key={index} className="rounded-md border border-border px-2 py-1 text-xs text-foreground-secondary">{skill.name}</span>)}</div></Section>}
    {!!data.languages?.length && <Section title="Langues">{data.languages.map((language, index) => <p key={index} className="text-sm text-foreground-secondary">{[language.name, language.proficiency].filter(Boolean).join(' · ')}</p>)}</Section>}
    {!!data.certifications?.length && <Section title="Certifications">{data.certifications.map((item, index) => <div key={index}><p className="text-sm font-medium text-foreground">{item.name}</p><Description>{item.organization}</Description></div>)}</Section>}
    {!!data.projects?.length && <Section title="Projets">{data.projects.map((item, index) => <div key={index}><p className="text-sm font-medium text-foreground">{item.name}</p><Description>{item.description}</Description></div>)}</Section>}
    {!!data.volunteering_experience?.length && <Section title="Bénévolat">{data.volunteering_experience.map((item, index) => <div key={index}><p className="text-sm font-medium text-foreground">{[item.role, item.company].filter(Boolean).join(' · ')}</p><Description>{item.cause}</Description><Description>{item.description}</Description></div>)}</Section>}
    {!!data.recommendations?.received?.length && <Section title="Recommandations">{data.recommendations.received.map((item, index) => <blockquote key={index} className="space-y-1 border-l-2 border-border pl-3"><Description>{item.text}</Description><p className="text-xs text-muted-foreground">{item.caption}</p></blockquote>)}</Section>}
    {!!data.interests?.length && <Section title="Centres d’intérêt"><Description>{data.interests.join(' · ')}</Description></Section>}
    {!![...data.contact_info?.emails ?? [], ...data.contact_info?.phones ?? []].length && <Section title="Coordonnées du profil">{[...data.contact_info?.emails ?? [], ...data.contact_info?.phones ?? []].map((contact, index) => <p key={index} className="break-all text-sm text-foreground-secondary">{contact}</p>)}</Section>}
  </div>;
}
