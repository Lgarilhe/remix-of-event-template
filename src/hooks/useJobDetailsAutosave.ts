// Enregistrement automatique du brief d'une mission (sourcing_projects.job_details).
//
// Logique déplacée telle quelle depuis MissionBriefV2 (refonte mission, lot 1,
// écran Cadrage) pour qu'un écran n'en tienne qu'une instance : brouillon local
// fusionné sur la dernière version du serveur, envoi 800 ms après la dernière
// frappe, envoi au démontage, garde de frappe en vol. Seul ajout : `retry`,
// qui renvoie le brouillon après un échec (jamais appelé par MissionBriefV2).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSourcingProjects, type SourcingProject } from '@/hooks/useSourcingProjects';
import { deepMerge } from '@/lib/deepMerge';
import type { JobDetails } from '@/types/jobDetails';

export type JobDetailsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useJobDetailsAutosave(project: SourcingProject, readOnly = false) {
  const { updateProject } = useSourcingProjects();
  const [saveStatus, setSaveStatus] = useState<JobDetailsSaveStatus>('idle');
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save logic (debounced 800ms).
  // latestRef = la "vérité serveur" la plus récente (depuis project.job_details).
  // pendingPatchRef = les changements en cours de saisie pas encore persistés.
  // À chaque render on re-merge les deux pour afficher l'état frais.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<JobDetails>>({});
  const latestRef = useRef<JobDetails>(project.job_details || {});
  // Incrémenté à chaque frappe. Permet de savoir si l'user a tapé pendant
  // qu'une sauvegarde était en vol (sinon on effacerait sa saisie).
  const editSeqRef = useRef(0);

  // Sync latestRef quand project.job_details change (DB sync depuis le serveur).
  // On ne le réécrase PAS pendant que l'user tape (sinon on perd les patchs locaux).
  useEffect(() => {
    latestRef.current = project.job_details || {};
  }, [project.job_details]);

  // Flush pending patch + cleanup timers au unmount.
  // CRITIQUE : si l'user navigue ailleurs alors qu'un timer est en cours
  // (ex: tape un champ puis change de sub-tab dans les 800ms), on flush
  // immédiatement pour ne pas perdre la saisie.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Flush sync : envoie le patch en attente avant de démonter
        if (Object.keys(pendingPatchRef.current).length > 0) {
          const merged = deepMerge(latestRef.current, pendingPatchRef.current);
          updateProject({ id: project.id, job_details: merged } as any).catch(() => {
            // best-effort, l'user a déjà quitté
          });
        }
      }
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]); // re-flush si on switch de mission

  const [tick, setTick] = useState(0); // forces re-render on local edit
  const jd = deepMerge(latestRef.current, pendingPatchRef.current) as JobDetails;
  // Le tick force un re-render pour afficher la nouvelle valeur sans race
  void tick;

  // Envoi du brouillon complet (corps du minuteur d'origine).
  const send = useCallback(() => {
    const sentSeq = editSeqRef.current;
    const merged = deepMerge(latestRef.current, pendingPatchRef.current);
    updateProject({ id: project.id, job_details: merged } as any).then(
      () => {
        // Ne vider le pending QUE si aucune frappe n'a eu lieu pendant
        // la requête en vol — sinon on perdrait le texte tapé entre
        // l'envoi et la réponse, et le refetch ferait reculer le champ.
        // Une frappe ultérieure a déjà reprogrammé un save du pending complet.
        if (editSeqRef.current === sentSeq) {
          pendingPatchRef.current = {};
        }
        setSaveStatus('saved');
        if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
      },
      () => setSaveStatus('error'),
    );
  }, [project.id, updateProject]);

  const updateField = useCallback((patch: Partial<JobDetails>) => {
    if (readOnly) return;
    pendingPatchRef.current = deepMerge(pendingPatchRef.current, patch);
    editSeqRef.current += 1;
    setTick(t => t + 1);
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(send, 800);
  }, [readOnly, send]);

  /** Renvoie tout de suite le brouillon après un échec d'enregistrement. */
  const retry = useCallback(() => {
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    send();
  }, [readOnly, send]);

  return { jd, updateField, saveStatus, retry };
}
