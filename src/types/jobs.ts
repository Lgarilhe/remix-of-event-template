export interface CandidateCounts {
  cv: number;
  itw: number;
  offre: number;
  total: number;
}

export interface TransversalCriteria {
  must: string;
  should: string;
  niceToHave: string;
  context: string;
  domain: string;
  level: string;
  bodyContent: string;
}

export interface Job {
  id: string;
  title: string;
  client: {
    id: string;
    name: string;
    sector: string;
    size: string;
    website: string;
    linkedin: string;
  } | null;
  status: string;
  seniority: string;
  contractType: string;
  location: string;
  remote: string;
  salaryMin: number;
  salaryMax: number;
  priority: string;
  skills: string[];
  description: string;
  interviewProcess: string;
  requirements: string;
  openingDate: string;
  startDate: string;
  channel: string;
  sourcingCriteria: string;
  teamInfo: string;
  xpMin: number;
  xpMax: number;
  tjm: number;
  accompagnement: string[];
  jobUrl: string;
  candidateCounts: CandidateCounts;
  /** Scoring criteria from the job itself */
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  /** Free-form body content extracted from the Notion page */
  bodyContent?: string;
  /** Resolved transversal criteria linked to this job */
  transversalCriteria?: TransversalCriteria | null;
  /** Entity / business unit */
  entity?: string;
}

export interface JobFiltersState {
  search: string;
  status: string[];
  contractType: string[];
  location: string;
  remote: string[];
  sector: string[];
  priority: string[];
  seniority: string[];
  skills: string[];
}
