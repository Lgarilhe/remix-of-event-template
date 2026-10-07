import { useMemo } from 'react';
import { Clock, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { EmptyState, StatGrid, StatTile } from '@/components/layout';
import { RecruiterTag } from '@/components/calls/RecruiterTag';
import type { RecruiterRef } from '@/lib/callRecruiter';
import type { AttachedCandidate, PhoneCall } from '@/lib/phoneCalls';
import { formatPhoneNumber } from '@/lib/phoneCallGroups';
import {
  bestHours,
  computeStats,
  formatPercent,
  formatTalkTime,
  missedToCallBack,
  statsByRecruiter,
  type DayBucket,
} from '@/lib/phoneCallStats';
import { plural } from '@/lib/plural';

type Resolve = (email: string | null | undefined, name: string | null | undefined) => RecruiterRef | null;

const dayLabel = (day: string) => {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
};

const dayTitle = (d: DayBucket) => {
  const date = new Date(`${d.day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (d.total === 0) return `${date} : aucun appel`;
  const parts = [d.answered > 0 && `${d.answered} décroché${d.answered > 1 ? 's' : ''}`, d.missed > 0 && `${d.missed} manqué${d.missed > 1 ? 's' : ''}`, d.voicemail > 0 && `${d.voicemail} sur messagerie`].filter(Boolean);
  return `${date} : ${plural(d.total, 'appel')} (${parts.join(', ')})`;
};

/** Appels par jour : décrochés en plein, manqués en clair. Aucune bibliothèque, aucune couleur : de simples barres. */
const DayBars = ({ perDay }: { perDay: DayBucket[] }) => {
  const max = Math.max(1, ...perDay.map((d) => d.total));
  const dense = perDay.length > 31;
  return (
    <div>
      <div role="img" aria-label="Nombre d'appels par jour" className={`flex h-28 items-end ${dense ? 'gap-px' : 'gap-0.5 sm:gap-1'}`}>
        {perDay.map((d) => (
          <div key={d.day} title={dayTitle(d)} className="flex h-full min-w-[2px] flex-1 flex-col justify-end">
            {d.total > 0 && (
              <div className="flex flex-col overflow-hidden rounded-sm" style={{ height: `${(d.total / max) * 100}%` }}>
                {d.missed > 0 && <div className="bg-foreground/25" style={{ flexGrow: d.missed }} />}
                {d.voicemail > 0 && <div className="bg-foreground/50" style={{ flexGrow: d.voicemail }} />}
                {d.answered > 0 && <div className="bg-foreground" style={{ flexGrow: d.answered }} />}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{dayLabel(perDay[0].day)}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground" aria-hidden="true" />Décrochés</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground/50" aria-hidden="true" />Messagerie</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground/25" aria-hidden="true" />Manqués</span>
        </span>
        <span>{dayLabel(perDay[perDay.length - 1].day)}</span>
      </div>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    {children}
  </section>
);

/**
 * Vue d'ensemble des appels : ce qui se passe, par qui, et ce qui attend un
 * rappel. Tout est calculé dans le navigateur à partir des appels de la période
 * (src/lib/phoneCallStats.ts) ; rien n'est affiché à zéro.
 */
export const CallsOverview = ({
  calls,
  attached,
  days,
  resolveRecruiter,
}: {
  calls: PhoneCall[];
  attached: Map<string, AttachedCandidate>;
  days: number;
  resolveRecruiter: Resolve;
}) => {
  const stats = useMemo(() => computeStats(calls, { days }), [calls, days]);
  const recruiters = useMemo(() => statsByRecruiter(calls, resolveRecruiter), [calls, resolveRecruiter]);
  const callBack = useMemo(() => missedToCallBack(calls), [calls]);
  const hours = useMemo(() => bestHours(stats.perHour), [stats.perHour]);

  if (stats.total === 0) {
    return (
      <EmptyState
        illustration="conversation"
        title="Aucun appel sur cette période"
        headingLevel={2}
        description="Les appels terminés de votre compte Aircall apparaissent ici dès qu'ils sont reçus."
      />
    );
  }

  const answerRate = formatPercent(stats.answerRate);
  const reachRate = formatPercent(stats.reachRate);

  return (
    <div className="space-y-10">
      <StatGrid cols={{ base: 2, md: 4 }}>
        <StatTile
          label="Appels"
          value={stats.total}
          icon={Phone}
          trailing={<span className="text-xs text-muted-foreground">{stats.inbound > 0 && `${stats.inbound} reçus`}{stats.inbound > 0 && stats.outbound > 0 && ' · '}{stats.outbound > 0 && `${stats.outbound} émis`}</span>}
        />
        {answerRate && <StatTile label="Appels reçus décrochés" value={answerRate} icon={PhoneIncoming} />}
        {reachRate && <StatTile label="Appels émis décrochés" value={reachRate} icon={PhoneOutgoing} />}
        {stats.talkSeconds > 0 && (
          <StatTile
            label="Temps de conversation"
            value={formatTalkTime(stats.talkSeconds)}
            icon={Clock}
            trailing={stats.avgTalkSeconds !== null ? <span className="text-xs text-muted-foreground">moy. {formatTalkTime(stats.avgTalkSeconds)}</span> : undefined}
          />
        )}
      </StatGrid>

      <Section title="Appels par jour">
        <DayBars perDay={stats.perDay} />
      </Section>

      {callBack.length > 0 && (
        <Section title={`Appels manqués à rappeler (${callBack.length})`}>
          <ul className="divide-y divide-border">
            {callBack.map((row) => {
              const known = attached.get(row.numberE164);
              const title = known?.name ?? row.contactName ?? formatPhoneNumber(row.numberE164);
              const showNumber = title !== formatPhoneNumber(row.numberE164);
              return (
                <li key={row.numberE164} className="flex items-center gap-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                    <PhoneMissed className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">
                      {showNumber ? `${formatPhoneNumber(row.numberE164)} · ` : ''}
                      {plural(row.missedCount, 'appel manqué', 'appels manqués')}, le dernier le{' '}
                      {new Date(row.lastMissedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à{' '}
                      {new Date(row.lastMissedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {recruiters.length > 0 && (
        <Section title="Par recruteur">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-normal">Recruteur</th>
                <th className="pb-2 text-right font-normal">Appels</th>
                <th className="pb-2 text-right font-normal">Décrochés</th>
                <th className="hidden pb-2 text-right font-normal sm:table-cell">Conversation</th>
                <th className="hidden pb-2 text-right font-normal sm:table-cell">Moyenne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recruiters.map((row) => (
                <tr key={row.key}>
                  <td className="py-2.5 pr-3">
                    <RecruiterTag recruiter={{ userId: row.isMember ? row.key : null, name: row.name, isMember: row.isMember }} size={24} />
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-foreground">{row.calls}</td>
                  <td className="py-2.5 text-right tabular-nums text-foreground">{row.answered > 0 ? row.answered : ''}</td>
                  <td className="hidden py-2.5 text-right tabular-nums text-foreground sm:table-cell">{row.talkSeconds > 0 ? formatTalkTime(row.talkSeconds) : ''}</td>
                  <td className="hidden py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{row.avgTalkSeconds !== null ? formatTalkTime(row.avgTalkSeconds) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {hours.length > 0 && (
        <Section title="Quand ça décroche">
          <ul className="space-y-1.5 text-sm text-foreground">
            {hours.map((h) => (
              <li key={h.hour}>
                <span className="font-medium tabular-nums">{h.hour} h</span>
                <span className="text-muted-foreground"> : {formatPercent(h.rate)} des appels émis sont décrochés ({plural(h.calls, 'appel')}).</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};
