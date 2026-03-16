import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { 
  ArrowRight, Check, ChevronDown, X, Loader2,
  Search, Brain, Send, MessageSquare, LayoutGrid
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useToast } from '@/hooks/use-toast';
import landingDashboard from '@/assets/landing-dashboard.png';

const useRedirectIfAuthenticated = () => {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/outreach', { replace: true });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) navigate('/outreach', { replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);
};

const CALENDLY_URL = 'https://calendly.com/demo/30min';

const SkalrLanding = () => {
  useRedirectIfAuthenticated();
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showCalendly, setShowCalendly] = useState(false);
  const [showContact, setShowContact] = useState(false);
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
    { num: '001', title: 'Sourcer', description: 'Recherche LinkedIn avancée avec filtres intelligents sur tout votre vivier' },
    { num: '002', title: 'Qualifier', description: "Scoring IA automatique de chaque profil par rapport à vos offres" },
    { num: '003', title: 'Engager', description: "Séquences d'InMails personnalisées et relances automatiques" },
    { num: '004', title: 'Suivre', description: "Pipeline kanban, inbox unifiée et notes collaboratives" },
  ];

  const values = [
    { title: 'La vitesse crée la valeur', description: "Contactez 3x plus de candidats qualifiés chaque semaine grâce à l'automatisation intelligente." },
    { title: 'Le recrutement est un système', description: "Nous connectons sourcing, engagement et suivi dans un flux continu et mesurable." },
    { title: "La qualité avant le volume", description: "Le scoring IA priorise les profils pertinents pour maximiser votre taux de conversion." },
  ];

  const stats = [
    { value: '×3', label: 'profils contactés par semaine' },
    { value: '−60%', label: 'temps de sourcing' },
    { value: '+80%', label: 'taux de réponse' },
  ];

  const faqs = [
    { question: 'Comment ça marche ?', answer: "Connectez votre compte LinkedIn via notre intégration sécurisée, configurez vos filtres de recherche, et laissez Skalr trouver, scorer et contacter les meilleurs profils pour vous." },
    { question: 'Mon compte LinkedIn est-il en sécurité ?', answer: "Absolument. Nous utilisons des connexions sécurisées et respectons les limites de LinkedIn. Vos identifiants sont chiffrés et ne sont jamais stockés en clair." },
    { question: "Combien de messages puis-je envoyer ?", answer: "Cela dépend de votre abonnement LinkedIn et de votre plan Skalr. Nous optimisons automatiquement le volume et les horaires d'envoi." },
    { question: "C'est gratuit ?", answer: "Skalr propose un essai gratuit pour découvrir la plateforme. Nos plans sont ensuite adaptés à la taille de votre équipe." },
  ];

  return (
    <>
      <SEOHead 
        title="Skalr — Plateforme de recrutement tout-en-un"
        description="Trouvez, engagez et recrutez vos meilleurs talents. Sourcing LinkedIn, séquences automatisées et suivi candidat."
        keywords="recrutement saas, sourcing linkedin, ats, talent acquisition"
      />

      <div className="min-h-screen bg-white text-foreground">

        {/* ===== NAV ===== */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-border/50">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <span className="text-xl font-bold tracking-tight text-foreground font-editorial italic">Skalr</span>
            
            <div className="hidden md:flex items-center gap-8">
              {['Produit', 'Résultats', 'FAQ'].map((label) => (
                <button
                  key={label}
                  onClick={() => document.getElementById(label.toLowerCase())?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCalendly(true)}
                className="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Réserver une démo
              </button>
              <button
                onClick={() => navigate('/auth')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-70 transition-opacity"
              >
                Commencer <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </nav>

        {/* ===== HERO ===== */}
        <section className="landing-sky-gradient pt-32 pb-16 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="font-editorial text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] leading-[1.05] tracking-tight text-foreground mb-6"
            >
              Le recrutement,{' '}
              <em className="italic">simplifié</em>{' '}
              et accéléré
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              Trouvez, engagez et recrutez vos meilleurs talents — avec clarté et efficacité.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="flex flex-wrap justify-center gap-3 mb-16"
            >
              <button
                onClick={() => setShowCalendly(true)}
                className="inline-flex items-center gap-2 h-12 px-7 bg-foreground text-background rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--landing-accent-yellow))]" />
                Réserver une démo
              </button>
              <button
                onClick={() => navigate('/auth')}
                className="inline-flex items-center gap-2 h-12 px-7 border border-foreground text-foreground rounded-full text-sm font-medium hover:bg-foreground hover:text-background transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
                Commencer gratuitement
              </button>
            </motion.div>

            {/* Dashboard Preview */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35 }}
              className="max-w-3xl mx-auto"
            >
              <div className="rounded-2xl border border-border/60 shadow-xl overflow-hidden bg-white">
                <img src={landingDashboard} alt="Skalr dashboard preview" className="w-full" />
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section id="produit" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl tracking-tight text-foreground leading-[1.1]">
                Tout ce qu'il faut pour sourcer,<br className="hidden md:block" />
                qualifier et recruter
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-10 items-start">
              {/* Left: visual */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[hsl(var(--landing-sky-start))] to-[hsl(var(--landing-sky-end))]"
              >
                <div className="absolute inset-0 flex items-end p-6">
                  <div className="bg-white rounded-xl shadow-lg p-4 max-w-[280px]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-[hsl(var(--landing-accent-yellow))] text-[10px] font-semibold uppercase">
                        Match IA
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">Score 94% — profil idéal pour votre poste</p>
                    <p className="text-xs text-muted-foreground mt-1">Ajuster les critères →</p>
                  </div>
                </div>
              </motion.div>

              {/* Right: numbered list */}
              <div className="space-y-0">
                {features.map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-start justify-between gap-4 py-6 border-b border-border last:border-b-0"
                  >
                    <div>
                      <h3 className="text-lg font-semibold text-foreground mb-1">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono shrink-0 pt-1">{feature.num}</span>
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  className="pt-6"
                >
                  <button
                    onClick={() => navigate('/auth')}
                    className="inline-flex items-center gap-2 h-11 px-6 bg-foreground text-background rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--landing-accent-yellow))]" />
                    Découvrir la plateforme
                  </button>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== VALUES ===== */}
        <section className="py-24 px-6 bg-muted/40">
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

            <div className="grid md:grid-cols-3 gap-8">
              {values.map((value, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center"
                >
                  <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-5">
                    <span className="text-xs font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">{value.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== STATS ===== */}
        <section id="résultats" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
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
                  className="text-center py-12 px-6 rounded-2xl border border-border bg-white"
                >
                  <span className="text-5xl md:text-6xl font-bold text-foreground tracking-tight block mb-3">
                    {stat.value}
                  </span>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== TESTIMONIAL ===== */}
        <section className="py-20 px-6 bg-muted/40">
          <div className="max-w-3xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <blockquote className="font-editorial text-2xl sm:text-3xl md:text-4xl leading-[1.3] text-foreground mb-8">
                "Skalr a transformé notre façon de recruter. On contacte 3× plus de candidats qualifiés, 
                et notre taux de réponse a explosé."
              </blockquote>
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center text-background text-sm font-semibold">
                  T
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-foreground">Head of Talent, Scale-up Tech</div>
                  <div className="text-xs text-muted-foreground">Équipe de 80 personnes</div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FAQ ===== */}
        <section id="faq" className="py-24 px-6">
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

            <div className="space-y-0">
              {faqs.map((faq, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-border"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full py-5 flex items-center justify-between text-left group"
                  >
                    <span className="font-medium text-foreground group-hover:opacity-70 transition-opacity">{faq.question}</span>
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
                        <p className="pb-5 text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== CTA FINAL ===== */}
        <section className="py-28 px-6 landing-sky-gradient">
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
              <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
                Rejoignez les équipes qui recrutent mieux, plus vite et à moindre coût.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => navigate('/auth')}
                  className="inline-flex items-center gap-2 h-13 px-8 bg-foreground text-background rounded-full text-base font-medium hover:opacity-90 transition-opacity"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--landing-accent-yellow))]" />
                  Commencer gratuitement
                  <ArrowRight className="h-4 w-4 ml-1" />
                </button>
                <button
                  onClick={() => setShowCalendly(true)}
                  className="inline-flex items-center gap-2 h-13 px-8 border border-foreground text-foreground rounded-full text-base font-medium hover:bg-foreground hover:text-background transition-colors"
                >
                  Réserver une démo
                </button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FOOTER ===== */}
        <footer className="py-10 px-6 border-t border-border">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <span className="text-lg font-bold tracking-tight text-foreground font-editorial italic">Skalr</span>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Mentions légales</a>
              <a href="#" className="hover:text-foreground transition-colors">Confidentialité</a>
              <button onClick={() => setShowContact(true)} className="hover:text-foreground transition-colors">Contact</button>
            </div>
            <span className="text-sm text-muted-foreground">© 2025 Skalr</span>
          </div>
        </footer>

        {/* ===== CALENDLY MODAL ===== */}
        <AnimatePresence>
          {showCalendly && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowCalendly(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-3xl h-[80vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowCalendly(false)}
                  className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                >
                  <X className="h-5 w-5 text-foreground" />
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
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowContact(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-lg bg-white border border-border rounded-2xl overflow-hidden shadow-2xl p-8"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowContact(false)}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                >
                  <X className="h-5 w-5 text-foreground" />
                </button>

                <h3 className="text-xl font-semibold text-foreground mb-1">Nous contacter</h3>
                <p className="text-sm text-muted-foreground mb-6">Laissez-nous un message, nous revenons vers vous rapidement.</p>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Nom *</label>
                      <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Votre nom" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">Email *</label>
                      <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} placeholder="vous@entreprise.com" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Entreprise</label>
                    <Input value={contactForm.company} onChange={(e) => setContactForm({ ...contactForm, company: e.target.value })} placeholder="Nom de votre entreprise" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Message *</label>
                    <Textarea value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} placeholder="Comment pouvons-nous vous aider ?" className="min-h-[120px]" required />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full inline-flex items-center justify-center gap-2 h-12 bg-foreground text-background rounded-full text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Envoi...</> : <>Envoyer <ArrowRight className="h-4 w-4" /></>}
                  </button>
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
