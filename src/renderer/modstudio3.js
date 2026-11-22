"use strict";
// Mod-Studio 1.5: overview dashboard, mod profile + sub-tabs, texture gallery + compare, weather (timecycle) view,
// visualsettings table, 3D model preview.

MS.sum = {}; MS.sub = "overview";
const CAT_ICON = { "Wetter & Timecycle": "🌤️", "Grafik-Einstellungen": "🎛️", "Lichter & Lens Flares": "💡", "Wasser": "🌊", "Partikel & Effekte": "✨", "Fahrzeuge": "🚗", "Welt & Vegetation": "🌳", "Texturen": "🖼️", "Modelle": "🧊", "Sonstiges": "📄" };
const CAT_EN = { "Wetter & Timecycle": "Weather & timecycle", "Grafik-Einstellungen": "Graphics settings", "Lichter & Lens Flares": "Lights & lens flares", "Wasser": "Water", "Partikel & Effekte": "Particles & effects", "Fahrzeuge": "Vehicles", "Welt & Vegetation": "World & vegetation", "Texturen": "Textures", "Modelle": "Models", "Sonstiges": "Other" };
const catL = c => LANG === "en" ? (CAT_EN[c] || c) : c;
async function msSummary(file) { if (MS.sum[file]) return MS.sum[file]; let v; try { v = await api("/api/ms/v/summary", { file }); } catch (e) { v = { error: e.message, categories: {}, types: {}, weather: [] }; } MS.sum[file] = v; return v; }
function catChips(sum, big) {
  const cats = Object.entries(sum.categories || {}).sort((a, b) => b[1] - a[1]);
  return h("div", { class: "chips" + (big ? " big" : "") }, cats.length ? cats.map(([c, n]) => h("span", { class: "chip", "data-tip": catL(c) + ": " + n + " " + L("Ersetzungen", "replacements") }, (CAT_ICON[c] || "📄") + " " + catL(c) + " " + n)) : h("span", { class: "muted small" }, sum.readable === false ? L("Inhalt geschützt", "content protected") : L("keine Ersetzungen", "no replacements")));
}

// ============================================================ overview dashboard
async function msOverviewTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  const p = MS.proj;
  const total = p.mods.reduce((a, m) => a + (m.info.size || 0), 0);
  const inPack = p.mods.filter(m => m.enabled && m.info.readable && m.info.oiv);
  const tiles = [
    ["🧩", p.mods.length, L("Mods", "Mods"), "mods"], ["💾", fmtSize(total), L("Größe gesamt", "Total size"), null],
    ["⚡", MS.conflicts.length, L("Konflikte", "Conflicts"), "conflicts"], ["🎨", (p.overrides || []).length, L("Eigene Dateien", "Own files"), "own"],
    ["📦", (p.packs || []).length, L("Fertige Packs", "Built packs"), "build"]];
  el.append(h("div", { class: "ov-tiles" }, tiles.map(([i, v, l, tab]) => h("div", { class: "ov-tile" + (tab ? " click" : ""), onclick: () => { if (tab) { MS.tab = tab; msRender(); } } }, h("div", { class: "ov-ic" }, i), h("div", { class: "ov-v" }, String(v)), h("div", { class: "ov-l" }, l)))));
  // next steps
  const steps = [];
  if (!p.mods.length) steps.push([L("Mods hinzufügen", "Add mods"), L("Im Tab „Ordner“ Mods aus deinem Arbeitsordner benutzen oder Dateien/Ordner ins Fenster ziehen.", "Use mods from your workspace in the Folder tab or drop files/folders onto the window."), "folder"]);
  if (MS.found?.length) steps.push([L(`${MS.found.length} gefundene Mods übernehmen`, `Take ${MS.found.length} found mods`), L("In deinem Arbeitsordner liegen noch Mods, die nicht in der Liste sind.", "There are mods in your workspace that are not in the list yet."), "folder"]);
  if (MS.conflicts.length) steps.push([L(`${MS.conflicts.length} Konflikte prüfen`, `Check ${MS.conflicts.length} conflicts`), L("Mehrere Mods ersetzen dieselbe Datei – festlegen, welche gewinnt.", "Several mods replace the same file – decide which one wins."), "conflicts"]);
  if (inPack.length > 1) steps.push([L("Mods fusionieren", "Fuse mods"), L("Pro Datei auswählen, von welcher Mod sie kommt.", "Choose per file which mod it comes from."), "fusion"]);
  if (inPack.length) steps.push([L("Pack bauen", "Build pack"), L(`${inPack.length} Mods sind bereit für ein Pack.`, `${inPack.length} mods are ready for a pack.`), "build"]);
  if (steps.length) el.append(h("div", { class: "card" }, h("h3", {}, L("Nächste Schritte", "Next steps")), ...steps.map(([t, d, tab], i) => h("div", { class: "ov-step", onclick: () => { MS.tab = tab; msRender(); } }, h("span", { class: "ov-num" }, String(i + 1)), h("div", {}, h("b", {}, t), h("div", { class: "muted small" }, d)), h("span", { class: "muted" }, "→")))));
  // mod cards
  const grid = h("div", { class: "ov-cards" });
  el.append(h("h3", { class: "ov-h" }, L("Deine Mods", "Your mods")), grid);
  for (const m of p.mods) {
    const card = h("div", { class: "ov-card" + (m.enabled ? "" : " off"), onclick: () => { MS.sel = m.file; MS.tree = null; MS.sub = "overview"; MS.tab = "mods"; msRender(); } },
      h("div", { class: "ov-ct" }, h("b", {}, mname(m.file)), h("span", { class: "muted small" }, fmtSize(m.info.size))),
      h("div", { class: "muted small" }, [m.info.meta?.author, m.info.meta?.version ? "v" + m.info.meta.version : "", m.info.inPlace ? L("vor Ort", "in place") : "", !m.info.readable ? L("geschützt", "protected") : ""].filter(Boolean).join(" · ") || " "),
      h("div", { class: "ov-chips" }, h("span", { class: "muted small" }, "…")));
    grid.append(card);
    msSummary(m.file).then(s => { const c = card.querySelector(".ov-chips"); c.innerHTML = ""; c.append(catChips(s)); });
  }
  if (!p.mods.length) grid.append(h("div", { class: "empty" }, L("Noch keine Mods.", "No mods yet.")));
}

