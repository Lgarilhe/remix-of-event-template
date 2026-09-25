import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Brain, LayoutGrid, Menu, Search, Send } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { IconTile } from '@/components/ui/IconTile';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { PublicFooter, publicFooterLinkClass } from '@/components/public/PublicFooter';
import { LandingProductDemo } from '@/components/landing/LandingProductDemo';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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

/**
 * Sections de la page atteintes par ancre. La prise de rendez-vous n'a pas
 * d'adresse connue : « Demander une démo » mène au formulaire de contact.
 */
const SECTION_IDS = ['produit', 'faq', 'contact'] as const;
type SectionId = (typeof SECTION_IDS)[number];

const NAV_LINKS: { label: string; id: SectionId }[] = [
  { label: 'Produit', id: 'produit' },
  { label: 'FAQ', id: 'faq' },
];

const DEMO_MESSAGE = 'Bonjour, je souhaite une démonstration de Konekt.';
const TRIAL_NOTE = "14 jours d'essai, sans carte bancaire.";

const features = [
  { title: 'Sourcer', icon: Search, description: 'Recherche LinkedIn avancée, avec des filtres intelligents, sur tout votre vivier de talents.' },
  { title: 'Qualifier', icon: Brain, description: "Score de chaque profil par l'IA, au regard de vos offres d'emploi." },
  { title: 'Engager', icon: Send, description: "Séquences d'InMails personnalisées par l'IA, avec relances automatiques." },
  { title: 'Suivre', icon: LayoutGrid, description: 'Pipeline en colonnes, messagerie unifiée et notes partagées pour tout centraliser.' },
];

const values = [
  { title: 'La vitesse crée la valeur', description: "Contactez davantage de candidats qualifiés chaque semaine grâce à l'automatisation." },
  { title: 'Le recrutement est un système', description: "Sourcing, prise de contact et suivi s'enchaînent dans un flux continu et mesurable." },
  { title: 'La qualité avant le volume', description: "Le score de l'IA met en avant les profils pertinents pour améliorer votre taux de conversion." },
];

const faqs = [
  { question: 'Comment ça marche ?', answer: "Connectez votre compte LinkedIn via notre intégration sécurisée, configurez vos filtres de recherche, et laissez Konekt trouver, scorer et contacter les meilleurs profils pour vous." },
  { question: 'Mon compte LinkedIn est-il protégé ?', answer: "Oui. Konekt n'agit que pendant vos heures ouvrées, dans votre fuseau horaire, et espace chaque action comme le ferait une personne. Les volumes quotidiens et hebdomadaires sont plafonnés, un compte nouvellement connecté monte en charge progressivement, et l'activité se met en pause d'elle-même dès qu'une limite approche ou que LinkedIn envoie un signal. Un même profil n'est pas sollicité deux fois par votre organisation sans avertissement, et vos identifiants ne sont jamais stockés en clair." },
  { question: 'Combien de messages puis-je envoyer ?', answer: "Cela dépend de votre abonnement LinkedIn et de votre plan Konekt. Nous optimisons automatiquement le volume et les horaires d'envoi." },
  { question: "C'est gratuit ?", answer: 'Konekt propose un essai gratuit pour découvrir la plateforme. Nos plans sont ensuite adaptés à la taille de votre équipe.' },
];

const EMPTY_FORM = { name: '', email: '', company: '', message: '' };

/** Fait défiler jusqu'à une section ; le formulaire de contact reçoit le focus. */
function goToSection(id: SectionId, focusTarget?: HTMLElement | null) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  focusTarget?.focus({ preventScroll: true });
}

