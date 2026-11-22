"use strict";
// VELOX Preset Studio 1.2 – shader errors from ReShade.log, gallery, pinned sliders ("My sliders"),
// share as ZIP, install/update official shader packs, backups of the ReShade folder.

// ============================================================ shader log
S.shaderLog = { files: {} };
async function loadShaderLog() {
  try { S.shaderLog = await api("/api/shaderlog"); } catch { S.shaderLog = { files: {} }; }
}
function logOf(file) { return (S.shaderLog.files || {})[file] || null; }
function logBadge(key) {
  const f = logOf(fileOf(key));
  if (!f || (f.status !== "fail" && f.status !== "error")) return null;
  return h("span", { class: "badge logbad", "data-tip": f.status === "fail"
    ? L("Laut ReShade.log kompiliert dieser Shader nicht – im Spiel wirkt er nicht.", "According to ReShade.log this shader does not compile – it has no effect in game.")
    : L("ReShade.log meldet Fehler in diesem Shader – kann im Spiel falsch aussehen.", "ReShade.log reports errors in this shader – may look wrong in game.") }, f.status === "fail" ? L("⚠ Fehler", "⚠ Error") : L("⚠ Meldung", "⚠ Issue"));
}
function logBox(file) {
  const f = logOf(file);
  if (!f || (!f.errors.length && !f.warnings.length && f.status === "ok")) return null;
  const lvl = f.status === "fail" ? "bad" : f.errors.length ? "wrn" : "muted";
  const when = S.shaderLog.time ? new Date(S.shaderLog.time).toLocaleString(LANG === "en" ? "en-GB" : "de-DE") : "";
  return h("div", { class: "logbox " + lvl },
    h("b", {}, f.status === "fail" ? L("Kompiliert nicht (ReShade.log)", "Does not compile (ReShade.log)") : f.errors.length ? L("Fehler-Meldungen im ReShade.log", "Error messages in ReShade.log") : L("Warnungen im ReShade.log", "Warnings in ReShade.log")),
    h("span", { class: "muted small" }, "  " + L("Stand: ", "As of: ") + when),
    ...[...f.errors.map(e => ["✕", e]), ...f.warnings.slice(0, 6).map(e => ["!", e])].map(([s, e]) => h("div", { class: "small" }, `${s} ${e.where ? e.where + " " : ""}${e.code ? e.code + ": " : ""}${e.msg}`)),
    f.warnings.length > 6 ? h("div", { class: "muted small" }, `+ ${f.warnings.length - 6} ${L("weitere Warnungen", "more warnings")}`) : null);
}
function logSummaryCard() {
  const files = Object.entries(S.shaderLog.files || {});
  const bad = files.filter(([, f]) => f.status === "fail" || f.status === "error");
  const card = h("div", { class: "card" }, h("h3", {}, L("Shader-Fehler aus ReShade.log", "Shader errors from ReShade.log")));
  if (!S.shaderLog.found) { card.append(h("p", {}, L("Keine ReShade.log gefunden – einmal das Spiel mit ReShade starten.", "No ReShade.log found – start the game with ReShade once."))); return card; }
  card.append(h("p", {}, L("Stand: ", "As of: ") + new Date(S.shaderLog.time).toLocaleString(LANG === "en" ? "en-GB" : "de-DE") + " · " +
    (bad.length ? L(`${bad.length} Shader mit Fehlern`, `${bad.length} shaders with errors`) : L("keine Fehler ✓", "no errors ✓")) + " · " +
    L(`${files.length - bad.length} nur mit Warnungen`, `${files.length - bad.length} with warnings only`)),
    h("button", { class: "small", onclick: async () => { await loadShaderLog(); renderPacks(); toast(L("ReShade.log neu gelesen", "ReShade.log re-read"), true); } }, L("Neu einlesen", "Re-read")));
  for (const [fn, f] of bad) card.append(h("div", { class: "rep-row " + (f.status === "fail" ? "bad" : "wrn") }, h("b", {}, fn), " ",
    h("span", { class: "muted small" }, f.errors[0] ? f.errors[0].msg : "")));
  return card;
}

