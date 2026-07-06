import type { LucideIcon } from 'lucide-react';
import { Compass, Building2, UserRound, PlugZap, Users } from 'lucide-react';

export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type SceneKey =
  | 'orgtype'
  | 'goal'
  | 'orgdetails'
  | 'stack'
  | 'discovery'
  | 'specializations'
  | 'org'
  | 'audit'
  | 'profile'
  | 'aitone'
  | 'integrations'
  | 'quotas'
  | 'team'
  | 'launch';

export const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'org', 'audit', 'profile', 'aitone', 'integrations', 'quotas', 'team', 'launch'],
  agency:     ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'org', 'audit', 'profile', 'aitone', 'integrations', 'quotas', 'team', 'launch'],
  freelance:  ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'profile', 'aitone', 'integrations', 'quotas', 'launch'],
};

export const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

export interface ChapterDef {
  id: string;
  title: string;
  tagline: string;
  icon: LucideIcon;
  scenes: SceneKey[];
}

// Couleur unique pour tout le wizard (accent émeraude de la sidebar) — pas d'arc-en-ciel.
export const CHAPTERS: ChapterDef[] = [
  {
    id: 'activity',
    title: 'Votre activité',
    tagline: 'Quelques questions pour adapter Konekt à votre métier.',
    icon: Compass,
    scenes: ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations'],
  },
  {
    id: 'company',
    title: 'Votre société',
    tagline: 'On construit votre espace de travail automatiquement.',
    icon: Building2,
    scenes: ['org', 'audit'],
  },
  {
    id: 'you',
    title: 'Votre profil',
    tagline: 'Vous êtes le visage de vos messages. Soignons-le.',
    icon: UserRound,
    scenes: ['profile', 'aitone'],
  },
  {
    id: 'tools',
    title: 'Vos outils',
    tagline: 'Connectez vos canaux et réglez votre rythme de prospection.',
    icon: PlugZap,
    scenes: ['integrations', 'quotas'],
  },
  {
    id: 'team',
    title: 'Votre équipe',
    tagline: 'Invitez vos collègues, tout le monde avance ensemble.',
    icon: Users,
    scenes: ['team'],
  },
];

export interface StepMeta {
  /** Libellé court affiché dans le rail latéral */
  railLabel: string;
  /** Durée estimée en secondes (affichage + calcul du temps restant) */
  durationSec: number;
  /** Pourquoi cette étape existe — argumentaire affiché à chaque écran */
  why: string;
  /** Ce que l'étape débloque concrètement (chips) */
  unlocks: string[];
  /** L'étape peut être passée sans bloquer la suite */
  skippable?: boolean;
}

