import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { 
  CheckCircle2, Clock, Send, Users, FileText, Briefcase, Calendar, 
  ArrowRight, Loader2, ShieldX, Mail, Phone, MessageSquare, 
  ChevronDown, ChevronUp, ExternalLink, HelpCircle, Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface FAQItem {
  question: string;
  answer: string;
}

interface DocumentItem {
  name: string;
  url: string;
  type?: string;
}

interface PortalData {
  candidate_name: string | null;
  job_title: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  company_description: string | null;
  pipeline_stage: string | null;
  next_steps: string | null;
  updated_at: string;
  stage_updated_at: string | null;
  estimated_days_to_next: number | null;
  recruiter_name: string | null;
  recruiter_email: string | null;
  recruiter_phone: string | null;
  documents: DocumentItem[] | null;
  faq: FAQItem[] | null;
}

const STAGE_PROGRESS: Record<string, { order: number; icon: typeof Send; label: string; description: string; avgDays?: number }> = {
  'Nouveau': { order: 0, icon: Users, label: 'Candidature reçue', description: 'Votre candidature a bien été reçue et est en cours de revue par notre équipe.', avgDays: 2 },
  'Contacté': { order: 1, icon: Send, label: 'Premier contact', description: 'Nous avons pris contact avec vous pour en savoir plus sur votre parcours.', avgDays: 3 },
  'Répondu': { order: 2, icon: CheckCircle2, label: 'Échange en cours', description: 'Nous sommes en discussion active pour évaluer l\'adéquation avec le poste.', avgDays: 5 },
  'Pré-qualif': { order: 3, icon: Clock, label: 'Pré-qualification', description: 'Un entretien de pré-qualification est prévu pour valider les critères clés.', avgDays: 5 },
  'CV envoyé': { order: 4, icon: FileText, label: 'Dossier transmis au client', description: 'Votre dossier a été présenté à notre client. Nous attendons leur retour.', avgDays: 7 },
  'ITW en cours': { order: 5, icon: Calendar, label: 'Entretiens client', description: 'Les entretiens avec le client sont en cours. Bonne chance !', avgDays: 10 },
  'Offre': { order: 6, icon: Briefcase, label: 'Proposition d\'embauche', description: 'Une proposition est en cours de finalisation. Vous êtes presque au bout !', avgDays: 5 },
  'Gagné': { order: 7, icon: CheckCircle2, label: 'Finalisé 🎉', description: 'Le processus est terminé avec succès. Félicitations !' },
};

const DEFAULT_FAQ: FAQItem[] = [
  { question: 'Combien de temps dure le processus de recrutement ?', answer: 'En moyenne, le processus complet prend entre 3 et 6 semaines, selon le poste et la disponibilité des interlocuteurs.' },
  { question: 'Comment me préparer à l\'entretien ?', answer: 'Renseignez-vous sur l\'entreprise, préparez des exemples concrets de vos réalisations, et n\'hésitez pas à poser des questions à votre recruteur.' },
  { question: 'Puis-je postuler à d\'autres postes en parallèle ?', answer: 'Bien sûr ! Nous pouvons même vous proposer d\'autres opportunités correspondant à votre profil.' },
  { question: 'Quand aurai-je un retour après l\'entretien ?', answer: 'Nous nous engageons à vous faire un retour dans les 48h suivant chaque étape du processus.' },
];

function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div className="divide-y divide-foreground/10">
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="w-full flex items-center justify-between py-3 text-left group"
          >
            <span className="text-sm font-semibold text-foreground pr-4">{item.question}</span>
            {openIndex === i ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </button>
          <AnimatePresence>
            {openIndex === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="text-sm text-muted-foreground pb-3 leading-relaxed">{item.answer}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export default function CandidatePortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    const fetchPortal = async () => {
      const { data: rows, error } = await (supabase
        .rpc as any)('get_portal_by_token', { p_token: token });

      // RPC returns an array, take first result
      const result = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

      if (error || !result) {
        setNotFound(true);
      } else {
        setData(result as unknown as PortalData);
      }
      setLoading(false);
    };
    fetchPortal();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <SEOHead title="Portail candidat" description="Suivez l'avancement de votre candidature" />
        <div className="text-center max-w-md">
          <ShieldX className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Lien invalide ou expiré</h1>
          <p className="text-sm text-muted-foreground">
            Ce lien de suivi n'est plus actif. Contactez votre recruteur pour obtenir un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  const currentStage = data.pipeline_stage || 'Nouveau';
  const currentOrder = STAGE_PROGRESS[currentStage]?.order ?? 0;
  const visibleStages = Object.entries(STAGE_PROGRESS)
    .filter(([key]) => key !== 'Gagné' || currentStage === 'Gagné')
    .sort((a, b) => a[1].order - b[1].order);

  const stageUpdatedDate = data.stage_updated_at ? new Date(data.stage_updated_at) : new Date(data.updated_at);
  const daysSinceStageUpdate = Math.floor((Date.now() - stageUpdatedDate.getTime()) / (1000 * 60 * 60 * 24));
  const estimatedDays = data.estimated_days_to_next ?? STAGE_PROGRESS[currentStage]?.avgDays ?? null;
  const daysRemaining = estimatedDays ? Math.max(0, estimatedDays - daysSinceStageUpdate) : null;

  const faqItems = (data.faq && (data.faq as FAQItem[]).length > 0) ? data.faq as FAQItem[] : DEFAULT_FAQ;
  const documents = (data.documents as DocumentItem[] | null) || [];

  const progressPercent = Math.round((currentOrder / (Object.keys(STAGE_PROGRESS).length - 1)) * 100);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Suivi candidature — ${data.job_title || 'Poste'}`}
        description="Suivez l'avancement de votre candidature en temps réel"
      />

      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-16">

        {/* ===== HEADER / BRANDING ===== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="border border-border bg-background p-6 sm:p-8 mb-6"
        >
          <div className="flex items-center gap-3 mb-5">
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt={data.company_name || ''} className="h-10 w-10 object-contain" />
            ) : (
              <div className="h-10 w-10 bg-foreground text-background flex items-center justify-center font-black text-lg">
                {(data.company_name || 'P')[0].toUpperCase()}
              </div>
            )}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                Portail candidat
              </span>
              {data.company_name && (
                <span className="text-sm font-semibold text-foreground">{data.company_name}</span>
              )}
            </div>
          </div>
          
          {data.candidate_name && (
            <p className="text-sm text-muted-foreground mb-2">
              Bonjour <span className="font-semibold text-foreground">{data.candidate_name}</span>,
            </p>
          )}
          
          <h1 className="text-2xl sm:text-3xl font-black text-foreground uppercase tracking-tight mb-2">
            {data.job_title || 'Votre candidature'}
          </h1>
          
          {data.company_description && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">{data.company_description}</p>
          )}

          {/* Progress bar */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Progression</span>
              <span className="text-xs font-bold text-foreground">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-muted/30 border border-border">
              <motion.div 
                initial={{ width: 0 }} animate={{ width: `${progressPercent}%` }} 
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-foreground"
              />
            </div>
          </div>
        </motion.div>

        {/* ===== DATES & ESTIMATED DELAY ===== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
          className="grid grid-cols-2 gap-3 mb-6"
        >
          <div className="border border-border bg-background p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Étape actuelle depuis</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-foreground">{daysSinceStageUpdate}</span>
              <span className="text-xs text-muted-foreground">jour{daysSinceStageUpdate > 1 ? 's' : ''}</span>
            </div>
            <span className="text-xs text-muted-foreground mt-1 block">
              {stageUpdatedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div className="border border-border bg-background p-4">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Prochaine étape dans</span>
            {daysRemaining !== null ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn("text-2xl font-black", daysRemaining <= 1 ? "text-emerald-600" : "text-foreground")}>
                    ~{daysRemaining}
                  </span>
                  <span className="text-xs text-muted-foreground">jour{daysRemaining > 1 ? 's' : ''}</span>
                </div>
                <span className="text-xs text-muted-foreground mt-1 block">estimation moyenne</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">À déterminer</span>
            )}
          </div>
        </motion.div>

        {/* ===== PROGRESS TIMELINE ===== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
          className="border border-border bg-background mb-6"
        >
          <div className="px-4 py-2.5 border-b border-border bg-foreground text-background">
            <span className="text-xs font-bold uppercase tracking-wider">
              Avancement du processus
            </span>
          </div>
          
          <div className="p-4 space-y-0">
            {visibleStages.map(([key, stage], index) => {
              const isPast = stage.order < currentOrder;
              const isCurrent = stage.order === currentOrder;
              const isFuture = stage.order > currentOrder;
              const Icon = stage.icon;
              const isLast = index === visibleStages.length - 1;

              return (
                <motion.div 
                  key={key} className="flex gap-4"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.05 }}
                >
                  {/* Timeline line + dot */}
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      "w-8 h-8 flex items-center justify-center border-2 shrink-0 transition-all",
                      isPast && "bg-foreground border-border text-background",
                      isCurrent && "bg-accent border-border text-foreground scale-110",
                      isFuture && "bg-muted/30 border-border text-muted-foreground"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    {!isLast && (
                      <div className={cn(
                        "w-0.5 h-8",
                        isPast ? "bg-foreground" : "bg-border"
                      )} />
                    )}
                  </div>

                  {/* Content */}
                  <div className={cn("pb-6", isLast && "pb-0")}>
                    <span className={cn(
                      "text-sm font-bold",
                      isFuture ? "text-muted-foreground" : "text-foreground"
                    )}>
                      {stage.label}
                    </span>
                    {isCurrent && (
                      <span className="ml-2 text-3xs px-1.5 py-0.5 bg-accent border border-border font-bold uppercase tracking-wider animate-pulse">
                        En cours
                      </span>
                    )}
                    {isPast && (
                      <span className="ml-2 text-3xs px-1.5 py-0.5 bg-foreground text-background font-bold uppercase tracking-wider">
                        ✓
                      </span>
                    )}
                    <p className={cn(
                      "text-xs mt-0.5 leading-relaxed",
                      isFuture ? "text-muted-foreground/50" : "text-muted-foreground"
                    )}>
                      {stage.description}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* ===== NEXT STEPS ===== */}
        {data.next_steps && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}
            className="border border-border bg-background p-4 mb-6"
          >
            <div className="flex items-center gap-2 mb-2">
              <ArrowRight className="w-4 h-4 text-foreground" />
              <span className="text-xs font-bold uppercase tracking-wider">Prochaines étapes</span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{data.next_steps}</p>
          </motion.div>
        )}

        {/* ===== DOCUMENTS & RESOURCES ===== */}
        {documents.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }}
            className="border border-border bg-background mb-6"
          >
            <div className="px-4 py-2.5 border-b border-border">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Documents & Ressources
              </span>
            </div>
            <div className="divide-y divide-foreground/10">
              {documents.map((doc, i) => (
                <a 
                  key={i} href={doc.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/5 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Download className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <div>
                      <span className="text-sm font-medium text-foreground">{doc.name}</span>
                      {doc.type && <span className="ml-2 text-xs px-1.5 py-0.5 bg-muted/20 text-muted-foreground font-medium uppercase">{doc.type}</span>}
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </a>
              ))}
            </div>
          </motion.div>
        )}

        {/* ===== FAQ ===== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }}
          className="border border-border bg-background mb-6"
        >
          <div className="px-4 py-2.5 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" /> Questions fréquentes
            </span>
          </div>
          <div className="px-4">
            <FAQAccordion items={faqItems} />
          </div>
        </motion.div>

        {/* ===== RECRUITER CONTACT ===== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }}
          className="border border-border bg-foreground text-background p-5 mb-8"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-background/60 block mb-3">
            Votre recruteur
          </span>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-background/15 border border-background/30 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-background/80" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-background text-base">
                {data.recruiter_name || 'Votre recruteur dédié'}
              </p>
              <p className="text-xs text-background/60 mt-0.5">
                N'hésitez pas à me contacter pour toute question
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 mt-4">
            {data.recruiter_email && (
              <a href={`mailto:${data.recruiter_email}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-background text-foreground text-xs font-bold uppercase tracking-wider hover:bg-background/90 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </a>
            )}
            {data.recruiter_phone && (
              <a href={`tel:${data.recruiter_phone}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-background text-foreground text-xs font-bold uppercase tracking-wider hover:bg-background/90 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" /> Appeler
              </a>
            )}
          </div>
        </motion.div>

        {/* ===== FOOTER ===== */}
        <p className="text-center text-xs text-muted-foreground uppercase tracking-wider">
          Dernière mise à jour : {new Date(data.updated_at).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
        </p>
      </div>
    </div>
  );
}
