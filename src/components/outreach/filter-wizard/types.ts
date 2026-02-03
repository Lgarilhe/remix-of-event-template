import { Job } from '@/pages/JobSpace';

export interface WizardQuestion {
  id: string;
  title: string;
  description?: string;
  type: 'multi-select' | 'single-select' | 'slider' | 'yes-no';
  options: WizardOption[];
  allowCustom?: boolean;
  customPlaceholder?: string;
}

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  selected?: boolean;
}

export interface WizardAnswer {
  questionId: string;
  selectedOptions: string[];
  customValue?: string;
}

export interface WizardState {
  currentStep: number;
  totalSteps: number;
  questions: WizardQuestion[];
  answers: WizardAnswer[];
  isGenerating: boolean;
}

export interface FilterWizardProps {
  job: Job;
  accountId?: string;
  onComplete: (filters: GeneratedFilters) => void;
  onCancel: () => void;
}

export interface GeneratedFilters {
  keywords?: string;
  role?: Array<{ keywords: string; priority: string; scope: string }>;
  seniority?: string[];
  calculated_experience_min?: number | null;
  calculated_experience_max?: number | null;
  location_within_area?: number | null;
  company_keywords?: Array<{ keywords: string; priority: string; scope: string }>;
  skills_keywords?: string[];
  school?: Array<{ id: string; name: string; priority: string }>;
  open_to_work?: boolean;
}

// Generate questions based on job data
export function generateQuestionsFromJob(job: Job): WizardQuestion[] {
  const questions: WizardQuestion[] = [];

  // Question 1: Required skills
  if (job.skills && job.skills.length > 0) {
    questions.push({
      id: 'required_skills',
      title: 'Quelles compétences sont OBLIGATOIRES ?',
      description: 'Les autres seront considérées comme bonus',
      type: 'multi-select',
      options: job.skills.map(skill => ({
        id: skill,
        label: skill,
        selected: false,
      })),
      allowCustom: true,
      customPlaceholder: 'Ajouter une compétence...',
    });
  }

  // Question 2: Remote policy / Location radius
  const remoteType = job.remote?.toLowerCase() || '';
  const isHybrid = remoteType.includes('hybride') || remoteType.includes('hybrid');
  const isFullRemote = remoteType.includes('full') || remoteType === 'remote' || remoteType === 'télétravail';
  
  questions.push({
    id: 'location_scope',
    title: 'Quelle zone géographique cibler ?',
    description: `Poste: ${job.location || 'Non précisé'} • ${job.remote || 'Non précisé'}`,
    type: 'single-select',
    options: [
      { id: 'national', label: '🌍 National', description: 'Toute la France' },
      { id: 'radius_75', label: '📍 Rayon 75 km', description: 'Autour de la ville', selected: isHybrid },
      { id: 'radius_35', label: '📍 Rayon 35 km', description: 'Proximité immédiate' },
      { id: 'no_filter', label: '❌ Pas de filtre', description: 'Ne pas filtrer par localisation', selected: isFullRemote },
    ],
  });

  // Question 3: Experience flexibility
  const hasExperience = job.xpMin || job.xpMax;
  if (hasExperience) {
    questions.push({
      id: 'experience_flex',
      title: 'Flexibilité sur l\'expérience ?',
      description: `Critère poste: ${job.xpMin || 0}-${job.xpMax || '?'} ans`,
      type: 'single-select',
      options: [
        { id: 'strict', label: '📏 Strict', description: `${job.xpMin || 0}-${job.xpMax || '?'} ans exactement` },
        { id: 'flexible', label: '📐 Flexible', description: `${Math.max(0, (job.xpMin || 0) - 1)}-${(job.xpMax || 5) + 2} ans` },
        { id: 'very_flexible', label: '🔄 Très flexible', description: `${Math.max(0, (job.xpMin || 0) - 2)}-${(job.xpMax || 5) + 4} ans` },
      ],
    });
  }

  // Question 4: Exclude client company
  if (job.client?.name) {
    questions.push({
      id: 'exclude_client',
      title: `Exclure les employés actuels de ${job.client.name} ?`,
      description: 'Évite de contacter des candidats déjà chez le client',
      type: 'yes-no',
      options: [
        { id: 'yes', label: '✅ Oui, exclure', selected: true },
        { id: 'no', label: '❌ Non, inclure' },
      ],
    });
  }

  // Question 5: School filter
  questions.push({
    id: 'school_filter',
    title: 'Filtrer par écoles ?',
    description: 'Cibler des profils issus d\'écoles spécifiques',
    type: 'single-select',
    options: [
      { id: 'top_15', label: '🎓 TOP 15 Ingénieurs', description: 'Polytechnique, Centrale, Mines...' },
      { id: 'top_business', label: '💼 TOP Business', description: 'HEC, ESSEC, ESCP...' },
      { id: 'both', label: '🏆 TOP Ingé + Business', description: 'Toutes les grandes écoles' },
      { id: 'no_filter', label: '❌ Pas de filtre', description: 'Ouvert à tous les profils', selected: true },
    ],
  });

  // Question 6: Open to work filter
  questions.push({
    id: 'open_to_work',
    title: 'Filtrer sur "Open to Work" ?',
    description: 'Attention: peut exclure des profils passifs qualifiés',
    type: 'yes-no',
    options: [
      { id: 'yes', label: '✅ Oui, uniquement Open to Work' },
      { id: 'no', label: '❌ Non, tous les profils', selected: true },
    ],
  });

  return questions;
}
