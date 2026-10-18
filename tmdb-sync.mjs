// Récupère tous les films d'horreur depuis 2000 sur TMDB et écrit films.js pour la Filmothèque.
// Usage : node tmdb-sync.mjs        (le jeton est lu dans .env : TMDB_TOKEN=...)
// Options dans .env : TMDB_MIN_VOTES=50 (filtre qualité), TMDB_FROM=2000
import { readFile, writeFile } from "node:fs/promises";

try { process.loadEnvFile(new URL(".env", import.meta.url)); } catch {}

const TOKEN = process.env.TMDB_TOKEN?.trim();
const MIN_VOTES = Number(process.env.TMDB_MIN_VOTES ?? 50);
const FROM = Number(process.env.TMDB_FROM ?? 2000);
const TO = new Date().getFullYear();
const OUT = new URL("films.js", import.meta.url);
const API = "https://api.themoviedb.org/3";
const HORROR = 27;

if (!TOKEN) {
  console.error("Jeton manquant : créez un fichier .env à côté de ce script avec la ligne\n  TMDB_TOKEN=votre_jeton_d_accès_en_lecture");
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 401) {
      console.error("TMDB refuse le jeton (401). Utilisez le « Jeton d'accès en lecture » (long, commence par eyJ…), pas la clé API courte.");
      process.exit(1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
      continue;
    }
    throw new Error(`TMDB ${res.status} sur ${path} : ${await res.text()}`);
  }
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// Cache : on garde les détails déjà téléchargés pour ne pas tout refaire à chaque synchronisation
async function loadCache() {
  try {
    const txt = await readFile(OUT, "utf8");
    const data = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    return new Map(data.films.map(f => [f.id, f]));
  } catch { return new Map(); }
}

const cache = await loadCache();
const found = new Map();

// 1. Découverte, année par année (TMDB plafonne à 500 pages par requête)
for (let year = FROM; year <= TO; year++) {
  let page = 1, pages = 1;
  do {
    const r = await tmdb("/discover/movie", {
      with_genres: HORROR, primary_release_year: year, "vote_count.gte": MIN_VOTES,
      language: "fr-FR", region: "FR", include_adult: "false", sort_by: "popularity.desc", page,
    });
    pages = Math.min(r.total_pages, 500);
    for (const m of r.results) {
      found.set(m.id, {
        ...cache.get(m.id),
        id: m.id, t: m.title, o: m.original_title, y: year, date: m.release_date,
        p: m.poster_path, b: m.backdrop_path, ov: m.overview,
        n: Math.round(m.vote_average * 10) / 10, v: m.vote_count, pop: Math.round(m.popularity * 10) / 10,
      });
    }
  } while (++page <= pages);
  process.stdout.write(`\r${year} : ${found.size} films trouvés`);
}
console.log();

// 2. Détails (durée, réalisation, casting, bande-annonce) pour les films pas encore en cache
const todo = [...found.values()].filter(f => f.min === undefined);
let done = 0;
await pool(todo, 8, async f => {
  const d = await tmdb(`/movie/${f.id}`, { language: "fr-FR", append_to_response: "credits,videos", include_video_language: "fr,en" });
  const vids = d.videos?.results.filter(v => v.site === "YouTube" && v.type === "Trailer") ?? [];
  const trailer = vids.find(v => v.iso_639_1 === "fr") ?? vids[0];
  Object.assign(f, {
    min: d.runtime || null,
    dir: d.credits?.crew.filter(c => c.job === "Director").map(c => c.name) ?? [],
    cast: d.credits?.cast.slice(0, 4).map(c => c.name) ?? [],
    c: d.production_countries?.map(c => c.iso_3166_1) ?? [],
    tr: trailer?.key ?? null,
    ov: f.ov || d.overview,
  });
  process.stdout.write(`\rDétails : ${++done}/${todo.length}`);
});
if (todo.length) console.log();

const films = [...found.values()].sort((a, b) => b.pop - a.pop);
const data = { updated: new Date().toISOString().slice(0, 10), from: FROM, minVotes: MIN_VOTES, films };
await writeFile(OUT, `/* Généré par tmdb-sync.mjs : ne pas modifier à la main. Données : TMDB (themoviedb.org) */\nwindow.LUMEN_CATALOGUE = ${JSON.stringify(data)};\n`);
console.log(`films.js écrit : ${films.length} films d'horreur de ${FROM} à ${TO}.`);