// ============================================================ pinned sliders ("Meine Regler")
S.pins = [];
const pinKey = (file, name) => file + "|" + name;
function isPinned(file, name) { return S.pins.some(p => p.file === file && p.key === name); }
async function togglePin(file, name) {
  S.pins = isPinned(file, name) ? S.pins.filter(p => !(p.file === file && p.key === name)) : [...S.pins, { file, key: name }];
  try { await api("/api/setpins", { pins: S.pins }); } catch (e) { toast(e.message); }
  renderStack(); if (S.sel === "__pins__") renderParams();
}
function pinBtn(file, u) {
  const on = isPinned(file, u.name);
  return h("button", { class: "pin" + (on ? " on" : ""), "data-tip": on ? L("Aus „Meine Regler“ entfernen", "Remove from \"My sliders\"") : L("Zu „Meine Regler“ hinzufügen – alle angepinnten Regler stehen oben in einer Liste", "Add to \"My sliders\" – all pinned sliders are listed together at the top"),
    onclick: e => { e.stopPropagation(); togglePin(file, u.name); } }, "📌");
}
async function renderPins() {
  const box = $("#params");
  box.innerHTML = ""; box.className = "dn-" + S.dn;
  box.append(h("div", { class: "phead" }, h("div", { class: "title" }, L("📌 Meine Regler", "📌 My sliders")),
    h("span", { class: "muted" }, L("Regler aus allen Effekten an einem Ort – mit 📌 an jedem Regler hinzufügen", "Sliders from all effects in one place – add with 📌 on any slider"))));
  if (!S.pins.length) { box.append(h("div", { class: "empty" }, L("Noch keine Regler angepinnt. Fahr mit der Maus über einen Regler und klick auf 📌.", "No sliders pinned yet. Hover a slider and click 📌."))); return; }
  const en = new Set(M.enabled().map(fileOf).map(f => f.toLowerCase()));
  const byFile = new Map();
  for (const p of S.pins) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file).push(p.key); }
  for (const [file, keys] of byFile) {
    const d = await fxDetails(file).catch(() => null);
    const t = S.techs.find(x => x.file === file);
    const cb = h("div", { class: "cb" });
    const off = !en.has(file.toLowerCase());
    const cat = h("div", { class: "cat" + (off ? " pin-off" : "") }, h("div", { class: "ch" }, h("span", {}, (t ? t.label : file) + (off ? L("  (Effekt ist aus)", "  (effect is off)") : "")), h("span", { class: "muted" }, file)), cb);
    for (const k of keys) {
      const u = d && d.uniforms ? d.uniforms.find(x => x.name === k) : null;
      if (u) cb.append(paramRow(file, u));
      else cb.append(h("div", { class: "row" }, h("div", { class: "lb" }, k), h("span", { class: "muted" }, L("Regler gibt es nicht mehr", "Slider no longer exists")), h("button", { class: "rs vis", onclick: () => togglePin(file, k) }, "✕")));
    }
    box.append(cat);
  }
}
const _renderParams = renderParams;
renderParams = async function () {
  if (S.sel === "__pins__") return renderPins();
  await _renderParams();
  if (!S.sel || !S.cur) return;
  const lb = logBox(fileOf(S.sel));
  const head = $("#params .phead");
  if (lb && head) head.after(lb);
};
const _renderStack2 = renderStack;
renderStack = function () {
  _renderStack2();
  const box = $("#stackList");
  if (!box || !S.cur) return;
  const item = h("div", { class: "fx pins-item" + (S.sel === "__pins__" ? " sel" : ""), onclick: () => { S.sel = "__pins__"; renderEditor(); } },
    h("div", { class: "nm" }, h("b", {}, L("📌 Meine Regler", "📌 My sliders")), h("small", {}, S.pins.length ? L(`${S.pins.length} angepinnt`, `${S.pins.length} pinned`) : L("Regler mit 📌 anpinnen", "Pin sliders with 📌"))));
  box.prepend(item);
};

