-- Migration : cours publics et ordre des fiches
-- À exécuter manuellement dans la console SQL Supabase.
-- Date : 2026-05-18

-- 1. Colonne est_public sur la table cours
ALTER TABLE cours ADD COLUMN est_public boolean DEFAULT false NOT NULL;

-- 2. Colonne ordre sur la table fiches (NULL par défaut, aucune contrainte)
ALTER TABLE fiches ADD COLUMN ordre integer;

-- 3. Politique SELECT publique sur cours (anon + authenticated peuvent lire les cours publics)
CREATE POLICY "cours_public_read"
  ON cours
  FOR SELECT
  TO anon, authenticated
  USING (est_public = true);

-- 4. Politique SELECT publique sur fiches (anon + authenticated peuvent lire les fiches
--    dont le cours parent est public)
CREATE POLICY "fiches_public_read"
  ON fiches
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cours
      WHERE cours.id = fiches.cours_id
        AND cours.est_public = true
    )
  );
