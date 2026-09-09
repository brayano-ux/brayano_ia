-- Activé dès le premier démarrage du conteneur PostgreSQL.
-- pgvector n'est pas utilisé activement au MVP, mais on le prépare
-- dès maintenant pour éviter une migration douloureuse plus tard (RAG / knowledge_chunks).
CREATE EXTENSION IF NOT EXISTS vector;
