// Onglet « Étapes » de la page d'une séquence (lot 5c-2) : le fil vertical des
// étapes, en lecture, tel que le moteur le jouera. Module pur, testé sous Node.
//
// Mêmes règles que l'éditeur et le moteur (components/outreach/sequence/
// sequenceGraph.ts) : départ à la première étape qu'aucun renvoi ne vise,
// étape suivante par engineNextStepId (fin de séquence, renvoi explicite, arrêt
// d'une cible de renvoi, sinon l'ordre suivant), fourches de « Vérifier la
// connexion » et d'un branchement, branche « Pas acceptée » d'une attente de
// connexion avec étape de repli. Une étape déjà dessinée n'est pas répétée :
// la branche dit qu'elle la rejoint. Les versions A/B d'une étape sont un seul
// bloc, avec leur nombre.

import type { SequenceStep } from '../types/sequence';
import {
  engineNextStepId,
  getPrimarySteps,
  isReferenced,
  rowToSequenceStep,
  stepTypeLabel,
  type SequenceStepRow,
} from '../components/outreach/sequence/sequenceGraph.ts';
import { plural } from './plural.ts';

export interface FlowStepNode {
  kind: 'step';
  id: string;
  number: number;
  actionType: string;
  title: string;
  /** Début du message, variables écrites en clair (« Bonjour [Prénom] »). */
  excerpt: string | null;
  /** Ligne d'explication d'une étape sans message (attente, visite). */
  description: string | null;
  /** Délai avant l'étape : « Attendre 2 jours », « Aussitôt ». */
  delay: string;
  badges: string[];
}

export interface FlowBranch {
  label: string;
  nodes: FlowNode[];
}

export interface FlowForkNode {
  kind: 'fork';
  id: string;
  number: number;
  actionType: string;
  title: string;
  description: string;
  delay: string;
  badges: string[];
  branches: FlowBranch[];
}

export interface FlowJoinNode {
  kind: 'join';
  /** Numéro de l'étape rejointe. */
  number: number;
  title: string;
}

export interface FlowEndNode {
  kind: 'end';
}

export type FlowNode = FlowStepNode | FlowForkNode | FlowJoinNode | FlowEndNode;

export interface SequenceFlow {
  /** « Dès l'inscription, au premier créneau » ; un délai sur la première étape s'y ajoute. */
  start: string;
  nodes: FlowNode[];
  /** Nombre d'étapes affichées (versions A/B comptées une fois). */
  stepCount: number;
}

// Variables du moteur écrites en clair dans un extrait (clés de sequenceGraph).
const VARIABLE_LABELS: Record<string, string> = {
  prenom: 'Prénom', first_name: 'Prénom',
  nom: 'Nom', last_name: 'Nom',
  nom_complet: 'Nom complet', name: 'Nom complet',
  headline: 'Titre LinkedIn',
  poste_actuel: 'Poste actuel', job_title: 'Poste actuel',
  entreprise_actuelle: 'Entreprise actuelle', company: 'Entreprise actuelle',
  profil_linkedin: 'Profil LinkedIn',
  niveau_connexion: 'Niveau de relation',
  poste_recherche: 'Poste recherché',
  client: 'Client',
  lieu_poste: 'Lieu du poste',
  type_contrat: 'Type de contrat',
  skills_requis: 'Compétences clés',
  mon_prenom: 'Votre prénom', sender_name: 'Votre prénom',
  mon_nom: 'Votre nom',
  ma_signature: 'Votre signature',
  mon_poste: 'Votre poste',
  ma_societe: 'Votre société',
  lien_calendly: 'Lien d’agenda', calendly_link: 'Lien d’agenda',
  aujourd_hui: 'Date du jour',
  jour_semaine: 'Jour de la semaine',
  date_courte: 'Date',
  salutation: 'Bonjour ou Bonsoir',
  periode_jour: 'Moment de la journée',
};

const EXCERPT_MAX = 160;

