import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AssistantMessageLayout, UserMessageLayout } from '@/components/assistant-ui/message-layout';
import { ASSISTANT_COMPOSER_CLASS, ASSISTANT_COMPOSER_INPUT_CLASS, ASSISTANT_COMPOSER_TOOLBAR_CLASS, ASSISTANT_SEND_CLASS } from '@/components/assistant-ui/composer-styles';
import { CriteriaSection } from '@/components/missions/v3/cadrage/CriteriaSection';
import { JobFields, FieldInput } from '@/components/missions/v3/cadrage/JobSection';
import { JobMoreDetails } from '@/components/missions/v3/cadrage/JobMoreDetails';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import type { JobDetails } from '@/types/jobDetails';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';
import { nextBriefQuestion, readInterviewTurn, validateBriefRanges } from '../../../../supabase/functions/sourcing-interview/contract';
import { SourcingSourcePicker, type SourcingSource } from './SourcingSourcePicker';

type Message = { role: 'user' | 'assistant'; content: string };
const weightLabels = { technical: 'Technique', soft_skill: 'Savoir-être', culture_fit: 'Culture', motivation: 'Motivation', experience: 'Expérience' };

export function SourcingInterviewDialog({ initialBrief = {}, initialMessage = '', initialSource, linkedinAvailable, onClose, onConfirm }: {
  initialBrief?: JobDetails; initialMessage?: string; initialSource: SourcingSource; linkedinAvailable: boolean;
  onClose: () => void; onConfirm: (brief: JobDetails, source: SourcingSource) => Promise<void>;
}) {
  const [brief, setBrief] = useState<JobDetails>(() => structuredClone(initialBrief));
  const base = useBaseKonektState();
  const [source, setSource] = useState(initialSource);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: nextBriefQuestion(initialBrief) }]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const started = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy]);

  async function send(answer = value.trim()) {
    if (!answer || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const { data, error: requestError } = await invokeWithCredits('sourcing-interview', 'sourcing_interview',
        { brief, message: answer, history: messages.slice(-12), source }, { modelOverride: 'claude-haiku-4-5' });
      if (requestError) throw requestError;
      const turn = readInterviewTurn(data);
      const criteria = turn.patch.evaluation_criteria?.map(c => ({
        ...brief.evaluation_criteria?.find(previous => previous.id === c.id), ...c,
      }));
      const next = { ...brief, ...turn.patch, ...(turn.patch.client ? { client: { ...brief.client, ...turn.patch.client } } : {}), ...(criteria ? { evaluation_criteria: criteria } : {}) };
      validateBriefRanges(next);
      if (!alive.current) return;
      setBrief(next);
      setMessages(previous => [...previous, { role: 'user', content: answer }, { role: 'assistant', content: turn.reply }]);
      setValue('');
    } catch (err) {
      if (alive.current) { setError(err instanceof Error ? err.message : 'Le cadrage a échoué. Réessayez.'); setValue(answer); }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => {
    if (initialMessage.trim() && !started.current) { started.current = true; void send(initialMessage.trim()); }
    // A new dialog instance owns one initial request, including in StrictMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceUnavailable = source === 'database'
    ? !base.state || !base.isEnabled || !base.planAllows || base.isLoading || base.isError
    : !linkedinAvailable;
  const updateField = (patch: Partial<JobDetails>) => setBrief(previous => ({ ...previous, ...patch }));
  const confirm = async () => {
    if (locked.current || value.trim() || sourceUnavailable || (brief.title?.trim().length ?? 0) < 3) return;
    try {
      validateBriefRanges(brief);
      if (brief.evaluation_criteria?.some(criterion => !criterion.label?.trim())) throw new Error('Renseignez le libellé de chaque critère, ou retirez les critères vides.');
      locked.current = true; setSaving(true); setError(null);
      const raw = [brief.raw_brief, ...messages.filter(m => m.role === 'user').map(m => m.content)].filter(Boolean).join('\n');
      await onConfirm({ ...brief, raw_brief: raw || brief.raw_brief, brief_source: messages.some(m => m.role === 'user') ? 'ai_structured' : initialBrief.brief_source ?? 'typed' }, source);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'L’enregistrement a échoué. Votre brouillon est conservé.'); }
    finally { locked.current = false; if (alive.current) setSaving(false); }
  };
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => { if (locked.current) return; if (value.trim() || JSON.stringify(brief) !== JSON.stringify(initialBrief)) setConfirmClose(true); else onClose(); };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[95dvh] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-y-auto p-4 sm:p-6" onEscapeKeyDown={event => { if (event.defaultPrevented) return; event.preventDefault(); close(); }}>
      <DialogHeader>
        <DialogTitle>Cadrer la recherche</DialogTitle>
        <DialogDescription>Précisez le poste avec l’assistant, ajustez les critères, puis validez pour chercher. Le cadrage existant est repris.</DialogDescription>
      </DialogHeader>
      <SourcingSourcePicker source={source} onChange={setSource} linkedinAvailable={linkedinAvailable} disabled={busy || saving} preserveDraft />
      <div className="grid shrink-0 gap-6 md:grid-cols-2">
        <section aria-label="Dialogue de cadrage" className="flex min-h-0 flex-col gap-3">
          <div ref={log} role="log" tabIndex={0} aria-label="Conversation de cadrage" aria-live="polite" className="max-h-[36dvh] min-h-32 space-y-5 overflow-y-auto px-1 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {messages.map((message, i) => message.role === 'assistant'
              ? <AssistantMessageLayout key={i}><p className="whitespace-pre-wrap break-words text-md leading-relaxed text-foreground">{message.content}</p></AssistantMessageLayout>
              : <UserMessageLayout key={i}><p className="whitespace-pre-wrap break-words">{message.content}</p></UserMessageLayout>)}
            {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Mise à jour du cadrage…</p>}
          </div>
          <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-2">
            <label htmlFor="sourcing-answer" className="sr-only">Votre réponse ou votre ajustement</label>
            <div className={ASSISTANT_COMPOSER_CLASS}>
              <textarea id="sourcing-answer" className={ASSISTANT_COMPOSER_INPUT_CLASS} value={value} onChange={e => setValue(e.target.value)} disabled={busy || saving} maxLength={6000} rows={3}
                placeholder="Précisez le profil ou demandez un ajustement des critères…"
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
              <div className={ASSISTANT_COMPOSER_TOOLBAR_CLASS}>
                <span className="text-xs text-muted-foreground">1 crédit minimum par échange IA.</span>
                <button type="submit" aria-label="Envoyer" disabled={busy || saving || !value.trim()} className={ASSISTANT_SEND_CLASS}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          </form>
        </section>
        <fieldset disabled={busy || saving} tabIndex={0} className="min-w-0 space-y-6 md:max-h-[48dvh] md:overflow-y-auto md:pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <legend className="mb-3 text-md font-semibold">Votre recherche</legend>
          <JobFields jd={brief} updateField={updateField} readOnly={busy || saving} className="sm:grid-cols-2" />
          <CriteriaSection jd={brief} updateField={updateField} readOnly={busy || saving} />
          <p className="text-xs text-muted-foreground">Les critères pondèrent la notation ; les filtres décident quels profils sont trouvés.</p>
          <JobMoreDetails jd={brief} updateField={updateField} readOnly={busy || saving} />
          {brief.evaluation_weights && <details>
            <summary className="cursor-pointer py-2 text-sm font-medium max-sm:min-h-11">Pondération globale</summary>
            <div className="space-y-3 pb-2">
              <p className="text-xs text-muted-foreground">Total attendu : 100 %. Vous pouvez aussi demander un ajustement dans le dialogue.</p>
              {Object.entries(weightLabels).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-sm">{label}
                <FieldInput type="number" min={0} max={100} className="w-20" aria-label={`Poids ${label} en pourcentage`} value={brief.evaluation_weights?.[key as keyof typeof weightLabels] ?? 0}
                  onChange={e => setBrief(previous => ({ ...previous, evaluation_weights: { ...previous.evaluation_weights!, [key]: Number(e.target.value) } }))} />
              </label>)}
            </div>
          </details>}
        </fieldset>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {confirmClose ? <div role="group" aria-label="Quitter le cadrage" className="flex flex-wrap items-center gap-2 border-t border-border pt-3"><p className="flex-1 text-sm">Quitter et perdre ce brouillon ?</p><Button variant="ghost" onClick={() => setConfirmClose(false)}>Continuer</Button><Button variant="secondary" onClick={onClose}>Quitter sans enregistrer</Button></div>
        : <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="max-w-xl text-sm text-muted-foreground">{value.trim() ? 'Envoyez votre réponse avant de valider.' : 'La validation enregistre le cadrage, génère les filtres et lance la recherche. La génération consomme des crédits IA.'}</p>
          <Button variant="primary" className="max-sm:min-h-11" disabled={busy || saving || !!value.trim() || (brief.title?.trim().length ?? 0) < 3 || sourceUnavailable} onClick={() => void confirm()}>{saving && <Loader2 aria-hidden="true" className="animate-spin" />}Valider et chercher</Button>
        </div>}
    </DialogContent>
  </Dialog>;
}
