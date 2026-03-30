import React from 'react';
import { motion } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInAccount } from '@/pages/Outreach';
import { useAICredits } from '@/hooks/useAICredits';
import { Check, AlertTriangle, Search, Wifi, FileText, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface SourcingReadinessPanelProps {
  project: SourcingProject;
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  sourcingTab: 'linkedin' | 'database';
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
  icon: React.ReactNode;
  delay?: number;
}

const CheckItem: React.FC<CheckItemProps> = ({ ok, label, detail, icon, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: -8 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.3 }}
    className="flex items-start gap-3 py-2"
  >
    <div className={cn(
      "w-6 h-6 flex items-center justify-center shrink-0 border",
      ok
        ? "bg-green-500/10 border-green-500/30 text-green-600"
        : "bg-orange-500/10 border-orange-500/30 text-orange-500"
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
  accounts,
  selectedAccount,
  sourcingTab,
}) => {
  const { creditsRemaining, isLoading: creditsLoading } = useAICredits();
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);

  const linkedInAccount = accounts.find(a => a.id === selectedAccount);
  const hasLinkedIn = !!linkedInAccount && linkedInAccount.status === 'OK';
  const isDatabase = sourcingTab === 'database';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="border border-foreground bg-background p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-foreground/5 border border-foreground/20 flex items-center justify-center">
          <Search className="w-5 h-5 text-foreground/60" />
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Vérification avant recherche
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isDatabase
              ? 'Recherche dans la base de +200M profils'
              : 'Recherche via votre compte LinkedIn'}
          </p>
        </div>
      </div>

      {/* Checks */}
      <div className="space-y-1 border border-foreground/10 p-4">
        {!isDatabase && (
          <CheckItem
            ok={hasLinkedIn}
            icon={<Wifi className="w-3.5 h-3.5" />}
            label={hasLinkedIn
              ? `Compte LinkedIn : ${linkedInAccount?.name || linkedInAccount?.identifier}`
              : 'Aucun compte LinkedIn connecté'}
            detail={hasLinkedIn
              ? 'Connecté et actif'
              : 'Connectez un compte dans Paramètres ou utilisez la Base Konekt.'}
            delay={0}
          />
        )}

        <CheckItem
          ok={brief.filled >= 4}
          icon={<FileText className="w-3.5 h-3.5" />}
          label={`Brief complété : ${brief.filled}/${brief.total} champs`}
          detail={brief.filled < 4
            ? 'Complétez le brief pour de meilleurs résultats'
            : 'Suffisant pour lancer une recherche'}
          delay={0.1}
        />

        <CheckItem
          ok={!creditsLoading && creditsRemaining > 0}
          icon={<Coins className="w-3.5 h-3.5" />}
          label={creditsLoading
            ? 'Chargement des crédits...'
            : `Crédits IA : ${creditsRemaining.toLocaleString('fr-FR')} disponibles`}
          detail={creditsRemaining > 0 ? 'Scoring et analyse IA disponibles' : 'Rechargez vos crédits'}
          delay={0.2}
        />
      </div>

      {/* Tip */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 bg-muted/30 border border-foreground/10">
        <span className="text-sm shrink-0">💡</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Configurez vos filtres dans le panneau de gauche, puis cliquez <strong className="text-foreground">Rechercher</strong>.
          Utilisez <strong className="text-foreground">Auto-fill IA</strong> pour pré-remplir les filtres à partir du brief.
        </p>
      </div>
    </motion.div>
  );
};