/** Début d'un message, variables en clair : « Bonjour [Prénom], votre parcours… ». */
export function templateExcerpt(text: string | null | undefined, max: number = EXCERPT_MAX): string | null {
  const flat = (text ?? '')
    .replace(/\\n|\n/g, ' ')
    .replace(/\{\{\s*([^{}|]+?)\s*(?:\|[^{}]*)?\}\}/g, (_raw, key: string) => `[${VARIABLE_LABELS[key.trim().toLowerCase()] ?? key.trim()}]`)
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** « Aussitôt », « Attendre 1 jour », « Attendre 2 jours et 4 heures ». */
export function delayLabel(step: Pick<SequenceStep, 'delayDays' | 'delayHours' | 'delayMinutes'>): string {
  const parts = [
    step.delayDays > 0 ? plural(step.delayDays, 'jour', 'jours') : '',
    step.delayHours > 0 ? plural(step.delayHours, 'heure', 'heures') : '',
    step.delayMinutes > 0 ? plural(step.delayMinutes, 'minute', 'minutes') : '',
  ].filter(Boolean);
  if (parts.length === 0) return 'Aussitôt';
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
  return `Attendre ${text}`;
}

const WAIT_DEFAULT_DAYS = 3;

function stepDescription(step: SequenceStep): string | null {
  const days = step.timeoutDays ?? WAIT_DEFAULT_DAYS;
  switch (step.actionType) {
    case 'profile_visit': return 'Le candidat est notifié de votre visite.';
    case 'wait_connection': return `Attendre que l’invitation soit acceptée, ${plural(days, 'jour', 'jours')} au plus.`;
    case 'wait_reply': return `Attendre une réponse, ${plural(days, 'jour', 'jours')} au plus. Une réponse arrête la séquence.`;
    case 'wait_profile_visit': return `Attendre une visite de profil, ${plural(days, 'jour', 'jours')} au plus.`;
    case 'connection_request': return step.messageTemplate?.trim() ? null : 'Invitation sans note : le candidat reçoit seulement votre demande de mise en relation.';
    case 'smart_message': return 'Message rédigé par l’IA Konekt pour chaque candidat, relu avant l’envoi.';
    default: return null;
  }
}

const CONDITION_BADGES: Partial<Record<SequenceStep['conditionType'], string>> = {
  if_connected: 'Seulement si en relation',
  if_not_connected: 'Seulement si pas en relation',
  if_no_response: 'Seulement sans réponse',
  if_score_above: 'Seulement au-dessus d’une note',
};

export function buildSequenceFlow(rows: readonly SequenceStepRow[]): SequenceFlow {
  const steps = rows.map(rowToSequenceStep);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const primaries = getPrimarySteps(steps);
  // Numéro d'une étape : son rang parmi les ordres (une version A/B a le numéro de son ordre).
  const orders = [...new Set(primaries.map((s) => s.order))].sort((a, b) => a - b);
  const numberOf = (step: SequenceStep) => orders.indexOf(step.order) + 1;
  const variantCount = (step: SequenceStep) => (step.variantGroup ? steps.filter((s) => s.order === step.order && s.variantGroup).length : 1);

  const badgesOf = (step: SequenceStep): string[] => {
    const row = rowById.get(step.id);
    const badges: string[] = [];
    const versions = variantCount(step);
    if (versions > 1) badges.push(`A/B · ${versions} versions`);
    if (step.actionType === 'connection_request' && step.messageTemplate?.trim()) badges.push('avec note');
    if (step.useAiPersonalization && step.actionType !== 'smart_message') badges.push('Rédigé par l’IA pour chaque candidat');
    if (row?.preferred_hour_start != null && row?.preferred_hour_end != null) badges.push(`Créneau ${row.preferred_hour_start} h-${row.preferred_hour_end} h`);
    const condition = CONDITION_BADGES[step.conditionType];
    if (condition) badges.push(condition);
    return badges;
  };

  const rendered = new Set<string>();
  const walk = (startId: string | null, depth: number): FlowNode[] => {
    const nodes: FlowNode[] = [];
    let id = startId;
    let hops = 0;
    while (id && hops < 200) {
      hops += 1;
      const step = byId.get(id);
      if (!step) break;
      if (rendered.has(step.id)) {
        nodes.push({ kind: 'join', number: numberOf(step), title: stepTypeLabel(step.actionType) });
        return nodes;
      }
      rendered.add(step.id);
      const base = {
        id: step.id,
        number: numberOf(step),
        actionType: step.actionType,
        title: stepTypeLabel(step.actionType),
        delay: delayLabel(step),
        badges: badgesOf(step),
      };
      const isFork = step.actionType === 'check_connection' || step.actionType === 'condition_branch';
      if (isFork && depth < 6) {
        const fallback = engineNextStepId(step, steps);
        const connection = step.actionType === 'check_connection';
        nodes.push({
          ...base,
          kind: 'fork',
          description: connection
            ? 'Deux branches selon que le candidat est déjà en relation ou non.'
            : 'Deux branches selon la condition de l’étape.',
          branches: [
            { label: connection ? 'Connecté (1er degré)' : 'Si la condition est remplie', nodes: walk(step.ifTrueGotoStep ?? fallback, depth + 1) },
            { label: connection ? 'Non connecté' : 'Sinon', nodes: walk(step.ifFalseGotoStep ?? fallback, depth + 1) },
          ],
        });
        return nodes;
      }
      if (step.actionType === 'wait_connection' && step.timeoutBranchStepId && depth < 6) {
        const days = step.timeoutDays ?? WAIT_DEFAULT_DAYS;
        nodes.push({
          ...base,
          kind: 'fork',
          description: `Attendre que l’invitation soit acceptée, ${plural(days, 'jour', 'jours')} au plus.`,
          branches: [
            { label: 'Acceptée', nodes: walk(engineNextStepId(step, steps), depth + 1) },
            { label: `Pas acceptée après ${plural(days, 'jour', 'jours')}`, nodes: walk(step.timeoutBranchStepId, depth + 1) },
          ],
        });
        return nodes;
      }
      nodes.push({
        ...base,
        kind: 'step',
        excerpt: step.actionType === 'smart_message' ? null : templateExcerpt(step.messageTemplate),
        description: stepDescription(step),
      });
      // Attente de réponse avec étape de repli : sans réponse, le moteur y passe.
      id = step.actionType === 'wait_reply' && step.timeoutBranchStepId ? step.timeoutBranchStepId : engineNextStepId(step, steps);
    }
    nodes.push({ kind: 'end' });
    return nodes;
  };

  const root = primaries.find((s) => !isReferenced(s, steps)) ?? primaries[0] ?? null;
  if (!root) return { start: 'Dès l’inscription, au premier créneau', nodes: [], stepCount: 0 };
  const firstDelay = delayLabel(root);
  return {
    start: firstDelay === 'Aussitôt' ? 'Dès l’inscription, au premier créneau' : `Dès l’inscription, puis ${firstDelay.charAt(0).toLowerCase()}${firstDelay.slice(1)}`,
    nodes: walk(root.id, 0),
    stepCount: orders.length,
  };
}
