import type { LinkedInProfile } from '@/components/outreach/types';

// Profil enregistré dans linkedin_profile_data (garde l'essentiel, laisse les champs volumineux).
// Module à part : la notation (useLinkedInScoring), « Retenir » (AddToProjectButton) et
// l'inscription en séquence (EnrollmentPreviewModal) écrivent le même profil, photo
// comprise, jamais une photo seule (lot P, P-0b). Un import depuis le hook de notation
// ferait passer tout son arbre de dépendances dans les chunks de la messagerie et du Pipeline.
export function serializeProfileForStorage(profile: LinkedInProfile): any {
  return {
    name: profile.name,
    first_name: profile.first_name,
    last_name: profile.last_name,
    headline: profile.headline,
    summary: profile.summary,
    location: profile.location,
    skills: profile.skills,
    work_experience: (profile.work_experience || []).slice(0, 8),
    education: profile.education,
    languages: (profile as any).languages,
    open_to_work: profile.open_to_work,
    open_profile: profile.open_profile,
    network_distance: profile.network_distance,
    public_profile_url: profile.public_profile_url,
    profile_url: profile.profile_url,
    connections_count: profile.connections_count,
    // Photo du candidat : sans elle, la note effaçait celle enregistrée à la découverte.
    profile_picture_url: profile.profile_picture_url,
    profile_picture_url_large: profile.profile_picture_url_large,
  };
}
