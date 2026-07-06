import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Loader2, Users, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type OrgType = 'enterprise' | 'agency' | 'freelance';

interface Props {
  /** Peut être async (création d'org freelance côté parent) — le bouton est
   *  verrouillé pendant l'attente pour empêcher les doubles créations. */
  onSelect: (orgType: OrgType, discoverySource: string) => void | Promise<void>;
  onBack: () => void;
}

// Question marketing facultative (décision refonte 06/07 : gardée en
// optionnel, non bloquante — persistée dans organizations.discovery_source).
const DISCOVERY_SOURCES = [
  { value: 'linkedin', label: 'LinkedIn (post / pub)' },
  { value: 'linkedin-dm', label: 'LinkedIn (message privé)' },
  { value: 'google', label: 'Recherche Google' },
  { value: 'word-of-mouth', label: 'Bouche-à-oreille / Recommandation' },
  { value: 'community', label: 'Communauté Slack / Discord' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'blog', label: 'Article / Blog' },
  { value: 'event', label: 'Événement / Salon / Meetup' },
  { value: 'product-hunt', label: 'Product Hunt' },
  { value: 'appsumo', label: 'AppSumo' },
  { value: 'comparison', label: 'Site de comparatifs (G2, Capterra…)' },
  { value: 'referral', label: 'Programme de parrainage' },
  { value: 'social-twitter', label: 'X (Twitter)' },
  { value: 'social-instagram', label: 'Instagram / TikTok' },
  { value: 'partner', label: 'Partenaire / Intégrateur' },
  { value: 'other', label: 'Autre' },
];

const ORG_TYPE_OPTIONS: { value: OrgType; icon: React.ElementType; title: string; description: string }[] = [
  {
    value: 'enterprise',
    icon: Building2,
    title: 'Je recrute pour mon entreprise',
    description: "Gérez vos recrutements en interne, avec ou sans l'aide de cabinets externes.",
  },
  {
    value: 'agency',
    icon: Users,
    title: 'Je suis un cabinet de recrutement',
    description: 'Recrutez pour vos clients et gérez une équipe de recruteurs.',
  },
  {
    value: 'freelance',
    icon: UserCircle,
    title: 'Je suis recruteur indépendant',
    description: 'Travaillez en solo, trouvez des missions et des postes au succès.',
  },
];

export const SceneOrgType: React.FC<Props> = ({ onSelect }) => {
  const [selected, setSelected] = useState<OrgType | null>(null);
  const [discovery, setDiscovery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleContinue = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await onSelect(selected, discovery);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Votre activité</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
          Quel est votre profil ?
        </h2>
        <p className="text-muted-foreground text-sm">
          Choisissez ce qui vous correspond le mieux.
        </p>
      </div>

      {/* Org type cards */}
      <div className="space-y-2.5">
        {ORG_TYPE_OPTIONS.map((option, index) => {
          const Icon = option.icon;
          const isSelected = selected === option.value;

          return (
            <motion.button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.08, duration: 0.35 }}
              className={`
                w-full text-left p-3.5 rounded-xl border transition-all duration-200
                flex items-start gap-3
                ${isSelected
                  ? 'border-foreground/40 bg-accent/60'
                  : 'border-border bg-card hover:bg-accent/40'}
              `}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/[0.06] text-foreground/60'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">{option.title}</span>
                <span className="text-xs text-muted-foreground mt-0.5 block leading-relaxed">
                  {option.description}
                </span>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Découverte — facultatif, non bloquant */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
      >
        <Select value={discovery} onValueChange={setDiscovery}>
          <SelectTrigger className="w-full rounded-xl text-sm text-muted-foreground h-10">
            <SelectValue placeholder="Comment nous avez-vous connu ? (optionnel)" />
          </SelectTrigger>
          <SelectContent>
            {DISCOVERY_SOURCES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-end pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          variant="primary"
          onClick={handleContinue}
          disabled={!selected || submitting}
          className="gap-2 px-6"
        >
          {submitting ? <>Création… <Loader2 className="w-4 h-4 animate-spin" /></> : <>Suivant <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </motion.div>
    </div>
  );
};
