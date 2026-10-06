/**
 * Aperçu réel des étapes écrites (refonte mission, lot 5d-1) : valeurs des
 * variables pour des candidats pas encore inscrits, calculées par le serveur
 * comme le moteur les calcule à l'envoi (fonction draft-sequence, action
 * preview_values), puis texte rendu dans le navigateur par
 * renderTemplatePreview (src/lib/templatePreview.ts, copie de
 * interpolateAndStrip). Remplace l'ancien rendu du navigateur, qui devinait le
 * prénom et l'entreprise à sa façon.
 *
 * - Pages de 10 candidats par appel (le serveur en accepte 20). `request` :
 *   candidats de l'écran (page de la liste, candidat affiché, pied,
 *   récapitulatif), le candidat affiché d'abord ; `ensure` : un candidat dont
 *   on attend les valeurs (génération d'un message IA hors de l'écran).
 * - Seules les variables des textes de la séquence sont demandées (`keys`).
 * - Mémoire par candidat, pour une organisation, une mission, une séquence,
 *   un compte d'envoi, un titre de poste et des variables ; tout change avec eux.
 * - Chaque candidat est décrit par les colonnes que l'inscription écrira
 *   (previewProfileOf, mêmes champs que handleEnroll de EnrollmentPreviewModal).
 * - Variables remplies à l'envoi seulement (expéditeur choisi par la rotation,
 *   variable personnelle d'un autre membre) : annoncées entre crochets
 *   (`atSend`), gardées telles quelles dans une retouche.
 * - Candidat effacé (RGPD), effacement non vérifié, lecture en échec côté
 *   serveur ou appel en échec : aucun texte, la raison à la place ;
 *   « Réessayer » relance ce qui peut l'être.
 * - Mission inconnue du serveur (poste hérité dont l'identifiant n'est pas une
 *   mission) : nouvel appel sans mission, comme le moteur qui retombe alors sur
 *   le titre du poste écrit sur l'inscription.
 * Gratuit : le serveur n'écrit rien et ne débite rien.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LinkedInProfile } from '@/components/outreach/types';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import { renderTemplatePreview, type PreviewValues } from '@/lib/templatePreview';

/** Candidats par appel à preview_values. */
export const PREVIEW_PAGE_SIZE = 10;

/** Texte affiché quand l'aperçu n'a pas pu être préparé et que le serveur n'a rien dit de plus. */
export const PREVIEW_VALUES_FAILED_MESSAGE = "L'aperçu de ce message n'a pas pu être préparé. Réessayez dans un instant.";

/**
 * Variables gardées telles quelles dans un texte modifiable, en plus de celles
 * de l'heure d'envoi : le moteur y met le lien d'agenda de la mission à l'envoi.
 */
export const KEPT_FOR_SEND_KEYS: readonly string[] = ['calendly_link', 'lien_calendly'];

/** Candidat pas encore inscrit, tel que l'inscription l'écrira (profiles de preview_values). */
export interface PreviewProfilePayload {
  id: string;
  provider_id: string | null;
  profile_name: string | null;
  profile_headline: string | null;
  profile_url: string | null;
  job_title: string | null;
  network_distance: string | null;
}

/**
 * Colonnes de sequence_enrollments que la préparation écrira pour ce candidat
 * (handleEnroll) : nom, titre, URL, titre du poste, relation et second
 * identifiant. Pas d'entreprise : l'inscription n'en écrit pas, le moteur la
 * tire du titre LinkedIn (« X chez Y »).
 */
export function previewProfileOf(profile: LinkedInProfile, jobTitle?: string | null): PreviewProfilePayload {
  return {
    id: profile.id,
    provider_id: profile.provider_id ?? null,
    profile_name: profile.name ?? null,
    profile_headline: profile.headline ?? null,
    profile_url: profile.profile_url || profile.public_profile_url || null,
    job_title: jobTitle ?? null,
    network_distance: normalizeNetworkDistance(profile.network_distance),
  };
}