// ============================================================ mod detail with sub-tabs
const _msModDetail = msModDetail;
msModDetail = async function (box) {
  const m = MS.proj.mods.find(x => x.file === MS.sel);
  if (!m) return _msModDetail(box);
  const tmp = h("div");
  const done = _msModDetail(tmp);
  // header from the original view
  const head = tmp.querySelector(".phead"); if (head) box.append(head);
  const sum = await msSummary(m.file);
  const subs = [["overview", L("Übersicht", "Overview")], ["textures", L("Texturen", "Textures") + (sum.textures ? ` (${sum.textures})` : "")], ["weather", L("Wetter", "Weather") + (sum.weather?.length ? ` (${sum.weather.length})` : "")],
    ["visual", L("Einstellungen", "Settings")], ["models", "3D" + (sum.models ? ` (${sum.models})` : "")], ["files", L("Ersetzungen & Dateien", "Replacements & files")]];
  if (!m.info.readable) MS.sub = "files";
  box.append(h("div", { class: "subtabs" }, subs.map(([k, l]) => h("button", { class: MS.sub === k ? "on" : "", disabled: !m.info.readable && k !== "files", onclick: () => { MS.sub = k; msRender(); } }, l))));
  const content = h("div", { class: "subcontent" }); box.append(content);
  if (MS.sub === "files") { await done; [...tmp.children].forEach(c => content.append(c)); return; }
  ({ overview: msSubOverview, textures: msSubTextures, weather: msSubWeather, visual: msSubVisual, models: msSubModels })[MS.sub](content, m, sum);
};
function msSubOverview(el, m, sum) {
  el.append(h("div", { class: "card prof" },
    h("h3", {}, L("Steckbrief", "Profile")),
    m.info.meta?.description ? h("p", { class: "muted pre" }, m.info.meta.description.slice(0, 500)) : null,
    h("h4", {}, L("Was die Mod ändert", "What the mod changes")), catChips(sum, true),
    h("h4", {}, L("Inhalt", "Content")),
    h("div", { class: "typebars" }, (() => {
      const t = Object.entries(sum.types || {}).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8);
      const max = Math.max(1, ...t.map(x => x[1].bytes));
      return t.map(([x, v]) => h("div", { class: "tb" }, h("span", { class: "ft ft-" + x }, x.toUpperCase().slice(0, 4)), h("div", { class: "tb-bar" }, h("i", { style: `width:${Math.max(2, v.bytes / max * 100)}%` })), h("span", { class: "muted small" }, `${v.count} · ${fmtSize(v.bytes)}`)));
    })()),
    h("div", { class: "toolbar", style: "margin-top:12px" },
      sum.textures ? h("button", { class: "small", onclick: () => { MS.sub = "textures"; msRender(); } }, `🖼️ ${sum.textures} ${L("Textur-Dateien ansehen", "texture files")}`) : null,
      sum.weather?.length ? h("button", { class: "small", onclick: () => { MS.sub = "weather"; msRender(); } }, `🌤️ ${sum.weather.length} ${L("Wetterlagen ansehen", "weather types")}`) : null,
      sum.visualsettings ? h("button", { class: "small", onclick: () => { MS.sub = "visual"; msRender(); } }, "🎛️ visualsettings") : null,
      sum.models ? h("button", { class: "small", onclick: () => { MS.sub = "models"; msRender(); } }, `🧊 ${sum.models} ${L("Modelle in 3D", "models in 3D")}`) : null)));
}

