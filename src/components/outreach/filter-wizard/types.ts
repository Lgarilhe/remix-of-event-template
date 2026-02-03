import { Job } from '@/pages/JobSpace';

export interface WizardQuestion {
  id: string;
  title: string;
  description?: string;
  type: 'multi-select' | 'single-select' | 'yes-no' | 'text-input';
  options: WizardOption[];
  allowCustom?: boolean;
  customPlaceholder?: string;
  required?: boolean;
}

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  selected?: boolean;
  metadata?: Record<string, unknown>;
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

// Seniority mapping from job seniority text to LinkedIn values
const SENIORITY_MAPPING: Record<string, string[]> = {
  'junior': ['3', '4'], // Entry, Associate
  'confirmé': ['4', '5'], // Associate, Mid-Senior
  'senior': ['5', '6'], // Mid-Senior, Director
  'sénior': ['5', '6'],
  'lead': ['5', '6', '7'], // Mid-Senior, Director, VP
  'manager': ['6', '7'], // Director, VP
  'directeur': ['7', '8'], // VP, CXO
  'head': ['6', '7'],
  'vp': ['7', '8'],
  'c-level': ['8', '9'], // CXO, Partner
};

// Generate smart job title variations
function generateTitleVariations(jobTitle: string): WizardOption[] {
  const title = jobTitle.toLowerCase();
  const variations: WizardOption[] = [];
  
  // Original title is always first
  variations.push({
    id: jobTitle,
    label: jobTitle,
    description: 'Titre exact du poste',
    selected: true,
  });

  // Common mappings for tech roles
  const titleMappings: Record<string, string[]> = {
    'développeur': ['Developer', 'Software Engineer', 'Ingénieur Développement'],
    'developer': ['Développeur', 'Software Engineer', 'Ingénieur Développement'],
    'software engineer': ['Développeur', 'Developer', 'Ingénieur Logiciel'],
    'ingénieur': ['Engineer', 'Ingénieur'],
    'fullstack': ['Full Stack', 'Full-Stack', 'Fullstack'],
    'full stack': ['Fullstack', 'Full-Stack'],
    'frontend': ['Front End', 'Front-End', 'UI Developer'],
    'backend': ['Back End', 'Back-End', 'API Developer'],
    'devops': ['DevOps Engineer', 'SRE', 'Platform Engineer', 'Ingénieur DevOps'],
    'sre': ['Site Reliability Engineer', 'DevOps', 'Platform Engineer'],
    'data engineer': ['Ingénieur Data', 'Data Developer', 'Ingénieur Données'],
    'data scientist': ['Data Analyst', 'ML Engineer', 'Scientifique Données'],
    'product manager': ['Chef de Produit', 'PM', 'Product Owner'],
    'product owner': ['Product Manager', 'PO', 'Chef de Produit'],
    'chef de projet': ['Project Manager', 'Delivery Manager'],
    'project manager': ['Chef de Projet', 'Delivery Manager'],
    'tech lead': ['Lead Developer', 'Lead Technique', 'Engineering Lead'],
    'lead': ['Lead', 'Senior', 'Principal'],
    'architect': ['Architecte', 'Solution Architect', 'Technical Architect'],
    'architecte': ['Architect', 'Solution Architect'],
    'cto': ['Chief Technology Officer', 'VP Engineering', 'Directeur Technique'],
    'cre': ['Customer Reliability Engineer', 'Support Engineer', 'Technical Support'],
    'support': ['Support Engineer', 'Customer Engineer', 'Technical Support'],
  };

  // Find matching variations
  for (const [key, alternatives] of Object.entries(titleMappings)) {
    if (title.includes(key)) {
      for (const alt of alternatives) {
        if (!variations.find(v => v.label.toLowerCase() === alt.toLowerCase())) {
          variations.push({
            id: alt,
            label: alt,
            description: 'Variation suggérée',
            selected: true, // Pre-select good variations
          });
        }
      }
    }
  }

  // Add seniority variations if detected
  if (title.includes('senior') || title.includes('sénior')) {
    const baseTitle = jobTitle.replace(/senior|sénior/gi, '').trim();
    if (baseTitle && !variations.find(v => v.label === baseTitle)) {
      variations.push({
        id: `${baseTitle} (no seniority)`,
        label: baseTitle,
        description: 'Sans mention de séniorité',
        selected: false,
      });
    }
  }

  return variations.slice(0, 8); // Limit to 8 options
}

