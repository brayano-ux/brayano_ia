# Tableau de bord Brayano IA

Site statique, **sans étape de compilation** : HTML, CSS et JavaScript (modules ES) servis tels quels. Le même dossier
contient la page d'accueil publique, les pages légales et le tableau de bord (adresse `/app/`).

## Organisation

```text
apps/dashboard/
├── index.html, landing.css        # Page d'accueil publique
├── conditions.html, confidentialite.html, fonctionnalites/
├── assets/                        # Logo, captures de la page d'accueil, polices, licences
│   ├── fonts/                     # Inter (variable), hébergée ici : aucune requête vers un autre site
│   └── screens/                   # Captures du tableau de bord montrées sur la page d'accueil
├── app/index.html                 # Document du tableau de bord : écran d'attente + feuilles de style
├── e2e/smoke.cjs                  # Test de parcours (Playwright), lancé par la CI
└── src/
    ├── bootstrap.js               # Charge les icônes et les gabarits, puis démarre app.js
    ├── theme-init.js              # Applique le thème clair/sombre avant le premier affichage
    ├── app.js                     # Assemble les fonctionnalités, le menu, la recherche rapide
    ├── config.js, state/, services/   # Adresse du serveur, session, appels à l'API
    ├── templates/
    │   ├── icons.html             # Toutes les icônes (symboles SVG #i-nom)
    │   ├── auth.html, app-shell.html
    │   └── views/                 # Un gabarit HTML par page
    ├── features/                  # Un dossier par page ou fonction (logique uniquement)
    ├── ui/                        # Briques d'interface réutilisables (voir plus bas)
    ├── utils/                     # Formatage, libellés, DOM, téléphone, CSV
    └── styles/                    # Voir « Système de design »
```

`app/index.html` ne contient que l'écran d'attente et le point d'entrée. `src/bootstrap.js` charge le fichier
d'icônes, l'écran de connexion, la coquille et les pages depuis `src/templates/`, puis importe `src/app.js` : les
gabarits sont en place avant l'initialisation des fonctionnalités.

## Système de design

| Fichier | Rôle |
|---|---|
| `styles/tokens.css` | Les variables : couleurs (clair et sombre), typographie, espacements, rayons, ombres, couleurs des graphiques. |
| `styles/base.css` | Réglages de base, polices, accessibilité (focus, mouvement réduit), utilitaires. |
| `styles/components.css` | Les composants : boutons, champs, interrupteurs, cartes, badges, onglets, listes, alertes, états vides, menus, fenêtres, panneaux latéraux, notifications, barre d'enregistrement. |
| `styles/layout.css` | La coquille : menu latéral, barre du haut, barre d'onglets du téléphone, recherche rapide. |
| `styles/<page>.css` | Ce qui est propre à une page. |
| `styles/main.css` | Feuille de transition pour les navigateurs qui gardent l'ancienne page d'entrée en mémoire. |

Règles à suivre pour que l'ensemble reste cohérent :

- **Couleurs** : toujours une variable de `tokens.css` (`var(--text)`, `var(--surface)`, `var(--primary)`…), jamais une
  couleur écrite en dur. C'est ce qui fait fonctionner le thème sombre (`:root[data-theme="dark"]`).
- **Composants** : réutiliser les classes existantes (`.btn .btn-primary`, `.card`, `.badge`, `.switch`, `.chip`,
  `.empty`, `.alert`, `.drawer`, `.menu`…) avant d'en créer une nouvelle.
- **Icônes** : `<svg class="icon"><use href="#i-nom"></use></svg>` dans un gabarit, ou `icon("nom")` (`ui/icons.js`)
  dans du JavaScript. Tracés Lucide (licence ISC, `assets/LICENSE-Lucide.txt`). Pas d'émoji dans l'interface.
- **Téléphone d'abord** : sous 1024 px, le menu latéral devient une barre d'onglets en bas de l'écran ; les panneaux
  latéraux s'ouvrent depuis le bas. Vérifier chaque page à 390 px de large : aucun défilement horizontal.
- **Textes** : français simple, vouvoiement, le nom exact des boutons entre guillemets « ». Quand un libellé
  change, mettre aussi à jour `apps/backend/src/support-assistant/knowledge.ts` (ce que sait l'assistant d'aide).

### Briques d'interface (`src/ui/`)

| Module | Usage |
|---|---|
| `confirm.js` | `await confirmDialog({ title, message, confirmLabel, tone })` : remplace `window.confirm`. |
| `drawer.js` | `openDrawer(element)` / `closeDrawer(element)` : panneau latéral (feuille en bas sur téléphone). |
| `menu.js` | Menus déroulants : un bouton `data-menu="id"` ouvre l'élément `.menu` portant cet identifiant. |
| `command-palette.js` | Recherche rapide (Ctrl/⌘ + K) : pages, actions, conversations. |
| `charts.js` | Graphique en colonnes et courbes miniatures, avec infobulle et tableau pour lecteurs d'écran. |
| `theme.js` | Thème clair, sombre ou automatique (`localStorage.brayano_theme`). |
| `avatar.js`, `icons.js`, `overlay.js`, `page-title.js` | Pastilles d'initiales, icônes, gestion du focus, titre de l'onglet. |