// ============================================================ texture gallery
const TEX_CATS = [["sky", L("Himmel", "Sky"), /sky|cloud|moon|star|sun|dome/i], ["water", L("Wasser", "Water"), /water|ocean|wave|foam|puddle|rain/i], ["veh", L("Fahrzeuge & Lichter", "Vehicles & lights"), /veh|car|wheel|tyre|tire|light|lamp|corona|plate/i],
  ["road", L("Straßen & Boden", "Roads & ground"), /road|asphalt|street|ground|terrain|decal|dirt|sand|rock|concrete/i], ["veg", L("Pflanzen", "Plants"), /veg|tree|grass|leaf|bush|plant|foliage|palm/i], ["fx", L("Effekte", "Effects"), /fx|ptfx|particle|smoke|fire|explo|blood|lens|flare/i]];
MS.texFilter = ""; MS.texCat = ""; MS.texOpen = new Set(); MS.texPage = 0;
async function msSubTextures(el, m) {
  let list; try { list = await api("/api/ms/v/textures", { file: m.file }); } catch (e) { el.append(h("div", { class: "empty" }, e.message)); return; }
  const flt = h("input", { type: "search", placeholder: L("Textur-Datei suchen…", "Search texture file…"), value: MS.texFilter, style: "width:260px" });
  const bar = h("div", { class: "toolbar" }, flt, h("button", { class: "small" + (!MS.texCat ? " on" : ""), onclick: () => { MS.texCat = ""; MS.texPage = 0; msRender(); } }, L("Alle", "All")),
    ...TEX_CATS.map(([k, l]) => h("button", { class: "small" + (MS.texCat === k ? " on" : ""), onclick: () => { MS.texCat = k; MS.texPage = 0; msRender(); } }, l)));
  el.append(bar);
  const box = h("div"); el.append(box);
  const draw = () => {
    box.innerHTML = "";
    const q = MS.texFilter.toLowerCase(); const cat = TEX_CATS.find(c => c[0] === MS.texCat);
    const shown = list.filter(t => (!q || t.path.toLowerCase().includes(q)) && (!cat || cat[2].test(t.path)));
    const per = 40, pages = Math.ceil(shown.length / per);
    box.append(h("p", { class: "muted small" }, L(`${shown.length} Textur-Dateien · auf eine Datei klicken, um ihre Bilder zu sehen`, `${shown.length} texture files · click a file to see its pictures`)));
    for (const t of shown.slice(MS.texPage * per, MS.texPage * per + per)) {
      const open = MS.texOpen.has(t.path) || shown.length <= 3;
      const grid = h("div", { class: "grid texgal" + (open ? "" : " hidden") });
      const row = h("div", { class: "cat" }, h("div", { class: "ch", onclick: () => { MS.texOpen.has(t.path) ? MS.texOpen.delete(t.path) : MS.texOpen.add(t.path); draw(); } },
        h("span", {}, (open ? "▾ " : "▸ ") + t.path.replace(/^content\//i, "")), h("span", { class: "muted" }, fmtSize(t.size))), h("div", { class: "cb" }, grid));
      box.append(row);
      if (open) api("/api/ms/v/ytdinfo", { file: m.file, path: t.path }).then(texs => {
        for (const x of texs) {
          const im = h("div", { class: "im" + (x.supported ? "" : " noimg") }, x.supported ? null : x.format);
          if (x.supported) im.style.backgroundImage = `url('vps://modtex/?file=${enc(m.file)}&path=${enc(t.path)}&i=${x.index}&size=192')`;
          grid.append(h("div", { class: "tile", onclick: () => x.supported && msTexBig(m.file, t.path, x) }, im, h("div", { class: "cap" }, h("b", {}, x.name), h("div", { class: "muted small" }, `${x.width}×${x.height} · ${x.format}`))));
        }
      }).catch(e => grid.append(h("div", { class: "muted" }, e.message)));
    }
    if (pages > 1) box.append(h("div", { class: "toolbar" }, h("button", { class: "small", disabled: MS.texPage === 0, onclick: () => { MS.texPage--; draw(); } }, "←"), h("span", { class: "muted" }, `${MS.texPage + 1} / ${pages}`), h("button", { class: "small", disabled: MS.texPage >= pages - 1, onclick: () => { MS.texPage++; draw(); } }, "→")));
  };
  flt.oninput = () => { MS.texFilter = flt.value; MS.texPage = 0; draw(); };
  draw();
}
function texUrl(file, p, i, size) { return `vps://modtex/?file=${enc(file)}&path=${enc(p)}&i=${i}&size=${size}`; }
async function msTexBig(file, p, x) {
  const body = h("div", {}, h("img", { src: texUrl(file, p, x.index, 2048), class: "checker", style: "max-width:100%;max-height:66vh;display:block;margin:auto" }),
    h("p", { class: "muted" }, `${x.name} · ${x.width}×${x.height} · ${x.format} · ${x.levels} mips · ${p}`));
  const cmp = h("div", { class: "toolbar" }, h("span", { class: "muted small" }, L("Suche dieselbe Textur in anderen Mods…", "Looking for the same texture in other mods…")));
  body.append(cmp);
  modal(x.name, body, [[L("Im Editor öffnen", "Open in editor"), () => { msOpenYtd({ mod: file, path: p }); return true; }], [L("Schließen", "Close"), () => true]]);
  $(".modal-box").style.width = "min(1300px, 95vw)";
  try {
    const c = await api("/api/ms/v/texcompare", { file, path: p, name: x.name });
    cmp.innerHTML = "";
    if (!c.length) cmp.append(h("span", { class: "muted small" }, L("Keine andere Mod im Projekt hat diese Textur.", "No other mod in the project has this texture.")));
    else { cmp.append(h("b", {}, L("Vergleichen mit:", "Compare with:"))); for (const o of c) cmp.append(h("button", { class: "small primary", onclick: () => msTexCompare({ file, path: p, index: x.index, name: x.name }, o) }, mname(o.mod) + ` (${o.width}×${o.height})`)); }
  } catch { cmp.innerHTML = ""; }
}
function msTexCompare(a, b) {
  const wrap = h("div", { class: "cmp checker" });
  const imB = h("img", { src: texUrl(b.mod, b.path, b.index, 2048) });
  const imA = h("img", { src: texUrl(a.file, a.path, a.index, 2048) });
  const clip = h("div", { class: "clip" }, imA), bar = h("div", { class: "bar" });
  wrap.append(imB, clip, bar, h("div", { class: "lab", style: "left:10px" }, "A: " + mname(a.file)), h("div", { class: "lab", style: "right:10px" }, "B: " + mname(b.mod)));
  const setX = q => { q = Math.max(0, Math.min(1, q)); clip.style.clipPath = `inset(0 ${100 - q * 100}% 0 0)`; bar.style.left = q * 100 + "%"; };
  let drag = false; const move = e => { const r = wrap.getBoundingClientRect(); setX((e.clientX - r.left) / r.width); };
  wrap.addEventListener("pointerdown", e => { drag = true; wrap.setPointerCapture(e.pointerId); move(e); });
  wrap.addEventListener("pointermove", e => drag && move(e)); wrap.addEventListener("pointerup", () => drag = false);
  setX(.5);
  modal(L("Vergleich: ", "Compare: ") + a.name, h("div", {}, wrap, h("p", { class: "muted" }, L("Schieber ziehen: links A, rechts B", "Drag the slider: left A, right B"))));
  $(".modal-box").style.width = "min(1500px, 96vw)";
}

// ============================================================ weather (timecycle)
MS.wx = { path: null, region: "GLOBAL", cmp: null, metric: "postfx_exposure", filter: "" };
const HOURS = [0, 5, 6, 7, 10, 13, 16, 17, 18, 19, 20, 21, 22];
function sampleAt(vals, hr) { // linear between keyframes, wraps 22 -> 24(=0)
  const hs = [...HOURS, 24], vs = [...vals, vals[0]];
  for (let i = 0; i < hs.length - 1; i++) if (hr >= hs[i] && hr <= hs[i + 1]) { const t = (hr - hs[i]) / (hs[i + 1] - hs[i] || 1); return vs[i] + (vs[i + 1] - vs[i]) * t; }
  return vals[0];
}
function bandCanvas(r, g, b, w = 720, hgt = 22) {
  const c = h("canvas", { width: w, height: hgt, class: "band" }); const x = c.getContext("2d");
  const max = Math.max(1, ...r, ...g, ...b);
  for (let px = 0; px < w; px++) { const hr = px / w * 24; const f = v => Math.round(Math.min(1, sampleAt(v, hr) / max) ** (1 / 1.6) * 255); x.fillStyle = `rgb(${f(r)},${f(g)},${f(b)})`; x.fillRect(px, 0, 1, hgt); }
  return c;
}
function hourAxis(w = 720) { return h("div", { class: "haxis", style: `width:${w}px` }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map(hr => h("span", { style: `left:${hr / 24 * 100}%` }, hr + "h"))); }
function lineChart(series, w = 720, hgt = 180) {
  const c = h("canvas", { width: w, height: hgt, class: "chart" }); const x = c.getContext("2d");
  const all = series.flatMap(s => s.vals); const mn = Math.min(0, ...all), mx = Math.max(...all, mn + 1e-6);
  x.strokeStyle = "#2a2f3a"; x.lineWidth = 1;
  for (let i = 0; i <= 8; i++) { const px = i / 8 * w; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, hgt); x.stroke(); }
  for (const s of series) {
    x.strokeStyle = s.color; x.lineWidth = 2.5; x.setLineDash(s.dash ? [6, 4] : []); x.beginPath();
    for (let px = 0; px <= w; px += 2) { const v = sampleAt(s.vals, px / w * 24); const py = hgt - 6 - (v - mn) / (mx - mn) * (hgt - 12); px ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
    x.setLineDash([]); x.fillStyle = s.color;
    HOURS.forEach((hr, i) => { const px = hr / 24 * w, py = hgt - 6 - (s.vals[i] - mn) / (mx - mn) * (hgt - 12); x.beginPath(); x.arc(px, py, 3, 0, 7); x.fill(); });
  }
  x.fillStyle = "#8a91a2"; x.font = "11px Segoe UI"; x.fillText(mx.toPrecision(3), 4, 12); x.fillText(mn.toPrecision(3), 4, hgt - 4);
  return c;
}
const WX_GROUPS = [["sky", L("Himmel", "Sky")], ["cloud", L("Wolken", "Clouds")], ["light", L("Licht & Sonne", "Light & sun")], ["fog", L("Nebel & Dunst", "Fog & haze")], ["water", L("Wasser", "Water")], ["postfx", L("Belichtung & Nachbearbeitung", "Exposure & post FX")], ["lens", L("Lens & Bloom", "Lens & bloom")], ["", L("Sonstiges", "Other")]];
async function msSubWeather(el, m, sum) {
  if (!sum.weather?.length) { el.append(h("div", { class: "empty" }, L("Diese Mod ändert keine Wetterlagen (timecycle).", "This mod does not change weather (timecycle)."))); return; }
  if (!MS.wx.path || !sum.weather.some(w => w.path === MS.wx.path)) MS.wx.path = (sum.weather.find(w => /extrasunny/i.test(w.path)) || sum.weather[0]).path;
  const others = [];
  for (const o of MS.proj.mods) { if (o.file === m.file || !o.info.readable) continue; const s = await msSummary(o.file); const hit = (s.weather || []).find(w => w.name.toLowerCase() === sum.weather.find(x => x.path === MS.wx.path).name.toLowerCase()); if (hit) others.push({ mod: o.file, path: hit.path }); }
  let A, B = null;
  try { A = await api("/api/ms/v/weather", { file: m.file, path: MS.wx.path }); } catch (e) { el.append(h("div", { class: "empty" }, e.message)); return; }
  const cmp = others.find(o => o.mod === MS.wx.cmp);
  if (cmp) { try { B = await api("/api/ms/v/weather", { file: cmp.mod, path: cmp.path }); } catch { B = null; } }
  const regions = Object.keys(A.regions); if (!regions.includes(MS.wx.region)) MS.wx.region = regions[0];
  const RA = A.regions[MS.wx.region] || {}, RB = B ? (B.regions[MS.wx.region] || {}) : null;
  el.append(h("div", { class: "toolbar wx-bar" },
    h("b", {}, L("Wetter:", "Weather:")),
    h("select", { onchange: e => { MS.wx.path = e.target.value; msRender(); } }, sum.weather.map(w => h("option", { value: w.path, selected: w.path === MS.wx.path }, w.name.toUpperCase()))),
    h("select", { onchange: e => { MS.wx.region = e.target.value; msRender(); } }, regions.map(r => h("option", { value: r, selected: r === MS.wx.region }, r))),
    h("b", {}, L("Vergleichen mit:", "Compare with:")),
    h("select", { onchange: e => { MS.wx.cmp = e.target.value || null; msRender(); } }, h("option", { value: "" }, others.length ? "—" : L("keine andere Mod mit diesem Wetter", "no other mod with this weather")), others.map(o => h("option", { value: o.mod, selected: o.mod === MS.wx.cmp }, mname(o.mod)))),
    h("input", { type: "search", placeholder: L("Wert suchen…", "Search value…"), value: MS.wx.filter, oninput: e => { MS.wx.filter = e.target.value; clearTimeout(MS.wx.t); MS.wx.t = setTimeout(msRender, 300); } })));
  el.append(h("p", { class: "muted small" }, L("Jedes Band zeigt eine Farbe über den ganzen Tag (0 – 24 Uhr), so wie sie in der Wetterdatei steht. Maus drüber = Werte.", "Each band shows a colour over the whole day (0 – 24h) as stored in the weather file. Hover = values.") + (B ? "  " + L("Obere Zeile = diese Mod, untere = Vergleich.", "Upper row = this mod, lower = comparison.") : "")));
  // exposure / light curves first
  const key = MS.wx.metric in RA ? MS.wx.metric : Object.keys(RA).find(k => !/_r$|_g$|_b$/.test(k));
  const scalars = Object.keys(RA).filter(k => !/_(r|g|b)$/.test(k) && (!MS.wx.filter || k.includes(MS.wx.filter.toLowerCase())));
  el.append(h("div", { class: "card" }, h("h3", {}, L("Verlauf über den Tag", "Curve over the day")),
    h("div", { class: "toolbar" }, h("select", { onchange: e => { MS.wx.metric = e.target.value; msRender(); } }, scalars.map(k => h("option", { value: k, selected: k === key }, k))),
      h("span", { class: "legend" }, h("i", { style: "background:#1ec8d4" }), mname(m.file)), B ? h("span", { class: "legend" }, h("i", { style: "background:#ffaa5a" }), mname(MS.wx.cmp)) : null),
    key ? lineChart([{ vals: RA[key], color: "#1ec8d4" }, ...(RB && RB[key] ? [{ vals: RB[key], color: "#ffaa5a", dash: true }] : [])]) : null, hourAxis()));
  // colour bands grouped
  const triples = Object.keys(RA).filter(k => k.endsWith("_r") && RA[k.slice(0, -2) + "_g"] && RA[k.slice(0, -2) + "_b"]).map(k => k.slice(0, -2)).filter(k => !MS.wx.filter || k.includes(MS.wx.filter.toLowerCase()));
  for (const [g, label] of WX_GROUPS) {
    const ks = triples.filter(k => g ? k.startsWith(g) : !WX_GROUPS.some(([x]) => x && k.startsWith(x)));
    if (!ks.length) continue;
    const cb = h("div", { class: "cb" });
    const box = h("div", { class: "cat" + (g === "" ? " closed" : "") }, h("div", { class: "ch", onclick: () => box.classList.toggle("closed") }, h("span", {}, label.toUpperCase()), h("span", { class: "muted" }, ks.length)), cb);
    for (const k of ks) {
      const vals = ["r", "g", "b"].map(c => RA[k + "_" + c]);
      const tip = HOURS.map((hr, i) => `${hr}h: ${vals.map(v => v[i]).join(" / ")}`).join("\n");
      const row = h("div", { class: "band-row" }, h("div", { class: "band-l", "data-tip": k + "\n" + tip }, k.replace(/_col$/, "").replace(/_/g, " ")), h("div", {}, bandCanvas(...vals),
        RB && RB[k + "_r"] ? bandCanvas(RB[k + "_r"], RB[k + "_g"], RB[k + "_b"], 720, 12) : null));
      cb.append(row);
    }
    cb.append(h("div", { class: "band-row" }, h("div"), hourAxis()));
    el.append(box);
  }
}

// ============================================================ visualsettings
MS.vs = { cmp: null, filter: "", onlyDiff: false };
async function msSubVisual(el, m, sum) {
  if (!sum.visualsettings) { el.append(h("div", { class: "empty" }, L("Diese Mod hat keine visualsettings.dat.", "This mod has no visualsettings.dat."))); return; }
  const others = [];
  for (const o of MS.proj.mods) { if (o.file === m.file || !o.info.readable) continue; const s = await msSummary(o.file); if (s.visualsettings) others.push({ mod: o.file, path: s.visualsettings }); }
  const A = await api("/api/ms/v/visual", { file: m.file, path: sum.visualsettings });
  const cmp = others.find(o => o.mod === MS.vs.cmp);
  const B = cmp ? await api("/api/ms/v/visual", { file: cmp.mod, path: cmp.path }) : null;
  const mb = B ? new Map(B.map(x => [x.key, x.value])) : null;
  el.append(h("div", { class: "toolbar" },
    h("input", { type: "search", placeholder: L("Einstellung suchen (z. B. car, sky, bloom)…", "Search setting (e.g. car, sky, bloom)…"), value: MS.vs.filter, style: "width:300px", oninput: e => { MS.vs.filter = e.target.value; clearTimeout(MS.vs.t); MS.vs.t = setTimeout(msRender, 250); } }),
    h("b", {}, L("Vergleichen mit:", "Compare with:")),
    h("select", { onchange: e => { MS.vs.cmp = e.target.value || null; msRender(); } }, h("option", { value: "" }, others.length ? "—" : L("keine andere Mod mit visualsettings", "no other mod with visualsettings")), others.map(o => h("option", { value: o.mod, selected: o.mod === MS.vs.cmp }, mname(o.mod)))),
    B ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: MS.vs.onlyDiff, onchange: e => { MS.vs.onlyDiff = e.target.checked; msRender(); } }), " ", L("nur Unterschiede", "differences only")) : null,
    h("span", { class: "muted" }, `${A.length} ${L("Werte", "values")}`)));
  const groups = new Map();
  for (const x of A) {
    if (MS.vs.filter && !x.key.toLowerCase().includes(MS.vs.filter.toLowerCase())) continue;
    const diff = mb && mb.has(x.key) && mb.get(x.key) !== x.value;
    if (MS.vs.onlyDiff && !diff) continue;
    const g = x.key.split(".")[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ ...x, diff, b: mb ? mb.get(x.key) : undefined });
  }
  for (const [g, items] of groups) {
    const tbl = h("table", { class: "diff vs" }, h("tr", {}, h("th", {}, L("Einstellung", "Setting")), h("th", {}, mname(m.file)), B ? h("th", {}, mname(MS.vs.cmp)) : null));
    for (const x of items) {
      const ex = typeof explainUniform === "function" ? explainUniform({ name: x.key.replace(/\./g, "_"), label: x.key.replace(/\./g, " "), category: g, dim: 1, base: "float", default: [0] }, "").auto : "";
      tbl.append(h("tr", { class: x.diff ? "vs-diff" : "" }, h("td", { "data-tip": x.key + (ex ? "\n" + ex : "") }, x.key.slice(g.length + 1) || x.key), h("td", { class: "v" }, x.value), B ? h("td", { class: "v" + (x.b === undefined ? " na" : "") }, x.b ?? "—") : null));
    }
    const box = h("div", { class: "cat" + (groups.size > 6 && !MS.vs.filter && !MS.vs.onlyDiff ? " closed" : "") }, h("div", { class: "ch", onclick: () => box.classList.toggle("closed") }, h("span", {}, g.toUpperCase()), h("span", { class: "muted" }, items.length + (B ? " · " + items.filter(i => i.diff).length + " " + L("anders", "different") : ""))), h("div", { class: "cb" }, tbl));
    el.append(box);
  }
}

