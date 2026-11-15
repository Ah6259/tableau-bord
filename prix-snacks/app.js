"use strict";
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
let D = null, F = {periode: "30", de: "", a: "", cat: "", ens: "", marque: "", gram: "", q: ""}, ouverts = new Set(), toutVoir = false;
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
  if (F.gram && grammage(p) !== F.gram) return false;
  if (F.q) { const t = (p.n + " " + p.m).toLowerCase(); if (!F.q.toLowerCase().split(/\s+/).every(m => t.includes(m))) return false; }
  return true;
}
function produitPasseSauf(p, sauf) { const g = F[sauf]; F[sauf] = ""; const r = produitPasse(p); F[sauf] = g; return r; }
function serie(p, b) { return D.jours.filter(j => dansPeriode(j, b) && p.p[j]).map(j => [j, p.p[j]]); }

// ---------- affichage
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
  const baisses = avec.filter(x => x.s.length > 1 && x.s[x.s.length - 1][1][0] < x.s[0][1][0] - 0.0005).length;
  const hausses = avec.filter(x => x.s.length > 1 && x.s[x.s.length - 1][1][0] > x.s[0][1][0] + 0.0005).length;
  const marques = [...new Set(D.produits.filter(p => (!F.cat || p.c === F.cat) && (!F.ens || p.e === F.ens)).map(p => p.m).filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr"));
  const nbGram = Object.fromEntries(GRAMMAGES.map(([k]) => [k, D.produits.filter(p => produitPasseSauf(p, "gram") && grammage(p) === k).length]));
  // une enseigne qui n'a pas répondu à UN passage n'est pas « en panne » (règle § 51) : ses derniers prix lus restent, la date le dit ;
  // « en panne » seulement si aucune lecture réussie depuis plus de 2 jours
  const ageJ = j => j ? Math.round((Date.parse(D.genere) - Date.parse(j)) / 864e5) : 99;
  const etat = Object.entries(D.etat).map(([k, v]) => `${D.enseignes[k] || k} : ${!v.erreur ? `${v.offres} produits le ${dateFr(v.date)}`
    : ageJ(v.reussite) <= 2 ? `prix du ${dateFr(v.reussite)} <span class="sous">(pas de réponse le ${dateFr(v.date)}, nouvel essai la nuit prochaine)</span>`
    : `<span class="p ko">en panne depuis le ${dateFr(v.reussite)}</span>`}`).join(" · ");
  let h = `<div class="haut"><div><h1>Prix des gaufrettes, biscuits et chips</h1>
    <div class="sous">Relevés du ${dateFr(D.jours[0])} au ${dateFr(D.jours[D.jours.length - 1])} (${D.jours.length} relevé${D.jours.length > 1 ? "s" : ""}, un chaque nuit) · ${etat}</div></div>
    <div class="boutons"><button class="sec" id="excel">⬇ Exporter Excel</button><button class="sec" id="imprimer">🖨 Rapport (PDF)</button>
    <button class="sec" id="sortir">Fermer${lire("snacks-code") ? " et oublier le code" : ""}</button></div></div>
  <div class="rapport-titre sous">Rapport du ${dateFr(de)} au ${dateFr(a)} · ${F.cat ? CATS[F.cat] : "gaufrettes, biscuits et chips"}${F.ens ? " · " + D.enseignes[F.ens] : ""}${F.marque ? " · " + esc(F.marque) : ""}${F.gram ? " · " + GRAMMAGES.find(([k]) => k === F.gram)[1] : ""}</div>
  <div class="filtres carte">
    <label>Durée <select id="f-periode">${[["7", "7 derniers jours"], ["30", "30 derniers jours"], ["90", "90 derniers jours"], ["tout", "Tout l’historique"], ["perso", "Dates au choix"]].map(([v, t]) => `<option value="${v}"${F.periode === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label${F.periode === "perso" ? "" : " hidden"}>Du <input type="date" id="f-de" value="${esc(F.de || de)}" min="${D.jours[0]}" max="${D.jours[D.jours.length - 1]}"></label>
    <label${F.periode === "perso" ? "" : " hidden"}>Au <input type="date" id="f-a" value="${esc(F.a || a)}" min="${D.jours[0]}" max="${D.jours[D.jours.length - 1]}"></label>
    <label>Produit <select id="f-cat"><option value="">Tous</option>${Object.entries(CATS).map(([v, t]) => `<option value="${v}"${F.cat === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Magasin <select id="f-ens"><option value="">Tous</option>${Object.entries(D.enseignes).map(([v, t]) => `<option value="${v}"${F.ens === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Marque <select id="f-marque"><option value="">Toutes</option>${marques.map(m => `<option value="${esc(m)}"${F.marque === m ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
    <label>Grammage <select id="f-gram"><option value="">Tous</option>${GRAMMAGES.map(([v, t]) => `<option value="${v}"${F.gram === v ? " selected" : ""}>${t} (${nbGram[v]})</option>`).join("")}</select></label>
    <label>Chercher <input type="search" id="f-q" value="${esc(F.q)}" placeholder="nom, marque…"></label>
  </div>
  <div class="chiffres">
    <div class="carte"><b>${avec.length}</b><span>produits suivis</span></div>
    <div class="carte"><b>${enCours.length}</b><span>remises en cours</span></div>
    <div class="carte"><b>${rem.length}</b><span>remises sur la durée</span></div>
    <div class="carte"><b>${baisses}</b><span>prix en baisse sur la durée</span></div>
    <div class="carte"><b>${hausses}</b><span>prix en hausse sur la durée</span></div>
  </div>
  <h2 id="remises">Remises du ${dateFr(de)} au ${dateFr(a)}</h2>`;
  if (!rem.length) h += `<div class="vide">Aucune remise sur cette durée avec ces filtres.</div>`;
  else {
    rem.sort((x, y) => (y.en_cours - x.en_cours) || (y.taux - x.taux));
    h += `<div class="boite"><table class="cartes"><thead><tr><th>Produit</th><th>Marque</th><th>Magasin</th><th class="n">Prix habituel</th><th class="n">Prix remisé</th><th class="n">Remise</th><th>Début</th><th>Fin</th><th>Sorte</th></tr></thead><tbody>`;
    for (const r of rem) h += `<tr><td data-l="Produit">${esc(r.nom)}${r.poids_g ? ` <span class="sous">${r.poids_g} g</span>` : ""}</td><td data-l="Marque">${esc(r.marque || "—")}</td>
      <td data-l="Magasin">${esc(D.enseignes[r.enseigne] || r.enseigne)}</td><td class="n" data-l="Prix habituel">${dt(r.prix_habituel)}</td><td class="n" data-l="Prix remisé"><b>${dt(r.prix_remise)}</b></td>
      <td class="n" data-l="Remise"><span class="p ok">−${pct(r.taux)}</span></td><td data-l="Début">${dateFr(r.debut)}</td><td data-l="Fin">${r.en_cours ? '<span class="p in">en cours</span>' : dateFr(r.fin)}</td>
      <td data-l="Sorte">${r.sorte === "annoncee" ? "prix barré par le magasin" : "constatée dans l’historique"}</td></tr>`;
    h += `</tbody></table></div>`;
  }
  h += `<h2 id="produits">Produits et historique des prix</h2>`;
  if (!avec.length) h += `<div class="vide">Aucun produit relevé sur cette durée avec ces filtres.</div>`;
  else {
    avec.sort((x, y) => x.p.c.localeCompare(y.p.c) || (x.p.m || "zzz").localeCompare(y.p.m || "zzz", "fr") || x.p.n.localeCompare(y.p.n, "fr"));
    const visibles = toutVoir ? avec : avec.slice(0, 150);
    h += `<div class="boite"><table class="cartes" id="t-prod"><thead><tr><th>Produit</th><th>Marque</th><th>Magasin</th><th>Produit</th><th class="n">Poids</th><th class="n">Dernier prix</th><th class="n">Prix au kg</th><th class="n">Min · max</th><th class="n">Variation</th><th>Évolution</th></tr></thead><tbody>`;
    for (const {p, s} of visibles) {
      const vals = s.map(x => x[1][0]), dern = s[s.length - 1][1], k = p.g ? dern[0] / p.g * 1000 : null;
      h += `<tr class="prod" data-id="${esc(p.id)}"><td data-l="Produit">${esc(p.n)}</td><td data-l="Marque">${esc(p.m || "—")}</td><td data-l="Magasin">${esc(D.enseignes[p.e] || p.e)}</td>
        <td data-l="Famille">${CATS[p.c] || p.c}</td><td class="n" data-l="Poids">${p.g ? p.g + " g" : "—"}</td>
        <td class="n" data-l="Dernier prix"><b>${dt(dern[0])}</b>${dern[3] ? ` <span class="p ok">remise</span>` : ""}${p.e === "carrefour" ? `<div class="sous">${dern[2]} magasin${dern[2] > 1 ? "s" : ""}</div>` : ""}</td>
        <td class="n" data-l="Prix au kg">${k == null ? "—" : dt(k)}</td><td class="n" data-l="Min · max">${dt(Math.min(...vals))} · ${dt(Math.max(...vals))}</td>
        <td class="n" data-l="Variation">${variation(s)}</td><td data-l="Évolution">${spark(vals)}</td></tr>`;
      if (ouverts.has(p.id)) h += `<tr class="det"><td colspan="10"><div class="histo">${s.map(([j, v]) => `<span${v[3] ? ' class="rem"' : ""}>${dateFr(j)} : ${dt(v[0])}${v[1] > v[0] + 0.0005 ? ` <s>${dt(v[1])}</s>` : ""}</span>`).join("")}</div>
        <div class="sous">${p.e === "carrefour" ? "Prix le plus courant dans les magasins Carrefour qui ont le produit en stock ; " : ""}<a href="${esc(p.u)}" target="_blank" rel="noopener noreferrer">voir le produit sur le site du magasin ↗</a></div></td></tr>`;
    }
    h += `</tbody></table></div>`;
    if (!toutVoir && avec.length > 150) h += `<p><button class="sec" id="tout">Voir les ${avec.length - 150} autres produits</button></p>`;
  }
  h += `<details class="comment carte"><summary>Comment fonctionne ce site ?</summary><ul>
    <li><b>Ce qu’il suit</b> : les gaufrettes, les biscuits et les chips vendus en ligne par Carrefour (carrefour.tn, chaque magasin) et Géant (geantdrive.tn), toutes marques et tous formats.</li>
    <li><b>Relevé chaque nuit</b> : un robot lit les prix affichés par les sites des magasins (jamais le prix en rayon ni les promotions papier) et ne garde que les produits en stock. Carrefour : prix le plus courant parmi ses magasins, avec le nombre de magasins.</li>
    <li><b>Historique</b> : chaque prix est gardé jour après jour depuis la mise en service (${dateFr(D.jours[0])}) ; touchez un produit pour voir tous ses prix.</li>
    <li><b>Remises</b> : « prix barré par le magasin » = le site affiche un ancien prix barré (au moins 2 % de moins) ; « constatée dans l’historique » = le prix du jour est au moins ${Math.round((D.seuil || 0.05) * 100)} % sous le prix habituel du produit (médiane des ${D.fenetre || 30} derniers jours, au moins 3 relevés). Chaque remise a sa date de début, sa date de fin (ou « en cours ») et son taux.</li>
    <li><b>Durée au choix</b> : 7, 30, 90 jours, tout l’historique ou deux dates ; les chiffres, les remises et les variations se recalculent sur cette durée.</li>
    <li><b>Filtres</b> : produit (gaufrettes, biscuits, chips), magasin, marque, <b>grammage</b> (portion jusqu’à 30 g, 31 à 60 g, 61 à 120 g, 121 à 250 g, plus de 250 g, lots de plusieurs sachets, poids non lu ; le poids est celui écrit par le magasin, un lot « 2 × 70 g » compte 140 g), recherche par mot.</li>
    <li><b>Exporter Excel</b> : un classeur avec l’historique (une ligne par produit, magasin et jour), les remises et la liste des produits, sur la durée et les filtres choisis.</li>
    <li><b>Rapport (PDF)</b> : imprime la page telle qu’elle est filtrée (le téléphone ou l’ordinateur propose « Enregistrer en PDF »).</li>
    <li><b>Ce qui n’est pas compté</b> : les cakes, gâteaux, muffins, barres de céréales et tout produit dont le nom ne dit pas clairement gaufrette, biscuit ou chips (rien n’est deviné). Une marque n’est écrite que si le magasin l’écrit ou si elle est connue.</li>
    <li><b>Vos données</b> : la page est privée (code), les prix sont chiffrés dans le fichier publié et déchiffrés dans votre navigateur ; aucun compteur de visites, rien n’est envoyé.</li>
    <li><b>Comparer les magasins</b> : ce n’est pas un comparateur ; le même produit peut apparaître une fois par magasin, chacun avec son historique.</li>
  </ul></details>
  <p class="note">Prix indicatifs lus sur les sites des magasins : <a href="https://www.carrefour.tn" target="_blank" rel="noopener noreferrer">carrefour.tn</a> et <a href="https://www.geantdrive.tn" target="_blank" rel="noopener noreferrer">geantdrive.tn</a>. Mis à jour chaque nuit vers 2h30 ; page produite le ${dateFr(D.genere)}.</p>`;
  $("#site").innerHTML = h;
  brancher(avec, rem, b);
}

function brancher(avec, rem, b) {
  const maj = () => { F.periode = $("#f-periode").value; F.de = $("#f-de")?.value || ""; F.a = $("#f-a")?.value || ""; F.cat = $("#f-cat").value; F.ens = $("#f-ens").value; F.marque = $("#f-marque").value; F.gram = $("#f-gram").value; F.q = $("#f-q").value.trim(); toutVoir = false; afficher(); };
  for (const id of ["#f-periode", "#f-de", "#f-a", "#f-cat", "#f-ens", "#f-marque", "#f-gram"]) $(id)?.addEventListener("change", maj);
  let t; $("#f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(maj, 300); });
  $("#tout")?.addEventListener("click", () => { toutVoir = true; afficher(); });
  $("#t-prod")?.addEventListener("click", e => {
    const tr = e.target.closest("tr.prod"); if (!tr || e.target.closest("a")) return;
    ouverts.has(tr.dataset.id) ? ouverts.delete(tr.dataset.id) : ouverts.add(tr.dataset.id); afficher();
  });
  $("#sortir").addEventListener("click", () => { ecrire("snacks-code", null); location.reload(); });
  $("#imprimer").addEventListener("click", () => print());
  $("#excel").addEventListener("click", () => exporter(avec, rem, b));
}

// ---------- export Excel (SheetJS, chargé au clic depuis cdnjs ; sans lui : fichiers CSV)
function lignes(avec, rem, b) {
  const [de, a] = b;
  const histo = [["Date", "Magasin", "Produit (famille)", "Marque", "Produit", "Poids (g)", "Prix (DT)", "Prix régulier (DT)", "Prix au kg (DT)", "Magasins en stock", "Magasins en remise", "Lien"]];
  for (const {p, s} of avec) for (const [j, v] of s)
    histo.push([j, D.enseignes[p.e] || p.e, CATS[p.c] || p.c, p.m || "", p.n, p.g ?? "", v[0], v[1] ?? "", p.g ? Math.round(v[0] / p.g * 1000 * 1000) / 1000 : "", v[2] ?? "", v[3] ?? "", p.u || ""]);
  const remises = [["Produit", "Marque", "Magasin", "Famille", "Poids (g)", "Prix habituel (DT)", "Prix remisé (DT)", "Remise (%)", "Début", "Fin", "En cours", "Sorte", "Jours"]];
  for (const r of rem) remises.push([r.nom, r.marque || "", D.enseignes[r.enseigne] || r.enseigne, CATS[r.categorie] || r.categorie, r.poids_g ?? "", r.prix_habituel, r.prix_remise,
    Math.round(r.taux * 1000) / 10, r.debut, r.fin, r.en_cours ? "oui" : "non", r.sorte === "annoncee" ? "prix barré par le magasin" : "constatée dans l'historique", r.jours]);
  const produits = [["Produit", "Marque", "Magasin", "Famille", "Poids (g)", "Premier prix de la durée (DT)", "Dernier prix (DT)", "Variation (%)", "Prix min (DT)", "Prix max (DT)", "Relevés", "Lien"]];
  for (const {p, s} of avec) { const v = s.map(x => x[1][0]); produits.push([p.n, p.m || "", D.enseignes[p.e] || p.e, CATS[p.c] || p.c, p.g ?? "", v[0], v[v.length - 1], v.length > 1 ? Math.round((v[v.length - 1] / v[0] - 1) * 1000) / 10 : "", Math.min(...v), Math.max(...v), v.length, p.u || ""]); }
  return {histo, remises, produits, nom: `prix-gaufrettes-biscuits-chips-${de}-${a}`};
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
async function exporter(avec, rem, b) {
  const btn = $("#excel"); btn.disabled = true; btn.textContent = "Préparation…";
  const L = lignes(avec, rem, b);
  try {
    const X = await chargerSheetJS();
    const wb = X.utils.book_new();
    for (const [nom, rows] of [["Historique", L.histo], ["Remises", L.remises], ["Produits", L.produits]]) {
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
  btn.disabled = false; btn.textContent = "⬇ Exporter Excel";
}

// ---------- entrée
$("#f").addEventListener("submit", e => { e.preventDefault(); ouvrir($("#code").value, $("#garder").checked); });
const garde = lire("snacks-code");
if (garde) ouvrir(garde, true);
