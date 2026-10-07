import type { ActivityEvent } from '@/hooks/useProfileActivity';
import { activityChannel } from '@/lib/inboxTimeline';

export type MessagingService = 'linkedin' | 'whatsapp' | 'email' | 'gmail' | 'outlook' | 'call' | 'calendar' | 'calendly' | 'aircall' | 'google_meet';

export const SERVICE_LABELS: Record<MessagingService, string> = {
  linkedin: 'LinkedIn', whatsapp: 'WhatsApp', email: 'E-mail', gmail: 'Gmail', outlook: 'Outlook',
  call: 'Appel', calendar: 'Calendrier', calendly: 'Calendly', aircall: 'Aircall', google_meet: 'Google Meet',
};

/** Un logo de fournisseur nécessite une origine connue, jamais l'adresse du destinataire. */
export function activityService(event: ActivityEvent): MessagingService {
  if (event.service) return event.service;
  return event.type === 'booking' ? 'calendar' : activityChannel(event);
}

export function meetingService(location?: string | null): 'google_meet' | null {
  return /google meet|https:\/\/meet\.google\.com\//i.test(location ?? '') ? 'google_meet' : null;
}
