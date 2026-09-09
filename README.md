# Brayano AI

Plateforme permettant à une entreprise de connecter un numéro WhatsApp à un agent conversationnel IA.

## Statut actuel
**Multi-tenant activé** (en avance sur la Phase 14 initialement prévue) : chaque entreprise créée a son propre numéro WhatsApp, sa propre base de connaissances (agent IA configurable), et ses conversations isolées. Pas encore d'authentification par compte utilisateur (à venir).

Voir `apps/backend/README.md` pour le flux complet (créer une entreprise → configurer l'agent → connecter WhatsApp → discuter).

## Feuille de route (phases)
- [x] Phase 0 — Architecture et choix techniques
- [x] Phase 1 — Initialisation du projet
- [x] Phase 2 — Base PostgreSQL + Prisma
- [x] Phase 3 — Connexion WhatsApp (Baileys) avec adapter
- [x] Phase 4 — Réception/envoi des messages
- [ ] Phase 5 — Mémoire conversationnelle avancée (résumé, profil) — reportée
- [x] Phase 6 — Intégration LLM (Gemini)
- [x] Multi-tenant (avancé depuis la Phase 14) — une entreprise = un numéro WhatsApp = sa base de connaissances
- [ ] Phase 8 — Qualification prospects (score, statuts) — le JSON IA calcule déjà `leadScore`/`leadData`, pas encore persisté en table `prospects`
- [ ] Phase 9 — Authentification (comptes utilisateurs par entreprise)
- [ ] Phase 10 — Dashboard
- [ ] Phase 11 — n8n / webhooks
- [ ] Phase 12 — Dockerisation complète
- [ ] Phase 13 — Tests

## Stack
Node.js, TypeScript, Fastify, Baileys (WhatsApp non officiel, multi-compte), PostgreSQL + Prisma 7, Google Gemini (`@google/genai`), Next.js (dashboard, à venir).

## Dashboard
Une interface web statique est disponible dans `apps/dashboard/`. Elle permet de piloter une entreprise, consulter les conversations, reprendre la main sur un échange, configurer l'agent IA et connecter WhatsApp.

Pour la prévisualiser pendant que le backend tourne sur le port 3000 :
```bash
python -m http.server 4173 --directory apps/dashboard
```
Puis ouvrir `http://localhost:4173`. Le dashboard utilise l'API `http://localhost:3000` par défaut ; cette URL peut être remplacée avec `localStorage.setItem("brayano_api", "http://...")`.
