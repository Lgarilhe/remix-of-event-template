/* eslint-disable react-refresh/only-export-components -- Frontières du harnais sans fournisseur réel. */
export interface AudioQA {
  accesses: string[];
  microphone: number;
  display: number;
  recordings: number;
  sockets: number;
}
declare global { interface Window { interviewAudioQA: AudioQA } }

function forbidden(name: string): never {
  window.interviewAudioQA.accesses.push(name);
  throw new Error(`Frontière externe interdite avant l'enregistrement : ${name}`);
}

/** Enregistrer l'accès avant de lever l'erreur : un catch ne peut pas masquer une régression. */
export const supabase = new Proxy({}, { get(_target, key) { return forbidden(`supabase.${String(key)}`); } });
export const invokeEdgeFunction = () => forbidden('invokeEdgeFunction');
export const invokeWithCredits = () => forbidden('invokeWithCredits');
export const getActiveOrganizationId = () => forbidden('getActiveOrganizationId');
export const isInsufficientCreditsError = () => false;
export const ModelPicker = () => null;
export const CreateEventModal = ({ open }: { open: boolean }) => open ? forbidden('CreateEventModal') : null;
export const InterviewFollowUp = () => forbidden('InterviewFollowUp');
