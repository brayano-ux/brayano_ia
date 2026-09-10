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
├── whatsapp/        # Adapter Baileys + registre multi-comptes
├── ai/              # Orchestrateur IA, providers, base de connaissances (ai_settings)
├── conversations/   # Logique conversation
├── contacts/
├── database/        # Prisma
├── shared/          # Erreurs, utils communs
├── routes/          # Contrôleurs HTTP
└── server.ts
```

## Statut de la phase
Multi-tenant activé en avance de phase : chaque entreprise créée via `POST /organizations` a son propre compte WhatsApp (session Baileys isolée), sa propre base de connaissances (`ai_settings`), et ses conversations totalement isolées. Pas encore d'authentification (Phase 9) — n'importe qui connaissant un `organizationId` peut l'utiliser pour l'instant, à garder en tête avant tout déploiement public.
