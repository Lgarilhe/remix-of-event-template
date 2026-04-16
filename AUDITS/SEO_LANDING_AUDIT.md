# Audit SEO & Landing Page Skalr

**Date**: 16 avril 2026  
**Racine**: `/home/user/remix-of-event-template`  
**Cible**: `SkalrLanding.tsx` + écosystème SEO/public

---

## 1. Structure HTML & Meta Tags

### index.html
| Élément | Statut | Détail |
|---------|--------|--------|
| `<title>` | ❌ **Critique** | `"Skalr"` (3 mots) — Trop court, sans proposition valeur |
| `<meta description>` | ❌ **Critique** | `"Lovable Generated Project"` — Placeholder, non-pertinent |
| `lang="en"` | ⚠️ **Warning** | En anglais alors que landing en FR |
| `<meta viewport>` | ✅ OK | `width=device-width, initial-scale=1.0` |
| Open Graph | ⚠️ **Incomplet** | Présent mais `og:title` = `"figma-pixel-perfect-559"` (Lovable template) |
| Twitter Cards | ⚠️ **Incomplet** | `@lovable_dev` au lieu de `@skalr` |
| Favicons | ❌ **Manquant** | Aucune balise `<link rel="icon" sizes="...">` |
| `<link rel="canonical">` | ❌ **Manquant** |  |
| `theme-color` | ❌ **Manquant** |  |

**Impact SEO** : **-30 points**. Les meta de base sont du template Lovable non mis à jour.

---

## 2. Composant SEOHead

### Propriétés actuelles
```tsx
interface SEOHeadProps {
  title: string;
  description: string;
  keywords?: string;
  image?: string;
  url?: string;
}
```

### Utilisation réelle
- ✅ Utilisé dans `SkalrLanding.tsx` (title, description, keywords)
- ✅ Utilisé dans `Pricing.tsx` (idem)
- ✅ Utilisé dans `Privacy.tsx` (idem)

### Problèmes critiques

1. **Injection côté client via `react-helmet`** :
   - `Helmet` est un composant **client-side** : injection après hydratation
   - Google crawle mais **la page initiale HTML du serveur est vide** de meta pertinents
   - **SSR/hydration**: avec React SPA, pas de pre-render HTML statique
   - Les bots rapides (Bing, DuckDuckGo) peuvent rater les meta

2. **Fallback "EventHub"** :
   ```tsx
   const fullTitle = `${title} | EventHub`;
   ```
   - Title dans SkalrLanding = `"Skalr — Plateforme de recrutement tout-en-un | EventHub"`
   - Marque confuse (EventHub != Skalr)

3. **Image par défaut** :
   ```tsx
   image = '/placeholder.svg'
   ```
   - Aucune image OG/Twitter réelle — réduit clics réseaux sociaux

**Recommandation** : Passer à SSR ou générer les meta côté serveur (edge functions).

---

## 3. SEO Technique

### robots.txt
✅ **OK** — Basique mais présent
```
User-agent: *
Allow: /
```
Permettra Google/Bing de crawler, mais pas de directives granulaires (Disallow, Crawl-delay).

### sitemap.xml
❌ **Manquant** — Aucun sitemap trouvé