export const STEP_META: Record<Exclude<SceneKey, 'launch'>, StepMeta> = {
  orgtype: {
    railLabel: 'Votre métier',
    durationSec: 10,
    why: 'Konekt s’adapte à votre métier : les écrans, les fonctionnalités et les conseils ne sont pas les mêmes pour une entreprise, un cabinet ou un indépendant.',
    unlocks: ['Expérience sur mesure', 'Fonctionnalités adaptées'],
  },
  goal: {
    railLabel: 'Votre objectif',
    durationSec: 10,
    why: 'Votre objectif prioritaire oriente ce que Konekt met en avant : le dashboard, les conseils du copilote et les prochaines étapes suggérées.',
    unlocks: ['Priorités claires', 'Conseils ciblés'],
  },
  orgdetails: {
    railLabel: 'Votre structure',
    durationSec: 20,
    why: 'La taille de votre équipe et votre volume de recrutement calibrent les quotas d’envoi, les rôles et les recommandations de l’IA Konekt.',
    unlocks: ['Quotas adaptés', 'Recommandations pertinentes'],
  },
  stack: {
    railLabel: 'Vos outils actuels',
    durationSec: 15,
    why: 'Savoir avec quoi vous travaillez (LinkedIn Recruiter, ATS, jobboards…) permet d’adapter les filtres de recherche disponibles et de préparer les bons connecteurs.',
    unlocks: ['Filtres adaptés à votre licence', 'Connecteurs suggérés'],
  },
  discovery: {
    railLabel: 'Découverte',
    durationSec: 5,
    why: 'Savoir où vous nous avez découvert nous aide à améliorer Konekt pour les prochains recruteurs. Promis, ça reste entre nous.',
    unlocks: ['Un produit qui s’améliore'],
    skippable: true,
  },
  specializations: {
    railLabel: 'Vos secteurs',
    durationSec: 20,
    why: 'Vos secteurs alimentent l’IA Konekt : suggestions de briefs, scoring des candidats et filtres de sourcing pré-remplis avec le bon vocabulaire.',
    unlocks: ['Scoring IA affûté', 'Filtres pré-remplis'],
  },
  org: {
    railLabel: 'Votre entreprise',
    durationSec: 45,
    why: 'Donnez-nous le nom de votre société : on récupère automatiquement logo, description et postes ouverts. Votre espace est prêt sans saisie manuelle, et vos premières missions se créent en un clic.',
    unlocks: ['Espace à vos couleurs', 'Missions pré-créées'],
  },
  audit: {
    railLabel: 'Image employeur',
    durationSec: 60,
    why: 'Votre image employeur influence directement vos taux de réponse. On analyse votre présence en ligne pour identifier vos forces avant votre premier message.',
    unlocks: ['Diagnostic complet', 'Meilleur taux de réponse'],
  },
  profile: {
    railLabel: 'Votre identité',
    durationSec: 60,
    why: 'Votre profil est votre vitrine : il signe vos messages, alimente votre page publique de recruteur et permet à l’IA Konekt de générer une bio qui vous ressemble.',
    unlocks: ['Bio générée par l’IA', 'Vitrine recruteur'],
  },
  aitone: {
    railLabel: 'Votre ton',
    durationSec: 40,
    why: 'L’IA Konekt rédige des messages en votre nom. Réglez le ton et vos consignes une seule fois : chaque message d’approche sonnera comme vous, pas comme un robot.',
    unlocks: ['Messages à votre image', 'Zéro réécriture'],
    skippable: true,
  },
  integrations: {
    railLabel: 'Connexions',
    durationSec: 120,
    why: 'LinkedIn est le moteur du sourcing : sans compte connecté, pas de recherche ni de messages. L’email et WhatsApp démultiplient la portée de vos séquences.',
    unlocks: ['Sourcing LinkedIn', 'Séquences multicanales'],
  },
  quotas: {
    railLabel: 'Rythme & sécurité',
    durationSec: 20,
    why: 'LinkedIn limite l’activité des comptes trop pressés. Un rythme d’envoi maîtrisé protège votre compte et améliore vos taux de réponse — on applique ces plafonds automatiquement.',
    unlocks: ['Compte LinkedIn protégé', 'Envois automatisés sereins'],
  },
  team: {
    railLabel: 'Invitations',
    durationSec: 60,
    why: 'Le recrutement est un sport d’équipe : invitez vos collègues pour partager missions, candidats et statistiques dans un seul espace.',
    unlocks: ['Missions partagées', 'Stats consolidées'],
    skippable: true,
  },
};

/** Durée estimée formatée pour une étape (ex. « 30 sec », « 2 min »). */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const min = Math.round(sec / 60);
  return `${min} min`;
}

/** Temps restant estimé (en secondes) à partir d'un index d'étape. */
export function remainingSeconds(flow: SceneKey[], stepIndex: number): number {
  return flow
    .slice(stepIndex)
    .filter((s): s is Exclude<SceneKey, 'launch'> => s !== 'launch')
    .reduce((sum, s) => sum + STEP_META[s].durationSec, 0);
}

/** Chapitres présents dans un flow donné (scènes filtrées, chapitres vides retirés). */
export function chaptersForFlow(flow: SceneKey[]): ChapterDef[] {
  return CHAPTERS
    .map((c) => ({ ...c, scenes: c.scenes.filter((s) => flow.includes(s)) }))
    .filter((c) => c.scenes.length > 0);
}

/** Index du chapitre contenant une scène (-1 si hors chapitre, ex. launch). */
export function chapterIndexOfScene(scene: SceneKey, chapters: ChapterDef[]): number {
  return chapters.findIndex((c) => c.scenes.includes(scene));
}
