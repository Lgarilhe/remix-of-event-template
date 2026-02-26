export interface CandidateCounts {
  cv: number;
  itw: number;
  offre: number;
  total: number;
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
