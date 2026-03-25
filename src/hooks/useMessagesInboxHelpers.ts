import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Chat, Message, SequenceEnrollmentInfo } from './useMessagesInbox';
import React from 'react';
import { Reply, Hourglass, Briefcase } from 'lucide-react';

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

export const formatChatTime = (timestamp?: string): string => {
  if (!timestamp) return '';
  try {
    const date = parseISO(timestamp);
    return formatDistanceToNow(date, { addSuffix: true, locale: fr });
  } catch {
    return '';
  }
};

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

// Get conversation status text and icon
export const getChatStatusInfo = (
  chat: Chat, 
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>
): { text: string; icon: React.ReactNode; color: string } | null => {
  const jobInfo = getChatJobInfo(chat, enrollmentsMap);
  
  if (hasUnread(chat)) {
    const suffix = jobInfo?.job_title ? ` · ${jobInfo.job_title}` : '';
    return {
      text: `À répondre${suffix}`,
      icon: React.createElement(Reply, { className: "w-3 h-3" }),
      color: 'text-amber-600'
    };
  }
  
  if (jobInfo && jobInfo.status === 'active' && !jobInfo.replied_at && jobInfo.current_step_order > 0) {
    return {
      text: `En attente · ${jobInfo.job_title || 'Séquence'}`,
      icon: React.createElement(Hourglass, { className: "w-3 h-3" }),
      color: 'text-blue-600'
    };
  }
  
  if (jobInfo?.job_title) {
    return {
      text: jobInfo.job_title,
      icon: React.createElement(Briefcase, { className: "w-3 h-3" }),
      color: 'text-violet-600'
    };
  }
  
  return null;
};

// Get message source type
export const getMessageSourceType = (chat: Chat): { label: string; color: string } | null => {
  const folders = chat.folder || [];

  const hasRecruiter = folders.some(f =>
    f.toLowerCase().includes('recruiter') ||
    f.toLowerCase().includes('talent')
  );
  
  if (chat.content_type === 'inmail') {
    return hasRecruiter
      ? { label: 'InMail Recruiter', color: 'bg-purple-100 text-purple-700 border-purple-200' }
      : { label: 'InMail', color: 'bg-purple-100 text-purple-700 border-purple-200' };
  }
  
  if (hasRecruiter) {
    return { label: 'Recruiter', color: 'bg-amber-100 text-amber-700 border-amber-200' };
  }
  
  const hasSalesNav = folders.some(f => 
    f.toLowerCase().includes('sales') || 
    f.toLowerCase().includes('navigator')
  );
  if (hasSalesNav) {
    return { label: 'Sales Nav', color: 'bg-blue-100 text-blue-700 border-blue-200' };
  }
  
  const hasClassic = folders.some(f => 
    f.toLowerCase().includes('classic') || 
    f.toLowerCase().includes('inbox')
  );
  if (hasClassic || folders.length > 0) {
    return { label: 'Classic', color: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  
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
