// TOP 15 French schools for quick filter selection
// These are the most prestigious engineering and business schools in France

export interface TopSchool {
  id: string;
  name: string;
  category: 'engineering' | 'business' | 'atypical';
}

// Reference: LinkedIn School IDs
export const TOP_SCHOOLS: TopSchool[] = [
  // TOP Engineering / Tech
  { id: "10245", name: "École Polytechnique", category: 'engineering' },
  { id: "301127", name: "CentraleSupélec", category: 'engineering' },
  { id: "12468", name: "Mines Paris - PSL", category: 'engineering' },
  { id: "12421", name: "École normale supérieure", category: 'engineering' },
  { id: "12453", name: "École des Ponts ParisTech", category: 'engineering' },
  { id: "12462", name: "Télécom Paris", category: 'engineering' },
  { id: "12446", name: "ISAE-SUPAERO", category: 'engineering' },
  
  // TOP Business / Commerce
  { id: "10219", name: "HEC Paris", category: 'business' },
  { id: "10213", name: "ESSEC Business School", category: 'business' },
  { id: "10212", name: "ESCP Business School", category: 'business' },
  { id: "10214", name: "emlyon business school", category: 'business' },
  { id: "10207", name: "EDHEC Business School", category: 'business' },
  { id: "10199", name: "Audencia", category: 'business' },
  
  // Atypical / Tech-focused
  { id: "10309954", name: "42", category: 'atypical' },
  { id: "12440", name: "Epitech", category: 'atypical' },
];

// Group by category for UI display
export const TOP_SCHOOLS_BY_CATEGORY = {
  engineering: TOP_SCHOOLS.filter(s => s.category === 'engineering'),
  business: TOP_SCHOOLS.filter(s => s.category === 'business'),
  atypical: TOP_SCHOOLS.filter(s => s.category === 'atypical'),
};
