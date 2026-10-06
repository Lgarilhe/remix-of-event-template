/**
 * Alerte de début d'entretien : à l'heure du rendez-vous, une alerte dans
 * l'application propose la visio, la fiche du candidat, la grille d'entretien et
 * l'assistant d'entretien (enregistrement, transcription, coaching).
 *
 * Montée dans AppSidebar, toujours présente (comme les autres signaux de la
 * barre). Une alerte par entretien et par heure de début : les clés déjà
 * signalées restent dans localStorage, un rechargement ne la répète pas. Rien
 * n'est signalé si la personne est déjà sur la grille de ce candidat, ni plus
 * de 10 minutes après le début (la ligne de la zone propose alors les mêmes
 * actions). Pas de notification du système : l'alerte est vue au retour sur
 * l'onglet.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/sonner';
import { InterviewAlertToast } from '@/components/sidebar/InterviewAlertToast';
import {
  ALERT_GRACE_MS,
  dueInterviewAlerts,
  interviewAlertKey,
  interviewLinks,
  joinUrlOf,
} from '@/lib/sidebarSignals';
import { useNow } from './useNow';
import { useUpcomingInterviews } from './useUpcomingInterviews';

const STORAGE_KEY = 'konekt:interview-alerts';
const STORAGE_CAP = 60;

function readAlerted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeAlerted(keys: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys].slice(-STORAGE_CAP)));
  } catch {
    // Stockage indisponible : l'alerte peut se répéter après un rechargement, sans autre effet.
  }
}

export function useInterviewAlerts(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nowMs = useNow(30_000);
  const { rows } = useUpcomingInterviews({ now: nowMs });
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (rows.length === 0) return;
    const alerted = readAlerted();
    const due = dueInterviewAlerts(rows, new Date(nowMs), alerted);
    if (due.length === 0) return;

    for (const row of due) {
      alerted.add(interviewAlertKey(row));
      const onItsScorecard =
        !!row.candidate_profile_id &&
        pathnameRef.current.startsWith(`/pipeline/scorecard/${encodeURIComponent(row.candidate_profile_id)}`);
      if (onItsScorecard) continue;

      const person = (row.candidate_name ?? row.event_name ?? '').trim() || 'Entretien';
      const toastId = `interview-${row.id}`;
      toast.custom(
        () => (
          <InterviewAlertToast
            person={person}
            sub={row.job_title}
            links={interviewLinks(row)}
            joinUrl={joinUrlOf(row.event_location)}
            onOpen={(to) => {
              toast.dismiss(toastId);
              navigate(to);
            }}
            onClose={() => toast.dismiss(toastId)}
          />
        ),
        { id: toastId, duration: ALERT_GRACE_MS },
      );
    }
    writeAlerted(alerted);
  }, [rows, nowMs, navigate]);
}
