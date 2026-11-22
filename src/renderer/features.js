"use strict";
// VELOX Preset Studio – extra features: packs view, performance hints, import + check,
// preset mixer, cleanup, look building blocks, day/night view, hover explanations.
// Everything here is generic: it only works with what is installed in the user's ReShade folder.

// ============================================================ day / night
const DN_RE = [/\b(day|tag)\b/i, /\b(night|nacht)\b/i];
function isDN(u) {
  if (!u || u.dim !== 2) return false;
  const t = (u.tooltip + " " + u.text + " " + u.label).toUpperCase();
  return (t.includes("DAY") && t.includes("NIGHT")) || (t.includes("TAG") && t.includes("NACHT"));
}
function dnSide(u) {
  if (!u || u.dim !== 1) return "";
  const words = splitWords(u.name + " " + u.label).toLowerCase();
  const day = /\b(day|tag|daytime)\b/.test(words), night = /\b(night|nacht|nighttime)\b/.test(words);
  return day && !night ? "day" : night && !day ? "night" : "";
}
function dnSwitch() {
  const mk = (v, lab) => h("button", { class: "seg" + (S.dn === v ? " on" : ""), onclick: e => { S.dn = v; localStorage.setItem("dn", v); $("#params").className = "dn-" + v; $$(".phead .dnsw .seg").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } }, lab);
  return h("div", { class: "dnsw", "data-tip": L("Nur Tag- oder nur Nacht-Werte anzeigen", "Show only day or only night values") },
    mk("both", L("Beide", "Both")), mk("day", L("☀ Tag", "☀ Day")), mk("night", L("☾ Nacht", "☾ Night")));
}

// ============================================================ performance hints (heuristic)
const PERF_HEAVY = /(rtgi|radiantgi|pcgi|turbogi|zenrcao|(^|[_\W])gi([_\W]|$)|ssr|ssdo|mxao|ssao|gtao|xegtao|hbao|miao|neossao|lsao|rtao|quantao|(^|[_\W])ao([_\W]|$)|volumetric|godray|cinematicdof|adof|qunit_dof|motionblur|motion_blur|denoise|nonlocal|knearest|(^|[_\W])taa|traa|dlaa-t|launchpad|framework|raytrac|nglighting|solaris)/i;
const PERF_MED = /(dof|bloom|blur|lens|flare|smaa|cmaa|lightroom|halation|deband|localcontrast|clarity|neural|sharpen_neural|depth|fog|glow|halftone|crt)/i;
function perfLevel(key) {
  const s = key.replace(/@/g, " ");
  return PERF_HEAVY.test(s) ? 2 : PERF_MED.test(s) ? 1 : 0;
}
function perfBadge(key, big) {
  const l = perfLevel(key);
  if (!l) return null;
  return h("span", { class: "badge perf" + l + (big ? " big" : ""), "data-tip": l === 2
    ? L("Schwerer Effekt – kann deutlich FPS kosten (Schätzung nach Effekt-Typ)", "Heavy effect – can cost a lot of FPS (estimate by effect type)")
    : L("Mittlerer Effekt – kostet etwas FPS (Schätzung)", "Medium effect – costs some FPS (estimate)") }, l === 2 ? "FPS ▼▼" : "FPS ▼");
}
const _renderStack = renderStack;
let lastStackRel = null;
renderStack = function () {
  _renderStack();
  if (S.cur && S.cur.rel !== lastStackRel) { lastStackRel = S.cur.rel; const sl = $("#stackList"); if (sl) setTimeout(() => (sl.scrollTop = 0)); }
  const head = $(".stack-head span");
  if (!head || !S.cur) return;
  const score = M.enabled().reduce((a, k) => a + [0.3, 1, 3][perfLevel(k)], 0);
  const lvl = score >= 6 ? 2 : score >= 2.5 ? 1 : 0;
  renderOtherEffects();
  head.innerHTML = "";
  head.append(L("Effekte im Preset", "Effects in preset"), " ",
    h("span", { class: "load l" + lvl, "data-tip": L("Geschätzte Last aller aktiven Effekte", "Estimated load of all active effects") },
      [L("Last: gering", "Load: low"), L("Last: mittel", "Load: medium"), L("Last: hoch", "Load: high")][lvl]));
};

