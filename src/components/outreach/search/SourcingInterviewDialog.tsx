import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { AssistantRuntimeProvider, useLocalRuntime, type AssistantRuntime, type ChatModelAdapter, type ThreadMessageLike } from '@assistant-ui/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SkalrThread } from '@/components/assistant-ui/thread';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { CriteriaSection } from '@/components/missions/v3/cadrage/CriteriaSection';
import { JobFields, FieldInput } from '@/components/missions/v3/cadrage/JobSection';
import { JobMoreDetails } from '@/components/missions/v3/cadrage/JobMoreDetails';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { cn } from '@/lib/utils';
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
  const [source, setSource] = useState(initialSource);
  const [view, setView] = useState<'chat' | 'brief'>('chat');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const base = useBaseKonektState();
  const locked = useRef(false);
  const alive = useRef(true);
  const started = useRef(false);
  const briefRef = useRef(brief);
  const sourceRef = useRef(source);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const accepted = useRef<Message[]>([{ role: 'assistant', content: nextBriefQuestion(initialBrief) }]);
  briefRef.current = brief;
  sourceRef.current = source;

  const [initialMessages] = useState<readonly ThreadMessageLike[]>(() => [{ role: 'assistant', content: [{ type: 'text', text: nextBriefQuestion(initialBrief) }] }]);
  const adapter = useMemo<ChatModelAdapter>(() => ({
    async *run({ messages, abortSignal }) {
      const last = [...messages].reverse().find(message => message.role === 'user');
      const answer = last?.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim() ?? '';
      if (!answer || abortSignal.aborted || locked.current) return;
      const restoreAnswer = () => {
        const composer = runtimeRef.current?.thread.composer;
        if (composer && !composer.getState().text.trim()) composer.setText(answer);
      };
      locked.current = true;
      setBusy(true);
      setError(null);
      try {
        const currentBrief = briefRef.current;
        const { data, error: requestError } = await invokeWithCredits('sourcing-interview', 'sourcing_interview',
          { brief: currentBrief, message: answer, history: accepted.current.slice(-12), source: sourceRef.current },
          { modelOverride: 'claude-haiku-4-5', signal: abortSignal });
        if (!alive.current) return;
        if (abortSignal.aborted) { restoreAnswer(); return; }
        if (requestError) throw requestError;
        const turn = readInterviewTurn(data);
        const criteria = turn.patch.evaluation_criteria?.map(criterion => ({
          ...currentBrief.evaluation_criteria?.find(previous => previous.id === criterion.id), ...criterion,
        }));
        const next = { ...currentBrief, ...turn.patch,
          ...(turn.patch.client ? { client: { ...currentBrief.client, ...turn.patch.client } } : {}),
          ...(criteria ? { evaluation_criteria: criteria } : {}) };
        validateBriefRanges(next);
        briefRef.current = next;
        setBrief(next);
        accepted.current.push({ role: 'user', content: answer }, { role: 'assistant', content: turn.reply });
        yield { content: [{ type: 'text', text: turn.reply }] };
      } catch (failure) {
        if (!alive.current) return;
        restoreAnswer();
        if (abortSignal.aborted) return;
        const message = failure instanceof Error ? failure.message : 'L’échange a échoué. Votre réponse est conservée ; réessayez.';
        setError(message);
        yield { content: [{ type: 'text', text: message }] };
      } finally {
        locked.current = false;
        if (alive.current) setBusy(false);
      }
    },
  }), []);
  const runtime = useLocalRuntime(adapter, { initialMessages });
  runtimeRef.current = runtime;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const update = () => setValue(runtime.thread.composer.getState().text);
    update();
    return runtime.thread.composer.subscribe(update);
  }, [runtime]);
  useEffect(() => {
    const appendWhenReady = () => {
      if (!initialMessage.trim() || started.current || runtime.thread.getState().isLoading) return;
      started.current = true;
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text: initialMessage.trim() }] });
    };
    // Le runtime monte d'abord une placeholder ; son abonnement annonce le vrai fil prêt.
    const unsubscribe = runtime.thread.subscribe(appendWhenReady);
    appendWhenReady();
    return unsubscribe;
  }, [initialMessage, runtime]);

  const sourceUnavailable = source === 'database'
    ? !base.state || !base.isEnabled || !base.planAllows || base.isLoading || base.isError
    : !linkedinAvailable;
  const updateField = (patch: Partial<JobDetails>) => setBrief(previous => ({ ...previous, ...patch }));
  const confirm = async () => {
    if (locked.current || runtime.thread.getState().isRunning || runtime.thread.composer.getState().text.trim() || sourceUnavailable || (briefRef.current.title?.trim().length ?? 0) < 3) return;
    try {
      const current = briefRef.current;
      validateBriefRanges(current);
      if (current.evaluation_criteria?.some(criterion => !criterion.label?.trim())) throw new Error('Renseignez le libellé de chaque critère, ou retirez les critères vides.');
      locked.current = true; setSaving(true); setError(null);
      const answers = accepted.current.filter(message => message.role === 'user').map(message => message.content);
      const raw = [current.raw_brief, ...answers].filter(Boolean).join('\n');
      await onConfirm({ ...current, raw_brief: raw || current.raw_brief,
        brief_source: answers.length ? 'ai_structured' : initialBrief.brief_source ?? 'typed' }, sourceRef.current);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'L’enregistrement a échoué. Votre brouillon est conservé.'); }
    finally { locked.current = false; if (alive.current) setSaving(false); }
  };
  const close = () => {
    if (locked.current) return;
    if (runtime.thread.composer.getState().text.trim() || JSON.stringify(briefRef.current) !== JSON.stringify(initialBrief)) setConfirmClose(true);
    else onClose();
  };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent variant="fullscreen" className="h-[100dvh] overflow-hidden" onEscapeKeyDown={event => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.target instanceof Element && event.target.closest('[role="combobox"][aria-expanded="true"]')) return;
      if (view === 'brief') setView('chat'); else close();
    }}>
      <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-border px-4 py-3 text-left">
        {view === 'brief' && <Button variant="ghost" size="icon-sm" aria-label="Revenir à la conversation" onClick={() => setView('chat')}><ArrowLeft aria-hidden="true" /></Button>}
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm">Assistant · Sourcing</DialogTitle>
          <DialogDescription className="truncate text-xs">{brief.title?.trim() || 'Nouvelle recherche'}</DialogDescription>
        </div>
        <Popover>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={busy || saving} aria-label="Choisir la source de recherche">{source === 'database' ? 'Base Konekt' : 'LinkedIn'}<ChevronDown aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent className="max-h-[70dvh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto" align="end">
            <SourcingSourcePicker source={source} onChange={setSource} linkedinAvailable={linkedinAvailable} disabled={busy || saving} preserveDraft />
          </PopoverContent>
        </Popover>
        {view === 'chat' && <Button variant="ghost" size="sm" aria-label="Cadrage" className="max-sm:h-11 max-sm:w-11 max-sm:px-0" onClick={() => setView('brief')}><SlidersHorizontal aria-hidden="true" /><span className="hidden sm:inline">Cadrage</span></Button>}
        <Button variant="ghost" size="icon-sm" aria-label="Fermer l’assistant" disabled={busy || saving} onClick={close} className="max-md:h-11 max-md:w-11"><X aria-hidden="true" /></Button>
      </DialogHeader>
      <AssistantRuntimeProvider runtime={runtime}>
        <fieldset disabled={saving} aria-label="Dialogue de cadrage" className={cn('min-h-0 min-w-0 flex-1', view !== 'chat' && 'hidden')}>
          <SkalrThread fullWidth attachmentsEnabled={false} contextMode="sourcing"
            toolsSlot={<Button type="button" variant="ghost" size="icon-sm" aria-label="Modifier le cadrage et les critères" onClick={() => setView('brief')}><SlidersHorizontal aria-hidden="true" /></Button>}
            modelSlot={<CreditCostBadge actionId="sourcing_interview" modelId="claude-haiku-4-5" />} />
        </fieldset>
      </AssistantRuntimeProvider>
      {view === 'brief' && <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <fieldset disabled={busy || saving} className="mx-auto w-full max-w-4xl">
          <Tabs defaultValue="job">
            <TabsList aria-label="Informations de la recherche" className="mb-5 max-sm:h-11"><TabsTrigger value="job">Le poste</TabsTrigger><TabsTrigger value="criteria">Critères</TabsTrigger></TabsList>
            <TabsContent value="job" className="space-y-6"><JobFields jd={brief} updateField={updateField} readOnly={busy || saving} /><JobMoreDetails jd={brief} updateField={updateField} readOnly={busy || saving} /></TabsContent>
            <TabsContent value="criteria" className="space-y-6">
              <CriteriaSection jd={brief} updateField={updateField} readOnly={busy || saving} />
              {brief.evaluation_weights && <details><summary className="cursor-pointer py-2 text-sm font-medium max-sm:min-h-11">Pondération globale</summary>
                <div className="space-y-3 py-3"><p className="text-xs text-muted-foreground">Total attendu : 100 %. Vous pouvez aussi demander un ajustement dans le dialogue.</p>
                  {Object.entries(weightLabels).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-sm">{label}<FieldInput type="number" min={0} max={100} className="w-20" aria-label={`Poids ${label} en pourcentage`} value={brief.evaluation_weights?.[key as keyof typeof weightLabels] ?? 0} onChange={event => setBrief(previous => ({ ...previous, evaluation_weights: { ...previous.evaluation_weights!, [key]: Number(event.target.value) } }))} /></label>)}
                </div>
              </details>}
            </TabsContent>
          </Tabs>
        </fieldset>
      </div>}
      {error && <p role="alert" className="shrink-0 px-4 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        {confirmClose ? <div role="group" aria-label="Quitter le cadrage" className="flex w-full flex-wrap items-center gap-2"><p className="flex-1 text-sm">Quitter et perdre ce brouillon ?</p><Button variant="ghost" onClick={() => setConfirmClose(false)}>Continuer</Button><Button variant="secondary" onClick={onClose}>Quitter sans enregistrer</Button></div>
          : <><p className="text-xs text-muted-foreground">{value.trim() ? 'Envoyez votre réponse avant de valider.' : 'Le cadrage sera enregistré avant de lancer la recherche.'}</p>
            <Button variant="primary" className="max-sm:min-h-11" disabled={busy || saving || !!value.trim() || (brief.title?.trim().length ?? 0) < 3 || sourceUnavailable} onClick={() => void confirm()}>{saving && <Loader2 aria-hidden="true" className="animate-spin" />}Valider et chercher</Button></>}
      </div>
    </DialogContent>
  </Dialog>;
}
