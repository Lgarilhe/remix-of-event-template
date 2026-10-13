import type { CaptureMode } from './liveAudioCapture';

export type InterviewAudioService = 'teams' | 'google_meet' | 'zoom' | 'video' | 'phone' | 'in_person';

export interface InterviewAudioRecommendation {
  service: InterviewAudioService;
  label: string;
  mode: CaptureMode;
  description: string;
  applicationHint?: string;
}

/** Lieu du rendez-vous validé : ne déduit jamais une marque d'un simple nom dans une URL. */
export function interviewAudioService(location?: string | null): InterviewAudioService | null {
  const value = location?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'tel:') return 'phone';
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft') return 'teams';
    if (host === 'meet.google.com') return 'google_meet';
    if (host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoom.com' || host.endsWith('.zoom.com')) return 'zoom';
    return 'video';
  } catch {
    const label = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/\b(telephone|telephonique|phone|appel telephonique)\b/.test(label) || /^\+?[\d\s().-]{6,}$/.test(label)) return 'phone';
    if (/\b(presentiel|sur place|bureau|dans nos locaux|en personne)\b/.test(label)) return 'in_person';
    if (/^(microsoft )?teams$/.test(label)) return 'teams';
    if (/^(google )?meet$/.test(label)) return 'google_meet';
    if (/^zoom$/.test(label)) return 'zoom';
    if (/\b(visio|visioconference|video)\b/.test(label)) return 'video';
    return null;
  }
}

/** Conseil sans permission, détection de périphérique ni ouverture de la réunion. */
export function interviewAudioRecommendation(
  location: string | null | undefined,
  displaySupported: boolean,
  userAgent = '',
): InterviewAudioRecommendation | null {
  const service = interviewAudioService(location);
  if (!service) return null;
  if (service === 'phone') return {
    service, label: 'Téléphone', mode: 'mic',
    description: 'Sur téléphone, activez le haut-parleur près du micro de l’ordinateur. Avec un casque téléphonique, la voix du candidat ne sera pas captée.',
    applicationHint: 'Appel dans un onglet ? Choisissez « Visio ou appel » et partagez son audio au démarrage.',
  };
  if (service === 'in_person') return {
    service, label: 'Sur place', mode: 'mic',
    description: 'Le micro seul convient : placez-le entre vous et le candidat, dans un endroit calme.',
  };
  const label = service === 'teams' ? 'Microsoft Teams' : service === 'google_meet' ? 'Google Meet' : service === 'zoom' ? 'Zoom' : 'Visioconférence';
  if (!displaySupported) return {
    service, label, mode: 'mic',
    description: 'Pour transcrire les deux voix avec un casque, ouvrez Konekt et la visio dans Chrome ou Edge sur ordinateur. Ici, seul le micro est disponible : il n’entend le candidat que sur haut-parleur.',
  };
  return {
    service, label, mode: 'meeting',
    description: `Ouvrez ${service === 'video' ? 'la visio' : label} dans Chrome ou Edge. Au démarrage, partagez son onglet en cochant « Partager aussi l’audio » : votre micro et le candidat seront transcrits séparément.`,
    ...(service === 'teams' || service === 'zoom' ? {
      applicationHint: /Windows/i.test(userAgent)
        ? 'Application installée ? Choisissez l’écran entier uniquement si le navigateur propose le partage de l’audio système. Sinon, utilisez la version web.'
        : 'Application installée ? Utilisez sa version web : le partage du son de l’application n’est pas garanti par ce navigateur.',
    } : {}),
  };
}
