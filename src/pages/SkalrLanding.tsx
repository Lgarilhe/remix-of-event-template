import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ChevronDown, X, Loader2, Menu,
  Search, Brain, Send, MessageSquare, LayoutGrid
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useToast } from '@/hooks/use-toast';
import landingDashboard from '@/assets/landing-dashboard.webp';
import { getValidatedSession } from '@/lib/authSession';
import { withPreviewAccessToken, withPreviewAccessTokenFromSearch } from '@/lib/previewToken';

const useRedirectIfAuthenticated = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const validateSessionInBackground = async () => {
      const { session } = await getValidatedSession();

      if (!isMounted || !session?.user) return;
      navigate(withPreviewAccessTokenFromSearch('/missions', window.location.search), { replace: true });
    };

    validateSessionInBackground().catch(() => {
      // Landing page is public: never block rendering on auth/network failures.
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if ((event === 'SIGNED_IN' || (event === 'TOKEN_REFRESHED' && !!session?.user)) && session?.user) {
        navigate(withPreviewAccessTokenFromSearch('/missions', window.location.search), { replace: true });
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);
};

const CALENDLY_URL = 'https://calendly.com/demo/30min';

/* ── Brutal button with offset shadow ── */
const BrutalButton = ({
  children,
  onClick,
  variant = 'primary',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'outline';
  className?: string;
}) => (
  <button
    onClick={onClick}
    className={`
      relative group inline-flex items-center gap-2 h-12 px-7 text-xs font-semibold uppercase tracking-wider
      border-2 border-border transition-all duration-200
      ${variant === 'primary'
        ? 'bg-foreground text-background hover:shadow-md'
        : 'bg-background text-foreground hover:shadow-md'
      }
      ${className}
    `}
  >
    {children}
  </button>
);

const SkalrLanding = () => {
  useRedirectIfAuthenticated();
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showCalendly, setShowCalendly] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', company: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      toast({ title: "Erreur", description: "Veuillez remplir tous les champs obligatoires.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('contact_submissions').insert({
        name: contactForm.name.trim(),
        email: contactForm.email.trim(),
        company: contactForm.company.trim() || null,
        message: contactForm.message.trim(),
      });
      if (error) throw error;
      try {
        await invokeEdgeFunction('notify-notion', {
          name: contactForm.name.trim(),
          email: contactForm.email.trim(),
          company: contactForm.company.trim() || null,
          message: contactForm.message.trim(),
        });
      } catch (e) { console.warn('Notion sync error:', e); }
      toast({ title: "Message envoyé !", description: "Nous vous recontacterons très vite." });
      setContactForm({ name: '', email: '', company: '', message: '' });
      setShowContact(false);
    } catch (error) {
      console.error('Contact form error:', error);
      toast({ title: "Erreur", description: "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const features = [
    { num: '001', title: 'Sourcer', icon: Search, description: 'Recherche LinkedIn avancée avec filtres intelligents sur tout votre vivier de talents.' },
    { num: '002', title: 'Qualifier', icon: Brain, description: "Scoring IA automatique de chaque profil par rapport à vos offres d'emploi." },
    { num: '003', title: 'Engager', icon: Send, description: "Séquences d'InMails personnalisées par l'IA avec relances automatiques." },
    { num: '004', title: 'Suivre', icon: LayoutGrid, description: "Pipeline kanban, inbox unifiée et notes collaboratives pour tout centraliser." },
  ];

  const values = [
    { title: 'La vitesse crée la valeur', description: "Contactez 3× plus de candidats qualifiés chaque semaine grâce à l'automatisation intelligente." },
    { title: 'Le recrutement est un système', description: "Nous connectons sourcing, engagement et suivi dans un flux continu et mesurable." },
    { title: "La qualité avant le volume", description: "Le scoring IA priorise les profils pertinents pour maximiser votre taux de conversion." },
  ];

  const stats = [
    { value: '×3', label: 'Profils contactés par semaine' },
    { value: '−60%', label: 'Temps de sourcing' },
    { value: '+80%', label: 'Taux de réponse' },
  ];

  const faqs = [
    { question: 'Comment ça marche ?', answer: "Connectez votre compte LinkedIn via notre intégration sécurisée, configurez vos filtres de recherche, et laissez Konekt trouver, scorer et contacter les meilleurs profils pour vous." },
    { question: 'Mon compte LinkedIn est-il en sécurité ?', answer: "Absolument. Nous utilisons des connexions sécurisées et respectons les limites de LinkedIn. Vos identifiants sont chiffrés et ne sont jamais stockés en clair." },
    { question: "Combien de messages puis-je envoyer ?", answer: "Cela dépend de votre abonnement LinkedIn et de votre plan Konekt. Nous optimisons automatiquement le volume et les horaires d'envoi." },
    { question: "C'est gratuit ?", answer: "Konekt propose un essai gratuit pour découvrir la plateforme. Nos plans sont ensuite adaptés à la taille de votre équipe." },
  ];

  return (
    <>
      <SEOHead 
        title="Konekt — Plateforme de recrutement tout-en-un"
        description="Trouvez, engagez et recrutez vos meilleurs talents. Sourcing LinkedIn, séquences automatisées et suivi candidat."
        keywords="recrutement saas, sourcing linkedin, ats, talent acquisition"
      />

      <div className="min-h-screen bg-background text-foreground">

        {/* ===== NAV ===== */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <KonektLogo variant="full" theme="dark" size={28} ariaLabel="Konekt — accueil" />

            <div className="hidden md:flex items-center gap-8">
              {[
                { label: 'Produit', id: 'produit' },
                { label: 'Résultats', id: 'resultats' },
                { label: 'FAQ', id: 'faq' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCalendly(true)}
                className="hidden sm:inline-flex text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors font-medium"
              >
                Démo
              </button>
              <BrutalButton onClick={() => navigate(withPreviewAccessToken('/auth'))} className="h-9 px-5 text-xs">
                Commencer <ArrowRight className="h-3 w-3" />
              </BrutalButton>
              {/* Burger menu — mobile uniquement */}
              <button
                type="button"
                onClick={() => setShowMobileMenu(true)}
                aria-label="Ouvrir le menu"
                className="md:hidden h-9 w-9 grid place-items-center rounded-md border border-border text-foreground hover:bg-foreground/[0.04] transition-colors"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>
          </div>
        </nav>

        {/* ===== Mobile menu drawer ===== */}
        <AnimatePresence>
          {showMobileMenu && (
            <motion.div
              key="mobile-menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] md:hidden bg-background"
            >
              <div className="flex items-center justify-between px-6 h-14 border-b border-border">
                <KonektLogo variant="full" theme="dark" size={28} />
                <button
                  type="button"
                  onClick={() => setShowMobileMenu(false)}
                  aria-label="Fermer le menu"
                  className="h-9 w-9 grid place-items-center rounded-md border border-border text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex flex-col px-6 py-6 gap-1">
                {[
                  { label: 'Produit', id: 'produit' },
                  { label: 'Résultats', id: 'resultats' },
                  { label: 'FAQ', id: 'faq' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      // Délai pour laisser le menu se fermer avant de scroller
                      setTimeout(() => {
                        document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                      }, 250);
                    }}
                    className="text-left py-4 text-base font-display font-bold uppercase tracking-wide text-foreground hover:text-foreground/70 transition-colors border-b border-border"
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileMenu(false);
                    setTimeout(() => setShowCalendly(true), 250);
                  }}
                  className="text-left py-4 text-base font-display font-bold uppercase tracking-wide text-foreground hover:text-foreground/70 transition-colors border-b border-border"
                >
                  Démo
                </button>
              </nav>
              <div className="px-6 mt-4">
                <BrutalButton
                  onClick={() => {
                    setShowMobileMenu(false);
                    setTimeout(() => navigate(withPreviewAccessToken('/auth')), 200);
                  }}
                  className="w-full h-12 text-sm"
                >
                  Commencer <ArrowRight className="h-4 w-4" />
                </BrutalButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== HERO ===== */}
        <section className="landing-sky-gradient pt-28 pb-20 px-6">
          <div className="max-w-5xl mx-auto text-center">
            {/* Label */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-8"
            >
              <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-foreground border-2 border-border px-4 py-1.5 bg-background shadow-sm">
                <span className="w-2 h-2 bg-accent" />
                Plateforme de recrutement
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="font-editorial text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] leading-[1.05] tracking-tight text-foreground mb-6"
            >
              Le recrutement,{' '}
              <em className="italic">simplifié</em>{' '}
              et accéléré
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              Trouvez, engagez et recrutez vos meilleurs talents — avec clarté et efficacité.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-wrap justify-center gap-3 mb-16"
            >
              <BrutalButton onClick={() => setShowCalendly(true)}>
                Réserver une démo
              </BrutalButton>
              <BrutalButton variant="outline" onClick={() => navigate(withPreviewAccessToken('/auth'))}>
                Commencer gratuitement
                <ArrowRight className="h-3.5 w-3.5" />
              </BrutalButton>
            </motion.div>

            {/* Dashboard Preview */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="max-w-3xl mx-auto"
            >
              <div className="border-2 border-border shadow-md overflow-hidden bg-background">
                <img src={landingDashboard} alt="Konekt dashboard preview" className="w-full" />
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section id="produit" className="py-24 px-6 bg-background">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4 block">
                Fonctionnalités
              </span>
              <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl tracking-tight text-foreground leading-[1.1]">
                Tout ce qu'il faut pour sourcer,<br className="hidden md:block" />
                qualifier et recruter
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-12 items-start">
              {/* Left: visual card */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="relative"
              >
                <div className="aspect-[4/3] border-2 border-border bg-gradient-to-br from-[hsl(var(--landing-sky-start))] to-[hsl(var(--landing-sky-end))] shadow-md">
                  <div className="absolute bottom-6 left-6">
                    <div className="bg-background border-2 border-border p-4 max-w-[280px] shadow-sm">
                      <span className="inline-block px-2 py-0.5 bg-[hsl(var(--landing-accent-yellow))] text-xs font-bold uppercase tracking-wider mb-2">
                        Match IA
                      </span>
                      <p className="text-sm font-semibold text-foreground">Score 94% — profil idéal pour votre poste</p>
                      <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Ajuster les critères →</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Right: numbered list */}
              <div>
                {features.map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-start gap-4 py-6 border-b border-border last:border-b-0 group"
                  >
                    <div className="w-10 h-10 border-2 border-border flex items-center justify-center shrink-0 bg-background group-hover:bg-accent group-hover:shadow-sm transition-all">
                      <feature.icon className="h-4 w-4 text-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="text-base font-bold text-foreground uppercase tracking-wide">{feature.title}</h3>
                        <span className="text-xs text-muted-foreground font-mono">{feature.num}</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                    </div>
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  className="pt-6"
                >
                  <BrutalButton onClick={() => navigate(withPreviewAccessToken('/auth'))}>
                    Découvrir la plateforme
                    <ArrowRight className="h-3.5 w-3.5" />
                  </BrutalButton>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== VALUES ===== */}
        <section className="py-24 px-6 border-t border-b border-border bg-muted/30">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="font-editorial text-4xl sm:text-5xl tracking-tight text-foreground leading-[1.1]">
                Conçu pour la clarté.<br />
                <em className="italic">Pensé pour l'action.</em>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {values.map((value, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="border-2 border-border bg-background p-6 hover:shadow-md transition-shadow"
                >
                  <div className="w-8 h-8 border-2 border-border flex items-center justify-center mb-5 bg-accent">
                    <span className="text-xs font-bold text-foreground">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-2">{value.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== STATS ===== */}
        <section id="resultats" className="py-24 px-6 bg-background">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4 block">
                Résultats
              </span>
              <h2 className="font-editorial text-4xl sm:text-5xl tracking-tight text-foreground">
                Des résultats concrets
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {stats.map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12 }}
                  className="text-center py-14 px-6 border-2 border-border bg-background hover:shadow-md transition-shadow"
                >
                  <span className="text-5xl md:text-6xl font-bold text-foreground tracking-tight block mb-3">
                    {stat.value}
                  </span>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== TESTIMONIAL ===== */}
        <section className="py-20 px-6 border-t border-b border-border bg-foreground text-background">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <span className="text-xs uppercase tracking-wider font-semibold text-background/60 mb-6 block">
                Témoignage
              </span>
              <blockquote className="font-editorial text-2xl sm:text-3xl md:text-4xl leading-[1.3] text-background mb-8">
                "Konekt a transformé notre façon de recruter. On contacte 3× plus de candidats qualifiés,
                et notre taux de réponse a explosé."
              </blockquote>
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 border-2 border-background flex items-center justify-center text-background text-sm font-bold bg-accent text-foreground">
                  T
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-background">Head of Talent, Scale-up Tech</div>
                  <div className="text-xs text-background/60 uppercase tracking-wider">Équipe de 80 personnes</div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FAQ ===== */}
        <section id="faq" className="py-24 px-6 bg-background">
          <div className="max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-14"
            >
              <h2 className="font-editorial text-3xl sm:text-4xl tracking-tight text-foreground">
                Questions fréquentes
              </h2>
            </motion.div>

            <div className="border-2 border-border divide-y-2 divide-foreground">
              {faqs.map((faq, i) => (
                <div key={i}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full py-5 px-6 flex items-center justify-between text-left group hover:bg-muted/30 transition-colors"
                  >
                    <span className="font-semibold text-sm text-foreground uppercase tracking-wide">{faq.question}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <p className="px-6 pb-5 text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== CTA FINAL ===== */}
        <section className="py-28 px-6 landing-sky-gradient border-t border-border">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl tracking-tight text-foreground mb-6 leading-[1.1]">
                Vos prochains talents{' '}
                <em className="italic">vous attendent</em>
              </h2>
              <p className="text-base text-muted-foreground mb-10 max-w-xl mx-auto">
                Rejoignez les équipes qui recrutent mieux, plus vite et à moindre coût.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <BrutalButton onClick={() => navigate(withPreviewAccessToken('/auth'))}>
                  Commencer gratuitement
                  <ArrowRight className="h-3.5 w-3.5" />
                </BrutalButton>
                <BrutalButton variant="outline" onClick={() => setShowCalendly(true)}>
                  Réserver une démo
                </BrutalButton>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FOOTER ===== */}
        <footer className="py-8 px-6 border-t-2 border-border bg-background">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <KonektLogo variant="full" theme="dark" size={24} />
            <div className="flex items-center gap-6 text-xs uppercase tracking-wider text-muted-foreground font-medium">
              <a href="/privacy#mentions" className="hover:text-foreground transition-colors">Mentions légales</a>
              <a href="/privacy" className="hover:text-foreground transition-colors">Confidentialité</a>
              <button onClick={() => setShowContact(true)} className="hover:text-foreground transition-colors">Contact</button>
            </div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">© {new Date().getFullYear()} Konekt</span>
          </div>
        </footer>

        {/* ===== CALENDLY MODAL ===== */}
        <AnimatePresence>
          {showCalendly && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-sm"
              onClick={() => setShowCalendly(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-3xl h-[80vh] bg-background border-2 border-border shadow-lg overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowCalendly(false)}
                  className="absolute top-3 right-3 z-10 w-9 h-9 border-2 border-border bg-background hover:bg-accent flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
                <iframe src={CALENDLY_URL} className="w-full h-full border-0" title="Réserver une démo" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== CONTACT MODAL ===== */}
        <AnimatePresence>
          {showContact && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-sm"
              onClick={() => setShowContact(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-lg bg-background border-2 border-border shadow-lg overflow-hidden p-8"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowContact(false)}
                  className="absolute top-3 right-3 w-9 h-9 border-2 border-border bg-background hover:bg-accent flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>

                <h3 className="text-lg font-bold text-foreground uppercase tracking-wide mb-1">Nous contacter</h3>
                <p className="text-sm text-muted-foreground mb-6">Laissez-nous un message, nous revenons vers vous rapidement.</p>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1">Nom *</label>
                      <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Votre nom" className="rounded-lg border-2 border-border" required />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1">Email *</label>
                      <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} placeholder="vous@entreprise.com" className="rounded-lg border-2 border-border" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1">Entreprise</label>
                    <Input value={contactForm.company} onChange={(e) => setContactForm({ ...contactForm, company: e.target.value })} placeholder="Nom de votre entreprise" className="rounded-lg border-2 border-border" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1">Message *</label>
                    <Textarea value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} placeholder="Comment pouvons-nous vous aider ?" className="min-h-[120px] rounded-lg border-2 border-border" required />
                  </div>
                  <BrutalButton className="w-full justify-center">
                    {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Envoi...</> : <>Envoyer <ArrowRight className="h-3.5 w-3.5" /></>}
                  </BrutalButton>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

export default SkalrLanding;
