/**
 * Migration du cours "Philosophie de l'esprit et la machine" dans Supabase.
 *
 * Prérequis : avoir exécuté 2026-05-18_cours_publics.sql dans Supabase
 * (la colonne est_public et la colonne ordre doivent exister).
 *
 * Lancement :
 *   cd scripts && npm install
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE=eyJ... \
 *   AUTEUR_USER_ID=uuid-de-ton-compte \
 *   node migrer-cours-philo.js
 *
 * Idempotence : si un cours portant exactement ce titre existe déjà,
 * le script s'arrête sans rien créer.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Variables d'environnement ────────────────────────────────────────────────
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const AUTEUR_USER_ID     = process.env.AUTEUR_USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !AUTEUR_USER_ID) {
  console.error('Variables manquantes. Attendues : SUPABASE_URL, SUPABASE_SERVICE_ROLE, AUTEUR_USER_ID');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

// ── Lecture du JSON source ───────────────────────────────────────────────────
const jsonPath = join(__dirname, '..', 'migrations', 'data', 'cours-philo-esprit.json');
const source = JSON.parse(readFileSync(jsonPath, 'utf8'));
const { cours: coursData, fiches: fichesData } = source;

// ── Idempotence ──────────────────────────────────────────────────────────────
const { data: existant, error: errCheck } = await supa
  .from('cours')
  .select('id')
  .eq('titre', coursData.titre)
  .limit(1);

if (errCheck) {
  console.error('Erreur lors de la vérification :', errCheck.message);
  process.exit(1);
}

if (existant && existant.length > 0) {
  console.error(`Un cours nommé "${coursData.titre}" existe déjà (id : ${existant[0].id}). Arrêt.`);
  process.exit(1);
}

// ── Insertion du cours ───────────────────────────────────────────────────────
console.log(`Insertion du cours "${coursData.titre}"…`);

const { data: coursInsere, error: errCours } = await supa
  .from('cours')
  .insert({
    user_id:    AUTEUR_USER_ID,
    titre:      coursData.titre,
    discipline: coursData.discipline,
    niveau:     coursData.niveau,
    description: coursData.description,
    est_public: true,
  })
  .select('id')
  .single();

if (errCours) {
  console.error('Erreur insertion cours :', errCours.message);
  process.exit(1);
}

const coursId = coursInsere.id;
console.log(`Cours créé → id : ${coursId}`);

// ── Insertion des fiches ─────────────────────────────────────────────────────
const fichesSaisies = [];

for (const fiche of fichesData) {
  console.log(`  Insertion fiche ${fiche.ordre} : "${fiche.titre}"…`);

  const { data: ficheInseree, error: errFiche } = await supa
    .from('fiches')
    .insert({
      user_id:    AUTEUR_USER_ID,
      cours_id:   coursId,
      titre:      fiche.titre,
      discipline: fiche.discipline,
      contenu:    fiche.contenu,
      ordre:      fiche.ordre,
    })
    .select('id,titre')
    .single();

  if (errFiche) {
    console.error(`  Erreur insertion fiche "${fiche.titre}" :`, errFiche.message);
    process.exit(1);
  }

  fichesSaisies.push(ficheInseree);
}

// ── Récapitulatif ────────────────────────────────────────────────────────────
console.log('\n── Récapitulatif ──');
console.log(`Cours  : ${coursId}`);
fichesSaisies.forEach((f, i) => {
  console.log(`Fiche ${i + 1} : ${f.id}  "${f.titre}"`);
});
console.log('\nMigration terminée avec succès.');
