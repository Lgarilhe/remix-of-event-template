/** Structured job brief stored in sourcing_projects.job_details (JSONB) */
export interface JobDetails {
  // ── Identité du poste ──
  title?: string;
  reference?: string;
  contract_type?: 'cdi' | 'cdd' | 'freelance' | 'alternance' | 'stage' | 'interim';
  start_date?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';

  // ── Client ──
  client?: {
    name?: string;
    sector?: string;
    size?: 'startup' | 'scale-up' | 'mid-market' | 'enterprise';
    culture_notes?: string;
    website?: string;
    logo_url?: string;
    hiring_manager?: {
      name?: string;
      title?: string;
      email?: string;
      phone?: string;
      linkedin?: string;
    };
  };

  // ── Le poste ──
  location?: string;
  remote_policy?: 'onsite' | 'hybrid' | 'full_remote';
  remote_days?: number;
  team_size?: number;
  reports_to?: string;
  manages?: number;
  context?: string;
  mission_description?: string;

  // ── Profil recherché ──
  seniority?: string;
  experience_min?: number;
  experience_max?: number;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  salary_type?: 'annual' | 'daily' | 'hourly';
  equity?: string;
  benefits?: string;

  // ── Compétences structurées ──
  skills_must_have?: string[];
  skills_should_have?: string[];
  skills_nice_to_have?: string[];
  skills_to_avoid?: string[];
  languages?: Array<{ language: string; level: string }>;
  certifications?: string[];

  // ── Ideal companies ──
  target_companies?: Array<{
    category: string;
    companies: Array<{ name: string; logo_url?: string }>;
  }>;

  // ── Calibration candidates ──
  calibration_profiles?: Array<{
    name: string;
    headline: string;
    linkedin_url: string;
    why_good_fit: string[];
    areas_of_improvement?: string;
  }>;

  // ── Manager evaluation criteria ──
  evaluation_criteria?: Array<{
    id: string;
    label: string;
    description: string;
    category: 'technical' | 'soft_skill' | 'culture_fit' | 'motivation' | 'experience';
    weight: 1 | 2 | 3; // 1=bonus, 2=important, 3=critique
    deal_breaker?: boolean;
    level_10?: string; // "Mon 10/10 c'est..."
    level_1?: string;  // "Mon rédhibitoire c'est..."
    interview_stage?: string; // À quelle étape évaluer ce critère
  }>;
  evaluation_weights?: {
    technical: number;   // % du total
    soft_skill: number;
    culture_fit: number;
    motivation: number;
    experience: number;
  };

  // ── Brief brut ──
  raw_brief?: string;
  brief_source?: 'typed' | 'voice' | 'imported' | 'ai_structured';
  voice_transcript?: string;
  voice_audio_url?: string;
  brief_video_url?: string;
}

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  freelance: 'Freelance',
  alternance: 'Alternance',
  stage: 'Stage',
  interim: 'Intérim',
};

export const URGENCY_LABELS: Record<string, string> = {
  low: '🟢 Basse',
  medium: '🟡 Moyenne',
  high: '🟠 Haute',
  critical: '🔴 Critique',
};

export const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Sur site',
  hybrid: 'Hybride',
  full_remote: 'Full remote',
};

export const SIZE_LABELS: Record<string, string> = {
  startup: 'Startup',
  'scale-up': 'Scale-up',
  'mid-market': 'Mid-market',
  enterprise: 'Enterprise',
};

export const SALARY_TYPE_LABELS: Record<string, string> = {
  annual: '€/an',
  daily: '€/jour',
  hourly: '€/heure',
};