// ============================================================ gallery
async function renderGallery() {
  const el = $("#view-gallery"); el.className = "view scroll"; el.innerHTML = "";
  let list; try { list = await api("/api/gallery"); } catch (e) { el.append(h("div", { class: "empty" }, e.message)); return; }
  const withImg = list.filter(p => p.shot).length;
  let filter = "";
  const grid = h("div", { class: "grid gallery" });
  const draw = () => {
    grid.innerHTML = "";
    for (const p of list) {
      if (filter && !(p.name + " " + p.folder).toLowerCase().includes(filter)) continue;
      const im = h("div", { class: "im" + (p.shot ? "" : " noimg") }, p.shot ? null : L("kein Bild", "no picture"));
      if (p.shot) im.style.backgroundImage = `url('vps://shot/?name=${enc(p.shot)}&size=480')`;
      const active = sameRel(S.state.active, p.rel);
      grid.append(h("div", { class: "tile" + (S.cur && S.cur.rel === p.rel ? " sel" : "") },
        h("div", { onclick: () => { openPreset(p.rel); showView("editor"); } }, im),
        h("div", { class: "cap g-cap" }, h("div", {}, h("b", {}, p.name), active ? h("span", { class: "act" }, " ●") : null, h("div", { class: "muted small" }, p.folder)),
          h("button", { class: "small", "data-tip": L("Vorschaubild aus deinen Screenshots wählen", "Pick a preview picture from your screenshots"), onclick: () => pickPreview(p.rel, p.name) }, L("Bild", "Picture")))));
    }
  };
  el.append(h("div", { class: "toolbar" }, h("b", {}, `${list.length} Presets · ${withImg} ${L("mit Bild", "with picture")}`),
    h("input", { placeholder: L("Suchen…", "Search…"), style: "width:240px", oninput: e => { filter = e.target.value.toLowerCase(); draw(); } }),
    h("span", { class: "muted" }, L("Bilder kommen automatisch aus deinen ReShade-Screenshots (Tab „Screenshots“ einrichten). Mit „Bild“ selbst wählen.", "Pictures come automatically from your ReShade screenshots (set up the Screenshots tab). Pick your own with 'Picture'."))), grid);
  draw();
}
async function pickPreview(rel, name) {
  const shots = await api("/api/shots");
  const grid = h("div", { class: "grid shots" });
  for (const s of shots) {
    const im = h("div", { class: "im" }); im.style.backgroundImage = `url('vps://shot/?name=${enc(s.name)}&size=400')`;
    grid.append(h("div", { class: "tile", onclick: async () => { await api("/api/setpreview", { rel, shot: s.name }); $(".modal-box .mh button").click(); renderGallery(); renderPresetList(); } }, im, h("div", { class: "cap" }, new Date(s.mtime * 1000).toLocaleString(LANG === "en" ? "en-GB" : "de-DE"))));
  }
  modal(L("Vorschaubild für ", "Preview picture for ") + name, shots.length ? grid : h("div", { class: "empty" }, L("Noch keine Screenshots. Unter „Screenshots“ einrichten und im Spiel die Druck-Taste drücken.", "No screenshots yet. Set them up under \"Screenshots\" and press Print in game.")),
    [[L("Automatisch", "Automatic"), async () => { await api("/api/setpreview", { rel, shot: null }); renderGallery(); }], [L("Schließen", "Close"), () => true]]);
}
// small thumbnails in the preset list
S.thumbs = {};
async function loadThumbs() { try { const g = await api("/api/gallery"); S.thumbs = Object.fromEntries(g.filter(p => p.shot).map(p => [p.rel, p.shot])); } catch { } }
const _renderPresetList = renderPresetList;
renderPresetList = function () {
  _renderPresetList();
  for (const el of $$("#presetList .pitem")) {
    const shot = S.thumbs[el.title];
    if (shot) { const t = h("span", { class: "pthumb" }); t.style.backgroundImage = `url('vps://shot/?name=${enc(shot)}&size=96')`; el.prepend(t); }
  }
};

// ============================================================ share as zip
async function shareZip() {
  if (!S.cur) return;
  if (S.dirty && !S.live) await save();
  const p = S.presets.find(x => x.rel === S.cur.rel);
  const out = await window.vps.saveZip((p ? p.name : "Preset") + ".zip");
  if (!out) return;
  try {
    const r = await api("/api/exportzip", { rel: S.cur.rel, out });
    toast(L(`ZIP gespeichert – ${r.textures} Texturen, Liste mit ${r.shaders} Shadern`, `ZIP saved – ${r.textures} textures, list of ${r.shaders} shaders`), true);
    window.vps.openPath(out.replace(/[\\/][^\\/]+$/, ""));
  } catch (e) { toast(e.message); }
}