Les notifications passent par `showToast(message, type)` (`utils/dom.js`).

## Navigation et adresses

Chaque page a son adresse, ce qui permet le bouton « Précédent » du navigateur, l'actualisation et le partage d'un
lien : `#/accueil`, `#/conversations` (et `#/conversations/<id>`), `#/commandes`, `#/rendez-vous`, `#/produits`,
`#/agent`, `#/messages-groupes`, `#/whatsapp`, `#/forfait`, `#/parametres`.

- Tout élément portant `data-view="orders"` (ou `data-view-target`) navigue vers la page, sans autre câblage.
- `navigate(view)` (`features/navigation/navigation.js`) change de page depuis le code.
- `registerLeaveGuard(view, hasUnsavedChanges)` fait demander confirmation avant de quitter une page dont des
  modifications ne sont pas enregistrées (utilisé par « Agent IA » et les réglages de l'agenda).
- Un employé (rôle `AGENT`) ne voit que Accueil, Conversations, Commandes et Rendez-vous.

### Ajouter une page

1. Gabarit dans `src/templates/views/`, ajouté à la liste de `src/bootstrap.js`.
2. Logique dans `src/features/<page>/`, initialisée dans `src/app.js`.
3. Styles dans `src/styles/<page>.css`, déclarés dans `app/index.html` (et `styles/main.css`).
4. Entrée dans `VIEWS` (`navigation.js`), dans le menu (`templates/app-shell.html`) et dans la recherche rapide (`app.js`).
5. Un passage dans `e2e/smoke.cjs`, et le nom de la page dans `knowledge.ts` côté serveur.

## Travailler en local

```bash
# 1. Le serveur (voir apps/backend/README.md), avec une base PostgreSQL locale
cd apps/backend && npm run dev

# 2. Des données de démonstration (« Boutique Awa ») — VIDE la base, refuse toute base non locale
DATABASE_URL=postgresql://…@localhost/… npx tsx src/dev/seed-demo.ts

# 3. Le site
python3 -m http.server 4173 --directory apps/dashboard
```

Puis `http://localhost:4173/` (page d'accueil) ou `http://localhost:4173/app/` (tableau de bord). Comptes de
démonstration : `awa@brayano.test` (propriétaire) et `carine@brayano.test` (employée), mot de passe `DemoPassword123`.

## Tests

`e2e/smoke.cjs` parcourt le tableau de bord dans un vrai navigateur, sur ordinateur puis sur téléphone : connexion,
chaque page et son adresse, retour et actualisation, recherche rapide, ajout et suppression d'un produit, barre
d'enregistrement de l'agent, thème sombre, assistant d'aide, absence de défilement horizontal. La CI le lance à
chaque demande de fusion, contre un serveur et une base jetables.

```bash
cd apps/dashboard/e2e && npm ci && npx playwright install chromium
E2E_EMAIL=demo@brayano.test E2E_PASSWORD=DemoPassword123 node smoke.cjs
```

## Page d'accueil et adresse du tableau de bord

Le dossier `apps/dashboard` est publié tel quel sur Render (Static Site, dossier à publier `apps/dashboard`, aucune compilation) : **l'adresse du site ne change pas**.

- `/` : page d'accueil. Un visiteur connecté (jeton dans `localStorage`, clé `brayano_session`) est renvoyé tout de suite vers `/app/`. Ajouter `?accueil` à l'adresse permet de voir la page d'accueil même connecté.
- `/app/` : tableau de bord (connexion). `/app/?inscription` ouvre directement le formulaire de création de compte.
- Dans le backend, mettre `CLIENT_DASHBOARD_URL` sur l'adresse `/app/` (ex. `https://brayanoia.onrender.com/app/`) pour que les liens des emails mènent directement au tableau de bord. Les balises de partage (`og:url`, `og:image`, `canonical`) de `index.html` contiennent l'adresse du site : à adapter si le domaine change.
- Les captures de `assets/screens/` sont de vraies captures du tableau de bord, prises avec les données de démonstration : les refaire quand l'interface change.

## Sécurité du site statique

- Les pages portent une politique de contenu (CSP) dans une balise `<meta>` : scripts et polices uniquement depuis ce site, pas de script en ligne. `app/index.html` autorise les appels vers l'adresse du serveur définie dans `src/config.js` (`defaultApi`). **Si vous changez l'adresse du serveur, mettez aussi à jour `connect-src` dans `app/index.html`** (un test le vérifie).
- Le tableau de bord se masque s'il est affiché dans un cadre d'un autre site.
- Sur Render (site statique), ajoutez aussi ces en-têtes dans *Settings → Headers* pour `/*` : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: geolocation=(self), microphone=(), camera=()` (une balise `<meta>` ne peut pas les définir ; `geolocation=(self)` est nécessaire au bouton « Utiliser ma position actuelle » de la page Agent IA).