// ---- "Other effects": every installed effect that is not in the preset, grouped by pack
let otherFilter = "";
const otherOpen = new Set(JSON.parse(localStorage.getItem("otherOpen") || "[]"));
function renderOtherEffects() {
  const box = $("#stackList");
  if (!box || !S.cur || !S.techs.length) return;
  const inPreset = new Set([...M.enabled(), ...stackEntries().off]);
  const q = otherFilter.toLowerCase();
  const groups = new Map();
  for (const t of S.techs) {
    const k = `${t.name}@${t.file}`;
    if (inPreset.has(k)) continue;
    if (q && !(t.label + " " + t.name + " " + t.file + " " + (t.pack || "")).toLowerCase().includes(q)) continue;
    const g = isFav(k) ? L("★ Favoriten", "★ Favorites") : (t.pack || L("Einzel-Shader", "Single shaders"));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(k);
  }
  const names = [...groups.keys()].sort((a, b) => (b.startsWith("★") - a.startsWith("★")) || a.localeCompare(b));
  const total = [...groups.values()].reduce((a, l) => a + l.length, 0);
  const search = h("input", { type: "search", class: "other-search", placeholder: L("Andere Effekte durchsuchen…", "Search other effects…"), value: otherFilter });
  search.addEventListener("input", () => { otherFilter = search.value; renderStack(); const i = $(".other-search"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  box.append(h("div", { class: "stack-sep other-head" }, L("Andere Effekte", "Other effects") + ` (${total})`), search);
  for (const g of names) {
    const list = groups.get(g);
    const open = otherOpen.has(g) || (q && total <= 60);
    box.append(h("div", { class: "other-grp", onclick: () => { otherOpen.has(g) ? otherOpen.delete(g) : otherOpen.add(g); localStorage.setItem("otherOpen", JSON.stringify([...otherOpen])); renderStack(); } },
      h("span", {}, (open ? "▾ " : "▸ ") + g), h("span", { class: "muted" }, list.length)));
    if (open) for (const k of list) box.append(fxItem(k, false));
  }
}

// ============================================================ packs view
let packFilter = "", packOpen = new Set(JSON.parse(localStorage.getItem("packOpen") || "[]"));
function renderPacks() {
  const el = $("#view-packs"); el.className = "view scroll"; el.innerHTML = "";
  const en = S.cur ? new Set(M.enabled()) : new Set();
  const groups = new Map();
  for (const t of S.techs) {
    const g = t.pack || L("Einzel-Shader", "Single shaders");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const names = [...groups.keys()].sort((a, b) => {
    const ua = groups.get(a).some(t => en.has(`${t.name}@${t.file}`)), ub = groups.get(b).some(t => en.has(`${t.name}@${t.file}`));
    return (ub - ua) || a.localeCompare(b);
  });
  const inp = h("input", { placeholder: L("Paket oder Effekt suchen…", "Search pack or effect…"), value: packFilter, style: "width:280px", oninput: e => { packFilter = e.target.value; draw(); } });
  el.append(h("div", { class: "toolbar" }, h("b", {}, names.length + " " + L("Pakete", "packs") + " · " + S.techs.length + " " + L("Effekte", "effects")), inp,
    h("span", { class: "muted" }, L("Alles, was in deinem reshade-shaders-Ordner installiert ist. Pakete mit Effekten im offenen Preset stehen oben.", "Everything installed in your reshade-shaders folder. Packs used by the open preset are on top."))));
  const box = h("div", { class: "packs" }); el.append(box);
  const draw = () => {
    box.innerHTML = "";
    const q = packFilter.toLowerCase();
    for (const n of names) {
      let list = groups.get(n);
      if (q && !n.toLowerCase().includes(q)) list = list.filter(t => (t.label + " " + t.name + " " + t.file).toLowerCase().includes(q));
      if (!list.length) continue;
      const used = list.filter(t => en.has(`${t.name}@${t.file}`)).length;
      const files = new Set(list.map(t => t.file)).size;
      const open = packOpen.has(n) || !!q;
      const body = h("div", { class: "pk-body" + (open ? "" : " hidden") });
      if (open) for (const t of list) {
        const k = `${t.name}@${t.file}`;
        body.append(h("div", { class: "pk-row", "data-tipfx": k },
          h("div", { class: "nm" }, h("b", {}, t.label), h("small", {}, t.file)),
          perfBadge(k), logBadge(k), isFav(k) ? h("span", { class: "badge" }, "★") : null,
          S.cur ? h("label", { class: "tog", "data-tip": L("Im offenen Preset an/aus", "On/off in the open preset") },
            h("input", { type: "checkbox", checked: en.has(k), onchange: e => { toggleFx(k, e.target.checked); renderPacks(); } }), h("span", { class: "sw" })) : null,
          S.cur ? h("button", { class: "small", onclick: () => { if (!en.has(k)) toggleFx(k, true); S.sel = k; showView("editor"); } }, L("Einstellen", "Adjust")) : null));
      }
      box.append(h("div", { class: "pk" + (used ? " used" : "") },
        h("div", { class: "pk-head", onclick: () => { open ? packOpen.delete(n) : packOpen.add(n); localStorage.setItem("packOpen", JSON.stringify([...packOpen])); draw(); } },
          h("span", { class: "pk-name" }, (open ? "▾ " : "▸ ") + n),
          used ? h("span", { class: "badge pack" }, used + " " + L("im Preset", "in preset")) : null,
          h("span", { class: "muted" }, `${list.length} ${list.length === 1 ? L("Effekt", "effect") : L("Effekte", "effects")} · ${files} ${files === 1 ? L("Datei", "file") : L("Dateien", "files")}`)), body));
    }
  };
  draw();
}

// ============================================================ check + import
function checkReport(c) {
  const box = h("div", { class: "report" });
  if (c.ok) box.append(h("p", { class: "ok" }, "✓ " + L(`Alles da – alle ${c.enabled} Effekte, Shader und Texturen sind installiert.`, `All good – all ${c.enabled} effects, shaders and textures are installed.`)));
  if (c.missingShaders.length) {
    box.append(h("h4", {}, L("Fehlende Shader-Dateien", "Missing shader files")));
    for (const m of c.missingShaders) box.append(h("div", { class: "rep-row bad" }, "✕ ", h("b", {}, m.file), " ",
      h("span", { class: "muted" }, "(" + m.techniques.join(", ") + ")"),
      m.hint ? h("div", { class: "muted small" }, L(`Paket „${m.hint}“ ist installiert – vermutlich andere Version. Paket aktualisieren.`, `Pack "${m.hint}" is installed – probably a different version. Update the pack.`))
        : h("div", { class: "muted small" }, L("Nicht installiert – das zugehörige Shader-Paket in reshade-shaders\\Shaders installieren.", "Not installed – install the matching shader pack into reshade-shaders\\Shaders."))));
  }
  if (c.missingTechniques.length) {
    box.append(h("h4", {}, L("Datei da, aber Effekt fehlt", "File present, effect missing")));
    for (const k of c.missingTechniques) box.append(h("div", { class: "rep-row wrn" }, "! ", h("b", {}, k), h("div", { class: "muted small" }, L("Shader-Datei hat eine andere Version.", "The shader file is a different version."))));
  }
  if (c.missingTextures.length) {
    box.append(h("h4", {}, L("Fehlende Texturen", "Missing textures")));
    for (const t of c.missingTextures) box.append(h("div", { class: "rep-row bad" }, "✕ ", h("b", {}, t), h("div", { class: "muted small" }, L("In reshade-shaders\\Textures ablegen.", "Put it into reshade-shaders\\Textures."))));
  }
  return box;
}
async function checkCurrent() {
  if (!S.cur) return;
  try { const c = await api("/api/check", { model: S.cur.model }); modal(L("Preset prüfen", "Check preset"), checkReport(c), [[L("Schließen", "Close"), () => true]]); }
  catch (e) { toast(e.message); }
}
async function importPresets(files) {
  files = files || await window.vps.pickPreset();
  for (const f of files) {
    let r; try { r = await api("/api/readfile", { file: f }); } catch (e) { toast(e.message); continue; }
    await new Promise(done => {
      const name = h("input", { value: r.name, style: "width:100%" });
      const folder = h("input", { value: "Importiert", style: "width:100%" });
      modal(L("Preset importieren: ", "Import preset: ") + r.name, h("div", {},
        h("div", { class: "form" }, h("label", {}, L("Name", "Name")), name, h("label", {}, L("Ordner", "Folder")), folder),
        h("h4", {}, L("Prüfung", "Check")), checkReport(r.check)), [
        [L("Abbrechen", "Cancel"), () => true],
        [L("Importieren", "Import"), async () => {
          try { const x = await api("/api/new", { name: name.value, folder: folder.value, model: r.model }); await loadPresets(); S.dirty = false; await openPreset(x.rel); toast(L("Importiert", "Imported"), true); }
          catch (e) { toast(e.message); return false; }
        }, "primary"]], () => setTimeout(done, 50));
    });
  }
}

// ============================================================ mixer
async function buildMix(rA, rB, w, onlyModel) {
  const [A, B] = await Promise.all([rA, rB].map(r => api("/api/preset?rel=" + enc(r)).then(x => x.model)));
  const lst = (m, k) => ((m.global.find(i => i[0] === k) || [])[1] || "").split(",").map(s => s.trim()).filter(Boolean);
  const eA = lst(A, "Techniques"), eB = lst(B, "Techniques");
  const dom = w > 0.5 ? eB : eA, oth = w > 0.5 ? eA : eB, wOth = w > 0.5 ? 1 - w : w;
  const both = new Set(eA.filter(k => eB.includes(k)));
  const keys = [...dom, ...oth.filter(k => !dom.includes(k) && (both.has(k) || wOth >= 0.35))];
  const files = new Set(keys.map(fileOf).map(f => f.toLowerCase()));
  const secA = new Map(A.sections.map(s => [s.name.toLowerCase(), s])), secB = new Map(B.sections.map(s => [s.name.toLowerCase(), s]));
  const sections = [];
  for (const f of new Set([...secA.keys(), ...secB.keys()])) {
    const a = secA.get(f), b = secB.get(f);
    const name = (a || b).name;
    if (!files.has(f)) { const d = (w > 0.5 ? b : a) || a || b; sections.push({ name, items: clone(d.items) }); continue; }
    const d = await fxDetails(name).catch(() => null);
    const def = k => { const u = d && d.uniforms ? d.uniforms.find(x => x.name === k) : null; return u ? u.default.join(",") : null; };
    const ma = Object.fromEntries(a?.items || []), mb = Object.fromEntries(b?.items || []);
    const items = [];
    for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
      const va = ma[k] ?? def(k), vb = mb[k] ?? def(k);
      const na = va != null ? String(va).split(",").map(Number) : null, nb = vb != null ? String(vb).split(",").map(Number) : null;
      if (na && nb && na.length === nb.length && !na.some(isNaN) && !nb.some(isNaN) && k !== "PreprocessorDefinitions") {
        const isInt = String(va).indexOf(".") < 0 && String(vb).indexOf(".") < 0;
        items.push([k, na.map((x, i) => { const v = x + (nb[i] - x) * w; return isInt ? String(Math.round(v)) : v.toFixed(6); }).join(",")]);
      } else items.push([k, String((w > 0.5 ? vb ?? va : va ?? vb) ?? "")]);
    }
    sections.push({ name, items });
  }
  const sort = [...keys, ...lst(w > 0.5 ? B : A, "TechniqueSorting").filter(k => !keys.includes(k))];
  return { global: [["Techniques", keys.join(",")], ["TechniqueSorting", sort.join(",")]], sections };
}
function mixModal() {
  const opts = sel => S.presets.map(p => h("option", { value: p.rel, selected: p.rel === sel }, `${p.folder} / ${p.name}`));
  const a = h("select", { style: "width:100%" }, opts(S.cur?.rel));
  const b = h("select", { style: "width:100%" }, opts(S.presets.find(p => p.rel !== S.cur?.rel)?.rel));
  const pct = h("span", { class: "mixpct" }, "50 %");
  const sl = h("input", { type: "range", min: 0, max: 100, value: 50, style: "width:100%", oninput: () => { pct.textContent = `${100 - sl.value} % A · ${sl.value} % B`; } });
  const name = h("input", { placeholder: L("Name (leer = automatisch)", "Name (empty = automatic)"), style: "width:100%" });
  pct.textContent = "50 % A · 50 % B";
  modal(L("Presets mischen", "Mix presets"), h("div", {},
    h("div", { class: "form" }, h("label", {}, "A"), a, h("label", {}, "B"), b, h("label", {}, L("Mischung", "Blend")), h("div", {}, sl, pct), h("label", {}, L("Neues Preset", "New preset")), name),
    h("p", { class: "muted" }, L("Gemeinsame Effekte werden stufenlos gemischt. Effekte, die nur in einem Preset sind, kommen ab 35 % Anteil dazu. Ergebnis wird ein neues Preset im Ordner „Eigene“.",
      "Shared effects are blended smoothly. Effects that exist in only one preset are added from 35 % share. The result is a new preset in the \"Eigene\" folder."))), [
    [L("Abbrechen", "Cancel"), () => true],
    [L("Mischen & öffnen", "Mix & open"), async () => {
      if (a.value === b.value) { toast(L("Bitte zwei verschiedene Presets wählen", "Pick two different presets")); return false; }
      try {
        const w = sl.value / 100;
        const model = await buildMix(a.value, b.value, w);
        const nA = S.presets.find(p => p.rel === a.value).name, nB = S.presets.find(p => p.rel === b.value).name;
        const r = await api("/api/new", { name: name.value || `Mix ${nA} x ${nB} ${Math.round(w * 100)}`, folder: "Eigene", model });
        await loadPresets(); S.dirty = false; await openPreset(r.rel); toast(L("Gemischt", "Mixed"), true);
      } catch (e) { toast(e.message); return false; }
    }, "primary"]]);
}

// ============================================================ cleanup
async function cleanupPlan(model) {
  const lst = k => ((model.global.find(i => i[0] === k) || [])[1] || "").split(",").map(s => s.trim()).filter(Boolean);
  const en = lst("Techniques"), so = lst("TechniqueSorting");
  const enabledFiles = new Set(en.map(fileOf).map(f => f.toLowerCase()));
  const installed = new Set(S.techs.map(t => t.file.toLowerCase()));
  const techSet = new Set(S.techs.map(t => `${t.name}@${t.file}`.toLowerCase()));
  const plan = { dupList: (en.length - new Set(en).size) + (so.length - new Set(so).size), dupKeys: 0, sortGhost: so.filter(k => !techSet.has(k.toLowerCase()) && !en.includes(k)).length,
    notInstalled: 0, unknown: 0, offEffects: 0, defaults: 0 };
  for (const s of model.sections) {
    const keys = s.items.map(i => i[0]); plan.dupKeys += keys.length - new Set(keys).size;
    const fl = s.name.toLowerCase();
    if (!installed.has(fl)) { plan.notInstalled += s.items.length; continue; }
    if (!enabledFiles.has(fl)) plan.offEffects += s.items.length;
    const d = await fxDetails(s.name).catch(() => null);
    if (!d || d.missing) continue;
    const um = new Map(d.uniforms.map(u => [u.name, u]));
    for (const [k, v] of s.items) {
      if (k === "PreprocessorDefinitions") continue;
      const u = um.get(k);
      if (!u) plan.unknown++;
      else { const vals = parseVals(v, u.dim); if (vals && sameVals(vals, u.default)) plan.defaults++; }
    }
  }
  return plan;
}
async function applyCleanup(model, o) {
  const g = k => model.global.find(i => i[0] === k);
  const installed = new Set(S.techs.map(t => t.file.toLowerCase()));
  const techSet = new Set(S.techs.map(t => `${t.name}@${t.file}`.toLowerCase()));
  const uniq = a => [...new Set(a)];
  const en = (g("Techniques")?.[1] || "").split(",").map(s => s.trim()).filter(Boolean);
  let so = (g("TechniqueSorting")?.[1] || "").split(",").map(s => s.trim()).filter(Boolean);
  if (o.dupList) { if (g("Techniques")) g("Techniques")[1] = uniq(en).join(","); so = uniq(so); }
  if (o.sortGhost) so = so.filter(k => techSet.has(k.toLowerCase()) || en.includes(k));
  if (g("TechniqueSorting")) g("TechniqueSorting")[1] = so.join(",");
  const enabledFiles = new Set(en.map(fileOf).map(f => f.toLowerCase()));
  const out = [];
  for (const s of model.sections) {
    const fl = s.name.toLowerCase();
    if (o.notInstalled && !installed.has(fl)) continue;
    if (o.offEffects && installed.has(fl) && !enabledFiles.has(fl)) continue;
    let items = s.items;
    if (o.dupKeys) { const seen = new Set(); items = items.filter(([k]) => !seen.has(k) && seen.add(k)); }
    if (o.unknown || o.defaults) {
      const d = await fxDetails(s.name).catch(() => null);
      if (d && !d.missing) {
        const um = new Map(d.uniforms.map(u => [u.name, u]));
        items = items.filter(([k, v]) => {
          if (k === "PreprocessorDefinitions") return true;
          const u = um.get(k);
          if (!u) return !o.unknown;
          if (o.defaults) { const vals = parseVals(v, u.dim); if (vals && sameVals(vals, u.default)) return false; }
          return true;
        });
      }
    }
    if (items.length) out.push({ name: s.name, items });
  }
  model.sections = out;
}
const CLEAN_OPTS = () => [
  ["dupList", true, L("Doppelte Einträge in Effektliste und Reihenfolge", "Duplicate entries in effect list and order")],
  ["dupKeys", true, L("Doppelte Werte im selben Effekt", "Duplicate values inside one effect")],
  ["sortGhost", true, L("Reihenfolge-Einträge für nicht installierte Effekte", "Order entries for effects that are not installed")],
  ["notInstalled", false, L("Werte für Shader, die nicht installiert sind", "Values for shaders that are not installed")],
  ["unknown", false, L("Werte, die der Shader nicht (mehr) kennt – evtl. von älteren Versionen", "Values the shader does not know (anymore) – maybe from older versions")],
  ["offEffects", false, L("Gespeicherte Werte von ausgeschalteten Effekten", "Stored values of switched-off effects")],
  ["defaults", false, L("Werte, die genau dem Standard entsprechen (macht die Datei kleiner, ändert nichts am Bild)", "Values equal to the default (smaller file, same look)")],
];
async function cleanupModal() {
  if (!S.cur) return;
  const plan = await cleanupPlan(S.cur.model);
  const boxes = {};
  const list = h("div", {}, CLEAN_OPTS().map(([k, def, lab]) => h("label", { class: "chk" + (plan[k] ? "" : " none") },
    boxes[k] = h("input", { type: "checkbox", checked: def && plan[k] > 0, disabled: !plan[k] }), " ", lab, " ", h("b", {}, String(plan[k])))));
  modal(L("Preset aufräumen", "Clean up preset"), h("div", {}, list, h("p", { class: "muted" }, L("Alles ist rückgängig machbar (Strg+Z), beim Speichern wird eine Version gesichert.", "Everything can be undone (Ctrl+Z); saving stores a version."))), [
    [L("Abbrechen", "Cancel"), () => true],
    [L("Aufräumen", "Clean up"), async () => {
      const o = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.checked]));
      beforeChange(); await applyCleanup(S.cur.model, o); changed(true);
      toast(L("Aufgeräumt", "Cleaned up"), true);
    }, "primary"]]);
}

