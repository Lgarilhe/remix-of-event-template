import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Link2, Mic, PhoneCall, Target, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SceneHeading } from '../parts/SceneHeading';

export interface FinaleStat {
  key: string;
  value: number | null;
  label: string;
  /** Sans nombre : une coche et un mot (LinkedIn connecté). */
  check?: boolean;
}

interface Teaser {
  key: string;
  icon: LucideIcon;
  title: string;
  line: string;
}

/**
 * Ce qui attend l'utilisateur dans l'application. Uniquement des fonctions en
 * ligne : une fonction qui n'existe pas encore ne se teasera pas ici.
 */
const TEASERS: Teaser[] = [
  {
    key: 'interview',
    icon: Mic,
    title: "Assistant d'entretien en direct",
    line: "Il écoute l'entretien en visio, même avec un casque, vous suggère les questions et prépare le compte rendu et la suite.",
  },
  {
    key: 'calls',
    icon: PhoneCall,
    title: 'Appels transcrits et analysés',
    line: 'Avec Aircall, chaque appel est transcrit, résumé, étiqueté (disponibilité, rémunération, télétravail) et relié au bon candidat.',
  },
  {
    key: 'url',
    icon: Link2,
    title: 'Une adresse web suffit',
    line: "Collez le lien d'une offre ou d'une société : les missions se créent à partir de ses offres.",
  },
  {
    key: 'now',
    icon: Target,
    title: 'La carte « Maintenant »',
    line: 'Sur chaque mission, la prochaine action à faire et ce qui bloque, sans fouiller.',
  },
];

interface Props {
  firstName: string;
  jobTitle: string;
  missionReady: boolean;
  linkedInConnected: boolean;
  stats: FinaleStat[];
  onOpenMission: () => void;
  onDashboard: () => void;
}

/**
 * La fin : ce qui existe maintenant, puis ce qui attend dans l'application.
 * Une seule action principale : ouvrir la mission, là où la recherche complète attend.
 */
export const SceneFinale: React.FC<Props> = ({ firstName, jobTitle, missionReady, linkedInConnected, stats, onOpenMission, onDashboard }) => (
  <div className="space-y-8">
    <SceneHeading title={firstName ? `C'est prêt, ${firstName}.` : "C'est prêt."}>
      <p>
        {missionReady
          ? `Votre mission « ${jobTitle} » est créée, avec son brief et ses filtres. Il reste à choisir qui contacter.`
          : 'Votre espace est prêt. Il reste à créer votre première mission.'}
      </p>
    </SceneHeading>

    {stats.length > 0 && (
      <ul className={stats.length === 4 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'} aria-label="Ce qui a été mis en place">
        {stats.map((s) => (
          <li key={s.key} className="rounded-xl border border-border bg-card p-4">
            <p className="flex h-8 items-center text-2xl font-semibold tabular-nums text-foreground">
              {s.check ? <Check className="h-6 w-6 text-success" aria-hidden="true" /> : (s.value ?? 0).toLocaleString('fr-FR')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </li>
        ))}
      </ul>
    )}

    <section aria-labelledby="finale-teasers" className="space-y-3">
      <h2 id="finale-teasers" className="text-base font-semibold text-foreground">
        Ce qui vous attend
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TEASERS.map((t) => (
          <li key={t.key} className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <t.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-foreground-secondary">{t.line}</p>
          </li>
        ))}
      </ul>
    </section>

    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onOpenMission} className="min-h-11 md:min-h-0">
          {missionReady ? 'Ouvrir ma mission' : 'Créer ma première mission'}
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button variant="ghost" onClick={onDashboard} className="min-h-11 text-muted-foreground md:min-h-0">
          Aller au tableau de bord
        </Button>
      </div>
      {!linkedInConnected && (
        <p className="max-w-md text-sm text-foreground-secondary">
          LinkedIn n'est pas encore connecté : la recherche et les messages en ont besoin.{' '}
          <Link
            to="/settings/account/connections"
            className="rounded-md font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Le connecter dans les Paramètres
          </Link>
        </p>
      )}
      <p className="text-xs text-muted-foreground">La liste « Premiers pas » de la barre latérale garde la suite : elle se coche au fil de votre usage.</p>
    </div>
  </div>
);