// Analyze job skills and categorize them
function categorizeSkills(skills: string[]): { critical: string[]; bonus: string[] } {
  if (!skills || skills.length === 0) return { critical: [], bonus: [] };
  
  // First 3-4 skills are usually the most important
  const criticalCount = Math.min(Math.ceil(skills.length * 0.5), 4);
  
  return {
    critical: skills.slice(0, criticalCount),
    bonus: skills.slice(criticalCount),
  };
}

// Calculate experience range based on job
function calculateExperienceRange(job: Job): { min: number; max: number; flexMin: number; flexMax: number } {
  const min = job.xpMin || 0;
  const max = job.xpMax || min + 5;
  
  return {
    min,
    max,
    flexMin: Math.max(0, min - 2),
    flexMax: max + 3,
  };
}

// Detect remote policy
function detectRemotePolicy(job: Job): 'full_remote' | 'hybrid' | 'onsite' | 'unknown' {
  const remote = (job.remote || '').toLowerCase();
  
  if (remote.includes('full') || remote === 'remote' || remote === 'télétravail') {
    return 'full_remote';
  }
  if (remote.includes('hybride') || remote.includes('hybrid')) {
    return 'hybrid';
  }
  if (remote.includes('site') || remote.includes('présentiel') || remote === 'non') {
    return 'onsite';
  }
  return 'unknown';
}

