-- L'option « image de l'agent » est retirée du produit : elle stockait l'image en base64 directement
-- dans cette colonne (jusqu'à ~7 Mo par entreprise) et affichait mal son aperçu. On vide les valeurs
-- existantes sans supprimer la colonne (réversible si la fonctionnalité est un jour réintroduite proprement).
UPDATE "ai_settings" SET "agent_image_url" = NULL WHERE "agent_image_url" IS NOT NULL;
