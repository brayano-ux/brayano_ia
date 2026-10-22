# Frontend dashboard architecture

This dashboard is being reorganized around a feature-first structure so it is easier to maintain and extend.

## Structure

```text
apps/dashboard/
├── index.html                 # Page d'accueil publique (HTML + landing.css, sans JavaScript de framework)
├── landing.css
├── assets/                    # Logo, image de partage (og-image.png)
├── app/
│   └── index.html             # Document HTML minimal du tableau de bord (adresse /app/)
├── src/
│   ├── bootstrap.js            # Charge les fragments avant les features
│   ├── templates/
│   │   ├── auth.html
│   │   ├── app-shell.html
│   │   └── views/               # Une vue HTML par fonctionnalité
│   ├── config.js
│   ├── state/
│   │   └── store.js
│   ├── services/
│   │   ├── api.js
│   │   └── storage.js
│   ├── utils/
│   │   ├── format.js
│   │   └── ui.js
│   ├── features/
│   │   ├── auth/
│   │   │   └── auth.js
│   │   ├── dashboard/
│   │   │   └── dashboard.js
│   │   ├── whatsapp/
│   │   │   └── whatsapp.js
│   │   ├── routing/
│   │   │   └── routing.js
│   │   └── settings/
│   │       └── settings.js
│   └── styles/                  # CSS modulaire chargé via main.css
│       ├── main.css
│       ├── base.css
│       ├── layout.css
│       └── components.css
└── README.md
```

## Principles

- Feature-first organization instead of one giant file.
- Keep UI, API logic and business state separate.
- Use small modules with one responsibility.
- Create reusable utilities for numbers, dates and formatting.
- Prepare the app for future evolution (multi-page or component-driven rebuild).

## UX goals

- clearer navigation,
- lighter dashboard,
- faster scanning of leads,
- visible actions for critical tasks,
- more consistent spacing and states,
- better mobile support.

## Chargement

`app/index.html` fournit uniquement le document et le point d’entrée du tableau de bord. `src/bootstrap.js` charge l’authentification, la coquille commune et les vues depuis `src/templates/`, puis importe `src/app.js`. Les vues sont injectées avant l’initialisation des fonctionnalités afin que leurs sélecteurs DOM restent disponibles.

Les styles sont organisés sous `src/styles/` et chargés dans l’ordre par `main.css`. Ajoute une nouvelle vue dans `src/templates/views/`, sa logique dans `src/features/`, son style dans `src/styles/`, puis raccorde son module et son chargeur dans `src/app.js` et `src/bootstrap.js`.


## Page d'accueil et adresse du tableau de bord

Le dossier `apps/dashboard` est publié tel quel sur Render (Static Site, dossier à publier `apps/dashboard`, aucune compilation) : **l'adresse du site ne change pas**.

- `/` : page d'accueil (landing). Un visiteur connecté (jeton dans `localStorage`, clé `brayano_session`) est renvoyé tout de suite vers `/app/`. Ajouter `?accueil` à l'adresse permet de voir la page d'accueil même connecté.
- `/app/` : tableau de bord (connexion). `/app/?inscription` ouvre directement le formulaire de création de compte.
- Dans le backend, mettre `CLIENT_DASHBOARD_URL` sur l'adresse `/app/` (ex. `https://brayanoia.onrender.com/app/`) pour que les liens des emails mènent directement au tableau de bord. Les balises de partage (`og:url`, `og:image`, `canonical`) de `index.html` contiennent l'adresse du site : à adapter si le domaine change.
- En local : `python -m http.server 4173 --directory apps/dashboard`, puis `http://localhost:4173/` (accueil) ou `http://localhost:4173/app/` (tableau de bord).
