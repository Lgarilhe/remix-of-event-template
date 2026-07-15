# Konekt Design System — « Grove »

Direction artistique inspirée du projet **Misso – Productivity Platform** (Halo Lab, Behance) :
identité chaleureuse et nature, light-first, formes très arrondies, accents joyeux.

> ⚠️ Note de fidélité : la référence Behance n'était pas accessible depuis l'environnement de
> travail (politique réseau). Cette déclinaison s'appuie sur la description documentée du projet
> (« playful, nature-inspired visual identity ») et le style connu de l'agence. À affiner avec
> des captures d'écran de la référence si besoin.

## Principes

1. **Crème, pas blanc** — le fond `hsl(40 43% 95%)` réchauffe tout l'écran ; les cartes blanches ressortent dessus.
2. **Vert forêt en primaire** (`hsl(148 48% 23%)`), **lime pour les CTA « moment de joie »** (`hsl(90 65% 55%)`).
3. **Accents pastel** (soleil, pêche, lavande, ciel) réservés aux statuts et étapes du pipeline.
4. **Rondeur systématique** — boutons pilule, cartes 20 px, inputs 16 px.
5. **Trois voix typographiques** — Instrument Serif (émotion / héro), Bricolage Grotesque (titres UI), Instrument Sans (corps). Space Mono pour les données.
6. **Ombres chaudes** — teintées brun, jamais de noir pur.

## Structure

```
tokens.css                 — variables CSS (source de vérité, format HSL du repo)
foundations/               — couleurs, typographie, espacement/rayons, ombres
components/                — boutons, champs, badges, cartes, navigation, table, kanban
patterns/                  — dashboard bento, landing héro
_ds_manifest.json          — index des cartes (généré)
```

Chaque preview HTML est autonome (tokens inlinés) et porte un marqueur `@dsCard` en première
ligne pour le panneau Design System de claude.ai/design.

## Application dans l'app

Les tokens sont volontairement au même format que `src/index.css` (HSL, mêmes noms shadcn :
`--background`, `--primary`, `--radius`…). Migration prévue :

1. Remplacer le bloc `:root` de `src/index.css` par `tokens.css` (le thème actuel est dark-first
   « Qonto » ; Grove est **light-first** — prévoir la bascule `darkMode` en conséquence).
2. Mapper les accents (`--accent-lime`, `--stage-*`) dans `tailwind.config.ts`.
3. Vérifier les composants qui référencent les anciennes variables (`--skalr-*`).

Rien n'est appliqué à l'app pour l'instant — ce dossier est la proposition de design.
