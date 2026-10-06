// Types d'une séquence telle que l'éditeur la manipule (étapes, conditions
// d'arrêt, expéditeurs). Sortis de SequenceBuilder.tsx au lot 5c-1, qui les
// réexporte jusqu'au lot 5j pour les fichiers voués au retrait.

export interface SequenceStep {
  id: string;
  order: number;
  actionType: 'inmail' | 'email' | 'connection_request' | 'profile_visit' | 'message' | 'smart_message' | 'whatsapp_message' | 'wait_connection' | 'wait_reply' | 'wait_profile_visit' | 'condition_branch' | 'check_connection';
  conditionType: 'always' | 'if_connected' | 'if_not_connected' | 'if_no_response' | 'if_email_opened' | 'if_email_not_opened' | 'if_link_clicked' | 'if_link_not_clicked' | 'if_has_email' | 'if_no_email' | 'if_has_phone' | 'if_no_phone' | 'if_bounced' | 'if_unsubscribed' | 'if_score_above';
  conditionValue?: string;
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  preferredHourStart: number;
  preferredHourEnd: number;
  subjectTemplate?: string;
  messageTemplate?: string;
  useAiPersonalization: boolean;
  aiTone?: 'professional' | 'casual' | 'enthusiastic';
  timeoutDays?: number;
  waitForEvent?: 'connection_accepted' | 'reply_received' | 'profile_visited';
  // « Terminer » au délai dépassé n'est pas proposé : rien ne l'enregistre et le
  // moteur passait à l'étape suivante. Seule l'étape de repli est persistée.
  timeoutAction?: 'skip' | 'alternative_step';
  alternativeStepIndex?: number;
  ifTrueGotoStep?: string;
  ifFalseGotoStep?: string;
  nextStepId?: string;
  timeoutBranchStepId?: string;
  variantGroup?: string | null;
  variantWeight?: number;
  ccEmails?: string[];
  bccEmails?: string[];
  includeUnsubscribe?: boolean;
  signatureId?: string;
}

export interface StopConditions {
  on_reply: boolean;
  on_click: boolean;
  on_unsubscribe: boolean;
  on_meeting_booked: boolean;
}

export interface SenderAccountConfig {
  account_id: string;
  /** Ancien champ, plus écrit : la rotation n'envoie que depuis des comptes LinkedIn. */
  email?: string;
  daily_limit: number;
  /** Nom affiché dans « Plusieurs expéditeurs », ignoré par le moteur. */
  label?: string;
  /** Canal du compte : la rotation ne sert qu'aux étapes LinkedIn. */
  channel?: 'linkedin';
}

export interface Sequence {
  id?: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  isActive: boolean;
  stopConditions?: StopConditions;
  senderAccounts?: SenderAccountConfig[];
  rotationMode?: string;
  multiSenderEnabled?: boolean;
}
