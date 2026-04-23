# Icons placeholder

L'extension a besoin de 4 icônes PNG : `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`.

Pour la V1 / dev local, tu peux générer rapidement des placeholders avec ImageMagick ou un site comme :
- https://favicon.io/favicon-generator/ (texte "K", fond noir, génère plusieurs tailles)
- https://www.figma.com/ → carré noir avec un "K" blanc bold centré

Une fois les 4 PNG dans ce dossier, le build Vite les copiera automatiquement dans `dist/icons/`.

Pour publier sur le Chrome Web Store, prévoir aussi :
- Promo tile 440x280 px
- Screenshot 1280x800 px (3-5 captures de l'extension en action)
- Description courte (132 chars max)
