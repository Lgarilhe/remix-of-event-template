import { ProfileDetailedTab } from '@/components/ats/candidate-detail/ProfileDetailedTab';
import type { LinkedInProfile } from '@/components/outreach/types';
import { parseDate } from '@/components/outreach/dateUtils';
import { hasCandidateProfileDetails, normalizeCandidateProfile } from '@/lib/candidateProfile';

/** Reprend la fiche Profil existante, avec ses logos et ses listes dépliables. */
export function CandidateProfileContent({ profile }: { profile: LinkedInProfile }) {
  const data = normalizeCandidateProfile(profile, profile.id, profile.name);
  const hasDetails = hasCandidateProfileDetails(data);
  const limited = !!data.throttled_sections?.length;
  const detailedProfile = {
    ...data,
    work_experience: data.work_experience?.map(job => ({ ...job, start: parseDate(job.start), end: parseDate(job.end) })),
    education: data.education?.map(school => ({ ...school, school_logo: school.school_picture_url, start: parseDate(school.start), end: parseDate(school.end) })),
  };
  return <div className="min-w-0 [overflow-wrap:anywhere]" data-component="candidate-profile">
    {!hasDetails && <div className="space-y-3 text-sm text-foreground-secondary">
      {data.headline && <p>{data.headline}</p>}
      {data.location && <p className="text-muted-foreground">{data.location}</p>}
      <p role="status" className="text-muted-foreground">{limited ? 'LinkedIn limite temporairement l’accès au détail de ce profil. Réessayez plus tard.' : 'Le parcours détaillé n’est pas disponible pour le moment.'}</p>
    </div>}
    {hasDetails && limited && <p role="status" className="mb-5 text-sm text-muted-foreground">Certaines rubriques LinkedIn sont temporairement limitées. Les informations disponibles restent affichées.</p>}
    {hasDetails && <ProfileDetailedTab
      linkedinProfileData={detailedProfile}
      enrichedProfile={{
        name: data.name || '',
        summary: data.summary,
        skills: data.skills?.map(skill => skill.name),
        languages: data.languages?.map(language => [language.name, language.proficiency].filter(Boolean).join(' · ')),
      }}
    />}
  </div>;
}