/**
 * Texte affiché : rendu du moteur, variables de l'heure d'envoi et variables
 * remplies à l'envoi (`atSend`) annoncées entre crochets.
 */
export function previewDisplayText(
  template: string,
  values: PreviewValues,
  sendTime: Readonly<Record<string, string>>,
  atSend: Readonly<Record<string, string>> = {},
): string {
  return renderTemplatePreview(template ?? '', { ...values, ...sendTime, ...atSend }).text;
}

const KEPT_OPEN = '';
const KEPT_CLOSE = '';

/**
 * Texte modifiable (point de départ d'une retouche, contexte des messages
 * rédigés par l'IA) : rendu du moteur, sauf les variables remplies à l'envoi
 * (`keepKeys` : heure d'envoi, lien d'agenda, variables annoncées), gardées
 * telles quelles pour que le moteur les remplisse au moment d'envoyer.
 */
export function previewEditableText(template: string, values: PreviewValues, keepKeys: readonly string[]): string {
  const keep = new Set(keepKeys.map((k) => k.toLowerCase()));
  const kept: string[] = [];
  const masked = (template ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, expr: string) => {
    if (!keep.has(expr.split('|')[0].trim().toLowerCase())) return match;
    kept.push(match);
    return `${KEPT_OPEN}${kept.length - 1}${KEPT_CLOSE}`;
  });
  const rendered = renderTemplatePreview(masked, values).text;
  return kept.length === 0
    ? rendered
    : rendered.replace(new RegExp(`${KEPT_OPEN}(\\d+)${KEPT_CLOSE}`, 'g'), (_, i: string) => kept[Number(i)] ?? '');
}

export type PreviewValuesEntry =
  | { status: 'loading' }
  | {
    status: 'ready';
    values: Readonly<Record<string, string>>;
    /** Variables remplies à l'envoi seulement, avec leur annonce entre crochets. */
    atSend: Readonly<Record<string, string>>;
    missing: readonly string[];
  }
  /** Aucun texte : effacement (RGPD), effacement non vérifié ou échec ; `retryable` : « Réessayer » a un sens. */
  | { status: 'unavailable'; message: string; retryable: boolean };

type ReadyEntry = Extract<PreviewValuesEntry, { status: 'ready' }>;

/** Variables gardées telles quelles dans un texte modifiable de ce candidat. */
export function keptForSendKeys(entry: Pick<ReadyEntry, 'atSend'>, sendTime: Readonly<Record<string, string>>): string[] {
  return [...Object.keys(sendTime), ...KEPT_FOR_SEND_KEYS, ...Object.keys(entry.atSend)];
}

interface PreviewValuesResponse {
  candidates?: Array<{ id: string; values?: Record<string, string>; at_send?: Record<string, string>; missing?: string[] }>;
  excluded?: Array<{ id: string; reason?: string; message?: string }>;
  send_time?: Record<string, string>;
  error_code?: string;
}

export type PreviewValuesPage =
  | { kind: 'values'; entries: Map<string, PreviewValuesEntry>; sendTime: Record<string, string> }
  | { kind: 'failed'; message: string };

/** Ce qui détermine les valeurs d'un candidat, en plus de ses propres colonnes. */
export interface PreviewValuesBase {
  organizationId: string;
  missionId: string | null;
  /** Séquence de l'inscription : le serveur y lit la rotation multi-expéditeurs. */
  sequenceId: string | null;
  accountId: string | null;
  /** Variables utilisées par les textes de la séquence (templateKeys). */
  keys: readonly string[];
}

/**
 * Un appel preview_values pour une page de candidats ; sans mission si le
 * serveur ne la connaît pas. Un candidat absent de la réponse n'y figure pas :
 * l'appelant le dit sans aperçu, jamais avec un texte inventé.
 */
