import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

interface Props {
  onSubmit: (source: string) => void;
  onBack: () => void;
  savedValue?: string;
}

export const SceneDiscovery: React.FC<Props> = ({ onSubmit, onBack, savedValue }) => {
  const [selected, setSelected] = useState(savedValue || '');

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          03 — Une dernière chose
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">
          Comment nous avez-vous trouvé ?
        </h2>
        <p className="text-muted-foreground text-sm">
          Simple curiosité — ça nous aide à mieux vous connaître.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap gap-2 justify-center"
      >
        {DISCOVERY_SOURCES.map(s => (
          <Badge
            key={s.value}
            variant={selected === s.value ? 'default' : 'outline'}
            className={`cursor-pointer text-xs px-3 py-1.5 transition-all ${
              selected === s.value
                ? 'bg-foreground text-background border-border'
                : 'border-border hover:border-border'
            }`}
            onClick={() => setSelected(s.value)}
          >
            {s.label}
          </Badge>
        ))}
      </motion.div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => selected && onSubmit(selected)}
          disabled={!selected}
          className="gap-2 border-2 border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
        >
          Suivant <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};
