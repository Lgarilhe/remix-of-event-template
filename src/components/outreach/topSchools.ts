// TOP French Engineering Schools for quick filter selection
// IDs resolved via LinkedIn Recruiter API (Unipile)

export interface TopSchool {
  id: string;
  name: string;
  category: 'engineering' | 'business' | 'atypical';
}

// Reference: LinkedIn School IDs (resolved via Unipile API)
export const TOP_SCHOOLS: TopSchool[] = [
  // Grandes Écoles d'Ingénieurs
  { id: "14034", name: "École Polytechnique", category: 'engineering' },
  { id: "14803", name: "CentraleSupélec", category: 'engineering' },
  { id: "12442", name: "Centrale Lyon", category: 'engineering' },
  { id: "163631", name: "Centrale Lille", category: 'engineering' },
  { id: "12429", name: "Centrale Nantes", category: 'engineering' },
  { id: "24772587", name: "École des Ponts ParisTech", category: 'engineering' },
  { id: "163637", name: "Télécom Paris", category: 'engineering' },
  { id: "27158163", name: "ENSTA Paris", category: 'engineering' },
  { id: "15092675", name: "Mines Paris - PSL", category: 'engineering' },
  { id: "12463", name: "IMT Atlantique", category: 'engineering' },
  { id: "12444", name: "Grenoble INP - Ensimag", category: 'engineering' },
  { id: "12451", name: "ISEP", category: 'engineering' },
  { id: "12437", name: "Arts et Métiers", category: 'engineering' },
  { id: "12443", name: "INP-ENSEEIHT", category: 'engineering' },
  { id: "12467", name: "UTC - Université de Technologie de Compiègne", category: 'engineering' },
  { id: "12446", name: "ISAE-SUPAERO", category: 'engineering' },
  
  // École Tech / Atypique
  { id: "12440", name: "EPITA", category: 'atypical' },
];

// Group by category for UI display
export const TOP_SCHOOLS_BY_CATEGORY = {
  engineering: TOP_SCHOOLS.filter(s => s.category === 'engineering'),
  business: TOP_SCHOOLS.filter(s => s.category === 'business'),
  atypical: TOP_SCHOOLS.filter(s => s.category === 'atypical'),
};