export async function fetchPreviewValuesPage(
  base: PreviewValuesBase,
  profiles: PreviewProfilePayload[],
): Promise<PreviewValuesPage> {
  const call = (missionId: string | null) => invokeEdgeFunction<PreviewValuesResponse>('draft-sequence', {
    action: 'preview_values',
    organization_id: base.organizationId,
    mission_id: missionId,
    sequence_id: base.sequenceId,
    account_id: base.accountId,
    keys: [...base.keys],
    profiles,
  });
  let { data, error } = await call(base.missionId);
  // Code d'erreur du serveur : error.code (invokeEdgeFunction recopie error_code).
  if (error && base.missionId && (error.code ?? data?.error_code) === 'MISSION_NOT_FOUND') ({ data, error } = await call(null));
  if (error) return { kind: 'failed', message: data?.error || error.message || PREVIEW_VALUES_FAILED_MESSAGE };

  const entries = new Map<string, PreviewValuesEntry>();
  for (const c of data?.candidates ?? []) {
    entries.set(c.id, { status: 'ready', values: c.values ?? {}, atSend: c.at_send ?? {}, missing: c.missing ?? [] });
  }
  for (const x of data?.excluded ?? []) {
    entries.set(x.id, {
      status: 'unavailable',
      message: x.message || PREVIEW_VALUES_FAILED_MESSAGE,
      // Effacement non vérifié ou lecture en échec : un nouvel essai peut aboutir ; effacé : jamais.
      retryable: x.reason !== 'gdpr_erased',
    });
  }
  return { kind: 'values', entries, sendTime: data?.send_time ?? {} };
}

interface UsePreviewValuesOptions {
  organizationId: string | null | undefined;
  /** Mission des inscriptions (uuid sans « project: »), sinon null. */
  missionId: string | null | undefined;
  /** Séquence de l'inscription. */
  sequenceId: string | null | undefined;
  /** Compte LinkedIn d'envoi de l'inscription. */
  accountId: string | null | undefined;
  /** Titre du poste écrit sur l'inscription (job_title). */
  jobTitle: string | null | undefined;
  /** Variables utilisées par les textes de la séquence (templateKeys). */
  keys: readonly string[];
}

/** Mémoire d'un contexte : entrées par candidat, appels en cours, profils demandés. */
interface PreviewValuesStore {
  key: string;
  alive: boolean;
  entries: Map<string, PreviewValuesEntry>;
  pending: Map<string, Promise<void>>;
  profiles: Map<string, LinkedInProfile>;
  sendTime: Record<string, string>;
}

const newStore = (key: string): PreviewValuesStore => ({
  key, alive: true, entries: new Map(), pending: new Map(), profiles: new Map(), sendTime: {},
});

export interface EnsuredPreviewValues {
  entries: ReadonlyMap<string, PreviewValuesEntry>;
  sendTime: Readonly<Record<string, string>>;
}

interface PreviewValuesSnapshot {
  store: PreviewValuesStore | null;
  entries: ReadonlyMap<string, PreviewValuesEntry>;
  sendTime: Readonly<Record<string, string>>;
}

const NO_SEND_TIME: Readonly<Record<string, string>> = {};

