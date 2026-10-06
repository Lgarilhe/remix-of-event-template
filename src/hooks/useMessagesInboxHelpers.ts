import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Chat, Message, SequenceEnrollmentInfo } from './useMessagesInbox';
import { timeAgo } from '@/lib/relativeTime';

// Format timestamp for message display
export const formatMessageTime = (timestamp?: string): string => {
  if (!timestamp) return '';
  try {
    const date = parseISO(timestamp);
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return `Hier ${format(date, 'HH:mm')}`;
    }
    return format(date, 'dd/MM HH:mm');
  } catch {
    return '';
  }
};

/**
 * Format compact pour la sidebar inbox : "5min", "2h", "3j", "5sem", "2mois", "1an"
 * Gain d'espace énorme vs "il y a environ 2 heures".
 */
/** Heure d'une conversation dans la liste : « 5 min », « 3 h », « 12 j », puis la date. */
export const formatChatTime = (timestamp?: string): string => timeAgo(timestamp, { compact: true }) ?? '';

// Get display name for chat
export const getChatDisplayName = (chat: Chat): string => {
  const attendee = chat.attendees?.[0];
  
  if (attendee) {
    if (attendee.display_name) return attendee.display_name;
    if (attendee.name) return attendee.name;
    if (attendee.first_name || attendee.last_name) {
      return `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim();
    }
    if (attendee.public_identifier) {
      const cleanId = attendee.public_identifier.replace(/-\d+$/, '').replace(/-/g, ' ');
      if (cleanId.length > 2) {
        return cleanId.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
    if (attendee.profile_url) {
      const match = attendee.profile_url.match(/\/in\/([^\/]+)/);
      if (match && match[1]) {
        const cleanId = match[1].replace(/-\d+$/, '').replace(/-/g, ' ');
        if (cleanId.length > 2 && !/^[A-Z]{20,}$/i.test(cleanId)) {
          return cleanId.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
      }
    }
  }
  if (chat.name) return chat.name;
  if (chat.subject) return chat.subject;
  if (chat.timestamp) {
    const date = new Date(chat.timestamp);
    return `Conversation du ${date.toLocaleDateString('fr-FR')}`;
  }
  return 'Conversation';
};

// Get headline for chat - show subject for InMails
export const getChatSubject = (chat: Chat): string | null => {
  if (chat.content_type === 'inmail' && chat.subject) {
    return chat.subject;
  }
  return null;
};

// Get headline for chat
export const getChatHeadline = (chat: Chat): string | undefined => {
  const attendee = chat.attendees?.[0];
  return attendee?.headline || attendee?.occupation || attendee?.specifics?.occupation;
};

// Get avatar for chat
export const getChatAvatar = (chat: Chat): string | undefined => {
  const attendee = chat.attendees?.find(a => a.picture_url || a.profile_picture_url);
  return attendee?.picture_url || attendee?.profile_picture_url;
};

// Check if chat has unread messages
export const hasUnread = (chat: Chat): boolean => {
  const count = chat.unread_count ?? chat.unread ?? 0;
  return count > 0;
};

export const getUnreadCount = (chat: Chat): number => {
  return chat.unread_count ?? chat.unread ?? 0;
};

// Get initials for fallback avatar
export const getInitials = (name?: string): string => {
  if (!name) return 'U';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

// Get message text
export const getMessageText = (msg: Message): string => {
  return msg.text || msg.text_content || '';
};

/**
 * True si le message a un contenu affichable (texte, pièce jointe, ou
 * subject InMail). Sinon c'est une bulle vide qu'on devrait skip côté
 * rendu (typiquement : message supprimé sans flag, payload Unipile
 * partiel, GIF/sticker non typé).
 */
export const hasDisplayableContent = (msg: Message): boolean => {
  if ((msg.text && msg.text.trim()) || (msg.text_content && msg.text_content.trim())) return true;
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) return true;
  if (msg.subject && msg.subject.trim()) return true;
  if (msg.is_deleted) return true; // on affiche un placeholder "supprimé"
  return false;
};

/**
 * Texte affiché dans la bulle. Si pas de texte mais pièce jointe →
 * placeholder. Si supprimé → placeholder explicite.
 */
export const getMessageDisplayText = (msg: Message): string => {
  const t = getMessageText(msg);
  if (t) return t;
  if (msg.is_deleted) return 'Message supprimé';
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    const count = msg.attachments.length;
    return count > 1 ? `${count} pièces jointes` : 'Pièce jointe';
  }
  if (msg.subject && msg.subject.trim()) return msg.subject;
  return '';
};

// Get profile ID from chat attendee
export const getChatProfileId = (chat: Chat): string | null => {
  const attendee = chat.attendees?.[0];
  return attendee?.provider_id || attendee?.attendee_provider_id || chat.attendee_provider_id || null;
};

// Get attendee profile ID
export const getAttendeeProfileId = (chat: Chat): string | null => {
  const attendee = chat.attendees?.[0];
  return attendee?.attendee_provider_id || attendee?.provider_id || null;
};

// Get job info for a chat
export const getChatJobInfo = (chat: Chat, enrollmentsMap: Map<string, SequenceEnrollmentInfo>): SequenceEnrollmentInfo | null => {
  const profileId = getChatProfileId(chat);
  if (!profileId) return null;
  return enrollmentsMap.get(profileId) || null;
};

/**
 * Repère principal d'une ligne de la liste (revue design D-07), dans un ordre
 * fixe : « À répondre » (message non lu) ou « En attente » (séquence en cours,
 * pas de réponse), puis la mission de l'inscription. Données seules : la
 * ligne choisit icônes et couleurs dans les jetons.
 */
export interface ChatStatusInfo {
  kind: 'reply' | 'waiting' | null;
  /** Poste de l'inscription en séquence, seule source sûre de la mission. */
  mission: string | null;
}

export const getChatStatusInfo = (
  chat: Chat,
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>
): ChatStatusInfo | null => {
  const jobInfo = getChatJobInfo(chat, enrollmentsMap);
  const mission = jobInfo?.job_title || null;

  if (hasUnread(chat)) return { kind: 'reply', mission };

  if (jobInfo && jobInfo.status === 'active' && !jobInfo.replied_at && jobInfo.current_step_order > 0) {
    return { kind: 'waiting', mission };
  }

  return mission ? { kind: null, mission } : null;
};

/**
 * Boîte d'origine d'une conversation, en texte neutre (revue design D-07).
 * La messagerie classique est le cas courant : pas de libellé.
 */
export const getMessageSourceType = (chat: Chat): { label: string } | null => {
  const folders = chat.folder || [];

  const hasRecruiter = folders.some(f =>
    f.toLowerCase().includes('recruiter') ||
    f.toLowerCase().includes('talent')
  );

  if (chat.content_type === 'inmail') {
    return { label: hasRecruiter ? 'InMail Recruiter' : 'InMail' };
  }

  if (hasRecruiter) return { label: 'Recruiter' };

  const hasSalesNav = folders.some(f =>
    f.toLowerCase().includes('sales') ||
    f.toLowerCase().includes('navigator')
  );
  if (hasSalesNav) return { label: 'Sales Navigator' };

  return null;
};

// Check if chat is from Recruiter folder
export const isRecruiterChat = (chat: Chat): boolean => {
  const folders = chat.folder || [];
  return folders.some(f => f.toLowerCase().includes('recruiter'));
};

// Check if chat is from Classic folder only
export const isClassicChat = (chat: Chat): boolean => {
  const folders = chat.folder || [];
  const hasRecruiter = folders.some(f => f.toLowerCase().includes('recruiter'));
  const hasClassic = folders.some(f => f.toLowerCase().includes('classic'));
  return hasClassic && !hasRecruiter;
};

// Build searchable string for chat
export const buildChatSearchText = (chat: Chat): string => {
  const attendeeText = (chat.attendees || [])
    .map(a => {
      const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim();
      return [
        a.display_name,
        a.name,
        fullName,
        a.public_identifier,
        a.profile_url,
        a.headline,
        a.occupation,
        a.specifics?.occupation,
      ]
        .filter(Boolean)
        .join(' ');
    })
    .filter(Boolean)
    .join(' ');

  return [
    chat.name,
    chat.subject,
    chat.last_message?.text,
    chat.last_message?.text_content,
    attendeeText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

// Get current candidate profile for modal
export const getCurrentCandidateProfile = (chat: Chat | null) => {
  if (!chat) return null;
  return {
    name: getChatDisplayName(chat),
    headline: getChatHeadline(chat),
    linkedinUrl: chat.attendees?.[0]?.profile_url,
    linkedinId: getAttendeeProfileId(chat),
  };
};
