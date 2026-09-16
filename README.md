# Brayano AI

Plateforme permettant à une entreprise de connecter un numéro WhatsApp à un agent conversationnel IA.

## Statut actuel
**Plateforme multi-tenant opérationnelle** : chaque entreprise possède son propre compte utilisateur, sa configuration IA, ses conversations et sa session WhatsApp persistée. La qualification configurable permet de demander des champs obligatoires avant le routage vers un commercial.

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
- [x] Phase 8 — Qualification prospects, score, statuts et routage commercial
- [x] Phase 9 — Authentification et isolation par entreprise
- [x] Phase 10 — Dashboard
- [ ] Phase 11 — n8n / webhooks
- [ ] Phase 12 — Dockerisation complète
- [ ] Phase 13 — Tests

## Stack
Node.js, TypeScript, Fastify, Baileys (WhatsApp non officiel, multi-compte), PostgreSQL + Prisma 7, Google Gemini (`@google/genai`), dashboard HTML/CSS/JavaScript statique.

## Dashboard
Une interface web statique est disponible dans `apps/dashboard/`. Elle permet de piloter une entreprise, consulter les conversations, reprendre la main sur un échange, configurer l'agent IA et connecter WhatsApp.

Pour la prévisualiser pendant que le backend tourne sur le port 3000 :
```bash
python -m http.server 4173 --directory apps/dashboard
```
Puis ouvrir `http://localhost:4173`. Le dashboard utilise l'API `http://localhost:3000` par défaut ; cette URL peut être remplacée avec `localStorage.setItem("brayano_api", "http://...")`.

## Livraison Render

- Le service backend doit conserver le disque persistant monté sur `/data`.
- `WHATSAPP_AUTH_DIR` doit rester égal à `/data/wa-session`.
- Ne jamais utiliser l'action dashboard **Déconnecter ce numéro** pour une simple déconnexion de l'application : cette action supprime volontairement la session WhatsApp.
- Avant un déploiement, vérifier que la base Render contient les colonnes du schéma actuel, notamment `qualification_fields` dans `ai_settings`.
- L'historique Prisma de ce dépôt contient des migrations créées sur plusieurs environnements. Ne pas lancer `prisma migrate reset` en production. Vérifier `prisma migrate status` et appliquer uniquement les migrations validées sur la base Render.
