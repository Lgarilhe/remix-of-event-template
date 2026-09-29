import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountUp } from '../stage/CountUp';
import { SceneHeading } from '../parts/SceneHeading';
import { Confetti } from '../stage/Confetti';
import { SPRING_DROP, SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

export interface FinaleStat {
  key: string;
  value: number | null;
  label: string;
  /** Sans nombre : une coche et un mot (LinkedIn connecté). */
  check?: boolean;
}

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
 * La fin : le badge s'est posé sur la carte, la salve de papiers part, et les
 * chiffres disent ce qui existe maintenant. Une seule action principale :
 * ouvrir la mission, là où la recherche complète attend.
 */
export const SceneFinale: React.FC<Props> = ({ firstName, jobTitle, missionReady, linkedInConnected, stats, onOpenMission, onDashboard }) => {
  const d = useDelay();
  return (
    <div className="space-y-8">
      <Confetti fire originX={0.3} originY={0.4} />
      <SceneHeading eyebrow="Terminé" title={firstName ? `C'est prêt, ${firstName}.` : "C'est prêt."} accent={[firstName || 'prêt']} delay={d(0.5)}>
        <p>
          {missionReady
            ? `Votre mission « ${jobTitle} » est créée, avec son brief et ses filtres. Il reste à choisir qui contacter.`
            : 'Votre espace est prêt. Il reste à créer votre première mission.'}
        </p>
      </SceneHeading>

      {stats.length > 0 && (
        <ul className={stats.length === 4 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'} aria-label="Ce qui a été mis en place">
          {stats.map((s, i) => (
            <motion.li
              key={s.key}
              initial={{ opacity: 0, y: 24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...SPRING_DROP, delay: d(1.0 + i * 0.1) }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <p className="flex h-8 items-center text-2xl font-extrabold text-foreground">
                {s.check ? <Check className="h-6 w-6 text-success" aria-hidden="true" /> : <CountUp value={s.value ?? 0} />}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </motion.li>
          ))}
        </ul>
      )}

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(1.5) }} className="space-y-3">
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
      </motion.div>
    </div>
  );
};
