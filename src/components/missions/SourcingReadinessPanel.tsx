import React from 'react';
import { motion } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { Check, AlertTriangle, Search, FileText, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface SourcingReadinessPanelProps {
  project: SourcingProject;
  selectedAccount: string | null;
}

/** Count how many brief fields are filled */
function countBriefFields(jd: Partial<JobDetails>): { filled: number; total: number } {
  const fields = [
    jd.title, jd.contract_type, jd.location, jd.remote_policy,
    jd.seniority, jd.experience_min, jd.salary_min,
    jd.mission_description || jd.context || jd.raw_brief,
    jd.skills_must_have?.length ? jd.skills_must_have : null,
    jd.skills_should_have?.length ? jd.skills_should_have : null,
    jd.client?.name,
    jd.languages?.length ? jd.languages : null,
  ];
  const total = fields.length;
  const filled = fields.filter(Boolean).length;
  return { filled, total };
}

interface CheckItemProps {
  ok: boolean;
  label: string;
  detail?: string;
  delay?: number;
}

const CheckItem: React.FC<CheckItemProps> = ({ ok, label, detail, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: -8 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.3 }}
    className="flex items-start gap-3 py-2"
  >
    <div className={cn(
      "w-6 h-6 flex items-center justify-center shrink-0 border",
      ok
        ? "bg-accent/20 border-accent/40 text-accent-foreground"
        : "bg-destructive/10 border-destructive/30 text-destructive"
    )}>
      {ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3 h-3" />}
    </div>
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
      {detail && <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  </motion.div>
);

export const SourcingReadinessPanel: React.FC<SourcingReadinessPanelProps> = ({
  project,
  selectedAccount,
}) => {
  const { creditsRemaining, isLoading: creditsLoading } = useAICredits();
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);

  const hasAccount = !!selectedAccount;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-lg space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted/50 border border-foreground/20 flex items-center justify-center">
          <Search className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Prêt à sourcer
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Configurez les filtres à gauche puis lancez la recherche
          </p>
        </div>
      </div>

      {/* Checks */}
      <div className="space-y-1 border border-foreground/10 p-4">
        <CheckItem
          ok={hasAccount}
          label={hasAccount ? 'Compte de recherche connecté' : 'Aucun compte connecté'}
          detail={hasAccount ? 'Prêt pour la recherche' : 'Connectez un compte dans Paramètres'}
          delay={0}
        />

        <CheckItem
          ok={brief.filled >= 4}
          label={`Brief : ${brief.filled}/${brief.total} champs remplis`}
          detail={brief.filled < 4
            ? 'Complétez le brief pour de meilleurs résultats'
            : 'Suffisant pour l\'Auto-fill IA'}
          delay={0.1}
        />

        <CheckItem
          ok={!creditsLoading && creditsRemaining > 0}
          label={creditsLoading
            ? 'Chargement des crédits...'
            : `Crédits IA : ${creditsRemaining.toLocaleString('fr-FR')} disponibles`}
          detail={creditsRemaining > 0 ? 'Scoring et analyse disponibles' : 'Rechargez vos crédits'}
          delay={0.2}
        />
      </div>

      {/* Tip */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 bg-muted/30 border border-foreground/10">
        <span className="text-sm shrink-0">💡</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Utilisez <strong className="text-foreground">Auto-fill IA</strong> pour générer les filtres à partir du brief,
          puis cliquez <strong className="text-foreground">Rechercher</strong>.
        </p>
      </div>
    </motion.div>
  );
};
