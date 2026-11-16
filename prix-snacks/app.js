"use strict";
const MG_STOCK = "Le site de MG ne dit pas si ce produit est disponible ou en rupture. Le prix est celui que MG affiche sur mg.tn, mais le produit peut manquer en magasin. Pour Carrefour, Géant et Elsabuy, au contraire, un prix n’est gardé que si le produit est en stock.";   // 15/11/2026 (Ahmed) : explication montrée avec chaque produit MG
// Page privée « Prix des gaufrettes, biscuits et chips » : déchiffre donnees.bin avec le code du lecteur (AES-256-GCM, PBKDF2
// 250 000 tours, même format que le tableau de bord de Clicvia), puis affiche remises, produits et historique sur la DURÉE CHOISIE,
// avec export Excel (SheetJS chargé seulement au clic) et rapport imprimable. Aucun compteur, rien n'est envoyé nulle part.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dt = v => v == null ? "—" : Number(v).toLocaleString("fr-FR", {minimumFractionDigits: 3, maximumFractionDigits: 3}) + " DT";
const pct = v => v == null ? "—" : (v * 100).toLocaleString("fr-FR", {maximumFractionDigits: 1}) + " %";
const dateFr = j => j ? j.slice(8, 10) + "/" + j.slice(5, 7) + "/" + j.slice(0, 4) : "—";
const lire = k => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const CATS = {gaufrettes: "Gaufrettes", biscuits: "Biscuits", chips: "Chips"};
let D = null, F = {periode: "30", de: "", a: "", cat: "", ens: "", marque: "", prod: "", gram: "", q: ""}, ouverts = new Set(), toutVoir = false;
// parties repliées par défaut (Ahmed, 15/11/2026 : « les sections doivent être compactes par défaut, c'est plus facile à lire ») ;
// une partie s'ouvre quand on la touche, par « Aller directement à » ou par une case de chiffres ; le rapport PDF les imprime toutes
const OUVERTES = new Set(); let NV_TOUT = false, IMPRESSION = false, NV_CACHE = null;
// filtre « Produit » (Ahmed, 15/11) : le nom du produit, choisi parmi ceux de la marque choisie (le même nom dans plusieurs magasins = un choix)
const cleProd = p => String(p.n || "").toLowerCase().replace(/\s+/g, " ").trim();
let VUE = "", REM = "";   // cases du haut cliquables (règle d'Ahmed, 15/11/2026) : VUE = "" | "baisse" | "hausse" ; REM = "" | "cours"
let aller = null;
addEventListener("popstate", e => { if (!(e.state && e.state.saut)) { const som = document.querySelector(".sommaire"); if (som) som.scrollIntoView({behavior: "smooth", block: "center"}); } });         // section vers laquelle défiler après le prochain affichage
// Concurrence (15/11/2026) : courbes choisies (marques ou produits ; la couleur suit l'élément, jamais son rang), calendrier complet ou non
let COURBES = [], CAL_TOUT = false, COURBE_MSG = "", REM_TOUT = false, TYPE_REM = "";   // TYPE_REM : "" toutes, "prix" sur le prix, "lot" sur le lot
// type de remise (15/11/2026, demande d'Ahmed et de son frère) : sur le PRIX (prix barré, baisse constatée) ou sur le LOT (offre écrite par le magasin)
const typeRem = r => r.sorte === "lot" ? "Sur le lot : " + (r.offre_texte || "offre du magasin") : r.sorte === "annoncee" ? "Sur le prix : prix barré par le magasin" : "Sur le prix : constatée dans l’historique";
const tauxRem = r => r.taux == null ? "—" : (r.sorte === "lot" ? "≈ " : "") + "−" + pct(r.taux);
const REM_MAX = 20;       // remises montrées d'abord (15/11 : 90 remises en cartes poussaient les courbes très loin sur téléphone)
const MAX_COURBES = 6;
// Grammage (demande d'Ahmed, 15/11/2026) : tranches de poids lues sur le produit ; un lot de plusieurs sachets est à part ; poids non lu = à part
const GRAMMAGES = [["portion", "Portion : jusqu’à 30 g", p => p.g != null && p.l === 1 && p.g <= 30], ["31-60", "31 à 60 g", p => p.g != null && p.l === 1 && p.g > 30 && p.g <= 60],
  ["61-120", "61 à 120 g", p => p.g != null && p.l === 1 && p.g > 60 && p.g <= 120], ["121-250", "121 à 250 g", p => p.g != null && p.l === 1 && p.g > 120 && p.g <= 250],
  ["250+", "Plus de 250 g", p => p.g != null && p.l === 1 && p.g > 250], ["lot", "Lots de plusieurs sachets", p => p.l > 1], ["inconnu", "Poids non lu", p => p.g == null]];
const grammage = p => (GRAMMAGES.find(([, , f]) => f(p)) || [""])[0];

async function dechiffrer(texte, code) {
  const b = Uint8Array.from(atob(texte.trim()), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const cle = await crypto.subtle.deriveKey({name: "PBKDF2", salt: b.slice(0, 16), iterations: 250000, hash: "SHA-256"},
    base, {name: "AES-GCM", length: 256}, false, ["decrypt"]);
  const clair = await crypto.subtle.decrypt({name: "AES-GCM", iv: b.slice(16, 28)}, cle, b.slice(28));
  const flux = new Blob([clair]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(flux).text());
}

async function ouvrir(code, garder) {
  $("#msg").textContent = "Ouverture…";
  let texte;
  try {
    const rep = await fetch("donnees.bin?t=" + Date.now(), {cache: "no-store"});
    if (!rep.ok) { $("#msg").textContent = "Les prix ne sont pas encore publiés sur cette page (le robot les publie chaque nuit dès que le code est créé)."; return; }
    texte = await rep.text();
  } catch { $("#msg").textContent = "Pas de connexion. Réessayez plus tard."; return; }
  try {
    D = await dechiffrer(texte, code);
    if (garder) ecrire("snacks-code", code);
    $("#entree").hidden = true; $("#site").hidden = false; afficher();
  } catch { ecrire("snacks-code", null); $("#msg").textContent = "Code incorrect."; }
}

// ---------- période et filtres
function bornes() {
  const jours = D.jours, dernier = jours[jours.length - 1];
  if (F.periode === "tout") return [jours[0], dernier];
  if (F.periode === "perso") return [F.de || jours[0], F.a || dernier];
  const d = new Date(dernier + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (Number(F.periode) - 1));
  return [d.toISOString().slice(0, 10), dernier];
}
const dansPeriode = (j, [de, a]) => j >= de && j <= a;
function produitPasse(p) {
  if (F.cat && p.c !== F.cat) return false;
  if (F.ens && p.e !== F.ens) return false;
  if (F.marque && p.m !== F.marque) return false;
  if (F.prod && cleProd(p) !== F.prod) return false;
  if (F.gram && grammage(p) !== F.gram) return false;
  if (F.q) { const t = (p.n + " " + p.m).toLowerCase(); if (!F.q.toLowerCase().split(/\s+/).every(m => t.includes(m))) return false; }
  return true;
}
function produitPasseSauf(p, ...sauf) { const g = sauf.map(k => F[k]); for (const k of sauf) F[k] = ""; const r = produitPasse(p); sauf.forEach((k, i) => F[k] = g[i]); return r; }
function serie(p, b) { return D.jours.filter(j => dansPeriode(j, b) && p.p[j]).map(j => [j, p.p[j]]); }

// ---------- affichage
// une partie = un bloc repliable (fermé au départ) : titre toujours visible, contenu montré au toucher
const section = (id, titre, compte) => `<details class="section carte" id="${id}"${OUVERTES.has(id) || IMPRESSION ? " open" : ""}><summary><h2>${titre}</h2>${compte != null ? `<span class="compte">${compte}</span>` : ""}</summary><div class="corps">`;
const FIN = `</div></details>`;
function spark(vals) {
  if (vals.length < 2) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), w = 110, h = 28;
  const x = i => (i / (vals.length - 1)) * (w - 4) + 2, y = v => hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  const d = vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const iMin = vals.indexOf(lo);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"></path><circle cx="${x(iMin).toFixed(1)}" cy="${y(lo).toFixed(1)}" r="2.2"></circle></svg>`;
}
function variation(s) {
  if (s.length < 2) return "—";
  const a = s[0][1][0], b = s[s.length - 1][1][0], v = b / a - 1;
  if (Math.abs(v) < 0.0005) return "stable";
  return v < 0 ? `<span class="moins">${pct(v)}</span>` : `<span class="plus">+${pct(v)}</span>`;
}
const kilo = p => p.g ? (p.p[D.jours[D.jours.length - 1]]?.[0] ?? null) == null ? null : (p.p[D.jours[D.jours.length - 1]][0] / p.g) * 1000 : null;