// Generate questions based on job data
export function generateQuestionsFromJob(job: Job): WizardQuestion[] {
  const questions: WizardQuestion[] = [];
  const titleVariations = generateTitleVariations(job.title);
  const { critical: criticalSkills, bonus: bonusSkills } = categorizeSkills(job.skills || []);
  const experienceRange = calculateExperienceRange(job);
  const remotePolicy = detectRemotePolicy(job);

  // Question 1: Job titles (CRITICAL - this directly impacts search quality)
  questions.push({
    id: 'job_titles',
    title: 'Quels titres de poste rechercher ?',
    description: 'Sélectionne les variantes pertinentes (FR + EN). Elles seront combinées avec OR.',
    type: 'multi-select',
    options: titleVariations,
    allowCustom: true,
    customPlaceholder: 'Ajouter un titre...',
    required: true,
  });

  // Question 2: Seniority levels
  const jobSeniority = (job.seniority || '').toLowerCase();
  const suggestedSeniority = SENIORITY_MAPPING[jobSeniority] || ['4', '5']; // Default to Associate + Mid-Senior
  
  questions.push({
    id: 'seniority',
    title: 'Quels niveaux de séniorité cibler ?',
    description: `Poste indiqué: ${job.seniority || 'Non précisé'}`,
    type: 'multi-select',
    options: [
      { id: '2', label: 'Intern', description: 'Stagiaire' },
      { id: '3', label: 'Entry Level', description: 'Débutant (0-2 ans)', selected: suggestedSeniority.includes('3') },
      { id: '4', label: 'Associate', description: 'Junior/Confirmé (2-5 ans)', selected: suggestedSeniority.includes('4') },
      { id: '5', label: 'Mid-Senior', description: 'Senior (5-10 ans)', selected: suggestedSeniority.includes('5') },
      { id: '6', label: 'Director', description: 'Manager/Lead', selected: suggestedSeniority.includes('6') },
      { id: '7', label: 'VP', description: 'Head of / VP', selected: suggestedSeniority.includes('7') },
      { id: '8', label: 'CXO', description: 'C-Level', selected: suggestedSeniority.includes('8') },
    ],
  });

  // Question 3: Experience range
  questions.push({
    id: 'experience',
    title: 'Quelle plage d\'expérience ?',
    description: `Critère poste: ${experienceRange.min}-${experienceRange.max} ans`,
    type: 'single-select',
    options: [
      { 
        id: 'strict', 
        label: `📏 Exact: ${experienceRange.min}-${experienceRange.max} ans`,
        description: 'Correspond exactement au besoin',
      },
      { 
        id: 'flexible', 
        label: `📐 Flexible: ${experienceRange.flexMin}-${experienceRange.flexMax} ans`,
        description: 'Élargit un peu pour plus de candidats',
        selected: true,
      },
      { 
        id: 'no_filter', 
        label: '🔓 Pas de filtre XP',
        description: 'Laisser le scoring IA décider',
      },
    ],
  });

  // Question 4: Skills prioritization (only if job has skills)
  if (job.skills && job.skills.length > 2) {
    questions.push({
      id: 'critical_skills',
      title: 'Quelles compétences sont OBLIGATOIRES ?',
      description: 'Les autres seront traitées comme bonus par le scoring IA',
      type: 'multi-select',
      options: job.skills.map((skill, idx) => ({
        id: skill,
        label: skill,
        selected: idx < criticalSkills.length, // Pre-select first ones as critical
      })),
      allowCustom: true,
      customPlaceholder: 'Ajouter une compétence...',
    });
  }

  // Question 5: Location & radius
  const locationOptions: WizardOption[] = [];
  
  if (remotePolicy === 'full_remote') {
    locationOptions.push(
      { id: 'national', label: '🌍 France entière', description: 'Full remote = pas de contrainte géo', selected: true },
      { id: 'europe', label: '🇪🇺 Europe', description: 'Timezone compatible' },
    );
  } else if (remotePolicy === 'hybrid') {
    locationOptions.push(
      { id: 'radius_75', label: `📍 75 km de ${job.location || 'la ville'}`, description: 'Hybride = proximité raisonnable', selected: true },
      { id: 'radius_50', label: '📍 50 km', description: 'Plus proche' },
      { id: 'national', label: '🌍 National', description: 'Si prêt à déménager' },
    );
  } else {
    locationOptions.push(
      { id: 'radius_35', label: `📍 35 km de ${job.location || 'la ville'}`, description: 'Présentiel = proximité importante', selected: true },
      { id: 'radius_50', label: '📍 50 km', description: 'Un peu plus large' },
      { id: 'radius_75', label: '📍 75 km', description: 'Élargi' },
    );
  }
  locationOptions.push({ id: 'no_filter', label: '❌ Pas de filtre géo', description: 'Ne pas filtrer par localisation' });

  questions.push({
    id: 'location',
    title: 'Quel rayon géographique ?',
    description: `📍 ${job.location || 'Non précisé'} • ${job.remote || 'Remote non précisé'}`,
    type: 'single-select',
    options: locationOptions,
  });

  // Question 6: Client exclusion + target companies
  if (job.client?.name) {
    questions.push({
      id: 'companies',
      title: 'Filtrer par entreprises ?',
      description: `Client: ${job.client.name}`,
      type: 'multi-select',
      options: [
        { 
          id: `exclude_${job.client.name}`, 
          label: `❌ Exclure ${job.client.name}`, 
          description: 'Éviter les employés actuels du client',
          selected: true,
          metadata: { type: 'exclude', company: job.client.name },
        },
        { 
          id: 'target_competitors', 
          label: '🎯 Cibler les concurrents', 
          description: 'Tu pourras préciser lesquels',
          metadata: { type: 'target_prompt' },
        },
      ],
      allowCustom: true,
      customPlaceholder: 'Ajouter une entreprise à exclure...',
    });
  }

  // Question 7: Advanced options
  questions.push({
    id: 'advanced',
    title: 'Options avancées',
    description: 'Paramètres supplémentaires pour affiner la recherche',
    type: 'multi-select',
    options: [
      { 
        id: 'open_to_work', 
        label: '👋 Open to Work uniquement', 
        description: '⚠️ Exclut les candidats passifs',
        selected: false,
      },
      { 
        id: 'recent_activity', 
        label: '📱 Actifs récemment', 
        description: 'Connectés dans les 30 derniers jours',
        selected: false,
      },
      { 
        id: 'first_degree', 
        label: '🤝 Réseau 1er degré', 
        description: 'Uniquement vos connexions directes',
        selected: false,
      },
    ],
  });

  return questions;
}
