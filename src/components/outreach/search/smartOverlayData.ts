/**
 * Données des surcouches de filtres (SmartOverlays).
 *
 * TOP_SCHOOLS : IDs LinkedIn déjà résolus — copie de la liste canonique de
 * supabase/functions/generate-search-filters/index.ts (l.83-126). Si tu
 * modifies l'une, modifie l'autre.
 *
 * ESN_BOOLEAN_GROUPS : les 16 ESN de ESN_KEYWORDS (même fichier edge, liste
 * dormante) en 2 requêtes booléennes OR — injectées en company_keywords avec
 * scope PAST_NOT_CURRENT (= « ex-employés, partis depuis »).
 */

export interface OverlaySchool { id: string; name: string }

export const TOP_ENGINEERING_SCHOOLS: OverlaySchool[] = [
  { id: '14034', name: 'École Polytechnique' },
  { id: '14803', name: 'CentraleSupélec' },
  { id: '15092675', name: 'Mines Paris - PSL' },
  { id: '24772587', name: 'École des Ponts ParisTech' },
  { id: '163637', name: 'Télécom Paris' },
  { id: '12442', name: 'Centrale Lyon' },
  { id: '163631', name: 'Centrale Lille' },
  { id: '12429', name: 'Centrale Nantes' },
  { id: '27158163', name: 'ENSTA Paris' },
  { id: '12463', name: 'IMT Atlantique' },
  { id: '12444', name: 'Grenoble INP - Ensimag' },
  { id: '12437', name: 'Arts et Métiers' },
  { id: '12443', name: 'INP-ENSEEIHT' },
  { id: '12467', name: 'UTC' },
  { id: '12446', name: 'ISAE-SUPAERO' },
  { id: '12451', name: 'ISEP' },
  { id: '12440', name: 'EPITA' },
  { id: '12435', name: 'INSA Lyon' },
  { id: '12460', name: 'INSA Toulouse' },
  { id: '12456', name: 'Polytech Nice' },
  { id: '167703', name: 'ENSAE Paris' },
];

export const TOP_BUSINESS_SCHOOLS: OverlaySchool[] = [
  { id: '14304', name: 'HEC Paris' },
  { id: '14296', name: 'ESSEC Business School' },
  { id: '14298', name: 'ESCP Business School' },
  { id: '14310', name: 'EM Lyon Business School' },
  { id: '14302', name: 'EDHEC Business School' },
  { id: '166993', name: 'Sciences Po' },
  { id: '14312', name: 'Grenoble École de Management' },
  { id: '14316', name: 'SKEMA Business School' },
  { id: '14306', name: 'Audencia Business School' },
  { id: '14314', name: 'Neoma Business School' },
  { id: '14318', name: 'Kedge Business School' },
  { id: '14300', name: 'Toulouse Business School' },
  { id: '166675', name: 'Paris-Dauphine University' },
  { id: '14308', name: 'IESEG School of Management' },
];

export const ESN_BOOLEAN_GROUPS = [
  'Capgemini OR Accenture OR "Sopra Steria" OR Atos OR CGI OR Altran OR Alten OR Assystem',
  'Aubay OR Devoteam OR Extia OR Wavestone OR Talan OR Onepoint OR "Publicis Sapient" OR "Sword Group"',
];