// ============================================================ shader packs (official ReShade list)
let pkgList = null;
async function packsInstallCard() {
  const card = h("div", { class: "card" }, h("h3", {}, L("Shader-Pakete installieren / aktualisieren", "Install / update shader packs")),
    h("p", {}, L("Offizielle Paketliste von ReShade (GitHub). Installieren lädt das Paket herunter und legt es in deinen reshade-shaders-Ordner. Aktualisieren lädt die neueste Version und überschreibt die Paket-Dateien.",
      "Official ReShade package list (GitHub). Install downloads the pack into your reshade-shaders folder. Update downloads the newest version and overwrites the pack files.")));
  const list = h("div", { class: "pkglist" }, h("div", { class: "muted" }, L("Lade Liste…", "Loading list…")));
  card.append(list);
  try { pkgList = await api("/api/packages"); } catch (e) { list.innerHTML = ""; list.append(h("p", { class: "wrn" }, e.message)); return card; }
  list.innerHTML = "";
  for (const p of pkgList) {
    const st = p.installed === 0 ? "none" : p.installed >= p.total ? "full" : "part";
    list.append(h("div", { class: "pkg" },
      h("div", { class: "nm" }, h("b", {}, p.name), h("div", { class: "muted small" }, p.desc)),
      h("span", { class: "pk-st " + st }, st === "none" ? L("nicht installiert", "not installed") : st === "full" ? L("installiert", "installed") : L(`teilweise (${p.installed}/${p.total})`, `partly (${p.installed}/${p.total})`)),
      p.repo ? h("button", { class: "small st-link", onclick: () => window.vps.openUrl(p.repo) }, "GitHub") : null,
      h("button", { class: "small" + (st === "none" ? " primary" : ""), onclick: () => installPackConfirm(p) }, st === "none" ? L("Installieren", "Install") : L("Aktualisieren", "Update"))));
  }
  return card;
}
function installPackConfirm(p, after) {
  modal(L("Paket herunterladen?", "Download pack?"), h("div", {},
    h("p", {}, h("b", {}, p.name)), h("p", { class: "muted" }, p.desc),
    h("p", {}, L("Quelle: ", "Source: "), h("span", { class: "mono" }, p.url)),
    h("p", { class: "muted" }, L("Es werden nur Shader- und Textur-Dateien in deinen reshade-shaders-Ordner geschrieben (gleichnamige Dateien werden überschrieben). Danach im Spiel einmal neu laden.",
      "Only shader and texture files are written into your reshade-shaders folder (files with the same name are overwritten). Reload once in game afterwards."))), [
    [L("Abbrechen", "Cancel"), () => true],
    [L("Herunterladen & installieren", "Download & install"), async () => {
      toast(L("Lade ", "Downloading ") + p.name + "…");
      try {
        const r = await api("/api/installpack", { id: p.id });
        S.fx = {}; await loadTechs();
        toast(L(`${r.name}: ${r.shaders} Shader-Dateien, ${r.textures} Texturen installiert`, `${r.name}: ${r.shaders} shader files, ${r.textures} textures installed`), true);
        if (after) after(); else if (S.view === "packs") renderPacks();
      } catch (e) { toast(e.message); }
    }, "primary"]]);
}