function afficher() {
  const b = bornes(), [de, a] = b;
  const prods = D.produits.filter(produitPasse);
  const avec = prods.map(p => ({p, s: serie(p, b)})).filter(x => x.s.length);
  const rem = D.remises.filter(r => r.fin >= de && r.debut <= a && prods.some(p => p.id === r.id));
  const enCours = rem.filter(r => r.en_cours);
  if (aller) OUVERTES.add(aller);          // une case de chiffres ou un bouton qui mène à une partie l'ouvre
  if (!NV_CACHE) NV_CACHE = window.SNACKS_ANALYSE.nouveautes(D.produits);
  const nvP = NV_CACHE.produits.filter(x => dansPeriode(x.jour, b) && produitPasse(x.p));
  const nv = {debut: NV_CACHE.debut, produits: nvP, marques: NV_CACHE.marques.filter(m => nvP.some(x => x.p.m === m.marque))};
  const baisses = avec.filter(x => x.s.length > 1 && x.s[x.s.length - 1][1][0] < x.s[0][1][0] - 0.0005).length;
  const hausses = avec.filter(x => x.s.length > 1 && x.s[x.s.length - 1][1][0] > x.s[0][1][0] + 0.0005).length;
  const marques = [...new Set(D.produits.filter(p => produitPasseSauf(p, "marque", "prod") && p.m).map(p => p.m))].sort((x, y) => x.localeCompare(y, "fr"));
  const nb = (sauf, f) => D.produits.filter(p => (sauf === "marque" ? produitPasseSauf(p, "marque", "prod") : produitPasseSauf(p, sauf)) && f(p)).length;
  const nomsProd = new Map(); if (F.marque) for (const p of D.produits) if (produitPasseSauf(p, "prod")) { const k = cleProd(p), x = nomsProd.get(k) || {nom: p.n, ens: new Set()}; x.ens.add(p.e); nomsProd.set(k, x); }
  const prodsMarque = [...nomsProd].sort((x, y) => x[1].nom.localeCompare(y[1].nom, "fr"));
  const nbGram = Object.fromEntries(GRAMMAGES.map(([k]) => [k, nb("gram", p => grammage(p) === k)]));
  const actifs = ["cat", "ens", "marque", "prod", "gram", "q"].filter(k => F[k]).length;
  // une enseigne qui n'a pas répondu à UN passage n'est pas « en panne » (règle § 51) : ses derniers prix lus restent, la date le dit ;
  // « en panne » seulement si aucune lecture réussie depuis plus de 2 jours
  const ageJ = j => j ? Math.round((Date.parse(D.genere) - Date.parse(j)) / 864e5) : 99;
  const pastille = (k, v) => !v.erreur ? `<span class="p ok" title="${esc(D.enseignes[k] || k)}">${esc(D.enseignes[k] || k)} · ${v.offres}</span>`
    : ageJ(v.reussite) <= 2 ? `<span class="p at">${esc(D.enseignes[k] || k)} · prix du ${dateFr(v.reussite)}</span>` : `<span class="p ko">${esc(D.enseignes[k] || k)} · en panne depuis le ${dateFr(v.reussite)}</span>`;
  let h = `<div class="haut">
    <h1>Prix des gaufrettes, biscuits et chips</h1>
    <div class="etat">${Object.entries(D.etat).map(([k, v]) => pastille(k, v)).join("")}<span class="p in">${D.jours.length} relevé${D.jours.length > 1 ? "s" : ""} · du ${dateFr(D.jours[0])} au ${dateFr(D.jours[D.jours.length - 1])}</span><span class="sous">mis à jour le ${esc(D.genere_heure || dateFr(D.genere))}, chaque nuit</span></div>
    <div class="boutons"><button class="sec" id="excel">⬇ Excel</button><button class="sec" id="imprimer">🖨 Rapport PDF</button><button class="sec" id="sortir" title="${lire("snacks-code") ? "Ferme la page et oublie le code sur cet appareil" : "Ferme la page"}">✕ Fermer${lire("snacks-code") ? "<small>oublier le code</small>" : ""}</button></div></div>
  <div class="rapport-titre sous">Rapport du ${dateFr(de)} au ${dateFr(a)} · ${F.cat ? CATS[F.cat] : "gaufrettes, biscuits et chips"}${F.ens ? " · " + D.enseignes[F.ens] : ""}${F.marque ? " · " + esc(F.marque) : ""}${F.prod ? " · " + esc(nomsProd.get(F.prod)?.nom || F.prod) : ""}${F.gram ? " · " + GRAMMAGES.find(([k]) => k === F.gram)[1] : ""}</div>
  <div class="chiffres">
    <button class="carte clic" data-aller="produits" data-vue=""><b>${avec.length}</b><span>produits suivis</span></button>
    <button class="carte clic" data-aller="remises" data-rem="cours"><b>${enCours.length}</b><span>remises en cours</span></button>
    <button class="carte clic" data-aller="remises" data-rem=""><b>${rem.length}</b><span>remises sur la durée</span></button>
    <button class="carte clic" data-aller="produits" data-vue="baisse"><b>${baisses}</b><span>prix en baisse sur la durée</span></button>
    <button class="carte clic" data-aller="produits" data-vue="hausse"><b>${hausses}</b><span>prix en hausse sur la durée</span></button>
    <button class="carte clic" data-saut="nouveautes"><b>${nv.produits.length}</b><span>nouveaux produits sur la durée${nv.marques.length ? ` (dont ${nv.marques.length} nouvelle${nv.marques.length > 1 ? "s" : ""} marque${nv.marques.length > 1 ? "s" : ""})` : ""}</span></button>
  </div>
  <button class="vers-sommaire" id="vers-sommaire" hidden aria-label="Revenir au sommaire">↑ Sommaire</button>
  <nav class="sommaire carte" aria-label="Aller à une partie"><div class="sommaire-titre">📍 Aller directement à</div><div class="sommaire-grille">${[["remises", "🏷️", "Remises", rem.length], ["nouveautes", "🆕", "Nouveautés", nv.produits.length], ["courbes", "📈", "Courbes des prix", null], ["par-marque", "🏢", "Remises par marque", null], ["calendrier", "📅", "Calendrier des remises", null], ["qui-suit", "🔁", "Qui suit qui ?", null], ["produits", "🛒", "Produits", avec.length]].map(([k, ico, t, n]) => `<button class="saut" data-saut="${k}"><span class="ico" aria-hidden="true">${ico}</span><span>${t}</span>${n != null ? `<b>${n}</b>` : ""}</button>`).join("")}</div></nav>
  <div class="filtres carte">
    <label>Durée <select id="f-periode">${[["7", "7 derniers jours"], ["30", "30 derniers jours"], ["90", "90 derniers jours"], ["tout", "Tout l’historique"], ["perso", "Dates au choix"]].map(([v, t]) => `<option value="${v}"${F.periode === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Magasin <select id="f-ens"><option value="">Tous (${nb("ens", () => true)})</option>${Object.entries(D.enseignes).map(([v, t]) => `<option value="${v}"${F.ens === v ? " selected" : ""}>${t} (${nb("ens", p => p.e === v)})</option>`).join("")}</select></label>
    <label${F.periode === "perso" ? "" : " hidden"}>Du <input type="date" id="f-de" value="${esc(F.de || de)}" min="${D.jours[0]}" max="${D.jours[D.jours.length - 1]}"></label>
    <label${F.periode === "perso" ? "" : " hidden"}>Au <input type="date" id="f-a" value="${esc(F.a || a)}" min="${D.jours[0]}" max="${D.jours[D.jours.length - 1]}"></label>
    <label>Famille <select id="f-cat"><option value="">Toutes (${nb("cat", () => true)})</option>${Object.entries(CATS).map(([v, t]) => `<option value="${v}"${F.cat === v ? " selected" : ""}>${t} (${nb("cat", p => p.c === v)})</option>`).join("")}</select></label>
    <label>Marque <select id="f-marque"><option value="">Toutes (${marques.length})</option>${marques.map(m => `<option value="${esc(m)}"${F.marque === m ? " selected" : ""}>${esc(m)} (${nb("marque", p => p.m === m)})</option>`).join("")}</select></label>
    <label>Grammage <select id="f-gram"><option value="">Tous</option>${GRAMMAGES.map(([v, t]) => `<option value="${v}"${F.gram === v ? " selected" : ""}>${t} (${nbGram[v]})</option>`).join("")}</select></label>
    <label class="large">Produit <select id="f-prod"${F.marque ? "" : " disabled"}>${F.marque ? `<option value="">Tous les produits ${esc(F.marque)} (${prodsMarque.length})</option>${prodsMarque.map(([k, x]) => `<option value="${esc(k)}"${F.prod === k ? " selected" : ""}>${esc(x.nom)}${x.ens.size > 1 ? ` (${x.ens.size} magasins)` : ""}</option>`).join("")}` : `<option value="">Choisissez d’abord une marque ci-dessus</option>`}</select></label>
    <label class="large">Chercher <input type="search" id="f-q" value="${esc(F.q)}" placeholder="un mot du nom, une marque, un parfum…"></label>
    <div class="actions"><span>${actifs ? `${actifs} filtre${actifs > 1 ? "s" : ""} actif${actifs > 1 ? "s" : ""} · ${avec.length} produit${avec.length > 1 ? "s" : ""}` : "Aucun filtre : tous les produits"}</span>${actifs ? `<button class="sec" id="effacer">✕ Effacer les filtres</button>` : ""}</div>
  </div>
  ${section("remises", REM === "cours" ? `Remises en cours (${enCours.length})` : `Remises du ${dateFr(de)} au ${dateFr(a)} (${rem.length})`)}${REM ? `<p><button class="sec" data-rem="">Voir toutes les remises de la durée</button></p>` : ""}`;
  const remType = (REM === "cours" ? enCours : rem), nbType = k => remType.filter(r => !k || (k === "lot") === (r.sorte === "lot")).length;
  if (remType.length) h += `<div class="types-rem"><span>Type de remise :</span>${[["", "Toutes"], ["prix", "Sur le prix"], ["lot", "Sur le lot (2e gratuit, −50 % sur le 2e…)"]].map(([k, t]) => `<button class="sec mini" data-type-rem="${k}" aria-pressed="${TYPE_REM === k}">${t} (${nbType(k)})</button>`).join("")}</div>`;
  const remAff = remType.filter(r => !TYPE_REM || (TYPE_REM === "lot") === (r.sorte === "lot"));
  if (!remAff.length) h += `<div class="vide">Aucune remise ${REM === "cours" ? "en cours" : "sur cette durée"} avec ces filtres.</div>`;
  else {
    remAff.sort((x, y) => (y.en_cours - x.en_cours) || ((y.taux ?? 0) - (x.taux ?? 0)));
    h += `<div class="boite"><table class="cartes"><thead><tr><th>Produit</th><th>Marque</th><th>Magasin</th><th class="n">Prix habituel</th><th class="n">Prix remisé</th><th class="n">Économie</th><th class="n">Remise</th><th>Début</th><th>Fin</th><th>Type de remise</th></tr></thead><tbody>`;
    for (const r of (REM_TOUT || IMPRESSION ? remAff : remAff.slice(0, REM_MAX))) h += `<tr><td data-l="Produit">${esc(r.nom)}${r.poids_g ? ` <span class="sous">${r.poids_g} g</span>` : ""}</td><td data-l="Marque">${esc(r.marque || "—")}</td>
      <td data-l="Magasin">${esc(D.enseignes[r.enseigne] || r.enseigne)}</td><td class="n" data-l="Prix habituel">${dt(r.prix_habituel)}</td><td class="n" data-l="Prix remisé"><b>${dt(r.prix_remise)}</b></td><td class="n" data-l="Économie">${r.montant != null ? "−" + dt(r.montant) : "—"}</td>
      <td class="n" data-l="Remise"><span class="p ok">${tauxRem(r)}</span></td><td data-l="Début">${r.debut_connu === false ? `au plus tard le ${dateFr(r.debut)} <span class="sous">(déjà là au 1er relevé)</span>` : dateFr(r.debut)}</td><td data-l="Fin">${r.en_cours ? '<span class="p in">en cours</span>' : dateFr(r.fin)}</td>
      <td data-l="Type de remise">${esc(typeRem(r))}</td></tr>`;
    h += `</tbody></table></div>`;
    if (!REM_TOUT && !IMPRESSION && remAff.length > REM_MAX) h += `<p><button class="sec" id="rem-tout">Voir les ${remAff.length - REM_MAX} autres remises</button></p>`;
  }
  h += FIN + blocNouveautes(nv) + concurrence(rem, b);
  const varDe = x => x.s.length > 1 ? x.s[x.s.length - 1][1][0] / x.s[0][1][0] - 1 : 0;
  const liste = VUE === "baisse" ? avec.filter(x => varDe(x) < -0.0005).sort((x, y) => varDe(x) - varDe(y))
    : VUE === "hausse" ? avec.filter(x => varDe(x) > 0.0005).sort((x, y) => varDe(y) - varDe(x))
    : avec.sort((x, y) => x.p.c.localeCompare(y.p.c) || (x.p.m || "zzz").localeCompare(y.p.m || "zzz", "fr") || x.p.n.localeCompare(y.p.n, "fr"));
  h += section("produits", VUE === "baisse" ? `Prix en baisse sur la durée (${liste.length}, la plus forte baisse d’abord)` : VUE === "hausse" ? `Prix en hausse sur la durée (${liste.length}, la plus forte hausse d’abord)` : "Produits et historique des prix", VUE ? null : liste.length) + (VUE ? `<p><button class="sec" data-vue="">Voir tous les produits</button></p>` : "");
  if (!liste.length) h += `<div class="vide">Aucun produit ${VUE ? "dans ce cas" : "relevé"} sur cette durée avec ces filtres.</div>`;
  else {
    const visibles = toutVoir ? liste : liste.slice(0, 150);
    if (liste.some(x => x.p.s === 0)) h += `<p class="note mg-stock"><b>Produits MG : stock non indiqué.</b> Le site de MG ne dit pas si ses produits sont disponibles ou en rupture. Ses prix sont ceux que MG affiche sur mg.tn, mais un produit peut manquer en magasin. Pour Carrefour, Géant et Elsabuy, au contraire, un prix n’est gardé que si le produit est en stock.</p>`;
    h += `<div class="boite"><table class="cartes" id="t-prod"><thead><tr><th>Produit</th><th>Marque</th><th>Magasin</th><th>Famille</th><th class="n">Poids</th><th class="n">Dernier prix</th><th class="n">Prix au kg</th><th class="n">Min · max</th><th class="n">Variation</th><th>Évolution</th></tr></thead><tbody>`;
    for (const {p, s} of visibles) {
      const vals = s.map(x => x[1][0]), dern = s[s.length - 1][1], k = p.g ? dern[0] / p.g * 1000 : null;
      h += `<tr class="prod" data-id="${esc(p.id)}"><td data-l="Produit">${esc(p.n)}</td><td data-l="Marque">${esc(p.m || "—")}</td><td data-l="Magasin">${esc(D.enseignes[p.e] || p.e)}</td>
        <td data-l="Famille">${CATS[p.c] || p.c}</td><td class="n" data-l="Poids">${p.g ? p.g + " g" : "—"}</td>
        <td class="n" data-l="Dernier prix"><b>${dt(dern[0])}</b>${dern[3] ? ` <span class="p ok">remise</span>` : ""}${p.e === "carrefour" ? `<div class="sous">${dern[2]} magasin${dern[2] > 1 ? "s" : ""}</div>` : ""}${p.s === 0 ? `<div class="sous">stock non indiqué par MG</div>` : ""}</td>
        <td class="n" data-l="Prix au kg">${k == null ? "—" : dt(k)}</td><td class="n" data-l="Min · max">${dt(Math.min(...vals))} · ${dt(Math.max(...vals))}</td>
        <td class="n" data-l="Variation">${variation(s)}</td><td data-l="Évolution">${spark(vals)}${p.g ? ` <button class="sec mini" data-courbe-p="${esc(p.id)}" aria-pressed="${COURBES.some(c => c.t === "p" && c.k === p.id)}" title="Ajouter ce produit aux courbes des prix">📈</button>` : ""}</td></tr>`;
      if (ouverts.has(p.id)) h += `<tr class="det"><td colspan="10"><div class="histo">${s.map(([j, v]) => `<span${v[3] ? ' class="rem"' : ""}>${dateFr(j)} : ${dt(v[0])}${v[1] > v[0] + 0.0005 ? ` <s>${dt(v[1])}</s>` : ""}</span>`).join("")}</div>
        ${p.s === 0 ? `<div class="sous mg-stock"><b>Stock non indiqué par MG :</b> ${MG_STOCK}</div>` : ""}<div class="sous">${p.e === "carrefour" ? "Prix le plus courant dans les magasins Carrefour qui ont le produit en stock ; " : ""}<a href="${esc(p.u)}" target="_blank" rel="noopener noreferrer">voir le produit sur le site du magasin ↗</a></div></td></tr>`;
    }
    h += `</tbody></table></div>`;
    if (!toutVoir && liste.length > 150) h += `<p><button class="sec" id="tout">Voir les ${liste.length - 150} autres produits</button></p>`;
  }
  h += FIN;
  h += `<details class="comment carte"><summary>Comment fonctionne ce site ?</summary><ul>
    <li><b>Ce qu’il suit</b> : les gaufrettes, les biscuits et les chips vendus en ligne par Carrefour (carrefour.tn, chaque magasin), Géant (geantdrive.tn), Elsabuy (elsabuy.tn, supermarché en ligne, lu le lundi et le jeudi) et MG (mg.tn, seulement ses marques MG J’aime et Koll Youm), toutes marques et tous formats. MG n’indique pas si un produit est en stock : ses prix portent la mention « stock non indiqué par MG », le prix est celui de mg.tn mais le produit peut manquer en magasin ; l’explication est rappelée au-dessus de la liste des produits et quand on touche un produit MG. Elsabuy écrit souvent le nom d’une gamme sans le mot de famille (« Croustina », « Sablito ») : la famille est alors celle que Carrefour et Géant donnent à cette gamme, jamais devinée.</li>
    <li><b>Relevé chaque nuit</b> : un robot lit les prix affichés par les sites des magasins (jamais le prix en rayon ni les promotions papier) et ne garde que les produits en stock. Carrefour : prix le plus courant parmi ses magasins, avec le nombre de magasins.</li>
    <li><b>Les robots et leurs horaires (heure de Tunis)</b> : <b>2h37</b> chaque nuit, un seul robot fait tout, dans l’ordre : lecture de Géant (environ 1 minute), lecture de Carrefour magasin par magasin (environ 3 minutes), le lundi et le jeudi lecture d’Elsabuy (environ 6 minutes, une page par produit, 3 secondes entre deux pages pour ne pas fatiguer ce petit site), lecture de MG (moins d’une minute, quelques recherches, 3 secondes entre deux pages), enregistrement de l’historique, calcul des remises, puis chiffrement et publication de cette page (vers 2h45 ; vers 2h50 le lundi et le jeudi). Un magasin qui ne répond pas est relu la nuit suivante, ses derniers prix restent. Dernier passage : <b>${esc(D.genere_heure || dateFr(D.genere))}</b>. Rien ne tourne en journée, sauf un lancement à la main.</li>
    <li><b>Historique</b> : chaque prix est gardé jour après jour depuis la mise en service (${dateFr(D.jours[0])}) ; touchez un produit pour voir tous ses prix.</li>
    <li><b>Remises</b> : « prix barré par le magasin » = le site affiche un ancien prix barré (au moins 2 % de moins) ; « constatée dans l’historique » = le prix du jour est au moins ${Math.round((D.seuil || 0.05) * 100)} % sous le prix habituel du produit (médiane des ${D.fenetre || 30} derniers jours, au moins 3 relevés). Chaque remise a sa date de début, sa date de fin (ou « en cours ») et son taux.</li>
    <li><b>Type de remise</b> : « Sur le prix » = prix barré par le magasin ou baisse constatée dans l’historique ; « Sur le lot » = offre que le magasin écrit dans le nom d’un lot (« 3 dont 1 gratuit », « −50 % sur le 2e », « +20 % de produit gratuit », produit offert). Pour une offre sur le lot, la remise indiquée (≈) est celle que l’offre annonce elle-même (3 dont 1 gratuit = 33 %), jamais devinée ; sans pourcentage écrit : « — » et 🎁 au calendrier. Les boutons « Type de remise » au-dessus de la liste filtrent l’un ou l’autre.</li>
    <li><b>Parties repliées</b> : chaque partie (remises, nouveautés, courbes, remises par marque, calendrier, qui suit qui, produits) est fermée au départ pour que la page reste courte ; touchez son titre pour l’ouvrir ou la refermer ; le rapport PDF les imprime toutes ouvertes.</li>
    <li><b>Nouveautés</b> : les nouvelles marques et les nouveaux produits apparus sur les sites des magasins pendant la durée choisie, avec la date d’apparition, le premier magasin et le premier prix. Est nouveau ce qui apparaît après le premier relevé d’un magasin (ce qui était déjà là au premier relevé ne compte jamais) ; ce peut être un vrai nouveau produit ou un produit revenu en stock. Une marque est « nouvelle » si aucun de ses produits n’était là au début du suivi, dans aucun magasin ; « nouvelle dans ce magasin » si elle n’y était pas mais existait ailleurs.</li>
    <li><b>Aller à</b> : en haut de la page, juste sous les chiffres, un grand cadre « Aller directement à » avec un bouton mène directement à chaque partie et l’ouvre (remises, nouveautés, courbes des prix, remises par marque, calendrier, qui suit qui, produits) ; le bouton « ↑ Sommaire » en bas de l’écran (ou le bouton retour du téléphone) ramène à cette rangée ; la liste des remises montre d’abord les ${REM_MAX} plus importantes (« Voir les autres remises » pour tout voir).</li>
    <li><b>Courbes des prix</b> : courbes du prix au kilo, par marque (prix médian au kilo de ses produits) ou par produit (bouton 📈 dans la liste), jusqu’à ${MAX_COURBES} à la fois ; les points marquent les jours en remise ; passez le doigt sur la courbe pour lire les prix d’un jour.</li>
    <li><b>Remises par marque</b> : pour chaque marque, nombre de remises, en cours, remise moyenne et la plus forte (en %), économie moyenne en dinars par paquet, magasins et dates ; touchez une marque pour ne voir qu’elle.</li>
    <li><b>Calendrier des remises</b> : une ligne par marque et une case par jour relevé, colorée les jours de remise (plus foncée quand la remise est plus forte) : on voit d’un coup d’œil quelles marques font des remises en même temps.</li>
    <li><b>Qui suit qui ?</b> : quand une marque lance une remise, une autre en lance-t-elle une dans les 7 jours ? Nombre de fois, le même jour, délai moyen. Une remise déjà là au premier relevé ne compte pas (début inconnu). Ce n’est pas une preuve de copie : le tableau devient parlant après quelques semaines.</li>
    <li><b>Les cases de chiffres sont des boutons</b> : « produits suivis » ouvre la liste, « remises en cours » et « remises sur la durée » ouvrent les remises, « prix en baisse » et « prix en hausse » montrent ces produits triés par variation.</li>
    <li><b>Durée au choix</b> : 7, 30, 90 jours, tout l’historique ou deux dates ; les chiffres, les remises et les variations se recalculent sur cette durée.</li>
    <li><b>Filtres</b> : famille (gaufrettes, biscuits, chips), magasin, marque, <b>produit</b> (une fois la marque choisie, la liste de ses produits ; le même nom vendu dans plusieurs magasins est un seul choix), <b>grammage</b> (portion jusqu’à 30 g, 31 à 60 g, 61 à 120 g, 121 à 250 g, plus de 250 g, lots de plusieurs sachets, poids non lu ; le poids est celui écrit par le magasin, un lot « 2 × 70 g » compte 140 g), recherche par mot.</li>
    <li><b>Exporter Excel</b> : un classeur avec l’historique (une ligne par produit, magasin et jour), les remises (avec l’économie en dinars), les remises par marque, « qui suit qui », les nouveautés et la liste des produits, sur la durée et les filtres choisis.</li>
    <li><b>Rapport (PDF)</b> : imprime la page telle qu’elle est filtrée (le téléphone ou l’ordinateur propose « Enregistrer en PDF »).</li>
    <li><b>Ce qui n’est pas compté</b> : les cakes, gâteaux, muffins, barres de céréales et tout produit dont le nom ne dit pas clairement gaufrette, biscuit ou chips (rien n’est deviné). Une marque n’est écrite que si le magasin l’écrit ou si elle est connue.</li>
    <li><b>Vos données</b> : la page est privée (code), les prix sont chiffrés dans le fichier publié et déchiffrés dans votre navigateur ; aucun compteur de visites, rien n’est envoyé.</li>
    <li><b>Comparer les magasins</b> : ce n’est pas un comparateur ; le même produit peut apparaître une fois par magasin, chacun avec son historique.</li>
  </ul></details>
  <p class="note">Prix indicatifs lus sur les sites des magasins : <a href="https://www.carrefour.tn" target="_blank" rel="noopener noreferrer">carrefour.tn</a>, <a href="https://www.geantdrive.tn" target="_blank" rel="noopener noreferrer">geantdrive.tn</a>, <a href="https://www.elsabuy.tn" target="_blank" rel="noopener noreferrer">elsabuy.tn</a> et <a href="https://mg.tn" target="_blank" rel="noopener noreferrer">mg.tn</a>. Mis à jour chaque nuit vers 2h45 ; page produite le ${esc(D.genere_heure || dateFr(D.genere))}.</p>`;
  $("#site").innerHTML = h;
  brancher(avec, rem, b, nv);
}

// ---------- nouveautés : nouvelles marques et nouveaux produits apparus sur les sites des magasins (calcul : analyse.js)
const NV_MAX = 20;
function blocNouveautes(nv) {
  const debuts = Object.entries(D.enseignes).filter(([k]) => nv.debut.has(k)).map(([k, t]) => `${esc(t)} le ${dateFr(nv.debut.get(k))}`).join(", ");
  const nm = nv.marques.length;
  let h = section("nouveautes", `Nouveautés : nouvelles marques et nouveaux produits (${nv.produits.length})`, nm ? `${nm} nouvelle${nm > 1 ? "s" : ""} marque${nm > 1 ? "s" : ""}` : null);
  h += `<div class="sous">Un produit est <b>nouveau</b> quand il apparaît sur le site d’un magasin après le premier relevé de ce magasin (suivi commencé : ${debuts}) : ce qui était déjà là au premier relevé n’est jamais compté. Ce peut être un vrai nouveau produit ou un produit revenu en stock. Une <b>marque est nouvelle</b> quand aucun de ses produits n’était là au premier relevé, dans aucun magasin.</div>`;
  if (D.jours.length < 14) h += `<div class="note-recul">Le suivi a commencé le ${dateFr(D.jours[0])} : les nouveautés deviennent parlantes après quelques semaines de relevés.</div>`;
  h += `<h3>Nouvelles marques sur le marché (${nm})</h3>`;
  if (!nm) h += `<div class="vide">Aucune nouvelle marque sur cette durée avec ces filtres.</div>`;
  else {
    h += `<div class="boite"><table class="cartes" id="t-nv-marques"><thead><tr><th>Marque</th><th>Apparue le</th><th>Premier magasin</th><th>Magasins</th><th class="n">Nouveaux produits</th></tr></thead><tbody>`;
    for (const x of nv.marques) h += `<tr><td data-l="Marque"><b>${esc(x.marque)}</b> <span class="p in">nouvelle marque</span></td><td data-l="Apparue le">${dateFr(x.jour)}</td><td data-l="Premier magasin">${esc(D.enseignes[x.enseigne] || x.enseigne)}</td>
      <td data-l="Magasins">${x.enseignes.map(e => esc(D.enseignes[e] || e)).join(", ")}</td><td class="n" data-l="Nouveaux produits">${nv.produits.filter(y => y.p.m === x.marque).length}</td></tr>`;
    h += `</tbody></table></div>`;
  }
  h += `<h3>Nouveaux produits (${nv.produits.length})</h3>`;
  if (!nv.produits.length) h += `<div class="vide">Aucun nouveau produit sur cette durée avec ces filtres.</div>`;
  else {
    const montres = NV_TOUT || IMPRESSION ? nv.produits : nv.produits.slice(0, NV_MAX);
    h += `<div class="boite"><table class="cartes" id="t-nv"><thead><tr><th>Produit</th><th>Marque</th><th>Magasin</th><th>Famille</th><th class="n">Poids</th><th>Apparu le</th><th class="n">Premier prix</th><th class="n">Dernier prix</th></tr></thead><tbody>`;
    for (const x of montres) {
      const p = x.p, js = Object.keys(p.p).filter(j => p.p[j]).sort(), dern = p.p[js[js.length - 1]][0];
      h += `<tr><td data-l="Produit"><a href="${esc(p.u)}" target="_blank" rel="noopener noreferrer">${esc(p.n)}</a></td><td data-l="Marque">${esc(p.m || "—")}${x.marque_nouvelle ? ` <span class="p in">nouvelle marque</span>` : x.marque_nouvelle_magasin ? ` <span class="p at">nouvelle dans ce magasin</span>` : ""}</td>
        <td data-l="Magasin">${esc(D.enseignes[p.e] || p.e)}</td><td data-l="Famille">${CATS[p.c] || p.c}</td><td class="n" data-l="Poids">${p.g ? p.g + " g" : "—"}</td><td data-l="Apparu le">${dateFr(x.jour)}</td>
        <td class="n" data-l="Premier prix">${dt(p.p[x.jour][0])}</td><td class="n" data-l="Dernier prix"><b>${dt(dern)}</b></td></tr>`;
    }
    h += `</tbody></table></div>`;
    if (montres.length < nv.produits.length) h += `<p><button class="sec" id="nv-tout">Voir les ${nv.produits.length - montres.length} autres nouveaux produits</button></p>`;
  }
  return h + FIN;
}

// ---------- concurrence : courbes, remises par marque, calendrier des remises, qui suit qui
function slotLibre() { for (let s = 1; s <= MAX_COURBES; s++) if (!COURBES.some(c => c.slot === s)) return s; return 0; }
function basculerCourbe(t, k) {
  const i = COURBES.findIndex(c => c.t === t && c.k === k);
  if (i >= 0) { COURBES.splice(i, 1); COURBE_MSG = ""; }
  else { const s = slotLibre(); if (!s) { COURBE_MSG = `${MAX_COURBES} courbes au plus : retirez-en une avant d’en ajouter.`; return; } COURBES.push({t, k, slot: s}); COURBE_MSG = ""; }
  aller = "courbes"; afficher();
}
function concurrence(rem, b) {
  const A = window.SNACKS_ANALYSE, [de, a] = b, joursP = D.jours.filter(j => dansPeriode(j, b));
  const sansMarque = D.produits.filter(p => produitPasseSauf(p, "marque"));
  const parMarqueProduits = new Map(); for (const p of sansMarque) if (p.m && p.g) parMarqueProduits.set(p.m, (parMarqueProduits.get(p.m) || 0) + 1);
  const topMarques = [...parMarqueProduits].sort((x, y) => y[1] - x[1]).slice(0, 15).map(x => x[0]);
  // courbes : choix du visiteur, sinon les 3 marques qui ont le plus de produits (choix automatique, dit)
  const auto = !COURBES.length;
  const items = auto ? topMarques.slice(0, 3).map((k, i) => ({t: "m", k, slot: i + 1})) : COURBES;
  const series = items.map(it => {
    if (it.t === "m") return {nom: it.k, sous: "prix médian au kilo de ses produits", slot: it.slot, pts: A.courbeMarque(sansMarque, it.k, joursP), it};
    const p = D.produits.find(x => x.id === it.k);
    return p ? {nom: p.n, sous: D.enseignes[p.e] || p.e, slot: it.slot, pts: A.courbeProduit(p, joursP), it} : null;
  }).filter(Boolean);
  window.__COURBE = {joursP, series};
  let h = section("courbes", "Courbes des prix (au kilo)", series.length ? `${series.length} courbe${series.length > 1 ? "s" : ""}` : null) + `
  <div class="carte bloc-courbe"><div class="sous">${auto ? "Choix automatique : les 3 marques qui ont le plus de produits. " : ""}Touchez une marque pour l’ajouter ou la retirer (${MAX_COURBES} courbes au plus) ; un produit s’ajoute avec 📈 dans la liste des produits.</div>
  <div class="puces">${topMarques.map(m => `<button class="sec puce" data-courbe-m="${esc(m)}" aria-pressed="${!auto && COURBES.some(c => c.t === "m" && c.k === m)}">${esc(m)}</button>`).join("")}</div>
  ${COURBE_MSG ? `<div class="msg-courbe">${esc(COURBE_MSG)}</div>` : ""}
  <div class="legende">${series.map((s, i) => `<span class="leg"><i class="s${s.slot}"></i>${esc(s.nom)} <span class="sous">${esc(s.sous)}</span>${!auto ? ` <button class="retirer" data-retire="${i}" aria-label="Retirer ${esc(s.nom)}">×</button>` : ""}</span>`).join("")}</div>
  ${courbeSVG(series, joursP)}<div id="courbe-info" class="sous" aria-live="polite">Passez le doigt ou la souris sur la courbe pour lire les prix d’un jour.</div></div>`;
  // remises par marque
  const pm = A.parMarque(rem);
  h += FIN + section("par-marque", `Remises par marque (${pm.filter(x => x.marque).length} marque${pm.filter(x => x.marque).length > 1 ? "s" : ""})`);
  if (!pm.length) h += `<div class="vide">Aucune remise sur cette durée avec ces filtres.</div>`;
  else {
    h += `<div class="boite"><table class="cartes" id="t-marques"><thead><tr><th>Marque</th><th class="n">Remises</th><th class="n">En cours</th><th class="n">Remise moyenne</th><th class="n">Plus forte</th><th class="n">Économie moyenne</th><th>Magasins</th><th>Du</th><th>Au</th></tr></thead><tbody>`;
    for (const x of pm) h += `<tr class="marque-ligne" data-marque="${esc(x.marque)}" title="Voir les remises de cette marque"><td data-l="Marque"><b>${esc(x.marque || "(marque non lue)")}</b></td><td class="n" data-l="Remises">${x.n}</td><td class="n" data-l="En cours">${x.en_cours}</td>
      <td class="n" data-l="Remise moyenne">${x.taux_moyen == null ? "—" : "−" + pct(x.taux_moyen)}</td><td class="n" data-l="Plus forte">${x.taux_max == null ? "—" : "−" + pct(x.taux_max)}</td><td class="n" data-l="Économie moyenne">${x.montant_moyen != null ? "−" + dt(x.montant_moyen) : "—"}</td>
      <td data-l="Magasins">${x.enseignes.map(e => esc(D.enseignes[e] || e)).join(", ")}</td><td data-l="Du">${dateFr(x.debut)}</td><td data-l="Au">${dateFr(x.fin)}</td></tr>`;
    h += `</tbody></table></div><p class="sous">Touchez une marque pour ne voir que ses remises et ses produits.</p>`;
  }
  // calendrier des remises
  const cal = A.calendrier(rem, joursP);
  const lignesCal = [...cal].map(([m, j]) => ({m, j, total: j.size})).filter(x => x.total).sort((x, y) => y.total - x.total || x.m.localeCompare(y.m, "fr"));
  const montrees = CAL_TOUT ? lignesCal : lignesCal.slice(0, 20);
  h += FIN + section("calendrier", "Calendrier des remises par marque", lignesCal.length ? `${lignesCal.length} marque${lignesCal.length > 1 ? "s" : ""}` : null);
  if (!lignesCal.length) h += `<div class="vide">Aucune remise d’une marque connue sur cette durée.</div>`;
  else {
    const niv = v => v >= 0.2 ? 3 : v >= 0.1 ? 2 : 1;
    h += `<div class="sous">Une ligne par marque, une case par jour relevé : la case est colorée les jours où la marque a au moins une remise ; le chiffre dans la case est la plus forte remise de la marque ce jour-là, en % (jaune : moins de 10 %, orange : 10 à 20 %, rouge : 20 % et plus ; 🎁 : offre sur le lot sans pourcentage écrit, comme un produit offert). Les offres sur le lot comptent avec leur équivalent annoncé (3 dont 1 gratuit = 33 %). Des cases colorées les mêmes jours pour plusieurs marques montrent des remises en même temps.</div>
    <div class="cal-legende sous"><span><i class="c c0"></i> aucune</span><span><i class="c c1"></i> moins de 10 %</span><span><i class="c c2"></i> 10 à 20 %</span><span><i class="c c3"></i> 20 % et plus</span></div>
    <div class="boite"><table class="cal" id="t-cal"><thead><tr><th></th>${joursP.map(j => `<th class="jour">${j.slice(8, 10)}/${j.slice(5, 7)}</th>`).join("")}</tr></thead><tbody>`;
    for (const x of montrees) h += `<tr><th class="nom">${esc(x.m)}</th>${joursP.map(j => { const c = x.j.get(j);
      return c ? `<td><button class="c c${niv(c.max)}" data-cal="${esc(x.m)}|${j}|${c.n}|${c.max}" aria-label="${esc(x.m)}, ${dateFr(j)} : ${c.n} remise${c.n > 1 ? "s" : ""}, ${c.max > 0 ? `jusqu’à −${pct(c.max)}` : "offre sur le lot sans pourcentage écrit"}">${c.max > 0 ? Math.round(c.max * 100) : "🎁"}</button></td>` : `<td><span class="c c0"></span></td>`; }).join("")}</tr>`;
    h += `</tbody></table></div><div id="cal-detail" class="sous" aria-live="polite">Touchez une case colorée pour voir le détail.</div>`;
    if (!CAL_TOUT && lignesCal.length > 20) h += `<p><button class="sec" id="cal-tout">Voir les ${lignesCal.length - 20} autres marques</button></p>`;
  }
  // qui suit qui
  const remP = rem.filter(r => r.debut >= de);
  const qs = A.quiSuitQui(remP, 7), nbL = [...A.lancements(remP).values()].reduce((s, v) => s + v.length, 0);
  h += FIN + section("qui-suit", "Qui suit qui ? (remises lancées à moins de 7 jours d’écart)", qs.length ? `${qs.length} lien${qs.length > 1 ? "s" : ""}` : null) + `
  <div class="sous">Pour chaque marque qui lance une remise, on regarde si une autre marque lance aussi une remise dans les 7 jours qui suivent. Ce n’est pas une preuve qu’elle copie : plus le nombre de fois est grand, plus le lien est probable. Les remises déjà présentes au premier relevé (${dateFr(D.jours[0])}) ne comptent pas : leur vrai début est inconnu.</div>`;
  if (D.jours.length < 14) h += `<div class="note-recul">Pas encore assez de recul : ${D.jours.length} jour${D.jours.length > 1 ? "s" : ""} relevé${D.jours.length > 1 ? "s" : ""} depuis le ${dateFr(D.jours[0])}. Ce tableau devient parlant après quelques semaines de relevés.</div>`;
  if (!qs.length) h += `<div class="vide">Aucune remise lancée par une marque suivie d’une autre dans les 7 jours sur cette durée (${nbL} lancement${nbL > 1 ? "s" : ""} de remise connu${nbL > 1 ? "s" : ""}).</div>`;
  else {
    h += `<div class="boite"><table class="cartes" id="t-suit"><thead><tr><th>Quand cette marque lance une remise…</th><th>… cette marque en lance une aussi</th><th class="n">Fois</th><th class="n">Le même jour</th><th class="n">Délai moyen</th></tr></thead><tbody>`;
    for (const x of qs.slice(0, 20)) h += `<tr><td data-l="Lance"><b>${esc(x.a)}</b></td><td data-l="Suit"><b>${esc(x.b)}</b></td><td class="n" data-l="Fois">${x.n} sur ${x.sur}</td><td class="n" data-l="Le même jour">${x.meme_jour}</td><td class="n" data-l="Délai moyen">${x.delai_moyen.toLocaleString("fr-FR")} j</td></tr>`;
    h += `</tbody></table></div>`;
  }
  return h + FIN;
}
function largeurCourbe() { const w = (document.querySelector("#site")?.clientWidth || 640) - 30; return Math.max(300, Math.min(1120, Math.round(w))); }
function courbeSVG(series, jours) {
  const W = largeurCourbe(), H = W < 500 ? 230 : 280, L = 52, R = 12, T = 26, B = 26;
  const vals = series.flatMap(s => s.pts.map(x => x[1]));
  if (!vals.length || !jours.length) return `<div class="vide">Pas de prix au kilo à tracer pour ce choix (poids non lu ou aucun relevé sur la durée).</div>`;
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { lo *= 0.95; hi *= 1.05; } const m = (hi - lo) * 0.08; lo = Math.max(0, lo - m); hi += m;
  const x = j => L + (jours.length === 1 ? (W - L - R) / 2 : jours.indexOf(j) / (jours.length - 1) * (W - L - R)), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, yy = y(v).toFixed(1); g += `<line class="grille" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="axe" x="${L - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${v.toLocaleString("fr-FR", {maximumFractionDigits: 1})}</text>`; }
  const idx = jours.length < 3 ? jours.map((_, i) => i) : [0, Math.floor((jours.length - 1) / 2), jours.length - 1];
  for (const i of idx) { const ancre = jours.length === 1 ? "middle" : i === 0 ? "start" : i === jours.length - 1 ? "end" : "middle";
    g += `<text class="axe" x="${x(jours[i]).toFixed(1)}" y="${H - 8}" text-anchor="${ancre}">${dateFr(jours[i]).slice(0, 5)}</text>`; }
  let traits = "";
  for (const s of series) {
    const pts = s.pts.filter(p => jours.includes(p[0]));
    if (pts.length > 1) traits += `<path class="ligne s${s.slot}" d="${pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ")}"/>`;
    for (const p of pts) if (pts.length === 1 || p[2]) traits += `<circle class="point s${s.slot}${p[2] ? " remise" : ""}" cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="4.5"/>`;
  }
  window.__COURBE.geo = {W, L, R};
  return `<svg class="courbe" id="courbe" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Courbes des prix au kilo, en dinars">${g}<text class="axe unite" x="${L - 6}" y="${T - 12}" text-anchor="end">DT/kg</text>${traits}<line id="curseur" class="curseur" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><rect class="zone" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
}
function brancherCourbe() {
  const svg = $("#courbe"); if (!svg) return;
  const {joursP, series, geo} = window.__COURBE, {W, L, R} = geo;
  const lire = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const i = joursP.length === 1 ? 0 : Math.max(0, Math.min(joursP.length - 1, Math.round((px - L) / (W - L - R) * (joursP.length - 1))));
    const j = joursP[i], xx = L + (joursP.length === 1 ? (W - L - R) / 2 : i / (joursP.length - 1) * (W - L - R)), c = $("#curseur");
    c.setAttribute("x1", xx); c.setAttribute("x2", xx); c.setAttribute("visibility", "visible");
    $("#courbe-info").innerHTML = `<b>${dateFr(j)}</b> · ` + series.map(s => { const p = s.pts.find(q => q[0] === j);
      return `<span class="leg"><i class="s${s.slot}"></i>${esc(s.nom)} : ${p ? dt(p[1]) + "/kg" + (p[2] ? " (remise)" : "") : "—"}</span>`; }).join(" ");
  };
  svg.addEventListener("pointermove", lire); svg.addEventListener("pointerdown", lire);
  svg.addEventListener("pointerleave", () => $("#curseur").setAttribute("visibility", "hidden"));
}

function brancher(avec, rem, b, nv) {
  const maj = () => { F.periode = $("#f-periode").value; F.de = $("#f-de")?.value || ""; F.a = $("#f-a")?.value || ""; F.cat = $("#f-cat").value; F.ens = $("#f-ens").value; const m = $("#f-marque").value; F.prod = m === F.marque ? ($("#f-prod")?.value || "") : ""; F.marque = m; F.gram = $("#f-gram").value; F.q = $("#f-q").value.trim(); toutVoir = false; REM_TOUT = false; NV_TOUT = false; afficher(); };
  for (const id of ["#f-periode", "#f-de", "#f-a", "#f-cat", "#f-ens", "#f-marque", "#f-prod", "#f-gram"]) $(id)?.addEventListener("change", maj);
  let t; $("#f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(maj, 300); });
  $("#tout")?.addEventListener("click", () => { toutVoir = true; afficher(); });
  $("#effacer")?.addEventListener("click", () => { F = {...F, cat: "", ens: "", marque: "", prod: "", gram: "", q: ""}; toutVoir = false; afficher(); });
  $("#t-prod")?.addEventListener("click", e => {
    const tr = e.target.closest("tr.prod"); if (!tr || e.target.closest("a") || e.target.closest("button")) return;
    ouverts.has(tr.dataset.id) ? ouverts.delete(tr.dataset.id) : ouverts.add(tr.dataset.id); afficher();
  });
  $("#site").querySelectorAll("[data-vue],[data-rem]").forEach(el => el.addEventListener("click", () => {
    if (el.dataset.vue !== undefined) VUE = el.dataset.vue; if (el.dataset.rem !== undefined) REM = el.dataset.rem;
    toutVoir = false; aller = el.dataset.aller || (el.dataset.vue !== undefined ? "produits" : "remises"); afficher();
  }));
  $("#site").querySelectorAll("[data-courbe-m]").forEach(el => el.addEventListener("click", () => {
    if (!COURBES.length) COURBES = window.__COURBE.series.map(s => ({...s.it}));   // le choix automatique devient le choix de départ
    basculerCourbe("m", el.dataset.courbeM); }));
  $("#site").querySelectorAll("[data-courbe-p]").forEach(el => el.addEventListener("click", e => { e.stopPropagation();
    if (!COURBES.length) COURBES = window.__COURBE.series.map(s => ({...s.it})); basculerCourbe("p", el.dataset.courbeP); }));
  $("#site").querySelectorAll("[data-retire]").forEach(el => el.addEventListener("click", () => { COURBES.splice(+el.dataset.retire, 1); COURBE_MSG = ""; aller = "courbes"; afficher(); }));
  $("#site").querySelectorAll("tr.marque-ligne").forEach(el => el.addEventListener("click", () => { F.marque = el.dataset.marque; F.prod = ""; toutVoir = false; aller = "remises"; afficher(); }));
  $("#site").querySelectorAll("[data-cal]").forEach(el => el.addEventListener("click", () => { const [m, j, n, mx] = el.dataset.cal.split("|");
    $("#cal-detail").innerHTML = `<b>${esc(m)}</b>, ${dateFr(j)} : ${n} remise${n > 1 ? "s" : ""} en cours, ${+mx > 0 ? `la plus forte à −${pct(+mx)}` : "offre sur le lot sans pourcentage écrit (ex. produit offert)"}.`; }));
  $("#cal-tout")?.addEventListener("click", () => { CAL_TOUT = true; aller = "calendrier"; afficher(); });
  $("#rem-tout")?.addEventListener("click", () => { REM_TOUT = true; aller = "remises"; afficher(); });
  $("#site").querySelectorAll("[data-type-rem]").forEach(el => el.addEventListener("click", () => { TYPE_REM = el.dataset.typeRem; REM_TOUT = false; aller = "remises"; afficher(); }));
  // 15/11/2026 (le frère d'Ahmed : « comment revenir aux autres parties ? ») : un saut est noté dans l'historique du téléphone (le bouton
  // « retour » ramène au sommaire) et le bouton flottant « ↑ Sommaire » apparaît dès que le sommaire n'est plus à l'écran.
  $("#site").querySelectorAll("details.section").forEach(d => d.addEventListener("toggle", () => { if (!IMPRESSION && d.isConnected) d.open ? OUVERTES.add(d.id) : OUVERTES.delete(d.id); }));
  $("#nv-tout")?.addEventListener("click", () => { NV_TOUT = true; aller = "nouveautes"; afficher(); });
  $("#site").querySelectorAll("[data-saut]").forEach(el => el.addEventListener("click", () => { const c = $("#" + el.dataset.saut); if (c) {
    if (c.tagName === "DETAILS") { c.open = true; OUVERTES.add(c.id); }
    try { history.pushState({saut: el.dataset.saut}, "", "#" + el.dataset.saut); } catch {}
    c.scrollIntoView({behavior: "smooth", block: "start"}); c.classList.add("eclair"); } }));
  const som = $(".sommaire"), haut = $("#vers-sommaire");
  if (som && haut) { try { new IntersectionObserver(e => { haut.hidden = e[0].isIntersecting || e[0].boundingClientRect.top > 0; }).observe(som); } catch { haut.hidden = false; }
    haut.addEventListener("click", () => { som.scrollIntoView({behavior: "smooth", block: "center"}); }); }
  brancherCourbe();
  if (aller) { const cible = $("#" + aller); aller = null; if (cible) { cible.scrollIntoView({behavior: "smooth", block: "start"}); cible.classList.add("eclair"); } }
  $("#sortir").addEventListener("click", () => { ecrire("snacks-code", null); location.reload(); });
  $("#imprimer").addEventListener("click", () => { IMPRESSION = true; afficher(); print(); });   // le rapport imprime TOUTES les parties ouvertes et toutes les remises
  $("#excel").addEventListener("click", () => exporter(avec, rem, b, nv));
}

// ---------- export Excel (SheetJS, chargé au clic depuis cdnjs ; sans lui : fichiers CSV)
function lignes(avec, rem, b, nv) {
  const [de, a] = b;
  const histo = [["Date", "Magasin", "Produit (famille)", "Marque", "Produit", "Poids (g)", "Prix (DT)", "Prix régulier (DT)", "Prix au kg (DT)", "Magasins en stock", "Magasins en remise", "Lien"]];
  for (const {p, s} of avec) for (const [j, v] of s)
    histo.push([j, D.enseignes[p.e] || p.e, CATS[p.c] || p.c, p.m || "", p.n, p.g ?? "", v[0], v[1] ?? "", p.g ? Math.round(v[0] / p.g * 1000 * 1000) / 1000 : "", v[2] ?? "", v[3] ?? "", p.u || ""]);
  const remises = [["Produit", "Marque", "Magasin", "Famille", "Poids (g)", "Prix habituel (DT)", "Prix remisé (DT)", "Économie (DT)", "Remise (%)", "Début", "Début connu", "Fin", "En cours", "Type de remise", "Jours"]];
  for (const r of rem) remises.push([r.nom, r.marque || "", D.enseignes[r.enseigne] || r.enseigne, CATS[r.categorie] || r.categorie, r.poids_g ?? "", r.prix_habituel, r.prix_remise, r.montant ?? "",
    r.taux == null ? "" : Math.round(r.taux * 1000) / 10, r.debut, r.debut_connu === false ? "non (déjà là au 1er relevé)" : "oui", r.fin, r.en_cours ? "oui" : "non", typeRem(r), r.jours]);
  const A = window.SNACKS_ANALYSE;
  const marques = [["Marque", "Remises", "En cours", "Lancements connus", "Remise moyenne (%)", "Plus forte (%)", "Économie moyenne (DT)", "Magasins", "Du", "Au"]];
  for (const x of A.parMarque(rem)) marques.push([x.marque || "(marque non lue)", x.n, x.en_cours, x.lancements, Math.round(x.taux_moyen * 1000) / 10, Math.round(x.taux_max * 1000) / 10,
    x.montant_moyen != null ? Math.round(x.montant_moyen * 1000) / 1000 : "", x.enseignes.map(e => D.enseignes[e] || e).join(", "), x.debut, x.fin]);
  const suit = [["Marque qui lance", "Marque qui lance aussi dans les 7 jours", "Fois", "Sur (lancements)", "Le même jour", "Délai moyen (jours)"]];
  for (const x of A.quiSuitQui(rem.filter(r => r.debut >= de), 7)) suit.push([x.a, x.b, x.n, x.sur, x.meme_jour, x.delai_moyen]);
  const produits = [["Produit", "Marque", "Magasin", "Famille", "Poids (g)", "Premier prix de la durée (DT)", "Dernier prix (DT)", "Variation (%)", "Prix min (DT)", "Prix max (DT)", "Relevés", "Lien"]];
  for (const {p, s} of avec) { const v = s.map(x => x[1][0]); produits.push([p.n, p.m || "", D.enseignes[p.e] || p.e, CATS[p.c] || p.c, p.g ?? "", v[0], v[v.length - 1], v.length > 1 ? Math.round((v[v.length - 1] / v[0] - 1) * 1000) / 10 : "", Math.min(...v), Math.max(...v), v.length, p.u || ""]); }
  const nouveaux = [["Apparu le", "Produit", "Marque", "Nouvelle marque", "Magasin", "Famille", "Poids (g)", "Premier prix (DT)", "Dernier prix (DT)", "Lien"]];
  for (const x of nv.produits) { const js = Object.keys(x.p.p).filter(j => x.p.p[j]).sort(); nouveaux.push([x.jour, x.p.n, x.p.m || "", x.marque_nouvelle ? "oui, nouvelle sur le marché" : x.marque_nouvelle_magasin ? "nouvelle dans ce magasin" : "non",
    D.enseignes[x.p.e] || x.p.e, CATS[x.p.c] || x.p.c, x.p.g ?? "", x.p.p[x.jour][0], x.p.p[js[js.length - 1]][0], x.p.u || ""]); }
  return {histo, remises, produits, marques, suit, nouveaux, nom: `prix-gaufrettes-biscuits-chips-${de}-${a}`};
}
function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(contenu instanceof Blob ? contenu : new Blob([contenu], {type}));
  const l = document.createElement("a"); l.href = url; l.download = nom; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function chargerSheetJS() {
  return new Promise((ok, ko) => {
    if (window.XLSX) return ok(window.XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.integrity = "sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==";
    s.crossOrigin = "anonymous";
    s.onload = () => ok(window.XLSX); s.onerror = () => ko(new Error("bibliothèque Excel non chargée"));
    document.head.appendChild(s);
  });
}
async function exporter(avec, rem, b, nv) {
  const btn = $("#excel"); btn.disabled = true; btn.textContent = "Préparation…";
  const L = lignes(avec, rem, b, nv);
  try {
    const X = await chargerSheetJS();
    const wb = X.utils.book_new();
    for (const [nom, rows] of [["Historique", L.histo], ["Remises", L.remises], ["Remises par marque", L.marques], ["Qui suit qui", L.suit], ["Nouveautés", L.nouveaux], ["Produits", L.produits]]) {
      const ws = X.utils.aoa_to_sheet(rows);
      ws["!cols"] = rows[0].map((_, i) => ({wch: Math.min(60, Math.max(10, ...rows.slice(0, 200).map(r => String(r[i] ?? "").length + 2)))}));
      X.utils.book_append_sheet(wb, ws, nom);
    }
    telecharger(L.nom + ".xlsx", new Blob([X.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  } catch {
    // secours : un CSV lisible par Excel (séparateur ; comme Excel en français)
    const csv = rows => rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    telecharger(L.nom + "-historique.csv", "﻿" + csv(L.histo), "text/csv;charset=utf-8");
    telecharger(L.nom + "-remises.csv", "﻿" + csv(L.remises), "text/csv;charset=utf-8");
  }
  btn.disabled = false; btn.textContent = "⬇ Excel";
}

// rapport imprimé (bouton ou Ctrl+P) : toutes les parties ouvertes, toutes les remises, puis retour à la page telle qu'elle était
addEventListener("beforeprint", () => { if (D && !IMPRESSION) { IMPRESSION = true; afficher(); } });
addEventListener("afterprint", () => { if (IMPRESSION) { IMPRESSION = false; afficher(); } });

// ---------- entrée
$("#f").addEventListener("submit", e => { e.preventDefault(); ouvrir($("#code").value, $("#garder").checked); });
const garde = lire("snacks-code");
if (garde) ouvrir(garde, true);
