# Brayano AI — Backend

## Prérequis
- Node.js 20+ ou 22+
- npm

## Installation
```bash
npm install
```

## Configuration
```bash
copy .env.example .env
# puis remplir .env : DATABASE_URL (déjà correct pour le docker-compose fourni),
# GEMINI_API_KEY (obligatoire, https://aistudio.google.com/app/apikey)
```

## Base de données
Depuis la racine du projet (`brayano-ai/`, pas `apps/backend/`) :
```bash
docker compose up -d
```
Puis, depuis `apps/backend/` :
```bash
npm run db:migrate
npm run db:generate
```

Le catalogue produits utilise la migration `20261003000000_add_product_catalog`. Après avoir vérifié que `DATABASE_URL` cible bien la base locale, applique les migrations avant de démarrer le dashboard.

## Lancement (développement)
```bash
npm run dev
```

## Vérification
```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/db
```

---

## Flux multi-tenant (une entreprise = un numéro WhatsApp = sa propre IA)

### 1. Créer une entreprise
```bash
curl.exe -X POST http://localhost:3000/organizations -H "Content-Type: application/json" -d "{\"name\":\"École ABC\"}"
```
Récupère l'`id` retourné (`organizationId`) — c'est la clé de toutes les routes suivantes.

### 2. Configurer sa base de connaissances (agent IA)
```bash
curl.exe -X PUT http://localhost:3000/organizations/<orgId>/ai-settings -H "Content-Type: application/json" -d "{\"agentName\":\"Assistant École ABC\",\"businessInfo\":\"École ABC propose des formations en informatique et en gestion. Frais d'inscription : 50000 FCFA.\",\"systemPrompt\":\"Ton rôle est d'accueillir les futurs étudiants, répondre à leurs questions sur les formations, et collecter leur nom, la formation recherchée et leur ville.\"}"
```
Si tu ne configures rien, des valeurs génériques par défaut sont utilisées automatiquement à la première conversation.

### Catalogue produits et photos

Dans le dashboard HTML, ouvre **Produits** pour créer une fiche avec son nom, sa description, sa catégorie, son prix et une photo JPEG, PNG ou WebP (5 Mo maximum). Une fiche désactivée n’est pas proposée à l’agent. Les images sont enregistrées dans `PRODUCT_IMAGE_DIR`. Si la variable n'est pas définie, elles sont rangées à côté des sessions WhatsApp (`<dossier de WHATSAPP_AUTH_DIR>/product-images`), donc sur le même disque persistant. En production, laisse-la vide : le serveur affiche un avertissement au démarrage si les photos ne sont pas sur le même disque que les sessions.

L’agent reçoit les fiches actives comme contexte et peut sélectionner leur identifiant lorsqu’un prospect demande une photo. Le backend vérifie cet identifiant dans le catalogue de la même entreprise et transmet l’image stockée, jamais une URL de photo arbitraire produite par le modèle.

Les URLs médias sont publiques afin que WhatsApp puisse récupérer les images. N’y stocke donc que des photos destinées à être partagées avec les prospects.

### 3. Connecter le numéro WhatsApp de cette entreprise
```bash
curl.exe -X POST http://localhost:3000/organizations/<orgId>/whatsapp/connect
```
Puis ouvre dans le navigateur :
```
http://localhost:3000/organizations/<orgId>/whatsapp/qr-view
```
Scanne avec WhatsApp (**Réglages > Appareils liés > Lier un appareil**) sur le téléphone du numéro de **cette entreprise précise**.

### 4. Répéter pour une deuxième entreprise
Refais les étapes 1 à 3 avec un autre nom et un autre numéro WhatsApp — chaque entreprise a sa session, ses conversations et son agent totalement isolés.

### 5. Conversations
```bash
curl http://localhost:3000/organizations/<orgId>/conversations
curl http://localhost:3000/organizations/<orgId>/conversations/<id>
```

### 6. Takeover humain
```bash
curl.exe -X POST http://localhost:3000/organizations/<orgId>/conversations/<id>/ai/disable
curl.exe -X POST http://localhost:3000/organizations/<orgId>/conversations/<id>/reply -H "Content-Type: application/json" -d "{\"text\":\"Réponse humaine\"}"
curl.exe -X POST http://localhost:3000/organizations/<orgId>/conversations/<id>/ai/enable
```

### 7. Suivi des clients, relances, messages groupés, équipe

