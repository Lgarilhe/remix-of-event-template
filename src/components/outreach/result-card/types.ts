import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { ProjectEnrollmentInfo } from '@/hooks/useProjectEnrollments';

export interface LinkedInResultCardProps {
  isBatchScoring?: boolean;
  profile: LinkedInProfile;
  selectedJob?: Job | null;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  jobScore?: JobMatchResult;
  onScoreProfile?: () => void;
  accountId?: string;
  onMessageSent?: () => void;
  onSequenceEnroll?: () => void;
  activeProject?: SourcingProject | null;
  onProfileTreated?: () => void;
  onArchive?: () => void;
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null; updated_at?: string } | null;
  airtableMatch?: { airtable_id: string; source_base: string; full_name: string | null; status: string | null; match_type?: 'url' | 'fuzzy' } | null;
  notionMatch?: { id: string; name: string } | null;
  /** Info enrollment séquence pour ce profil sur la mission courante.
   *  Si présent, on affiche un badge "En séquence X · Étape N" et on
   *  prévient le user avant un re-enrôlement. */
  enrollmentInfo?: ProjectEnrollmentInfo | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender_id?: string;
  timestamp?: string;
  is_sender?: boolean;
  attachments?: Array<{ type: string; url?: string; name?: string }>;
}

export interface ProfileData {
  firstName: string;
  lastName: string;
  initials: string;
  fullName: string;
  currentJob: any;
  otherCurrentJobs: any[];
  pastJobs: any[];
  currentCompany: string | undefined;
  currentRole: string | undefined;
  currentJobTenure: string | null;
  networkDistance: number | undefined;
  profileUrl: string | undefined;
  skills: any[];
  education: any[];
  educationPreview: any[];
  connectionsCount: number | undefined;
  isLikelyToRespond: boolean;
  isActiveTalent: boolean;
  totalExperience: string | null;
  experienceFromDiploma: { years: number; diplomaYear: number; diplomaName: string } | null;
}
