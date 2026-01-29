// TOP 15 French schools for quick filter selection
// These are the most prestigious engineering and business schools in France
// IDs resolved via LinkedIn Recruiter API

export interface TopSchool {
  id: string;
  name: string;
  category: 'engineering' | 'business' | 'atypical';
}

// Reference: LinkedIn School IDs (resolved via Unipile API)
export const TOP_SCHOOLS: TopSchool[] = [
  // TOP Engineering / Tech
  { id: "14034", name: "École Polytechnique", category: 'engineering' },
  { id: "14803", name: "CentraleSupélec", category: 'engineering' },
  { id: "15092675", name: "Mines Paris - PSL", category: 'engineering' },
  { id: "27158163", name: "ENSTA Paris", category: 'engineering' },
  { id: "163637", name: "Télécom Paris", category: 'engineering' },
  { id: "24772587", name: "École des Ponts ParisTech", category: 'engineering' },
  { id: "479301", name: "ENSAE Paris", category: 'engineering' },
  { id: "1280025", name: "Télécom SudParis", category: 'engineering' },
  
  // TOP Business / Commerce  
  { id: "285669", name: "HEC Paris", category: 'business' },
  { id: "15105510", name: "ESSEC Business School", category: 'business' },
  { id: "15106487", name: "ESCP Business School", category: 'business' },
  { id: "1223185", name: "emlyon business school", category: 'business' },
];

// Group by category for UI display
export const TOP_SCHOOLS_BY_CATEGORY = {
  engineering: TOP_SCHOOLS.filter(s => s.category === 'engineering'),
  business: TOP_SCHOOLS.filter(s => s.category === 'business'),
  atypical: TOP_SCHOOLS.filter(s => s.category === 'atypical'),
};
