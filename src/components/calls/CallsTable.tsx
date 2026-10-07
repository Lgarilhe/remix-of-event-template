import { useMemo, useState } from 'react';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Search } from 'lucide-react';
import { EmptyState } from '@/components/layout';
import { RecruiterTag } from '@/components/calls/RecruiterTag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RecruiterRef } from '@/lib/callRecruiter';
import {
  NO_FILTERS,
  callStatusLabel,
  filterCalls,
  type CallFilters,
  type DirectionFilter,
  type MatchedFilter,
  type OutcomeFilter,
} from '@/lib/phoneCallFilters';
import { tagsInUse, type InsightLight } from '@/lib/phoneCallInsightModel';
import { callTitle, formatPhoneNumber } from '@/lib/phoneCallGroups';
import { formatTalkTime } from '@/lib/phoneCallStats';
import type { AttachedCandidate, PhoneCall } from '@/lib/phoneCalls';

type Resolve = (email: string | null | undefined, name: string | null | undefined) => RecruiterRef | null;

const PAGE = 50;

const formatWhen = (iso: string | null) => {
  if (!iso) return 'date inconnue';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const recruiterKeyOf = (resolve: Resolve) => (call: PhoneCall): string | null => {
  const r = resolve(call.agentEmail, call.agentName);
  return r ? (r.userId ?? `aircall:${r.name}`) : null;
};

const FilterSelect = <T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) => (
  <Select value={value} onValueChange={(v) => onChange(v as T)}>
    <SelectTrigger aria-label={label} className="h-9 w-auto min-w-[8.5rem] gap-2 text-sm">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/**
 * Tous les appels de la période, du plus récent au plus ancien, avec leurs
 * filtres. Une ligne ouvre le détail de l'appel. Le visage est celui du candidat
 * quand le numéro est rattaché, sinon le sens de l'appel.
 */
export const CallsTable = ({
  calls,
  attached,
  resolveRecruiter,
  recruiterOptions,
  insights,
  onOpen,
}: {
  calls: PhoneCall[];
  attached: Map<string, AttachedCandidate>;
  resolveRecruiter: Resolve;
  /** Recruteurs proposés au filtre (vide : pas de filtre par recruteur). */
  recruiterOptions: Array<{ key: string; name: string }>;
  /** Analyse des appels (lot A5), par appel : ses étiquettes se montrent et se filtrent. */
  insights: ReadonlyMap<string, InsightLight>;
  onOpen: (call: PhoneCall) => void;
}) => {
  const [filters, setFilters] = useState<CallFilters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const set = <K extends keyof CallFilters>(key: K, value: CallFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setLimit(PAGE);
  };

  const recruiterKey = useMemo(() => recruiterKeyOf(resolveRecruiter), [resolveRecruiter]);
  const tagsOf = useMemo(() => (call: PhoneCall): ReadonlyArray<string> => insights.get(call.id)?.tags ?? [], [insights]);
  // Les étiquettes proposées au filtre : celles des appels de la période, seulement s'il y en a.
  const tagOptions = useMemo(() => tagsInUse(calls.map((c) => insights.get(c.id)).filter((l): l is InsightLight => !!l)), [calls, insights]);
  const filtered = useMemo(() => filterCalls(calls, filters, { attached, recruiterKey, tagsOf }), [calls, filters, attached, recruiterKey, tagsOf]);
  const shown = filtered.slice(0, limit);
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filters.query}
            onChange={(e) => set('query', e.target.value)}
            placeholder="Nom ou numéro"
            aria-label="Chercher un appel par nom ou numéro"
            className="h-9 pl-8"
            autoComplete="off"
          />
        </div>
        <FilterSelect<DirectionFilter>
          label="Sens de l'appel"
          value={filters.direction}
          onChange={(v) => set('direction', v)}
          options={[{ value: 'all', label: 'Tous les sens' }, { value: 'inbound', label: 'Reçus' }, { value: 'outbound', label: 'Émis' }]}
        />
        <FilterSelect<OutcomeFilter>
          label="Issue de l'appel"
          value={filters.outcome}
          onChange={(v) => set('outcome', v)}
          options={[{ value: 'all', label: 'Toutes les issues' }, { value: 'done', label: 'Décrochés' }, { value: 'missed', label: 'Manqués' }, { value: 'voicemail', label: 'Messagerie' }]}
        />
        <FilterSelect<MatchedFilter>
          label="Rattachement à un candidat"
          value={filters.matched}
          onChange={(v) => set('matched', v)}
          options={[{ value: 'all', label: 'Tous' }, { value: 'attached', label: 'Rattachés' }, { value: 'unattached', label: 'Non rattachés' }]}
        />
        {recruiterOptions.length > 1 && (
          <FilterSelect<string>
            label="Recruteur"
            value={filters.recruiter}
            onChange={(v) => set('recruiter', v)}
            options={[{ value: 'all', label: 'Tous les recruteurs' }, ...recruiterOptions.map((r) => ({ value: r.key, label: r.name }))]}
          />
        )}
        {tagOptions.length > 0 && (
          <FilterSelect<string>
            label="Étiquette de l'analyse"
            value={filters.tag}
            onChange={(v) => set('tag', v)}
            options={[{ value: 'all', label: 'Toutes les étiquettes' }, ...tagOptions.map((t) => ({ value: t, label: t }))]}
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Aucun appel ne correspond"
          headingLevel={2}
          description={filtering ? 'Essayez avec d\'autres filtres.' : 'Aucun appel sur cette période.'}
          action={filtering ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { setFilters(NO_FILTERS); setLimit(PAGE); }} className="min-h-11 md:min-h-0">
              Effacer les filtres
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((call) => {
              const known = call.numberE164 ? attached.get(call.numberE164) : undefined;
              const title = callTitle(call, known);
              const Icon = call.outcome === 'missed' ? PhoneMissed : call.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
              const recruiter = resolveRecruiter(call.agentEmail, call.agentName);
              const number = call.numberE164 ? formatPhoneNumber(call.numberE164) : null;
              const tags = (insights.get(call.id)?.tags ?? []).slice(0, 3);
              return (
                <li key={call.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpen(call)}
                    className="h-auto w-full justify-start gap-3 whitespace-normal rounded-lg px-0 py-3 text-left font-normal hover:bg-muted/40 hover:text-foreground active:scale-100 max-md:min-h-14"
                  >
                    {known ? (
                      <PersonAvatar name={known.name ?? title} src={known.avatarUrl} candidateId={known.candidateId} size={36} />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate text-sm font-medium text-foreground">{title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {number && title !== number ? `${number} · ` : ''}
                        {formatWhen(call.startedAt)} · {callStatusLabel(call)}
                        {call.talkSeconds > 0 ? ` · ${formatTalkTime(call.talkSeconds)}` : ''}
                      </span>
                      {(recruiter || tags.length > 0) && (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {recruiter && <RecruiterTag recruiter={recruiter} size={18} />}
                          {tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">{tag}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
          {filtered.length > shown.length && (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)} className="min-h-11 md:min-h-0">
                Afficher plus ({filtered.length - shown.length})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