// ============================================================ look building blocks
const LOOKS = [
  { id: "warm", de: "Wärme", en: "Warmth", minus: ["Kälter", "Cooler"], plus: ["Wärmer", "Warmer"], re: /(temperature|ctemp|kelvin|warmth|white_?balance|(^|[_\s])temp([_\s]|$))/i, not: /intensity|amount|strength|mix|emergency|light|lamp|corona/i, kelvin: true, add: ["prod80_04_ColorTemperature@PD80_04_Color_Temperature.fx", "Lightroom@qUINT_lightroom.fx"] },
  { id: "contrast", de: "Kontrast", en: "Contrast", re: /contrast/i, not: /adapt|threshold|edge|sharp|limit|detect|mask|local|clarity|light|emissive/i, add: ["Curves@Curves.fx", "prod80_04_ContrastBrightnessSaturation@PD80_04_Contrast_Brightness_Saturation.fx"] },
  { id: "sat", de: "Sättigung", en: "Saturation", re: /(saturation|vibrance|colou?rfulness|chroma|(^|[_\s])sat([_\s]|$))/i, not: /limit|threshold|desat|bloom|mask|emergency|sss|skin|balance|corona|light|lamp|emissive|veh|galaxy|star|sky/i, add: ["Vibrance@Vibrance.fx", "Colourfulness@Colourfulness.fx"] },
  { id: "bright", de: "Helligkeit", en: "Brightness", minus: ["Dunkler", "Darker"], plus: ["Heller", "Brighter"], re: /(exposure|brightness|(^|[_\s])q?bright([_\s]|$))/i, not: /night|threshold|bloom|adapt|limit|ui|light|lamp|emissive|corona|veh|sky|star/i, add: ["Levels@Levels.fx", "LiftGammaGain@LiftGammaGain.fx"] },
  { id: "bloom", de: "Bloom / Leuchten", en: "Bloom / glow", re: /(bloom.*(intensity|amount|strength|mult)|bloom_?int|(^|[_\s])bloom([_\s]|$)|glow.*(intensity|amount|strength))/i, not: /threshold|layer|debug|adapt|sat|curve/i, add: ["Bloom@qUINT_bloom.fx", "MagicBloom@MagicBloom.fx"] },
  { id: "sharp", de: "Schärfe", en: "Sharpness", re: /(sharpen|sharpness|sharp_?strength|(^|[_\s])sharp([_\s]|$)|cas_?contrast)/i, not: /clamp|radius|debug|mask|limit|pattern/i, add: ["ContrastAdaptiveSharpen@CAS.fx", "LumaSharpen@LumaSharpen.fx"] },
  { id: "vignette", de: "Vignette", en: "Vignette", re: /(vignette.*(amount|intensity|strength)|vignette_?amount)/i, fileRe: /vignette/i, fileKey: /^(amount|intensity|strength)$/i, add: ["Vignette@Vignette.fx"] },
  { id: "grain", de: "Filmkorn", en: "Film grain", re: /(grain.*(intensity|amount|strength)|filmicnoise|(^|[_\s])noise([_\s]|$)|(^|[_\s])grain([_\s]|$))/i, not: /size|speed|seed|sat|blue/i, add: ["FilmGrain@FilmGrain.fx"] },
];
function splitWords(s) { return String(s).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " "); }
async function applyLook(id, dir, strength = 1, onlyNight = false) {
  if (!S.cur) throw new Error(L("Kein Preset offen", "No preset open"));
  const changes = [];
  const files = [...new Set(M.enabled().map(fileOf))];
  if (id === "film") {
    for (const [i, d] of [["contrast", 1], ["sat", -1], ["vignette", 1], ["grain", 1]]) changes.push(...(await applyLook(i, d * dir, strength, false)).changes);
    return { changes, suggest: [] };
  }
  if (id === "night") {
    beforeChange();
    for (const f of files) {
      const d = await fxDetails(f).catch(() => null); if (!d || d.missing) continue;
      for (const u of d.uniforms) {
        const words = splitWords(u.name + " " + u.label);
        const cur = parseVals(M.get(f, u.name), u.dim) || u.default.slice();
        if (u.base === "bool" && /night/i.test(words) && /bright|light/i.test(words)) {
          if (!cur[0] !== (dir < 0)) continue;
          M.set(f, u.name, fmtVals(u, [dir > 0 ? 1 : 0])); changes.push(`${f} › ${u.label}: ${dir > 0 ? L("an", "on") : L("aus", "off")}`);
        } else if (u.base !== "bool" && !u.items && (isDN(u) && /(exposure|bright|gamma)/i.test(words) && !/(contrast|sat|vignette|grain|noise|corona|emissive|light|lamp|reflect|spec|tint|mood|temp|intensity)/i.test(words))) {
          const { mn, mx } = rangeOf(u, cur); const step = Math.min((mx - mn) * 0.05, Math.max(Math.abs(cur[1]), 0.2) * 0.08) * strength * dir;
          const nv = cur.slice(); nv[1] = Math.min(mx, Math.max(mn, nv[1] + step));
          M.set(f, u.name, fmtVals(u, nv)); changes.push(`${f} › ${u.label} (${L("Nacht", "night")}): ${cur[1].toFixed(3)} → ${nv[1].toFixed(3)}`);
        }
      }
    }
    if (changes.length) changed(true);
    return { changes, suggest: [] };
  }
  const look = LOOKS.find(x => x.id === id);
  if (!look) throw new Error("Look?");
  beforeChange();
  for (const f of files) {
    const d = await fxDetails(f).catch(() => null); if (!d || d.missing) continue;
    for (const u of d.uniforms) {
      if (u.base === "bool" || u.items || u.ui_type === "color" || (u.dim > 1 && !isDN(u))) continue;
      const words = splitWords(u.name) + " " + u.label;
      const hit = (look.re.test(words) || (look.fileRe && look.fileRe.test(f) && look.fileKey.test(u.name))) && !(look.not && look.not.test(words));
      if (!hit) continue;
      const cur = parseVals(M.get(f, u.name), u.dim) || u.default.slice();
      const { mn, mx } = rangeOf(u, cur);
      let sign = dir;
      if (look.id === "vignette" && (u.default[0] < 0 || cur[0] < 0)) sign = -dir;
      const nv = cur.map((v, i) => {
        if (onlyNight && u.dim === 2 && i === 0) return v;
        if (look.kelvin && Math.abs(v) > 1000) return Math.round(v - sign * 350 * strength); // kelvin: lower = warmer
        const step = Math.min((mx - mn) * 0.05, Math.max(Math.abs(v), 0.2) * 0.1);
        return Math.min(mx, Math.max(mn, v + sign * step * strength));
      });
      if (sameVals(nv, cur)) continue;
      M.set(f, u.name, fmtVals(u, nv));
      changes.push(`${f} › ${u.label}: ${cur.map(x => +x.toFixed(3)).join(", ")} → ${nv.map(x => +x.toFixed(3)).join(", ")}`);
    }
  }
  if (changes.length) changed(true);
  const suggest = changes.length ? [] : look.add.filter(k => S.techByKey[k] && !M.enabled().includes(k));
  return { changes, suggest };
}
function lookModal() {
  if (!S.cur) return;
  let strength = 1;
  const log = h("div", { class: "lookLog" }, h("div", { class: "muted" }, L("Klick auf − oder + ändert passende Regler in deinen aktiven Effekten. Alles mit Strg+Z rückgängig.", "Click − or + to change matching sliders in your active effects. Undo with Ctrl+Z.")));
  const run = async (id, dir) => {
    try {
      const r = await applyLook(id, dir, strength);
      log.prepend(h("div", { class: "lk-entry" }, r.changes.length
        ? h("div", {}, h("b", { class: "ok" }, `✓ ${r.changes.length} ${L("Regler geändert", "sliders changed")}`), ...r.changes.slice(0, 8).map(c => h("div", { class: "muted small" }, c)))
        : h("div", {}, h("b", { class: "wrn" }, L("Kein passender Regler in deinen aktiven Effekten.", "No matching slider in your active effects.")),
          ...r.suggest.map(k => h("button", { class: "small", style: "margin:4px 6px 0 0", onclick: async e => { toggleFx(k, true); e.target.disabled = true; await run(id, dir); } }, "+ " + (S.techByKey[k]?.label || k))))));
    } catch (e) { toast(e.message); }
  };
  const row = (id, lab, minus, plus) => h("div", { class: "lk-row" }, h("span", {}, lab),
    h("button", { onclick: () => run(id, -1) }, "− " + (minus || "")), h("button", { onclick: () => run(id, +1) }, "+ " + (plus || "")));
  const str = h("div", { class: "dnsw" }, [[0.5, L("fein", "fine")], [1, L("normal", "normal")], [2, L("stark", "strong")]].map(([v, l]) =>
    h("button", { class: "seg" + (v === 1 ? " on" : ""), onclick: e => { strength = v; $$(".lk-str .seg").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } }, l)));
  str.classList.add("lk-str");
  modal(L("Looks – mit einem Klick", "Looks – one click"), h("div", { class: "looks" },
    h("div", { class: "toolbar" }, h("b", {}, L("Stärke pro Klick", "Strength per click")), str),
    ...LOOKS.map(lk => row(lk.id, L(lk.de, lk.en), lk.minus ? L(...lk.minus) : "", lk.plus ? L(...lk.plus) : "")),
    row("film", L("Filmisch (Kontrast+, Sättigung−, Vignette+, Korn+)", "Filmic (contrast+, saturation−, vignette+, grain+)"), L("weniger", "less"), L("mehr", "more")),
    row("night", L("Nächte heller", "Brighter nights"), L("dunkler", "darker"), L("heller", "brighter")),
    log), [[L("Fertig", "Done"), () => true]]);
}