const SkalrLanding = () => {
  useRedirectIfAuthenticated();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // L'essai ouvre directement le formulaire d'inscription de /auth.
  const trialLink = { to: withPreviewAccessToken('/auth'), state: { mode: 'signup' } };

  const scrollToSection = (id: SectionId) => goToSection(id, id === 'contact' ? nameInputRef.current : null);

  /** « Demander une démo » : le formulaire de contact, message prérempli s'il est vide. */
  const requestDemo = (event?: MouseEvent) => {
    event?.preventDefault();
    setContactForm((form) => (form.message.trim() ? form : { ...form, message: DEMO_MESSAGE }));
    scrollToSection('contact');
  };

  const onAnchorClick = (id: SectionId) => (event: MouseEvent) => {
    event.preventDefault();
    scrollToSection(id);
  };

  // Menu du téléphone : on le ferme, puis on défile une fois le verrou de défilement levé.
  const onMenuAnchorClick = (id: SectionId, demo = false) => (event: MouseEvent) => {
    event.preventDefault();
    setMenuOpen(false);
    window.setTimeout(() => (demo ? requestDemo() : scrollToSection(id)), 250);
  };

  // Arrivée par une ancre (/#contact depuis une autre page).
  useEffect(() => {
    const id = location.hash.slice(1) as SectionId;
    if (!SECTION_IDS.includes(id)) return;
    const timer = window.setTimeout(() => goToSection(id, id === 'contact' ? nameInputRef.current : null), 0);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const handleContactSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      toast.error('Formulaire incomplet', { description: 'Renseignez votre nom, votre e-mail et votre message.' });
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
      } catch (err) {
        console.warn('Notion sync error:', err);
      }
      toast.success('Message envoyé', { description: 'Nous vous recontactons rapidement.' });
      setContactForm(EMPTY_FORM);
    } catch (error) {
      console.error('Contact form error:', error);
      toast.error("Votre message n'a pas pu être envoyé", {
        description: 'Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof typeof EMPTY_FORM) => (value: string) =>
    setContactForm((form) => ({ ...form, [field]: value }));

  return (
    <>
      <SEOHead
        title="Konekt, plateforme de recrutement tout-en-un"
        description="Trouvez, engagez et recrutez vos meilleurs talents. Sourcing LinkedIn, séquences automatisées et suivi candidat."
        keywords="recrutement saas, sourcing linkedin, ats, talent acquisition"
      />

      <div className="min-h-screen bg-background text-foreground">
        {/* ===== En-tête ===== */}
        <header className="fixed inset-x-0 top-0 z-sticky border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link
              to={withPreviewAccessToken('/')}
              aria-label="Konekt, accueil"
              className="-mx-1 inline-flex min-h-11 items-center rounded-md px-1 md:min-h-0"
            >
              <KonektLogo theme="auto" size={26} ariaLabel="" />
            </Link>

            <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
              {NAV_LINKS.map((item) => (
                <Button key={item.id} asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  <a href={`#${item.id}`} onClick={onAnchorClick(item.id)}>
                    {item.label}
                  </a>
                </Button>
              ))}
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <Link to={withPreviewAccessToken('/pricing')}>Tarifs</Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <a href="#contact" onClick={onAnchorClick('contact')}>
                  Contact
                </a>
              </Button>
            </nav>

            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                <Link to={withPreviewAccessToken('/auth')}>Se connecter</Link>
              </Button>
              <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
                <Link to={trialLink.to} state={trialLink.state}>
                  Commencer l'essai gratuit
                </Link>
              </Button>
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="h-11 w-11 md:hidden" aria-label="Ouvrir le menu">
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="flex w-full max-w-xs flex-col gap-0 p-0">
                  <div className="flex h-14 items-center border-b border-border px-4">
                    <SheetTitle className="text-sm">Menu</SheetTitle>
                  </div>
                  <SheetDescription className="sr-only">Navigation de la page d'accueil de Konekt</SheetDescription>
                  <nav aria-label="Menu" className="flex flex-col p-2">
                    {NAV_LINKS.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        onClick={onMenuAnchorClick(item.id)}
                        className="flex min-h-11 items-center rounded-md px-3 text-md font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        {item.label}
                      </a>
                    ))}
                    <Link
                      to={withPreviewAccessToken('/pricing')}
                      className="flex min-h-11 items-center rounded-md px-3 text-md font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      Tarifs
                    </Link>
                    <a
                      href="#contact"
                      onClick={onMenuAnchorClick('contact', true)}
                      className="flex min-h-11 items-center rounded-md px-3 text-md font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      Demander une démo
                    </a>
                  </nav>
                  <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
                    <Button asChild variant="outline" size="lg" className="h-11">
                      <Link to={withPreviewAccessToken('/auth')}>Se connecter</Link>
                    </Button>
                    <Button asChild variant="primary" size="lg" className="h-11">
                      <Link to={trialLink.to} state={trialLink.state}>
                        Commencer l'essai gratuit
                      </Link>
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        <main className="pt-14">
          {/* ===== Présentation ===== */}
          <section aria-labelledby="accueil-titre" className="px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-5xl text-center">
              <p className="eyebrow">Plateforme de recrutement</p>
              <h1
                id="accueil-titre"
                className="mx-auto mt-4 max-w-3xl text-balance font-brand text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl"
              >
                Le recrutement, simplifié et accéléré
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base text-foreground-secondary md:text-lg">
                Trouvez, engagez et recrutez vos meilleurs talents, avec clarté et efficacité.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <Button asChild variant="primary" size="lg" className="max-md:h-11">
                  <Link to={trialLink.to} state={trialLink.state}>
                    Commencer l'essai gratuit
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="max-md:h-11">
                  <a href="#contact" onClick={requestDemo}>
                    Demander une démo
                  </a>
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{TRIAL_NOTE}</p>

              <div className="mx-auto mt-14 max-w-3xl">
                <LandingProductDemo />
              </div>
            </div>
          </section>

          {/* ===== Fonctionnalités ===== */}
          <section id="produit" aria-labelledby="produit-titre" className="scroll-mt-14 border-t border-border px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-6xl">
              <div className="mx-auto max-w-2xl text-center">
                <p className="eyebrow">Fonctionnalités</p>
                <h2 id="produit-titre" className="mt-3 text-balance font-brand text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Tout ce qu'il faut pour sourcer, qualifier et recruter
                </h2>
              </div>
              <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {features.map((feature) => (
                  <li key={feature.title} className="rounded-xl border border-border bg-card p-5">
                    <IconTile icon={feature.icon} aria-hidden="true" />
                    <h3 className="mt-4 text-md font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{feature.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ===== Valeurs ===== */}
          <section aria-labelledby="valeurs-titre" className="border-t border-border bg-card px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-6xl">
              <h2
                id="valeurs-titre"
                className="mx-auto max-w-2xl text-balance text-center font-brand text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
              >
                Conçu pour la clarté, pensé pour l'action
              </h2>
              <ul className="mt-12 grid gap-4 md:grid-cols-3">
                {values.map((value) => (
                  <li key={value.title} className="rounded-xl border border-border bg-background p-6">
                    <h3 className="text-md font-semibold text-foreground">{value.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{value.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ===== Questions fréquentes ===== */}
          <section id="faq" aria-labelledby="faq-titre" className="scroll-mt-14 border-t border-border px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl">
              <h2 id="faq-titre" className="text-center font-brand text-3xl font-semibold tracking-tight text-foreground">
                Questions fréquentes
              </h2>
              <Accordion type="single" collapsible className="mt-10 rounded-xl border border-border bg-card px-5">
                {faqs.map((faq, i) => (
                  <AccordionItem key={faq.question} value={`question-${i}`} className="last:border-b-0">
                    <AccordionTrigger className="min-h-11 gap-4 text-left text-md font-semibold hover:no-underline [&>svg]:text-muted-foreground">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>

          {/* ===== Essai et contact ===== */}
          <section aria-labelledby="contact-titre" className="border-t border-border bg-card px-4 py-20 sm:px-6">
            <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <h2 id="contact-titre" className="text-balance font-brand text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Vos prochains talents vous attendent
                </h2>
                <p className="mt-4 max-w-xl text-base text-foreground-secondary">
                  Rejoignez les équipes qui recrutent mieux, plus vite et à moindre coût.
                </p>
                <div className="mt-8">
                  <Button asChild variant="primary" size="lg" className="max-md:h-11 max-sm:w-full">
                    <Link to={trialLink.to} state={trialLink.state}>
                      Commencer l'essai gratuit
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{TRIAL_NOTE}</p>
              </div>

              <div id="contact" className="scroll-mt-20 rounded-xl border border-border bg-background p-6 sm:p-8">
                <h3 className="text-lg font-semibold text-foreground">Demander une démo ou nous écrire</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Laissez-nous un message : nous vous recontactons rapidement pour organiser une démonstration ou répondre à vos questions.
                </p>
                <form onSubmit={handleContactSubmit} className="mt-6 space-y-4" aria-busy={isSubmitting}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-nom">Nom</Label>
                      <Input
                        ref={nameInputRef}
                        id="contact-nom"
                        autoComplete="name"
                        value={contactForm.name}
                        onChange={(e) => updateField('name')(e.target.value)}
                        placeholder="Votre nom"
                        className="max-md:h-11"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-email">E-mail</Label>
                      <Input
                        id="contact-email"
                        type="email"
                        autoComplete="email"
                        value={contactForm.email}
                        onChange={(e) => updateField('email')(e.target.value)}
                        placeholder="vous@entreprise.fr"
                        className="max-md:h-11"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-entreprise">
                      Entreprise <span className="font-normal text-muted-foreground">(facultatif)</span>
                    </Label>
                    <Input
                      id="contact-entreprise"
                      autoComplete="organization"
                      value={contactForm.company}
                      onChange={(e) => updateField('company')(e.target.value)}
                      placeholder="Nom de votre entreprise"
                      className="max-md:h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-message">Message</Label>
                    <Textarea
                      id="contact-message"
                      value={contactForm.message}
                      onChange={(e) => updateField('message')(e.target.value)}
                      placeholder="Comment pouvons-nous vous aider ?"
                      className="min-h-[120px]"
                      required
                    />
                  </div>
                  <Button type="submit" variant="primary" loading={isSubmitting} className="max-md:h-11 max-sm:w-full">
                    {isSubmitting ? 'Envoi…' : 'Envoyer le message'}
                  </Button>
                </form>
              </div>
            </div>
          </section>
        </main>

        <PublicFooter
          width="wide"
          extra={
            <li>
              <a href="#contact" onClick={onAnchorClick('contact')} className={publicFooterLinkClass}>
                Contact
              </a>
            </li>
          }
        />
      </div>
    </>
  );
};

export default SkalrLanding;