export function usePreviewValues({ organizationId, missionId, sequenceId, accountId, jobTitle, keys }: UsePreviewValuesOptions) {
  const contextKey = [organizationId ?? '', missionId ?? '', sequenceId ?? '', accountId ?? '', jobTitle ?? '', keys.join(',')].join('\u0001');
  // Une nouvelle mémoire à chaque contexte : les réponses d'un ancien contexte sont ignorées.
  const store = useMemo(() => newStore(contextKey), [contextKey]);
  // Copie lue par l'écran, publiée à chaque changement de la mémoire.
  const [snapshot, setSnapshot] = useState<PreviewValuesSnapshot>({ store: null, entries: new Map(), sendTime: NO_SEND_TIME });

  // Contexte remplacé ou fenêtre fermée : les réponses en route sont ignorées.
  useEffect(() => {
    store.alive = true;
    return () => { store.alive = false; };
  }, [store]);

  const publish = useCallback(() => {
    if (store.alive) setSnapshot({ store, entries: new Map(store.entries), sendTime: store.sendTime });
  }, [store]);

  /**
   * Demande les valeurs des candidats pas encore demandés dans ce contexte
   * (pages de 10) ; un candidat n'est demandé qu'une fois, sauf « Réessayer »
   * (`force`). Rend la promesse de fin des appels qui les concernent.
   */
  const request = useCallback((profiles: readonly LinkedInProfile[], options?: { force?: boolean }): Promise<void> => {
    if (!organizationId) return Promise.resolve();
    const todo: LinkedInProfile[] = [];
    const waits: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const profile of profiles) {
      const id = profile?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const inFlight = store.pending.get(id);
      if (inFlight && !options?.force) {
        waits.push(inFlight);
        continue;
      }
      if (!options?.force && store.entries.has(id)) continue;
      todo.push(profile);
    }
    if (todo.length === 0) return Promise.all(waits).then(() => undefined);
    for (const p of todo) {
      store.entries.set(p.id, { status: 'loading' });
      store.profiles.set(p.id, p);
    }
    publish();
    const base: PreviewValuesBase = {
      organizationId,
      missionId: missionId || null,
      sequenceId: sequenceId || null,
      accountId: accountId || null,
      keys,
    };
    for (let i = 0; i < todo.length; i += PREVIEW_PAGE_SIZE) {
      const page = todo.slice(i, i + PREVIEW_PAGE_SIZE).map((p) => previewProfileOf(p, jobTitle));
      const done = fetchPreviewValuesPage(base, page)
        .catch((err): PreviewValuesPage => {
          console.warn('[usePreviewValues] preview_values en échec :', err);
          return { kind: 'failed', message: PREVIEW_VALUES_FAILED_MESSAGE };
        })
        .then((outcome) => {
          for (const p of page) {
            if (store.pending.get(p.id) === done) store.pending.delete(p.id);
            store.entries.set(p.id, outcome.kind === 'values'
              ? outcome.entries.get(p.id) ?? { status: 'unavailable', message: PREVIEW_VALUES_FAILED_MESSAGE, retryable: true }
              : { status: 'unavailable', message: outcome.message, retryable: true });
          }
          if (outcome.kind === 'values' && Object.keys(outcome.sendTime).length > 0) store.sendTime = outcome.sendTime;
          publish();
        });
      for (const p of page) store.pending.set(p.id, done);
      waits.push(done);
    }
    return Promise.all(waits).then(() => undefined);
  }, [store, publish, organizationId, missionId, sequenceId, accountId, jobTitle, keys]);

  /** Valeurs de ces candidats, demandées si besoin : attend la fin des appels qui les concernent. */
  const ensure = useCallback(async (profiles: readonly LinkedInProfile[]): Promise<EnsuredPreviewValues> => {
    await request(profiles);
    return { entries: store.entries, sendTime: store.sendTime };
  }, [request, store]);

  const current = snapshot.store === store;
  const entryOf = useCallback(
    (profileId: string): PreviewValuesEntry | undefined => (snapshot.store === store ? snapshot.entries.get(profileId) : undefined),
    [snapshot, store],
  );

  /** Relance les candidats sans aperçu dont un nouvel essai peut aboutir. */
  const retry = useCallback(() => {
    const again: LinkedInProfile[] = [];
    store.entries.forEach((entry, id) => {
      const profile = store.profiles.get(id);
      if (entry.status === 'unavailable' && entry.retryable && profile) again.push(profile);
    });
    void request(again, { force: true });
  }, [request, store]);

  return { entryOf, sendTime: current ? snapshot.sendTime : NO_SEND_TIME, request, ensure, retry };
}