// ============================================================ hover explanations
const EXPLAIN = [
  // [regex on words, subject de, subject en]  – what the setting is about
  [/\blivery\b/i, "Folierung / Lackierung (Livery) von Fahrzeugen", "Vehicle livery (wrap / paint design)"],
  [/\bcorona/i, "Lichthöfe (Coronas) um Lichtquellen wie Scheinwerfer und Laternen", "Coronas – light halos around lamps and headlights"],
  [/\bstreet ?lights?\b/i, "Straßenlaternen", "Street lights"],
  [/\bemergency|\bsiren|\bblaul/i, "Blaulicht / Einsatzfahrzeuge", "Emergency lights / vehicles"],
  [/\bhead ?lights?\b/i, "Frontscheinwerfer", "Headlights"],
  [/\btail ?lights?\b/i, "Rücklichter", "Tail lights"],
  [/\bindicator|\bblinker/i, "Blinker", "Indicators"],
  [/\bdrl\b/i, "Tagfahrlicht", "Daytime running lights"],
  [/\bemissive/i, "selbstleuchtende Flächen (Lampen, Displays, Neon)", "Emissive surfaces (lamps, screens, neon)"],
  [/\bveh(icle)?\b|\bcar\b/i, "Fahrzeuge", "Vehicles"],
  [/\bchrome/i, "Chrom-Teile", "Chrome parts"],
  [/\b(wheel|rims?)\b/i, "Felgen / Räder", "Wheels / rims"],
  [/\btires?\b|\btyres?\b/i, "Reifen", "Tyres"],
  [/\bglass|\bwindow/i, "Glas / Scheiben", "Glass / windows"],
  [/\bcarbon/i, "Carbon-Optik", "Carbon fibre look"],
  [/\bpaint\b/i, "Lack-Shader (wie der Lack glänzt)", "Paint shader (how paint shines)"],
  [/\brain ?drops?|\braindrop/i, "Regentropfen", "Raindrops"],
  [/\bpuddles?/i, "Pfützen", "Puddles"],
  [/\bwet|\bwetness/i, "Nässe", "Wetness"],
  [/\bsnow|\bfrozen|\bblizzard/i, "Schnee / Frost", "Snow / frost"],
  [/\bfog\b|\bhaze|\bmist/i, "Nebel / Dunst", "Fog / haze"],
  [/\bclouds?\b/i, "Wolken", "Clouds"],
  [/\bvolumetric/i, "volumetrisches Licht (Lichtstrahlen im Raum)", "Volumetric light (light shafts)"],
  [/\bsky\b/i, "Himmel", "Sky"],
  [/\bstar|\bgalaxy/i, "Sterne / Galaxie am Nachthimmel", "Stars / galaxy in the night sky"],
  [/\bvegetation|\bfoliage|\bgrass|\btrees?\b/i, "Pflanzen / Vegetation", "Vegetation"],
  [/\broads?\b|\basphalt/i, "Straßen", "Roads"],
  [/\bparticles?|\bparticle ?fx/i, "Partikel (Rauch, Funken, Staub)", "Particles (smoke, sparks, dust)"],
  [/\bfire|\bexhaust|\bflame/i, "Feuer / Auspuff-Flammen", "Fire / exhaust flames"],
  [/\bburnout/i, "Burnout-Rauch", "Burnout smoke"],
  [/\bblood/i, "Blut-Effekte", "Blood effects"],
  [/\bdust/i, "Staub", "Dust"],
  [/\bhud\b|\bui\b|\breticle|\bcrosshair/i, "Spiel-Oberfläche (HUD, Fadenkreuz)", "Game UI (HUD, crosshair)"],
  [/\bbloom/i, "Bloom – helles Licht strahlt weich in die Umgebung aus", "Bloom – bright light softly glows into the surroundings"],
  [/\bglow/i, "Leuchten / Glühen", "Glow"],
  [/\blens ?flare|\bflare/i, "Linsenreflexe (Lens Flares)", "Lens flares"],
  [/\banamorphic/i, "anamorphe Lichtstreifen (Kino-Look)", "Anamorphic light streaks (cinema look)"],
  [/\bstreaks?\b/i, "Lichtstreifen", "Light streaks"],
  [/\blens\b|\bdirt\b/i, "Kameralinse / Schmutz auf der Linse", "Camera lens / lens dirt"],
  [/\bchromatic|\baberration|\bfringe/i, "chromatische Aberration – farbige Ränder wie bei echten Linsen", "Chromatic aberration – coloured fringes like real lenses"],
  [/\bdistort/i, "Verzerrung", "Distortion"],
  [/\bvignette/i, "Vignette – dunkle Bildränder", "Vignette – darker picture edges"],
  [/\bgrain\b|\bnoise\b/i, "Filmkorn / Bildrauschen", "Film grain / noise"],
  [/\bsharp|\bcas\b|\bclarity|\bdetail/i, "Schärfe / Details", "Sharpness / detail"],
  [/\bblur\b/i, "Unschärfe / Weichzeichner", "Blur"],
  [/\bmotion ?blur/i, "Bewegungsunschärfe", "Motion blur"],
  [/\bdof\b|\bdepth of field|\bfocus|\bbokeh/i, "Tiefenschärfe (Hintergrund unscharf)", "Depth of field (blurred background)"],
  [/\b(ao|ssao|mxao|gtao|occlusion)\b/i, "Umgebungsverdeckung – dunkle Schatten in Ecken und Fugen", "Ambient occlusion – dark shading in corners and gaps"],
  [/\b(gi|rtgi|global illumination)\b/i, "Global Illumination – Licht prallt von Flächen ab", "Global illumination – light bounces off surfaces"],
  [/\bssr\b/i, "Bildschirm-Spiegelungen (SSR)", "Screen-space reflections (SSR)"],
  [/\bshadows?\b/i, "Schatten", "Shadows"],
  [/\breflect/i, "Spiegelungen / Reflexionen", "Reflections"],
  [/\bspecular|\bspec\b/i, "Glanzlichter (Specular) – wie stark Oberflächen Licht spiegeln", "Specular highlights – how strongly surfaces reflect light"],
  [/\bfresnel/i, "Fresnel – Spiegelung wird zum Rand hin stärker", "Fresnel – reflection gets stronger at grazing angles"],
  [/\bmetal|\bmetallic/i, "Metall-Anteil", "Metallic amount"],
  [/\blut\b|\blook ?up/i, "LUT – Farb-Look aus einer Tabelle (Color Grading)", "LUT – colour look from a lookup table (colour grading)"],
  [/\btone ?map|\btonemap/i, "Tonemapping – wie helle und dunkle Bereiche ins Bild gebracht werden", "Tonemapping – how highlights and shadows are mapped"],
  [/\bhdr\b/i, "HDR / Dynamikumfang", "HDR / dynamic range"],
  [/\bexposure/i, "Belichtung", "Exposure"],
  [/\bbright/i, "Helligkeit", "Brightness"],
  [/\bcontrast/i, "Kontrast", "Contrast"],
  [/\bgamma/i, "Gamma – Helligkeit der Mitteltöne", "Gamma – midtone brightness"],
  [/\bsaturation|\bsat\b/i, "Sättigung (Farbstärke)", "Saturation (colour strength)"],
  [/\bvibrance/i, "Vibrance – verstärkt blasse Farben mehr als kräftige", "Vibrance – boosts dull colours more than strong ones"],
  [/\bhue\b/i, "Farbton", "Hue"],
  [/\btemp|\bkelvin|\bwhite ?balance/i, "Farbtemperatur (warm/kalt)", "Colour temperature (warm/cool)"],
  [/\btint\b/i, "Einfärbung / Tönung", "Tint"],
  [/\blevels?\b|\bblack ?point|\bwhite ?point/i, "Tonwerte – Schwarz- und Weißpunkt", "Levels – black and white point"],
  [/\blift\b|\bgain\b/i, "Lift/Gamma/Gain – Schatten, Mitten, Lichter getrennt einfärben", "Lift/gamma/gain – colour shadows, mids and highlights separately"],
  [/\bcurves?\b/i, "Kurven (Kontrastkurve)", "Curves (contrast curve)"],
  [/\bmood|\bgrade|\bgrading/i, "Farbstimmung / Color Grading", "Colour mood / grading"],
  [/\bsepia|\bmonochrome|\bgr[ae]yscale|\bblack ?and ?white/i, "Schwarzweiß / Sepia", "Black & white / sepia"],
  [/\baa\b|\bantialias|\bsmaa|\bfxaa|\btaa\b/i, "Kantenglättung (Anti-Aliasing)", "Anti-aliasing (edge smoothing)"],
  [/\bdepth\b/i, "Tiefenpuffer (Entfernung zur Kamera)", "Depth buffer (distance to camera)"],
  [/\bdebug/i, "Debug-Anzeige zum Einstellen (im normalen Spiel aus lassen)", "Debug view for tuning (keep off for normal play)"],
];
const ASPECT = [
  [/\b(intensity|strength|amount|mult|multiplier|power|opacity|blend|mix)\b/i, "Stärke – höher = kräftiger", "Strength – higher = stronger"],
  [/\b(radius|size|scale|width|length)\b/i, "Größe / Reichweite", "Size / reach"],
  [/\bthreshold|\bknee/i, "Schwelle – ab welcher Helligkeit der Effekt wirkt", "Threshold – brightness where the effect starts"],
  [/\b(color|colour|col)\b/i, "Farbe", "Colour"],
  [/\bfalloff|\bgloss|\brough/i, "Glanz / wie weich das Licht ausläuft", "Gloss / how softly light falls off"],
  [/\bspeed|\banimation|\banimated/i, "Geschwindigkeit / Animation", "Speed / animation"],
  [/\bdensity/i, "Dichte", "Density"],
  [/\bdistance|\bfar\b|\bnear\b/i, "Entfernung", "Distance"],
  [/\bheight/i, "Höhe", "Height"],
  [/\boffset|\bbias|\bshift/i, "Verschiebung", "Offset"],
  [/\bquality|\bsamples?|\bsteps|\bpasses|\biterations?/i, "Qualität – höher = schöner, aber mehr FPS-Kosten", "Quality – higher = nicer but costs more FPS"],
  [/\b(style|mode|type|profile|preset)\b/i, "Variante / Stil", "Variant / style"],
  [/\brefraction|\brefract/i, "Lichtbrechung", "Refraction"],
  [/\bphysical\b/i, "physikalisch echt dargestellt (Glanz/Reflexion wie ein echtes Material statt flach aufgemalt)", "Physically based (real gloss/reflections instead of flat paint)"],
  [/\bforce\b/i, "erzwingen – auch dann aktiv, wenn es sonst automatisch aus wäre", "Force – active even when it would normally switch off"],
  [/\b(disable|remove|hide|skip)\b/i, "abschalten", "Turn off"],
  [/\b(enable|use|toggle|show)\b/i, "einschalten", "Turn on"],
  [/\bflicker/i, "Flackern", "Flicker"],
  [/\bsmooth/i, "weicher / geglättet", "Smoother"],
  [/\bblack\b/i, "schwarz", "Black"],
  [/\bcolou?red\b/i, "farbig", "Coloured"],
];
function explainUniform(u, file) {
  const words = splitWords(u.name) + " " + u.label + " " + (u.category || "");
  const subj = [], asp = [];
  for (const [re, de, en] of EXPLAIN) if (re.test(words) && subj.length < 2 && !subj.includes(L(de, en))) subj.push(L(de, en));
  for (const [re, de, en] of ASPECT) if (re.test(words) && asp.length < 2) asp.push(L(de, en));
  const parts = [];
  if (subj.length) parts.push(subj.join(" · "));
  if (asp.length) parts.push(asp.join(" · "));
  let type = "";
  if (u.base === "bool") type = L("Schalter: an oder aus.", "Switch: on or off.");
  else if (u.items && u.items.length) type = L("Auswahl: ", "Choice: ") + u.items.slice(0, 6).join(", ") + (u.items.length > 6 ? " …" : "") + ".";
  else if (u.ui_type === "color") type = L("Farbe (Rot / Grün / Blau, je 0–1).", "Colour (red / green / blue, 0–1 each).");
  else if (isDN(u)) type = L("Zwei Werte: links Tag, rechts Nacht.", "Two values: left day, right night.");
  else if (u.dim > 1) type = L(`${u.dim} Werte.`, `${u.dim} values.`);
  else if (dnSide(u)) type = dnSide(u) === "day" ? L("Gilt tagsüber.", "Applies during the day.") : L("Gilt nachts.", "Applies at night.");
  return { auto: parts.length ? parts.join(" – ") + "." : "", type };
}
function explainEffect(key) {
  const t = S.techByKey[key];
  const words = splitWords(key.replace("@", " ").replace(/\.fx$/, "")) + " " + (t ? t.label : "");
  const subj = [];
  for (const [re, de, en] of EXPLAIN) if (re.test(words) && subj.length < 2) subj.push(L(de, en));
  return subj.join(" · ");
}
const tip = h("div", { id: "tip", class: "hidden" });
document.body.append(tip);
let tipTimer = null, tipEl = null;
function tipContent(el) {
  if (el._tip) {
    const { file, u } = el._tip;
    const ex = explainUniform(u, file);
    const cur = S.cur ? M.get(file, u.name) : null;
    const meta = [L("Standard: ", "Default: ") + u.default.map(v => +v.toFixed(4)).join(", ")];
    if (u.min != null || u.max != null) meta.push(L("Bereich: ", "Range: ") + (u.min ?? "–") + " … " + (u.max ?? "–"));
    if (cur != null) meta.push(L("Jetzt: ", "Now: ") + cur.split(",").map(v => +(+v).toFixed(4)).join(", "));
    return h("div", {}, h("div", { class: "tip-t" }, u.label.trim() || u.name),
      u.tooltip ? h("div", { class: "tip-src" }, u.tooltip) : null,
      ex.auto ? h("div", { class: "tip-auto" }, (u.tooltip ? "" : "") + ex.auto) : null,
      ex.type ? h("div", { class: "tip-type" }, ex.type) : null,
      !u.tooltip && !ex.auto ? h("div", { class: "tip-auto" }, L("Keine Beschreibung im Shader. Tipp: Wert ändern und im Spiel mit der Reload-Taste vergleichen.", "No description in the shader. Tip: change it and compare in game with the reload key.")) : null,
      h("div", { class: "tip-meta" }, meta.join("  ·  ")),
      h("div", { class: "tip-meta" }, L("Intern: ", "Internal: ") + u.name + " · " + file));
  }
  if (el.dataset.tipfx) {
    const k = el.dataset.tipfx, t = S.techByKey[k];
    const ex = explainEffect(k);
    const l = perfLevel(k);
    return h("div", {}, h("div", { class: "tip-t" }, t ? t.label : nameOf(k)),
      t && t.tooltip ? h("div", { class: "tip-src" }, t.tooltip.slice(0, 600)) : null,
      ex ? h("div", { class: "tip-auto" }, ex) : null,
      h("div", { class: "tip-meta" }, [t && t.pack ? L("Paket: ", "Pack: ") + t.pack : null, fileOf(k), l ? (l === 2 ? L("schwer (FPS)", "heavy (FPS)") : L("mittel (FPS)", "medium (FPS)")) : null].filter(Boolean).join("  ·  ")));
  }
  if (el.dataset.tip) return h("div", {}, el.dataset.tip);
  return null;
}
document.addEventListener("mouseover", e => {
  const el = e.target.closest && e.target.closest("[data-tip],[data-tipfx],.lb");
  if (el === tipEl) return;
  tipEl = el; clearTimeout(tipTimer); tip.classList.add("hidden");
  if (!el || (el.classList.contains("lb") && !el._tip)) return;
  tipTimer = setTimeout(() => {
    const c = tipContent(el); if (!c) return;
    tip.innerHTML = ""; tip.append(c); tip.classList.remove("hidden");
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left, y = r.bottom + 8;
    if (x + tw > innerWidth - 10) x = innerWidth - tw - 10;
    if (y + th > innerHeight - 10) y = r.top - th - 8;
    tip.style.left = Math.max(10, x) + "px"; tip.style.top = Math.max(10, y) + "px";
  }, 280);
});
document.addEventListener("mousedown", () => { clearTimeout(tipTimer); tip.classList.add("hidden"); });