// ============================================================ backups
async function backupCard() {
  const card = h("div", { class: "card" }, h("h3", {}, L("Backup des ReShade-Ordners", "Backup of the ReShade folder")),
    h("p", {}, L("„Presets“ sichert ReShade.ini und alle Presets (klein, schnell). „Komplett“ sichert zusätzlich alle Shader und Texturen (groß). Wiederherstellen überschreibt nur Dateien aus dem Backup – vorher wird automatisch der aktuelle Stand gesichert.",
      "\"Presets\" saves ReShade.ini and all presets (small, fast). \"Full\" also saves all shaders and textures (large). Restore only overwrites files from the backup – the current state is backed up automatically first.")));
  const run = async mode => {
    toast(L("Backup läuft…", "Backup running…"));
    try { const r = await api("/api/backup", { mode }); toast(L(`Backup fertig: ${r.files} Dateien, ${(r.size / 1048576).toFixed(1)} MB`, `Backup done: ${r.files} files, ${(r.size / 1048576).toFixed(1)} MB`), true); renderSetup(); }
    catch (e) { toast(e.message); }
  };
  card.append(h("div", { class: "toolbar" },
    h("button", { class: "primary", onclick: () => run("presets") }, L("Presets sichern", "Back up presets")),
    h("button", { onclick: () => run("full") }, L("Komplett sichern", "Full backup")),
    h("button", { onclick: () => openFolder("backups") }, L("Ordner öffnen", "Open folder"))));
  const list = await api("/api/backups").catch(() => []);
  for (const b of list.slice(0, 12)) card.append(h("div", { class: "rep-row bk" },
    h("span", {}, b.name.replace(/\.zip$/, "")), h("span", { class: "muted small" }, (b.size / 1048576).toFixed(1) + " MB"),
    h("button", { class: "small", onclick: () => restoreConfirm(b) }, L("Wiederherstellen", "Restore"))));
  if (!list.length) card.append(h("p", { class: "muted" }, L("Noch keine Backups.", "No backups yet.")));
  return card;
}
function restoreConfirm(b) {
  modal(L("Backup wiederherstellen?", "Restore backup?"), h("div", {},
    h("p", {}, h("b", {}, b.name)),
    h("p", {}, L("Alle Dateien aus diesem Backup werden in deinen ReShade-Ordner zurückgeschrieben und überschreiben die aktuellen Versionen. Dateien, die nicht im Backup sind, bleiben unverändert.",
      "All files from this backup are written back into your ReShade folder and overwrite the current versions. Files that are not in the backup stay untouched.")),
    h("p", { class: "muted" }, L("Vorher wird automatisch ein Presets-Backup vom jetzigen Stand angelegt.", "A presets backup of the current state is made automatically first."))), [
    [L("Abbrechen", "Cancel"), () => true],
    [L("Wiederherstellen", "Restore"), async () => {
      try {
        const r = await api("/api/restore", { name: b.name });
        S.fx = {}; S.dirty = false; await loadState(); await loadPresets(); await loadTechs();
        if (S.cur) await openPreset(S.cur.rel, true);
        toast(L(`Wiederhergestellt: ${r.files} Dateien`, `Restored: ${r.files} files`) + (r.skippedIni ? L(" (ReShade.ini übersprungen – Spiel läuft)", " (ReShade.ini skipped – game running)") : ""), true);
        renderSetup();
      } catch (e) { toast(e.message); }
    }, "primary"]]);
}