- **Photos et documents reçus** : enregistrés sur le disque persistant (`CLIENT_MEDIA_DIR`, par défaut à côté de `wa-session`), supprimés après `CLIENT_MEDIA_RETENTION_DAYS` jours (90 par défaut). Le propriétaire est prévenu par email ; une preuve de paiement probable marque la conversation « paiement à vérifier ». L'IA ne confirme jamais un paiement : seul le propriétaire le fait (onglet Commandes). Les vidéos et autocollants sont toujours ignorés.
- **Étiquettes** (Nouveau, Intéressé, A commandé, À rappeler) : posées automatiquement, modifiables à la main (`POST /conversations/:id/stage`, `AUTO` rend la main à l'assistant).
- **Horaires d'ouverture et relances automatiques** : réglés dans `PUT /ai-settings` (`businessHours*`, `closedMessage`, `followUp*`). Les relances ne partent que vers les clients « Intéressé » dont le dernier message vient de l'IA, jamais hors horaires, jamais après un « STOP ».
- **Statistiques** : `GET /organizations/:id/stats?days=1|7|30` (le temps gagné est une estimation d'une minute par réponse de l'IA).
- **Corrections** : `POST /conversations/:id/messages/:messageId/correct` et `/ai-corrections` ; l'assistant s'en souvient. Il s'inspire aussi, de façon anonymisée, des conversations passées qui ont abouti (commande, rendez-vous).
- **Messages groupés** : `/organizations/:id/broadcasts` (aperçu, envoi, annulation). Garde-fous : clients ayant écrit dans les 30 derniers jours, pas de désinscrits, envoi par lots de 50 destinataires au maximum (un groupe plus grand : on renvoie le même message, les clients qui l'ont déjà reçu sont exclus), 100 messages par 24 h, un seul envoi à la fois, pause aléatoire de 8 à 20 s, mention « répondez STOP » ajoutée automatiquement. Un envoi interrompu par un redémarrage reprend tout seul.
- **Équipe** : `/organizations/:id/team`. Un employé (rôle `AGENT`) répond aux clients et suit commandes et rendez-vous ; il ne peut ni modifier l'agent, ni le catalogue, ni WhatsApp, ni l'équipe (liste blanche dans `src/shared/permissions.ts`).
- Les tâches de fond (relances, reprise des envois, nettoyage des fichiers) tournent toutes les 5 minutes ; `BACKGROUND_JOBS=false` les coupe.
- Au démarrage, `prisma db push` ajoute les nouvelles colonnes (aucune donnée n'est supprimée).

- **Numéro WhatsApp à l'inscription** : le formulaire demande le numéro de l'entreprise (`whatsappNumber`, avec indicatif ; un mobile camerounais à 9 chiffres reçoit `+237`). Il est gardé dans `organizations.whatsapp_number`, pré-remplit la connexion par code d'association, et la page WhatsApp prévient si le téléphone relié est un autre numéro. Les anciens comptes l'ajoutent depuis la page WhatsApp (`PUT /organizations/:id/whatsapp/number`).
- **Photos de produits durables** : chaque photo est copiée dans la base (`product_images`) en plus du disque. Après un redéploiement sans disque persistant, elle est reconstituée à la demande ; au démarrage, les photos qui n'existent que sur le disque sont copiées en base. Si une photo ne peut malgré tout pas partir, le client reçoit le texte et un message honnête, et le journal « Pourquoi cette réponse ? » le signale. Les photos et documents **reçus des clients** restent sur le disque (`CLIENT_MEDIA_DIR`).
- **Disque persistant (Render)** : les sessions WhatsApp (`WHATSAPP_AUTH_DIR`, par défaut `/data/wa-session`) ne sont conservées entre deux redémarrages que si un disque est monté sur `/data`. Sans disque, il faut relier le numéro à chaque redémarrage.

### Tester avec une vraie base
```bash
INTEGRATION_DB=1 DATABASE_URL=postgresql://.../base_de_test npm test
```
Les tests d'intégration vident la base indiquée : n'utilisez jamais celle d'un client.

---

## Erreurs fréquentes

- **`Cannot find module '../generated/prisma/client.ts'`** — lance `npm run db:generate`.
- **`APP_URL invalide` / `GEMINI_API_KEY est requis`** — vérifie ton `.env`.
- **`Ce compte WhatsApp n'est pas connecté pour cette entreprise.`** en réponse à `/reply` — l'entreprise concernée n'a jamais fait `POST /whatsapp/connect`, ou le serveur a redémarré depuis (chaque redémarrage nécessite de rappeler `connect`, qui réutilise la session déjà scannée si `wa-session/<orgId>/` existe encore).
- **PowerShell + `curl`** — utilise `curl.exe` (pas l'alias `curl` de PowerShell) pour les requêtes avec body/headers, ou `Invoke-RestMethod`.
- **`npm audit fix --force`** — ne jamais lancer sur ce projet (dépendance Baileys non officielle, ça changerait sa version de façon incontrôlée).

## Structure

```
src/
├── config/          # Variables d'environnement
├── organizations/   # Création/lecture des entreprises (multi-tenant)
├── products/        # Catalogue produit et stockage des photos
├── whatsapp/        # Adapter Baileys + registre multi-comptes
├── ai/              # Orchestrateur IA, providers, base de connaissances (ai_settings)
├── conversations/   # Logique conversation
├── contacts/
├── database/        # Prisma
├── shared/          # Erreurs, utils communs
├── routes/          # Contrôleurs HTTP
└── server.ts
```

## Livraison

Le backend utilise une authentification par session et isole les données par organisation. Les sessions WhatsApp sont stockées dans `WHATSAPP_AUTH_DIR` et restaurées automatiquement au démarrage lorsqu'elles existent encore.

En production, utilise `npm run db:migrate:deploy` uniquement après avoir vérifié l'état de la base avec `npx prisma migrate status`. Ne lance jamais `prisma migrate reset` sur la base d'un client.