// ============================================================ language (static html)
const STATIC_EN = {
  "Editor": "Editor", "Pakete": "Packs", "Vergleichen": "Compare", "Texturen": "Textures", "Screenshots": "Screenshots", "Versionen": "Versions", "Einrichtung": "Setup",
  "Speichern": "Save", "Import": "Import", "+ Neu": "+ New", "Kein Preset gewählt": "No preset selected", "Looks": "Looks", "Mischen": "Mix", "Prüfen": "Check",
  "Aufräumen": "Clean up", "Im Spiel aktiv setzen": "Set active in game", "Duplizieren": "Duplicate", "Umbenennen": "Rename", "Löschen": "Delete",
  "Effekte im Preset": "Effects in preset", "+ Effekt": "+ Effect", "Ziehen = Reihenfolge · Schalter = an/aus · oben wird zuerst gerendert": "Drag = order · switch = on/off · top renders first",
  "Links ein Preset und dann einen Effekt wählen.": "Pick a preset on the left, then an effect.", "Nach Updates suchen": "Check for updates", "Spiel: ?": "Game: ?",
  "Jede Änderung wird sofort in die Preset-Datei geschrieben": "Every change is written to the preset file instantly", "Rückgängig (Strg+Z)": "Undo (Ctrl+Z)",
  "Wiederholen (Strg+Y)": "Redo (Ctrl+Y)", "Speichern (Strg+S)": "Save (Ctrl+S)", "Preset suchen…": "Search preset…",
  "Preset-Datei importieren und auf fehlende Shader prüfen": "Import a preset file and check for missing shaders", "Neues Preset": "New preset",
  "Mit einem Klick wärmer, kälter, kontrastreicher …": "Warmer, cooler, more contrast … with one click", "Zwei Presets stufenlos mischen": "Blend two presets smoothly",
  "Prüft, ob alle Shader und Texturen installiert sind": "Checks whether all shaders and textures are installed", "Doppelte und unnötige Einträge entfernen": "Remove duplicate and unneeded entries",
  "Projekt auf GitHub": "Project on GitHub",
  "Galerie": "Gallery", "Teilen": "Share", "Preset als ZIP zum Weitergeben speichern": "Save preset as ZIP to share",
};
function translateStatic() {
  if (LANG !== "en") return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { const t = n.nodeValue.trim(); if (STATIC_EN[t]) n.nodeValue = n.nodeValue.replace(t, STATIC_EN[t]); }
  for (const el of $$("[title],[placeholder]")) {
    if (STATIC_EN[el.title]) el.title = STATIC_EN[el.title];
    if (el.placeholder && STATIC_EN[el.placeholder]) el.placeholder = STATIC_EN[el.placeholder];
  }
  document.documentElement.lang = "en";
}
translateStatic();
function setLang(l, force) {
  if (l === LANG) return;
  if (!force && S.dirty && !S.live && !confirm(L("Ungespeicherte Änderungen verwerfen und Sprache wechseln?", "Discard unsaved changes and switch language?"))) return;
  localStorage.setItem("lang", l); S.dirty = false; location.reload();
}
$("#langBtn").textContent = LANG === "en" ? "EN" : "DE";
$("#langBtn").onclick = () => setLang(LANG === "en" ? "de" : "en");
const _renderSetup = renderSetup;
renderSetup = async function () {
  await _renderSetup();
  const el = $("#view-setup");
  el.prepend(h("div", { class: "card" }, h("h3", {}, "Sprache / Language"),
    h("div", { class: "dnsw" }, [["de", "Deutsch"], ["en", "English"]].map(([v, l]) => h("button", { class: "seg" + (LANG === v ? " on" : ""), onclick: () => setLang(v) }, l)))));
};