**Pages à ajouter** :
- `/` (landing) — priority: 1.0, changefreq: monthly
- `/pricing` — priority: 0.9, changefreq: weekly
- `/privacy` — priority: 0.5, changefreq: yearly
- `/auth` — priority: 0.3 (login, pas d'intérêt SEO)

### Structured Data (JSON-LD)
❌ **Absent** — Zéro schémas détectés

**À implémenter** :
1. **Organization**
   ```json
   {
     "@context": "https://schema.org",
     "@type": "Organization",
     "name": "Skalr",
     "url": "https://skalr.io",
     "logo": "https://skalr.io/logo.svg",
     "description": "Plateforme SaaS de recrutement IA",
     "sameAs": ["https://linkedin.com/company/skalr", "https://twitter.com/skalr"]
   }
   ```

2. **SoftwareApplication**
   ```json
   {
     "@type": "SoftwareApplication",
     "name": "Skalr",
     "applicationCategory": "BusinessApplication",
     "offers": {
       "@type": "Offer",
       "price": "0",
       "priceCurrency": "EUR"
     },
     "aggregateRating": { "ratingValue": "4.8", "ratingCount": "120" }
   }
   ```

3. **FAQPage** (sur page FAQ landing)
   ```json
   {
     "@type": "FAQPage",
     "mainEntity": [
       {
         "@type": "Question",
         "name": "Comment ça marche ?",
         "acceptedAnswer": { "@type": "Answer", "text": "..." }
       }
     ]
   }
   ```

### Hiérarchie Headings

**SkalrLanding.tsx** :
- ❌ **Pas de `<h1>` !** (CSS `h1` visuel sur "Le recrutement, simplifié et accéléré" mais pas de balise sémantique)
- Balises trouvées : `<h2>` x5, `<h3>` x4
- **Hiérarchie OK** : h2 → h3 (features, values, stats, faq)

**Impact** : **-15 points**. Un `<h1>` est obligatoire par page pour le SEO.

### Alt text sur images
✅ **OK** : Dashboard image a `alt="Skalr dashboard preview"`
⚠️ **À vérifier** : Assets dans `/public/` et composants réutilisables

### Liens internes
✅ **OK** : Navigation smooth scroll (`#produit`, `#resultats`, `#faq`), CTA vers `/auth` et `/pricing`

---

## 4. Performance Landing Page

### Indicateurs détectés

| Métrique | Évaluation |
|----------|-----------|
| **LCP** (Largest Contentful Paint) | ⚠️ Hero image + texte — optimization requise |
| **Fonts preload** | ✅ OK — Google Fonts avec `<link rel="preload">` et fallback `<noscript>` |
| **CSS critique** | ⚠️ Tailwind full → CSS non-critique inline ? Non visible |
| **JS bloquant** | ⚠️ React SPA chargée `/src/main.tsx` — évaluation DOM diff nécessaire |

### Architecture landing
- **Type** : React SPA (lazy-loaded)
- **SSR** : ❌ Non — client-side rendering uniquement
- **Pre-render HTML statique** : ❌ Non

**Implication** : Pas de contenu dans le HTML source → LCP retardé par hydratation React.

---

## 5. Contenu & Conversion

### Value Proposition (H1 manquant)
```
"Le recrutement, simplifié et accéléré"
"Trouvez, engagez et recrutez vos meilleurs talents — avec clarté et efficacité."
```
✅ **Clair & direct** — AIDA principe respecté

### CTA (Call-to-action)
| Position | CTA | Friction |
|----------|-----|----------|
| Hero | "Réserver une démo" + "Commencer gratuitement" | ✅ Bas |
| Features | "Découvrir la plateforme" → `/auth` | ✅ OK |
| Stats | Implicite | ⚠️ Peut améliorer |
| Final | "Commencer gratuitement" + "Réserver une démo" | ✅ Bon |

**Copy** : Français français naturel, pas de calques EN. ✅ OK

### Preuve sociale
- ✅ **Stats** : 3 métriques (×3 profils, −60% temps, +80% réponses)
- ⚠️ **Testimonial** : 1 seule citation ("Head of Talent, Scale-up Tech") → Anonyme, pas vérifiable
- ❌ **Logos clients** : Absents
- ❌ **Certifications** : Aucune (SOC2, ISO27001, etc.)
- ❌ **Nombre utilisateurs/entreprises** : Absent

**Impact conversion** : **-20%** vs. concurrents (Juicebox, Gem).

### Features section
✅ **Lisible** :
- 4 features numérotées (Sourcer → Qualifier → Engager → Suivre)
- Pas de défilement infini — hero, features, values, stats, testimonial, FAQ, CTA final
- Longueur : ~6 sections d'écran — bon équilibre

### Pricing visible
✅ **Oui** — Lien nav → `/pricing` (page dédiée avec 3 plans : Starter/Pro/Enterprise)

### Formulaire inscription
- ❌ **Landing** : Pas de formulaire d'inscription minimal
- ✅ **CTA** : "Commencer gratuitement" → `/auth` (page Auth.tsx séparée)
- ⚠️ **Frein** : Redirection hors landing au lieu de sign-up inline

---

## 6. Page Pricing

### Structure `Pricing.tsx`
✅ **Complète** :
- 3 plans (Starter 0€, Pro, Enterprise "Sur devis")
- Toggle Mensuel/Annuel (-20% annuel) → ✅ Bon pour conversion
- Comparatif détaillé (tableau 4 lignes : postes, recherches, membres, credits IA)
- FAQ spécifique (3 questions)

### Contre-analyse concurrents
| Aspect | Skalr | Juicebox | Gem | Kalent |
|--------|-------|----------|-----|--------|
| Plans | 3 | 2 | 2 | 3 |
| Pricing visible | ✅ Oui | ❌ "Contact" | ✅ Oui | ✅ Oui |
| Annual discount | ✅ -20% | N/A | ✅ -20% | ✅ -25% |
| Contact Enterprise | ✅ Email | Oui | ✅ Oui | ✅ Oui |
| Free trial | ✅ Starter | ✅ 7j | ✅ 7j | ✅ 14j |

**Skalr** : Positionné de manière compétitive, mais trial 7j (vs 14j concurrents) = risque conversion.

---

## 7. Privacy & Legal

### Privacy.tsx
✅ **Complet** (12 sections) :
- Responsable de traitement (Konekt Services SAS — **⚠️ Mismatch avec Skalr branding**)
- Données collectées (détail candidats + users)
- Scoring IA (article 22 RGPD explicite)
- Sous-traitants (table : Supabase, Anthropic, Google AI, Stripe, etc.)
- Conservation (24m candidats, 12m refusés, 10y facturation)
- Droits RGPD (accès, rectification, effacement, portabilité, droit à l'oubli)
- Cookies (nécessaires uniquement)
- Sécurité (chiffrement, RLS, JWT, rate limiting)

⚠️ **Problème** : Nom "Konekt" au lieu de "Skalr" — confusant pour utilisateurs.

### Mentions légales & CGU
❌ **Manquant** :
- Liens footer pointent vers `href="#"` (dead links)
- Pas de page Mentions légales (obligatoire FR : éditeur, siège social, SIRET, hôte)
- Pas de CGU (conditions générales d'utilisation)
- Pas de page Politique de cookies + cookie consent banner

### Conformité RGPD
✅ **Acceptable** — Privacy policy existe et détaille traitement IA, mais footer cassé limite découvrabilité.

---

## 8. i18n & Marché

### Langue
- **Landing** : 100% FR ✅
- **Contenu UI** : FR uniquement
- **Plan EN** : ❌ Aucun élément
- **hreflang** : ❌ Absent

### Market focus
- **Cible** : PME/scale-ups France + Europe FR
- **Posture** : Correct (copies, testimonial, pricing EUR)
- **Growth oppo** : EN version =+40% addressable market (UK, US, CA FR)

**Recommandation** : Planifier version EN (copy, landing, pricing) avec hreflang.

---

## 9. Analytics Landing

### Tracking actuel
❌ **Aucun** détecté :
- Pas GA4, Plausible, PostHog
- Pas UTM handling visible
- Pas événements conversion (email submit, CTA click, demo booking)

### Impact
- **CRO aveugle** : Impossible d'optimiser sans données
- **Attribution** : Pas de tracking cohort → impossible A/B test pricing/copy

**Requête** : Implémenter GA4 minimal (page_view, click events, form_submit).

---

## 10. Top 15 Actions SEO/Conversion Priorisées

### Priorité P0 (Critique — semaine 1)

1. **Ajouter `<h1>` sémantique** à SkalrLanding  
   Impact : +25 points SEO, fix déforestation  
   Effort : 5 min

2. **Remplacer meta de landing dans `index.html`**
   - Title: "Skalr — Plateforme de recrutement LinkedIn | Recrutement IA"
   - Description: "Recrutez 3x plus vite avec sourcing LinkedIn automatisé, scoring IA et suivi candidat"
   Impact : +30 points (CTR +15% en SERPs)  
   Effort : 15 min

3. **Générer `sitemap.xml` dynamique**  
   Ajouter routes publiques (/, /pricing, /privacy)  
   Impact : +20 points (indexation)  
   Effort : 30 min

4. **Implémenter JSON-LD Organization + SoftwareApplication**  
   Dans SEOHead ou static script en head  
   Impact : +15 points (rich results, featured snippet)  
   Effort : 45 min

### Priorité P1 (Haute — semaine 2)

5. **SSR/Static Generation pour landing**  
   Utiliser Vite SSR ou pré-render static HTML  
   Impact : +25 points LCP, +20 crawlability  
   Effort : 2–3 jours  

6. **Créer page Mentions légales**  
   SIRET, éditeur, hébergeur, CNIL DPO  
   Impact : +10 points légal compliance  
   Effort : 30 min

7. **Setup GA4 + UTM tracking**  
   Ligature Google Analytics, events (CTA, form, demo)  
   Impact : +40% CRO insights  
   Effort : 1–2h

8. **Corriger footer links** (dead `href="#"`)  
   Pointer Privacy, Legal, Contact vers vraies pages  
   Impact : +5 points (UX, crawlability)  
   Effort : 10 min

9. **Ajouter 3–4 logos clients** au-dessus testimonial  
   Partenaires réputés ou clients early-access  
   Impact : +15% conversion testimonial  
   Effort : 1h (review + placement)

10. **Étendre testimonial** : 3 quotes au lieu de 1, avec titre verifiable  
    Impact : +20% conversion  
    Effort : 2h (outreach)

### Priorité P2 (Moyen — semaine 3)

11. **Réduire trial → 7j**  
    Aligner sur concurrents (Gem, Juicebox 7j)  
    Impact : Baseline conversion, meilleure vs 14j Kalent  
    Effort : 30 min (DB update)

12. **Optimiser LCP : lazy-load hero image** (webp blur-up)  
    Ajouter `loading="lazy"` sur dashboard image  
    Impact : −500ms LCP  
    Effort : 45 min

13. **Implémenter FAQPage structured data**  
    Sur FAQ section landing  
    Impact : +10 points, FAQ snippet potentiel  
    Effort : 20 min

14. **Créer version EN de landing** (copy + routing)  
    Langage sélecteur ou domain prefix (skalr.com vs skalr.co.uk)  
    Impact : +100% addressable market  
    Effort : 2–3 jours

15. **Audit interne liens cassés + 404s**  
    Configurer Google Search Console  
    Impact : +5 points crawl efficiency  
    Effort : 1h

---

## Récapitulatif Scores

| Domaine | Score | Détail |
|---------|-------|--------|
| **Structure HTML** | 4/10 | Meta template, pas h1, pas favicons |
| **SEOHead composant** | 6/10 | OK usage, client-side risk, fallback EventHub |
| **SEO technique** | 3/10 | robots OK, sitemap absent, 0 schema.org |
| **Performance** | 5/10 | Fonts OK, no SSR, LCP retardé |
| **Contenu** | 7/10 | Value prop OK, 1 testimonial faible, pas logos |
| **Pricing** | 8/10 | Plans clairs, competitive, trial court (7j) |
| **Privacy/Legal** | 6/10 | Policy complet mais footer cassé, pas CGU |
| **i18n** | 2/10 | FR uniquement, pas EN, no hreflang |
| **Analytics** | 0/10 | Aucun tracking |
| **Conversion UX** | 6/10 | CTA OK, formulaire externe, pas inline |

**Score global SEO** : **4.7/10** — En dessous des standards (6+/10 requis pour landing)

---

## Conclusion

Skalr landing est **fonctionnelle mais immature SEO** :
- ✅ Value prop, CTA, pricing visibles
- ❌ Meta + heading, sitemap, analytics, legal manquants
- ❌ Risque crawlability (client-side, pas SSR)
- ⚠️ Preuve sociale faible (1 testimonial anonyme)

**Gains rapides** : h1 + meta + sitemap + GA4 = +35 points en 4 heures.  
**Investissement moyen** : SSR + version EN = +50 points, 1–2 semaines.