// ============================================================ hooks into existing views
const _renderPacks = renderPacks;
renderPacks = function () {
  _renderPacks();
  const el = $("#view-packs");
  const tb = $(".toolbar", el);
  const wrap = h("div");
  tb.after(wrap);
  wrap.append(logSummaryCard());
  packsInstallCard().then(c => wrap.append(c));
};
const _renderSetup2 = renderSetup;
renderSetup = async function () {
  await _renderSetup2();
  const el = $("#view-setup");
  const c = await backupCard();
  const cards = $$(".card", el);
  (cards[2] || cards[cards.length - 1]).after(c);
};
const _viewShot = viewShot;
viewShot = function (s) {
  _viewShot(s);
  const sel = h("select", {}, h("option", { value: "" }, L("— als Vorschaubild für Preset —", "— use as preview for preset —")), S.presets.map(p => h("option", { value: p.rel }, `${p.folder} / ${p.name}`)));
  sel.onchange = async () => { if (!sel.value) return; await api("/api/setpreview", { rel: sel.value, shot: s.name }); await loadThumbs(); renderPresetList(); toast(L("Vorschaubild gesetzt", "Preview set"), true); };
  $(".modal-box .mb").append(sel);
};
// import: zip support + install button for missing official packs
const _importPresets = importPresets;
importPresets = async function (files) {
  files = files || await window.vps.pickPreset();
  const zips = files.filter(f => /\.zip$/i.test(f)), inis = files.filter(f => !/\.zip$/i.test(f));
  if (inis.length) await _importPresets(inis);
  for (const f of zips) {
    let r; try { r = await api("/api/readzip", { file: f }); } catch (e) { toast(e.message); continue; }
    await new Promise(done => {
      const name = h("input", { value: r.name, style: "width:100%" });
      const folder = h("input", { value: "Importiert", style: "width:100%" });
      modal(L("ZIP importieren: ", "Import ZIP: ") + r.name, h("div", {},
        h("div", { class: "form" }, h("label", {}, L("Name", "Name")), name, h("label", {}, L("Ordner", "Folder")), folder),
        r.texturesNew.length ? h("p", { class: "muted" }, L(`${r.texturesNew.length} neue Texturen werden mit installiert (vorhandene werden nicht überschrieben).`, `${r.texturesNew.length} new textures will be installed too (existing ones are not overwritten).`)) : null,
        h("h4", {}, L("Prüfung", "Check")), checkReport(r.check)), [
        [L("Abbrechen", "Cancel"), () => true],
        [L("Importieren", "Import"), async () => {
          try { const x = await api("/api/importzip", { file: f, name: name.value, folder: folder.value }); await loadPresets(); S.dirty = false; await openPreset(x.rel); toast(L(`Importiert (${x.textures} Texturen)`, `Imported (${x.textures} textures)`), true); }
          catch (e) { toast(e.message); return false; }
        }, "primary"]], () => setTimeout(done, 50));
    });
  }
};
$("#importBtn").onclick = () => importPresets();
const _checkReport = checkReport;
checkReport = function (c) {
  const box = _checkReport(c);
  for (const m of c.missingShaders || []) {
    if (!m.official) continue;
    const row = [...box.querySelectorAll(".rep-row")].find(r => r.textContent.includes(m.file));
    if (row) row.append(h("button", { class: "small primary", style: "margin-top:6px", onclick: () => installPackConfirm({ id: m.official.id, name: m.official.name, desc: L("Enthält ", "Contains ") + m.file, url: m.official.repo }) },
      L("„" + m.official.name + "“ installieren", "Install \"" + m.official.name + "\"")));
  }
  return box;
};
$("#shareBtn").onclick = shareZip;
const _updateTop2 = updateTop;
updateTop = function () { _updateTop2(); $("#shareBtn").disabled = !S.cur; };

// remote commands
Object.assign(REMOTE, {
  shaderLog: { help: "Shader-Fehler/Warnungen aus ReShade.log", run: async () => (await loadShaderLog(), S.shaderLog) },
  gallery: { help: "Presets mit zugeordnetem Vorschau-Screenshot", run: () => api("/api/gallery") },
  setPreview: { help: "{rel|name, shot|null} Vorschaubild festlegen", run: async a => { const p = findPreset(a); if (!p) throw new Error("Preset nicht gefunden"); await api("/api/setpreview", { rel: p.rel, shot: a.shot || null }); await loadThumbs(); renderPresetList(); return { ok: true }; } },
  pins: { help: "Angepinnte Regler (Meine Regler)", run: () => S.pins },
  pin: { help: "{file, key, on} Regler an-/abpinnen", run: async a => { if (!!a.on !== isPinned(a.file, a.key) || a.on === undefined) await togglePin(a.file, a.key); return S.pins; } },
  exportZip: { help: "{out, rel?} offenes (oder rel) Preset als ZIP speichern (absoluter Pfad)", run: a => api("/api/exportzip", { rel: a.rel || (needCur(), S.cur.rel), out: a.out }) },
  packages: { help: "Offizielle ReShade-Paketliste mit Installationsstatus", run: () => api("/api/packages") },
  installPack: { help: "{id} Paket aus der offiziellen Liste installieren/aktualisieren (lädt aus dem Internet)", run: async a => { const r = await api("/api/installpack", { id: a.id }); S.fx = {}; await loadTechs(); return r; } },
  backup: { help: "{mode: presets|full} Backup des ReShade-Ordners", run: a => api("/api/backup", { mode: a.mode }) },
  backups: { help: "Liste der Backups", run: () => api("/api/backups") },
  restore: { help: "{name} Backup wiederherstellen (sichert vorher den aktuellen Stand)", run: async a => { const r = await api("/api/restore", { name: a.name }); S.fx = {}; await loadPresets(); await loadTechs(); return r; } },
});

// init
(async () => {
  await loadShaderLog();
  try { S.pins = await api("/api/pins"); } catch { }
  await loadThumbs();
  renderPresetList();
  if (S.cur) renderEditor();
})();
