import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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

  const confirm = async () => {
    if (locked.current || value.trim() || (source === 'database' && (!base.isEnabled || base.isLoading || base.isError))) return;
    try {
      validateBriefRanges(brief);
      locked.current = true; setSaving(true); setError(null);
      const raw = [initialBrief.raw_brief, ...messages.filter(m => m.role === 'user').map(m => m.content)].filter(Boolean).join('\n').slice(0, 12000);
      await onConfirm({ ...brief, raw_brief: raw || brief.raw_brief, brief_source: messages.some(m => m.role === 'user') ? 'ai_structured' : initialBrief.brief_source ?? 'typed' }, source);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'L’enregistrement a échoué. Votre brouillon est conservé.'); }
    finally { locked.current = false; if (alive.current) setSaving(false); }
  };
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => { if (locked.current) return; if (value.trim() || JSON.stringify(brief) !== JSON.stringify(initialBrief)) setConfirmClose(true); else onClose(); };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[95dvh] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-y-auto p-4 sm:p-6" onEscapeKeyDown={event => { event.preventDefault(); close(); }}>
      <DialogHeader>
        <DialogTitle>Cadrer la recherche</DialogTitle>
        <DialogDescription>Précisez le poste avec l’assistant, ajustez les critères, puis validez pour chercher. Le cadrage existant est repris.</DialogDescription>
      </DialogHeader>
      <SourcingSourcePicker source={source} onChange={setSource} linkedinAvailable={linkedinAvailable} disabled={busy || saving} preserveDraft />
      <div className="grid shrink-0 gap-6 md:grid-cols-2">
        <section aria-label="Dialogue de cadrage" className="flex min-h-0 flex-col gap-3">
          <div ref={log} role="log" tabIndex={0} aria-label="Conversation de cadrage" aria-live="polite" className="max-h-[36dvh] min-h-32 space-y-4 overflow-y-auto rounded-xl bg-muted p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {messages.map((m, i) => <div key={i} className="space-y-1"><p className="text-xs font-medium text-foreground">{m.role === 'user' ? 'Vous' : 'Assistant'}</p><p className="whitespace-pre-wrap break-words text-sm text-foreground">{m.content}</p></div>)}
            {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Mise à jour du cadrage…</p>}
          </div>
          <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-2">
            <label htmlFor="sourcing-answer" className="text-sm font-medium">Votre réponse ou votre ajustement</label>
            <Textarea id="sourcing-answer" value={value} onChange={e => setValue(e.target.value)} disabled={busy || saving} maxLength={6000} rows={3}
              placeholder="Par exemple : React est indispensable, le secteur est un bonus. Donnez plus de poids à l’expérience."
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">1 crédit minimum par échange IA.</span>
              <Button type="submit" variant="secondary" disabled={busy || saving || !value.trim()} className="min-h-11"><Send aria-hidden="true" />Envoyer</Button></div>
          </form>
        </section>
        <fieldset disabled={busy || saving} className="min-w-0 space-y-3">
          <legend className="mb-3 text-base font-semibold">Votre recherche</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['title', 'Poste'], ['location', 'Lieu']] as const).map(([key, label]) => <label key={key} className="space-y-1 text-sm">{label}<Input aria-label={label} value={brief[key] ?? ''} onChange={e => setBrief(b => ({ ...b, [key]: e.target.value }))} /></label>)}
          </div>
          <label className="block space-y-1 text-sm">Compétences indispensables<Input aria-label="Compétences indispensables" value={(brief.skills_must_have ?? []).join(', ')} onChange={e => setBrief(b => ({ ...b, skills_must_have: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }))} /></label>
          <p className="text-xs text-muted-foreground">Séparez les compétences par des virgules. Les critères pondèrent la notation ; les filtres décident quels profils sont trouvés.</p>
          <div className="max-h-[25dvh] space-y-3 overflow-y-auto">
            {(brief.evaluation_criteria ?? []).map(c => <div key={c.id} className="space-y-1 border-t border-border pt-2">
              <p className="text-sm font-medium">{c.label}</p>
              {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Select disabled={busy || saving} value={String(c.weight)} onValueChange={value => setBrief(b => ({ ...b, evaluation_criteria: b.evaluation_criteria?.map(item => item.id === c.id ? { ...item, weight: Number(value) as 1 | 2 | 3 } : item) }))}>
                  <SelectTrigger aria-label={`Importance de ${c.label}`} className="min-h-11 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1">Bonus</SelectItem><SelectItem value="2">Important</SelectItem><SelectItem value="3">Indispensable</SelectItem></SelectContent>
                </Select>
                <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox aria-label={`Éliminatoire : ${c.label}`} checked={!!c.deal_breaker} onCheckedChange={checked => setBrief(b => ({ ...b, evaluation_criteria: b.evaluation_criteria?.map(item => item.id === c.id ? { ...item, deal_breaker: checked === true } : item) }))} />Éliminatoire</label>
              </div>
            </div>)}
          </div>
          <details><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Contexte et pondération globale</summary>
            <div className="space-y-3 pb-2">
              <Textarea aria-label="Contexte du poste" rows={3} value={brief.context ?? ''} onChange={e => setBrief(b => ({ ...b, context: e.target.value }))} />
              {brief.evaluation_weights && <><p className="text-xs text-muted-foreground">Total attendu : 100 %. Vous pouvez aussi demander un ajustement dans le dialogue.</p>
                {Object.entries(weightLabels).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-sm">{label}<Input type="number" min={0} max={100} className="w-20" aria-label={`Poids ${label} en pourcentage`} value={brief.evaluation_weights?.[key as keyof typeof weightLabels] ?? 0} onChange={e => setBrief(b => ({ ...b, evaluation_weights: { ...b.evaluation_weights!, [key]: Number(e.target.value) } }))} /></label>)}</>}
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{[brief.client?.name, brief.client?.sector, brief.client?.culture_notes, brief.contract_type, brief.remote_policy, brief.seniority,
                brief.experience_min != null ? `Expérience minimum : ${brief.experience_min} ans` : '',
                brief.salary_min != null ? `Budget minimum : ${brief.salary_min} ${brief.salary_currency ?? '€'}` : '',
                brief.salary_max != null ? `Budget maximum : ${brief.salary_max} ${brief.salary_currency ?? '€'}` : '',
                brief.skills_should_have?.length ? `Souhaitées : ${brief.skills_should_have.join(', ')}` : '',
                brief.skills_nice_to_have?.length ? `Bonus : ${brief.skills_nice_to_have.join(', ')}` : '',
                brief.skills_to_avoid?.length ? `À éviter : ${brief.skills_to_avoid.join(', ')}` : '',
                brief.languages?.map(l => `${l.language} (${l.level})`).join(', '),
                brief.target_companies?.flatMap(c => c.companies.map(v => v.name)).join(', '),
                brief.mission_description].filter(Boolean).join('\n')}</p>
            </div>
          </details>
        </fieldset>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {confirmClose ? <div role="group" aria-label="Quitter le cadrage" className="flex flex-wrap items-center gap-2 border-t border-border pt-3"><p className="flex-1 text-sm">Quitter et perdre ce brouillon ?</p><Button variant="ghost" onClick={() => setConfirmClose(false)}>Continuer</Button><Button variant="secondary" onClick={onClose}>Quitter sans enregistrer</Button></div>
        : <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="max-w-xl text-sm text-muted-foreground">{value.trim() ? 'Envoyez votre réponse avant de valider.' : 'La validation enregistre le cadrage, génère les filtres et lance la recherche. La génération consomme des crédits IA.'}</p>
          <Button variant="primary" className="min-h-11" disabled={busy || saving || !!value.trim() || (brief.title?.trim().length ?? 0) < 3 || (source === 'database' && (!base.isEnabled || base.isLoading || base.isError))} onClick={() => void confirm()}>{saving && <Loader2 aria-hidden="true" className="animate-spin" />}Valider et chercher</Button>
        </div>}
    </DialogContent>
  </Dialog>;
}