// ============================================================ 3D models
MS.m3 = { path: null, filter: "", wire: false };
async function msSubModels(el, m, sum) {
  if (!sum.models) { el.append(h("div", { class: "empty" }, L("Diese Mod enthält keine 3D-Modelle (.ydr/.yft/.ydd).", "This mod contains no 3D models (.ydr/.yft/.ydd)."))); return; }
  const list = await api("/api/ms/v/models", { file: m.file });
  if (!MS.m3.path || !list.includes(MS.m3.path)) MS.m3.path = list[0];
  const left = h("div", { class: "m3-list" });
  const flt = h("input", { type: "search", placeholder: L("Modell suchen…", "Search model…"), value: MS.m3.filter, style: "width:100%" });
  const items = h("div");
  const drawList = () => { items.innerHTML = ""; const q = MS.m3.filter.toLowerCase(); for (const p of list.filter(x => !q || x.toLowerCase().includes(q)).slice(0, 400)) items.append(h("div", { class: "tech" + (p === MS.m3.path ? " on" : ""), onclick: () => { MS.m3.path = p; msRender(); } }, p.replace(/^content\//i, ""))); };
  flt.oninput = () => { MS.m3.filter = flt.value; drawList(); };
  left.append(flt, items); drawList();
  const right = h("div", { class: "m3-view" });
  el.append(h("div", { class: "m3" }, left, right));
  right.append(h("div", { class: "muted" }, L("Lade Modell…", "Loading model…")));
  try {
    const d = await api("/api/ms/v/model", { file: m.file, path: MS.m3.path });
    right.innerHTML = "";
    const cv = h("canvas", { class: "m3-canvas" }); right.append(cv);
    right.append(h("div", { class: "toolbar" }, h("span", { class: "muted small" }, `${MS.m3.path.split("/").pop()} · ${d.meshes.length} ${L("Teile", "parts")} · ${d.triangles.toLocaleString()} ${L("Dreiecke", "triangles")}`),
      h("div", { class: "spacer" }), h("label", { class: "chk" }, h("input", { type: "checkbox", checked: MS.m3.wire, onchange: e => { MS.m3.wire = e.target.checked; msRender(); } }), " ", L("Drahtgitter", "Wireframe")),
      h("span", { class: "muted small" }, L("Ziehen = drehen · Mausrad = zoomen", "Drag = rotate · wheel = zoom"))));
    requestAnimationFrame(() => glView(cv, d, MS.m3.wire));
  } catch (e) { right.innerHTML = ""; right.append(h("div", { class: "empty" }, L("Modell konnte nicht dargestellt werden: ", "Could not display model: ") + e.message)); }
}
function b64f(s, T) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); }
function glView(cv, d, wire) {
  cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
  const gl = cv.getContext("webgl2", { antialias: true }); if (!gl) return;
  const vs = `#version 300 es
  in vec3 p; in vec3 n; uniform mat4 mvp; uniform mat4 rot; out vec3 vn; out float vz;
  void main(){ vn = (rot*vec4(n,0.)).xyz; gl_Position = mvp*vec4(p,1.); vz = p.z; }`;
  const fs = `#version 300 es
  precision highp float; in vec3 vn; in float vz; uniform vec3 col; uniform float hasN; out vec4 o;
  void main(){ vec3 N = normalize(vn); float l = hasN > .5 ? max(dot(N, normalize(vec3(.4,.6,.7))), 0.)*.75 + .3 : .8; o = vec4(col*l,1.); }`;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
  const meshes = d.meshes.map(m => {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, b64f(m.pos, Float32Array), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 3, gl.FLOAT, false, 0, 0);
    const nl = gl.getAttribLocation(pr, "n");
    if (m.nrm) { const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, b64f(m.nrm, Float32Array), gl.STATIC_DRAW); gl.enableVertexAttribArray(nl); gl.vertexAttribPointer(nl, 3, gl.FLOAT, false, 0, 0); }
    const idx = b64f(m.idx, Uint32Array);
    let ib = idx;
    if (wire) { const l = new Uint32Array(idx.length * 2); for (let i = 0; i < idx.length; i += 3) { l.set([idx[i], idx[i + 1], idx[i + 1], idx[i + 2], idx[i + 2], idx[i]], i * 2); } ib = l; }
    const eb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
    return { vao, count: ib.length, hasN: !!m.nrm };
  });
  const c = d.bmin.map((v, i) => (v + d.bmax[i]) / 2), size = Math.max(...d.bmax.map((v, i) => v - d.bmin[i]), 0.01);
  let yaw = 0.7, pitch = 0.35, dist = size * 1.8;
  const mul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  const persp = (f, a, n, fr) => { const t = 1 / Math.tan(f / 2); return new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + n) / (n - fr), -1, 0, 0, 2 * fr * n / (n - fr), 0]); };
  const draw = () => {
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.07, 0.08, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    // GTA is Z-up: rotate -90° around X, then orbit
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const zup = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
    const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
    const rx = new Float32Array([1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1]);
    const tr = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1]);
    const cam = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1]);
    const rot = mul(rx, mul(ry, zup));
    const mvp = mul(persp(0.8, cv.width / cv.height, size * 0.01, size * 20), mul(cam, mul(rot, tr)));
    gl.uniformMatrix4fv(gl.getUniformLocation(pr, "mvp"), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(pr, "rot"), false, rot);
    meshes.forEach((m, i) => {
      gl.bindVertexArray(m.vao);
      const hue = (i * 0.17) % 1; gl.uniform3f(gl.getUniformLocation(pr, "col"), 0.55 + 0.35 * Math.cos(6.28 * hue), 0.65 + 0.25 * Math.cos(6.28 * (hue + .33)), 0.75 + 0.2 * Math.cos(6.28 * (hue + .66)));
      gl.uniform1f(gl.getUniformLocation(pr, "hasN"), m.hasN ? 1 : 0);
      gl.drawElements(wire ? gl.LINES : gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    });
  };
  let drag = null;
  cv.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", e => { if (!drag) return; yaw += (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.01)); drag = [e.clientX, e.clientY]; draw(); });
  cv.addEventListener("pointerup", () => drag = null);
  cv.addEventListener("wheel", e => { e.preventDefault(); dist *= e.deltaY > 0 ? 1.1 : 0.9; draw(); }, { passive: false });
  draw();
}