// ============================================================ wiring
$("#importBtn").onclick = () => importPresets();
$("#checkBtn").onclick = checkCurrent;
$("#cleanBtn").onclick = cleanupModal;
$("#lookBtn").onclick = lookModal;
$("#mixBtn").onclick = mixModal;
const _updateTop = updateTop;
updateTop = function () { _updateTop(); ["lookBtn", "checkBtn", "cleanBtn"].forEach(id => $("#" + id).disabled = !S.cur); };

// remote commands for the new features
Object.assign(REMOTE, {
  packs: { help: "Alle erkannten Shader-Pakete mit Effekten", run: () => { const g = {}; for (const t of S.techs) (g[t.pack || "Einzel-Shader"] ||= []).push(`${t.name}@${t.file}`); return g; } },
  check: { help: "{rel?} Preset auf fehlende Shader/Texturen prüfen (ohne rel = offenes Preset)", run: async a => a.rel ? api("/api/check?rel=" + enc(a.rel)) : (needCur(), api("/api/check", { model: S.cur.model })) },
  importFile: { help: "{file, name?, folder?} Preset-Datei importieren (absoluter Pfad)", run: async a => { const r = await api("/api/readfile", { file: a.file }); const x = await api("/api/new", { name: a.name || r.name, folder: a.folder || "Importiert", model: r.model }); await loadPresets(); S.dirty = false; await openPreset(x.rel); return { rel: x.rel, check: r.check }; } },
  mix: { help: "{a, b (Namen oder rel), weight 0..1 (Anteil B), name?} neues gemischtes Preset", run: async a => {
    const pa = findPreset({ name: a.a, rel: a.a?.startsWith(".\\") ? a.a : undefined }), pb = findPreset({ name: a.b, rel: a.b?.startsWith(".\\") ? a.b : undefined });
    if (!pa || !pb) throw new Error("Preset nicht gefunden");
    const w = Math.max(0, Math.min(1, +a.weight || 0.5));
    const model = await buildMix(pa.rel, pb.rel, w);
    const r = await api("/api/new", { name: a.name || `Mix ${pa.name} x ${pb.name} ${Math.round(w * 100)}`, folder: "Eigene", model });
    await loadPresets(); S.dirty = false; await openPreset(r.rel); return { rel: r.rel };
  } },
  cleanup: { help: "{dupList,dupKeys,sortGhost,notInstalled,unknown,offEffects,defaults: bool} offenes Preset aufräumen; ohne Optionen = nur Vorschau", run: async a => {
    needCur(); if (!Object.keys(a).length) return { preview: await cleanupPlan(S.cur.model) };
    beforeChange(); await applyCleanup(S.cur.model, a); changed(true); return { ok: true, after: await cleanupPlan(S.cur.model) };
  } },
  lang: { help: "{lang: de|en} Sprache umschalten (lädt das Fenster neu)", run: async a => { if (S.dirty && !S.live) await save(); setTimeout(() => setLang(a.lang === "en" ? "en" : "de", true), 50); return { ok: true }; } },
  modal: { help: "{name: looks|mix|cleanup|check|import} Dialog öffnen", run: a => { ({ looks: lookModal, mix: mixModal, cleanup: cleanupModal, check: checkCurrent, import: () => importPresets() })[a.name]?.(); return { ok: true }; } },
  look: { help:"{id: warm|contrast|sat|bright|bloom|sharp|vignette|grain|film|night, dir: 1|-1, strength: 0.5|1|2} Look-Baustein anwenden", run: a => applyLook(a.id, +a.dir || 1, +a.strength || 1) },
});
