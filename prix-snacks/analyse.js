"use strict";
// Analyse de la concurrence (demande d'Ahmed et de son frère, 15/11/2026) : fonctions PURES, sans affichage, testées par
// tools/essai_page.mjs avec des données inventées. Utilisées par app.js. Rien n'est deviné :
//  - une remise déjà présente au premier relevé du produit a un début INCONNU : elle ne compte jamais comme un « lancement » ;
//  - « suivre » = lancer une remise dans les N jours après une autre marque ; ce n'est pas une preuve de copie (coïncidence possible).
(function () {
  const jourSuivant = (j, n) => { const d = new Date(j + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ecart = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  // marque -> Map(jour -> {n: remises actives ce jour, max: plus fort taux}) ; seulement les jours relevés (jours)
  function calendrier(remises, jours) {
    const cal = new Map();
    for (const r of remises) {
      if (!r.marque) continue;
      const m = cal.get(r.marque) || new Map(); cal.set(r.marque, m);
      for (const j of jours) if (j >= r.debut && j <= r.fin) {
        const c = m.get(j) || {n: 0, max: 0, lancee: false}; c.n++; c.max = Math.max(c.max, r.taux || 0); m.set(j, c);
      }
    }
    return cal;
  }

  // marque -> jours de LANCEMENT : jour où au moins une remise de la marque commence, avec un début connu
  function lancements(remises) {
    const L = new Map();
    for (const r of remises) {
      if (!r.marque || r.debut_connu === false) continue;
      const s = L.get(r.marque) || new Set(); s.add(r.debut); L.set(r.marque, s);
    }
    return new Map([...L].map(([m, s]) => [m, [...s].sort()]));
  }

  // « qui suit qui » : pour chaque paire (A lance, B suit), nombre de lancements de A suivis d'un lancement de B dans 0..fenetre jours
  function quiSuitQui(remises, fenetre = 7) {
    const L = lancements(remises), res = [];
    for (const [a, sa] of L) for (const [b, sb] of L) {
      if (a === b) continue;
      let n = 0, meme = 0, delais = [];
      for (const d of sa) {
        const suite = sb.find(x => x >= d && x <= jourSuivant(d, fenetre));
        if (suite) { n++; const e = ecart(d, suite); delais.push(e); if (e === 0) meme++; }
      }
      if (n) res.push({a, b, n, sur: sa.length, meme_jour: meme, delai_moyen: Math.round(delais.reduce((x, y) => x + y, 0) / delais.length * 10) / 10});
    }
    return res.sort((x, y) => y.n / y.sur - x.n / x.sur || y.n - x.n || x.delai_moyen - y.delai_moyen);
  }

  // résumé des remises par marque (les remises sans marque lue sont regroupées à part)
  function parMarque(remises) {
    const M = new Map();
    for (const r of remises) {
      const k = r.marque || "";
      const x = M.get(k) || {marque: k, n: 0, en_cours: 0, taux: [], montants: [], enseignes: new Set(), debut: r.debut, fin: r.fin, lancements: 0};
      x.n++; if (r.en_cours) x.en_cours++; if (r.taux != null) x.taux.push(r.taux); if (r.montant != null) x.montants.push(r.montant);
      x.enseignes.add(r.enseigne); if (r.debut < x.debut) x.debut = r.debut; if (r.fin > x.fin) x.fin = r.fin; if (r.debut_connu !== false) x.lancements++;
      M.set(k, x);
    }
    return [...M.values()].map(x => ({marque: x.marque, n: x.n, en_cours: x.en_cours, lancements: x.lancements,
      taux_moyen: x.taux.length ? x.taux.reduce((a, b) => a + b, 0) / x.taux.length : null, taux_max: x.taux.length ? Math.max(...x.taux) : null,   // offre sans % écrit : pas comptée dans les %
      montant_moyen: x.montants.length ? x.montants.reduce((a, b) => a + b, 0) / x.montants.length : null,
      enseignes: [...x.enseignes].sort(), debut: x.debut, fin: x.fin}))
      .sort((x, y) => (x.marque === "") - (y.marque === "") || y.n - x.n || (y.taux_max ?? 0) - (x.taux_max ?? 0));
  }

  // prix au kilo d'un produit un jour donné (null sans poids lu)
  const prixKg = (p, j) => p.g && p.p[j] ? p.p[j][0] / p.g * 1000 : null;
  const mediane = v => { const s = [...v].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  // courbe d'une marque : médiane des prix au kilo de ses produits (avec poids) relevés ce jour-là
  function courbeMarque(produits, marque, jours) {
    return jours.map(j => [j, mediane(produits.filter(p => p.m === marque).map(p => prixKg(p, j)).filter(v => v != null))]).filter(x => x[1] != null);
  }
  function courbeProduit(p, jours) { return jours.map(j => [j, prixKg(p, j), p.p[j] ? !!p.p[j][3] || p.p[j][1] > p.p[j][0] + 0.0005 : false]).filter(x => x[1] != null); }

  window.SNACKS_ANALYSE = {calendrier, lancements, quiSuitQui, parMarque, courbeMarque, courbeProduit, mediane, prixKg, ecart, jourSuivant};
})();