// ============================================================ hook: overview tab + default
const _msRender3 = msRender;
msRender = function () {
  _msRender3();
  const nav = $(".ms-tabs");
  if (nav && !nav.querySelector('[data-k="overview"]')) {
    const b = h("button", { "data-k": "overview", class: MS.tab === "overview" ? "on" : "", onclick: () => { MS.tab = "overview"; msRender(); } }, L("Übersicht", "Overview"));
    nav.prepend(b);
    if (MS.tab === "overview") [...nav.children].forEach(x => x !== b && x.classList.remove("on"));
  }
  const body = $(".ms-body");
  if (body && MS.tab === "overview" && MS.state?.workspace && MS.proj) { body.innerHTML = ""; msOverviewTab(body); }
};
const _msLoad3 = msLoad;
msLoad = async function () { MS.sum = {}; await _msLoad3(); };
const _msOpen3 = msOpen;
msOpen = async function (dir, create) { MS.tab = "overview"; await _msOpen3(dir, create); if (MS.tab === "mods") { MS.tab = "overview"; msRender(); } };

MS.tab = "overview";
const _remOpen = REMOTE.msOpen.run;
REMOTE.msOpen.run = async a => { const r = await _remOpen(a); MS.tab = "overview"; await msInit(); if (MS.tab === "mods") { MS.tab = "overview"; msRender(); } return r; };
Object.assign(REMOTE, {
  msTab: { help: "{name: overview|folder|mods|conflicts|own|fusion|tex|build} Tab im Mod-Studio wechseln", run: a => { setMode("mods"); MS.tab = a.name || "overview"; msRender(); return { ok: true }; } },
  msSummary: { help: "{file} Steckbrief einer Mod (Bereiche, Dateitypen, Wetter, visualsettings, Modelle)", run: a => api("/api/ms/v/summary", { file: a.file }) },
  msWeather: { help: "{file, path} Timecycle-Werte einer Wetterlage (13 Stützpunkte pro Wert)", run: a => api("/api/ms/v/weather", a) },
  msVisual: { help: "{file, path} visualsettings.dat als Liste", run: a => api("/api/ms/v/visual", a) },
  msShow: { help: "{file, sub: overview|textures|weather|visual|models|files} Mod im Studio anzeigen", run: a => { setMode("mods"); MS.sel = a.file; MS.sub = a.sub || "overview"; MS.tab = "mods"; MS.tree = null; msRender(); return { ok: true }; } },
});
