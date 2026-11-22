"use strict";
// Mod-Studio 1.4: texture editor (YTD) + fusion (pick per file from several mods) + validated export.

// ============================================================ textures
MS.tex = null; // current YTD session state
async function msOpenYtd(src) {
  try { MS.tex = await api("/api/ms/ytdopen", src); MS.tab = "tex"; msRender(); }
  catch (e) { toast(e.message); }
}
async function msOpenYtdDisk() {
  const f = await window.vps.pickFiles({ title: L("YTD öffnen (wird nur gelesen)", "Open YTD (read only)"), filters: [{ name: "YTD", extensions: ["ytd"] }] });
  if (f.length) msOpenYtd({ disk: f[0] });
}
function msTexTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  if (!MS.tex) {
    el.append(h("div", { class: "card" }, h("h3", {}, L("Texturen bearbeiten (YTD)", "Edit textures (YTD)")),
      h("p", {}, L("Öffne eine .ytd aus einer Mod (Tab „Mods“ → Datei-Liste → „Texturen“), aus deinen eigenen Dateien, oder irgendeine .ytd von der Festplatte (wird nur gelesen).",
        "Open a .ytd from a mod (Mods tab → file list → \"Textures\"), from your own files, or any .ytd from disk (read only).")),
      h("ul", { class: "muted" }, h("li", {}, L("Vorschau aller Texturen, Export als PNG oder DDS", "Preview of all textures, export as PNG or DDS")),
        h("li", {}, L("Textur ersetzen: dein Bild wird automatisch auf Größe und Format des Originals gebracht (inkl. Mipmaps)", "Replace a texture: your picture is converted to the original size and format automatically (incl. mipmaps)")),
        h("li", {}, L("Speichern legt eine eigene Datei im Arbeitsordner an – sie ersetzt im Pack automatisch das Original", "Saving creates an own file in the workspace – it automatically replaces the original in the pack"))),
      h("button", { class: "primary", onclick: msOpenYtdDisk }, L("YTD von Festplatte öffnen…", "Open YTD from disk…"))));
    return;
  }
  const t = MS.tex;
  const where = t.src.kind === "mod" ? `${mname(t.src.mod)} › ${t.src.path}` : t.src.kind === "own" ? L("Eigene Datei: ", "Own file: ") + t.src.own : t.src.disk;
  el.append(h("div", { class: "toolbar" },
    h("div", {}, h("div", { class: "title" }, t.src.name), h("div", { class: "muted small" }, where),
      t.src.target ? h("div", { class: "ok small" }, L("Ersetzt im Spiel: ", "Replaces in game: ") + t.src.target.targetRaw + (t.src.target.archive ? "  (" + t.src.target.archive + ")" : "")) : h("div", { class: "wrn small" }, L("Kein Spielziel bekannt – Speichern legt nur eine Datei an, die du exportieren kannst.", "No game target known – saving only creates a file you can export."))),
    h("div", { class: "spacer" }),
    h("button", { class: "small", onclick: msOpenYtdDisk }, L("Andere YTD…", "Other YTD…")),
    h("button", { class: "small", onclick: () => msTexExport(null, "png") }, L("Alle als PNG", "All as PNG")),
    h("button", { class: "small", onclick: () => msTexExport(null, "dds") }, L("Alle als DDS", "All as DDS")),
    h("button", { class: "primary", disabled: !t.changed.length, onclick: msTexSave }, t.changed.length ? L(`Speichern (${t.changed.length} geändert)`, `Save (${t.changed.length} changed)`) : L("Keine Änderungen", "No changes"))));
  el.append(h("p", { class: "muted small" }, `${t.textures.length} ${L("Texturen", "textures")}. ` + L("Tipp: DDS exportieren, in GIMP/Photoshop bearbeiten und als DDS oder PNG wieder einsetzen.", "Tip: export DDS, edit in GIMP/Photoshop and put it back as DDS or PNG.")));
  const grid = h("div", { class: "grid texgrid" });
  for (const x of t.textures) {
    const im = h("div", { class: "im" + (x.supported ? "" : " noimg") }, x.supported ? null : x.format);
    if (x.supported) im.style.backgroundImage = `url('vps://ytd/?id=${t.id}&i=${x.index}&size=256&v=${t.ver}')`;
    grid.append(h("div", { class: "tile" + (t.changed.includes(x.index) ? " changed" : "") },
      h("div", { onclick: () => x.supported && msTexView(x) }, im),
      h("div", { class: "cap tex-cap" },
        h("b", { title: x.name }, x.name),
        h("div", { class: "muted small" }, `${x.width}×${x.height} · ${x.format} · ${x.levels} mip${x.levels > 1 ? "s" : ""}`),
        h("div", { class: "tex-btns" },
          h("button", { class: "small", disabled: !x.supported, onclick: () => msTexExport(x.index, "png") }, "PNG"),
          h("button", { class: "small", disabled: !x.supported, onclick: () => msTexExport(x.index, "dds") }, "DDS"),
          h("button", { class: "small primary", disabled: !x.supported, onclick: () => msTexReplace(x) }, L("Ersetzen…", "Replace…"))))));
  }
  el.append(grid);
}
function msTexView(x) {
  modal(x.name, h("div", {}, h("img", { src: `vps://ytd/?id=${MS.tex.id}&i=${x.index}&size=2048&v=${MS.tex.ver}`, style: "max-width:100%;max-height:70vh;display:block;margin:auto;background:repeating-conic-gradient(#222 0 25%, #2c2c2c 0 50%) 0 0/20px 20px" }),
    h("p", { class: "muted" }, `${x.width}×${x.height} · ${x.format} · ${x.levels} mips`)), [
    [L("Ersetzen…", "Replace…"), () => { msTexReplace(x); return true; }, "primary"], [L("Schließen", "Close"), () => true]]);
}
async function msTexExport(index, as) {
  try { const r = await api("/api/ms/ytdexport", { id: MS.tex.id, index, as, all: index == null }); toast(L(`${r.files} exportiert`, `${r.files} exported`), true); window.vps.openPath(r.dir); }
  catch (e) { toast(e.message); }
}
async function msTexReplace(x) {
  const f = await window.vps.pickFiles({ title: L("Bild für ", "Picture for ") + x.name, filters: [{ name: L("Bilder", "Images"), extensions: ["png", "jpg", "jpeg", "bmp", "dds"] }] });
  if (!f.length) return;
  toast(L("Kodiere Textur…", "Encoding texture…"));
  try { MS.tex = await api("/api/ms/ytdreplace", { id: MS.tex.id, index: x.index, file: f[0] }); msRender(); toast(L(`${x.name} ersetzt – noch speichern`, `${x.name} replaced – remember to save`), true); }
  catch (e) { toast(e.message); }
}
async function msTexSave() {
  try {
    const r = await api("/api/ms/ytdsave", { id: MS.tex.id });
    MS.tex = await api("/api/ms/ytdstate", { id: MS.tex.id });
    toast(r.override ? L(`Gespeichert als eigene Datei „${r.file}“ – ersetzt im Pack das Original`, `Saved as own file "${r.file}" – replaces the original in the pack`) : L(`Gespeichert: ${r.file}`, `Saved: ${r.file}`), true);
    MS.proj = await api("/api/ms/project"); MS.conflicts = await api("/api/ms/conflicts"); msRender();
  } catch (e) { toast(e.message); }
}

// ============================================================ fusion
MS.fusion = { mods: [], choose: {}, extra: {}, data: null, filter: "", own: true };
async function msFusionLoad() {
  if (!MS.fusion.mods.length) { MS.fusion.data = null; return; }
  MS.fusion.data = await api("/api/ms/fusion", { mods: MS.fusion.mods });
  // default: rows only one mod has -> that mod; shared rows -> last selected mod (can be changed)
  for (const r of MS.fusion.data.rows) {
    const owners = MS.fusion.mods.filter(m => r.have[m]);
    if (!(r.key in MS.fusion.choose) || (MS.fusion.choose[r.key] && !owners.includes(MS.fusion.choose[r.key]))) MS.fusion.choose[r.key] = owners[owners.length - 1] || "";
  }
}
function msFusionTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  const usable = MS.proj.mods.filter(m => m.info.readable && m.info.oiv);
  const prot = MS.proj.mods.filter(m => !m.info.readable);
  el.append(h("div", { class: "card" }, h("h3", {}, L("Mods fusionieren", "Fuse mods")),
    h("p", {}, L("Wähle zwei oder mehr Mods. Danach entscheidest du pro Datei, von welcher Mod sie kommen soll – oder ob sie wegfällt. Am Ende wird alles geprüft und als ein neues Pack exportiert.",
      "Pick two or more mods. Then decide per file which mod it should come from – or drop it. At the end everything is checked and exported as one new pack.")),
    h("div", { class: "fu-pick" }, usable.map(m => {
      const on = MS.fusion.mods.includes(m.file);
      return h("button", { class: "fu-chip" + (on ? " on" : ""), onclick: async () => { MS.fusion.mods = on ? MS.fusion.mods.filter(x => x !== m.file) : [...MS.fusion.mods, m.file]; await msFusionLoad(); msRender(); } },
        (on ? "✓ " : "+ ") + mname(m.file), h("small", {}, ` ${m.info.ops.length}`));
    })),
    prot.length ? h("p", { class: "muted small" }, L("Nicht fusionierbar (geschützt): ", "Cannot be fused (protected): ") + prot.map(m => m.file).join(", ")) : null));
  const d = MS.fusion.data;
  if (!d || MS.fusion.mods.length < 1) { el.append(h("div", { class: "empty" }, L("Oben Mods antippen, die du kombinieren willst.", "Tap the mods you want to combine above."))); return; }
  const mods = MS.fusion.mods;
  const letter = i => String.fromCharCode(65 + i);
  const short = f => mname(f);
  // legend + global buttons
  el.append(h("div", { class: "toolbar fu-legend" },
    ...mods.map((m, i) => h("span", { class: "fu-tag t" + (i % 6) }, letter(i) + " = " + short(m))),
    h("div", { class: "spacer" }),
    h("input", { type: "search", placeholder: L("Dateien filtern…", "Filter files…"), value: MS.fusion.filter, oninput: e => { MS.fusion.filter = e.target.value; drawRows(); } })));
  el.append(h("div", { class: "toolbar" }, h("b", {}, L("Alles auf einmal: ", "Everything at once: ")),
    ...mods.map((m, i) => h("button", { class: "small", onclick: () => { for (const r of d.rows) if (r.have[m]) MS.fusion.choose[r.key] = m; drawRows(); } }, L("alles von ", "all from ") + letter(i))),
    h("button", { class: "small", onclick: () => { for (const r of d.rows) { const o = mods.filter(m => r.have[m]); MS.fusion.choose[r.key] = o[o.length - 1]; } drawRows(); } }, L("Standard (später gewinnt)", "Default (later wins)"))));
  const rowsBox = h("div"); el.append(rowsBox);
  const drawRows = () => {
    rowsBox.innerHTML = "";
    const q = MS.fusion.filter.toLowerCase();
    const cats = new Map();
    for (const r of d.rows) { if (q && !(r.target + " " + r.archive).toLowerCase().includes(q)) continue; if (!cats.has(r.category)) cats.set(r.category, []); cats.get(r.category).push(r); }
    for (const [cat, rows] of cats) {
      const shared = rows.filter(r => mods.filter(m => r.have[m]).length > 1).length;
      const cb = h("div", { class: "cb" });
      const box = h("div", { class: "cat" + (rows.length > 60 && !q ? " closed" : "") },
        h("div", { class: "ch", onclick: () => box.classList.toggle("closed") }, h("span", {}, cat.toUpperCase()),
          h("span", { class: "muted" }, `${rows.length} ${L("Dateien", "files")}${shared ? " · " + shared + " " + L("in mehreren Mods", "in several mods") : ""}`)), cb);
      cb.append(h("div", { class: "toolbar fu-catbtns" }, h("span", { class: "muted small" }, L("Bereich: ", "Section: ")),
        ...mods.map((m, i) => h("button", { class: "small", onclick: () => { for (const r of rows) if (r.have[m]) MS.fusion.choose[r.key] = m; drawRows(); } }, L("alles von ", "all from ") + letter(i))),
        h("button", { class: "small", onclick: () => { for (const r of rows) MS.fusion.choose[r.key] = ""; drawRows(); } }, L("Bereich weglassen", "Drop section"))));
      for (const r of rows.slice(0, 500)) {
        const cur = MS.fusion.choose[r.key];
        cb.append(h("div", { class: "fu-row" + (cur ? "" : " off") },
          h("div", { class: "nm" }, h("b", {}, r.target), h("small", {}, r.archive)),
          h("div", { class: "fu-choice" },
            ...mods.map((m, i) => r.have[m]
              ? h("button", { class: "fu-btn t" + (i % 6) + (cur === m ? " on" : ""), "data-tip": short(m) + (r.have[m].source ? " ← " + r.have[m].source : ""), onclick: () => { MS.fusion.choose[r.key] = m; drawRows(); } }, letter(i))
              : h("span", { class: "fu-none" }, "·")),
            h("button", { class: "fu-btn x" + (!cur ? " on" : ""), "data-tip": L("Diese Datei weglassen", "Leave this file out"), onclick: () => { MS.fusion.choose[r.key] = ""; drawRows(); } }, "✕"))));
      }
      if (rows.length > 500) cb.append(h("div", { class: "muted" }, L(`… ${rows.length - 500} weitere – Filter benutzen`, `… ${rows.length - 500} more – use the filter`)));
      rowsBox.append(box);
    }
    if (d.extras.length) {
      const cb = h("div", { class: "cb" });
      cb.append(h("p", { class: "muted small" }, L("Diese Änderungen bearbeiten Dateien direkt (z. B. XML-Einträge). Sie werden nacheinander ausgeführt.", "These changes edit files directly (e.g. XML entries). They are applied one after another.")));
      for (const x of d.extras) cb.append(h("label", { class: "chk" }, h("input", { type: "checkbox", checked: MS.fusion.extra[x.key] !== false, onchange: e => { MS.fusion.extra[x.key] = e.target.checked; } }),
        " ", h("span", { class: "fu-tag t" + (mods.indexOf(x.mod) % 6) }, letter(mods.indexOf(x.mod))), " ", x.kind, " ", h("b", {}, x.target), h("span", { class: "muted small" }, "  " + x.archive)));
      rowsBox.append(h("div", { class: "cat" }, h("div", { class: "ch" }, h("span", {}, L("SONDER-ÄNDERUNGEN", "SPECIAL CHANGES")), h("span", { class: "muted" }, d.extras.length)), cb));
    }
    sumEl.textContent = msFusionSummary();
  };
  const name = h("input", { value: MS.fusion.name || mods.map(short).join(" + ").slice(0, 60), style: "flex:1", oninput: e => (MS.fusion.name = e.target.value) });
  const own = h("input", { type: "checkbox", checked: MS.fusion.own, onchange: e => (MS.fusion.own = e.target.checked) });
  const sumEl = h("span", { class: "muted" });
  el.append(h("div", { class: "card fu-export" }, h("h3", {}, L("Prüfen & exportieren", "Check & export")),
    h("div", { class: "toolbar" }, h("label", {}, L("Name", "Name")), name),
    h("label", { class: "chk" }, own, " ", L("Meine eigenen Dateien (z. B. bearbeitete Texturen) mit einbauen", "Include my own files (e.g. edited textures)")),
    h("p", {}, sumEl),
    h("div", { class: "toolbar" },
      h("button", { onclick: () => msFusionRun(false, name.value) }, L("Nur prüfen", "Check only")),
      h("button", { class: "primary", onclick: () => msFusionRun(true, name.value) }, L("Prüfen & exportieren", "Check & export")))));
  drawRows();
}
function msFusionSummary() {
  const d = MS.fusion.data; if (!d) return "";
  const count = {}; let dropped = 0;
  for (const r of d.rows) { const c = MS.fusion.choose[r.key]; if (c) count[c] = (count[c] || 0) + 1; else dropped++; }
  return MS.fusion.mods.map((m, i) => `${String.fromCharCode(65 + i)}: ${count[m] || 0}`).join(" · ") + ` · ${L("weggelassen", "dropped")}: ${dropped}`;
}
function msSelection() {
  return { mods: MS.fusion.mods, choose: { ...MS.fusion.choose }, extra: { ...MS.fusion.extra }, own: MS.fusion.own };
}
async function msFusionRun(build, name) {
  toast(build ? L("Prüfe und baue…", "Checking and building…") : L("Prüfe…", "Checking…"));
  try {
    if (!build) { const v = await api("/api/ms/validate", { selection: msSelection(), name }); msReport(v, null); return; }
    const r = await api("/api/ms/build", { selection: msSelection(), name });
    if (r.ok === false) { msReport(r.report, null); return; }
    MS.proj = await api("/api/ms/project");
    msReport({ ok: true, errors: [], warnings: [], stats: { files: r.files, mods: r.mods } }, r);
  } catch (e) { toast(e.message); }
}
function msReport(v, built) {
  const body = h("div", { class: "report" });
  if (built) body.append(h("p", { class: "ok" }, "✓ " + L(`Pack „${built.name}“ gebaut (${fmtSize(built.size)}, ${built.files} Dateien).`, `Pack "${built.name}" built (${fmtSize(built.size)}, ${built.files} files).`)),
    h("p", { class: built.verified?.ok ? "ok" : "bad" }, built.verified?.ok ? "✓ " + L(`Nachkontrolle: alle ${built.verified.sources} Quellen im Pack vorhanden, assembly.xml gültig.`, `Post-check: all ${built.verified.sources} sources present, assembly.xml valid.`) : "✕ " + (built.verified?.problems || []).join(" · ")));
  else body.append(h("p", { class: v.ok ? "ok" : "bad" }, v.ok ? "✓ " + L("Keine Fehler gefunden – das Pack kann gebaut werden.", "No errors found – the pack can be built.") : "✕ " + L(`${v.errors.length} Fehler – so wird kein Pack gebaut.`, `${v.errors.length} errors – no pack will be built like this.`)));
  if (v.stats) body.append(h("p", { class: "muted" }, `${v.stats.mods} Mods · ${v.stats.files} ${L("Dateien", "files")}${v.stats.bytes ? " · ~" + fmtSize(v.stats.bytes) : ""}`));
  if (v.errors?.length) { body.append(h("h4", {}, L("Fehler", "Errors"))); v.errors.forEach(e => body.append(h("div", { class: "rep-row bad" }, "✕ " + e))); }
  if (v.warnings?.length) { body.append(h("h4", {}, L("Hinweise", "Notes"))); v.warnings.forEach(e => body.append(h("div", { class: "rep-row wrn" }, "! " + e))); }
  const btns = [[L("Schließen", "Close"), () => true]];
  if (built && MS.state.liveExists) btns.unshift([L("In FiveM kopieren…", "Copy to FiveM…"), () => { msInstallConfirm(built.name); return true; }, "primary"]);
  modal(built ? L("Export fertig", "Export done") : L("Prüfbericht", "Check report"), body, btns);
}

// ============================================================ hooks into the existing Mod-Studio UI
const _msRender = msRender;
msRender = function () {
  _msRender();
  const nav = $(".ms-tabs");
  if (nav) {
    const add = (k, l, before) => { const b = h("button", { class: MS.tab === k ? "on" : "", onclick: () => { MS.tab = k; msRender(); } }, l); before ? nav.insertBefore(b, before) : nav.append(b); };
    const buildBtn = [...nav.children].find(b => b.textContent.startsWith(L("Pack bauen", "Build pack")));
    add("fusion", L("Fusionieren", "Fuse"), buildBtn);
    add("tex", L("Texturen", "Textures") + (MS.tex?.changed.length ? " •" : ""), buildBtn);
  }
  const body = $(".ms-body");
  if (body && (MS.tab === "tex" || MS.tab === "fusion") && MS.state?.workspace && MS.proj) {
    body.innerHTML = "";
    (MS.tab === "tex" ? msTexTab : msFusionTab)(body);
  }
};
// re-hook after each file list redraw (the list is redrawn on search)
const _observer = new MutationObserver(() => {
  if (document.body.dataset.mode !== "mods" || MS.tab !== "mods") return;
  for (const row of $$(".ms-file")) {
    if (row.dataset.tex) continue; row.dataset.tex = "1";
    const p = row.querySelector(".fp")?.textContent || "";
    if (/\.ytd$/i.test(p) && !/\.rpf\//i.test(p) && !row.querySelector("button")) row.append(h("button", { class: "small", onclick: e => { e.preventDefault(); e.stopPropagation(); msOpenYtd({ mod: MS.sel, path: p }); } }, L("Texturen", "Textures")));
  }
});
_observer.observe(document.body, { childList: true, subtree: true });
const _msOwnTab = msOwnTab;
msOwnTab = function (body) {
  _msOwnTab(body);
  (MS.proj.overrides || []).forEach((o, i) => {
    if (!/\.ytd$/i.test(o.file)) return;
    const card = $$(".ms-body .card")[i + 1];
    if (card) card.insertBefore(h("button", { class: "small primary", onclick: () => msOpenYtd({ own: o.file }) }, L("Texturen bearbeiten", "Edit textures")), card.lastChild);
  });
};
// build tab: show validation report on failure + post-check result
const _msBuildTab = msBuildTab;
msBuildTab = function (body) {
  _msBuildTab(body);
  const btn = [...$$(".ms-body button.primary")].find(b => b.textContent === L("Pack bauen", "Build pack"));
  if (!btn) return;
  const form = btn.closest(".card");
  btn.onclick = async e => {
    e.target.disabled = true;
    const inputs = form.querySelectorAll("input, textarea");
    try {
      const r = await api("/api/ms/build", { name: inputs[0].value, version: inputs[1].value, author: inputs[2].value, description: inputs[3].value, dropLosers: inputs[4].checked });
      if (r.ok === false) { msReport(r.report, null); e.target.disabled = false; return; }
      await msLoad(); msReport({ ok: true, errors: [], warnings: r.blocked.length ? [L("Nicht im Pack: ", "Not in pack: ") + r.blocked.join(", ")] : [], stats: { files: r.files, mods: r.mods } }, r);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
};

// remote commands
Object.assign(REMOTE, {
  msYtdOpen: { help: "{mod, path} | {own} | {disk} YTD öffnen – liefert Textur-Liste und Session-id", run: async a => { MS.tex = await api("/api/ms/ytdopen", a); MS.tab = "tex"; setMode("mods"); msRender(); return MS.tex; } },
  msYtdExport: { help: "{id, index?|all, as: png|dds} Texturen exportieren", run: a => api("/api/ms/ytdexport", { ...a, all: a.all || a.index == null }) },
  msYtdReplace: { help: "{id, index, file} Textur durch Bild/DDS ersetzen (Größe/Format werden angepasst)", run: async a => { MS.tex = await api("/api/ms/ytdreplace", a); msRender(); return MS.tex; } },
  msYtdSave: { help: "{id} geänderte YTD als eigene Datei speichern (ersetzt im Pack das Original)", run: async a => { const r = await api("/api/ms/ytdsave", a); await msLoad(); return r; } },
  msFusion: { help: "{mods:[files]} Fusionsdaten: alle Dateien der Mods nach Bereichen, wer was hat", run: async a => { MS.fusion.mods = a.mods || []; await msFusionLoad(); MS.tab = "fusion"; setMode("mods"); msRender(); return { ...MS.fusion.data, choose: MS.fusion.choose }; } },
  msFusionChoose: { help: "{choose:{key: file|''}, extra?:{key:bool}} Auswahl setzen (leer = weglassen)", run: a => { Object.assign(MS.fusion.choose, a.choose || {}); Object.assign(MS.fusion.extra, a.extra || {}); if (MS.tab === "fusion") msRender(); return { summary: msFusionSummary() }; } },
  msValidate: { help: "{selection?} Fusion bzw. Pack prüfen (ohne selection = normales Pack)", run: a => api("/api/ms/validate", a.selection ? a : (MS.fusion.mods.length ? { selection: msSelection() } : {})) },
  msFusionBuild: { help: "{name} aktuelle Fusion prüfen und als Pack bauen", run: async a => { const r = await api("/api/ms/build", { selection: msSelection(), name: a.name || "Fusion" }); MS.proj = await api("/api/ms/project"); return r; } },
});

// ============================================================ 1.4.1: folder explorer, found-mods offer, in-place use
MS.dir = "";
MS.found = [];
async function msScan() { try { MS.found = await api("/api/ms/scan"); } catch { MS.found = []; } }
const _msLoad = msLoad;
msLoad = async function () {
  await msScan();
  await _msLoad();
};
const _msInit = msInit;
msInit = async function () {
  await _msInit();
  if (MS.proj && !MS.proj.mods.length && MS.found.length && MS.tab === "mods") { MS.tab = "folder"; msRender(); }
};
function msFoundBanner() {
  if (!MS.found.length) return null;
  const rpfs = MS.found.filter(f => f.kind === "rpf"), oivs = MS.found.filter(f => f.kind !== "rpf");
  return h("div", { class: "found-banner" },
    h("div", {}, h("b", {}, L(`${MS.found.length} Mod(s) in diesem Ordner gefunden`, `${MS.found.length} mod(s) found in this folder`)),
      h("div", { class: "muted small" }, [rpfs.length ? `${rpfs.length} RPF (${L("werden direkt benutzt, nichts wird kopiert", "used in place, nothing copied")})` : "", oivs.length ? `${oivs.length} OIV/${L("Ordner", "folder")} (${L("werden in eine Mod umgewandelt", "converted into a mod")})` : ""].filter(Boolean).join(" · "))),
    h("div", { class: "spacer" }),
    h("button", { class: "small", onclick: () => { MS.tab = "folder"; msRender(); } }, L("Liste ansehen", "View list")),
    h("button", { class: "small primary", onclick: msTakeAllFound }, L("Alle übernehmen", "Take all")),
    h("button", { class: "small st-link", onclick: async () => { await api("/api/ms/hide", { files: MS.found.map(f => f.rel) }); MS.found = []; msRender(); } }, L("ausblenden", "hide")));
}
async function msTakeAllFound() {
  const rpfs = MS.found.filter(f => f.kind === "rpf").map(f => f.rel);
  const others = MS.found.filter(f => f.kind !== "rpf").map(f => MS.state.workspace + "\\" + f.rel.replace(/\//g, "\\"));
  try {
    let n = 0;
    if (rpfs.length) n += (await api("/api/ms/useinplace", { files: rpfs })).filter(x => x.file).length;
    if (others.length) n += (await api("/api/ms/import", { files: others })).filter(x => x.file).length;
    toast(L(`${n} Mod(s) übernommen`, `${n} mod(s) added`), true);
    MS.tab = "mods"; MS.sel = null; await msLoad();
  } catch (e) { toast(e.message); }
}
async function msFolderTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  const ban = msFoundBanner(); if (ban) el.append(ban);
  let data; try { data = await api("/api/ms/browse", { dir: MS.dir }); } catch (e) { MS.dir = ""; el.append(h("div", { class: "empty" }, e.message)); return; }
  const parts = data.dir ? data.dir.split("/") : [];
  const crumbs = h("div", { class: "crumbs" },
    h("button", { class: "small" + (parts.length ? "" : " on"), onclick: () => { MS.dir = ""; msRender(); } }, "📁 " + MS.state.workspace.split(/[\\/]/).pop()),
    ...parts.map((p, i) => [h("span", { class: "muted" }, "›"), h("button", { class: "small" + (i === parts.length - 1 ? " on" : ""), onclick: () => { MS.dir = parts.slice(0, i + 1).join("/"); msRender(); } }, p)]).flat(),
    h("div", { class: "spacer" }),
    parts.length ? h("button", { class: "small", onclick: () => { MS.dir = parts.slice(0, -1).join("/"); msRender(); } }, L("↑ Hoch", "↑ Up")) : null,
    h("button", { class: "small", onclick: () => window.vps.openPath(MS.state.workspace + (data.dir ? "\\" + data.dir.replace(/\//g, "\\") : "")) }, L("Im Explorer öffnen", "Open in Explorer")));
  el.append(crumbs);
  if (!data.items.length) { el.append(h("div", { class: "empty" }, L("Ordner ist leer.", "Folder is empty."))); return; }
  const ICON = { dir: "📁", foldermod: "🧩", rpf: "📦", oiv: "🧩", ytd: "🖼️", image: "🖼️", text: "📄", zip: "🗜️", other: "📄" };
  const abs = it => MS.state.workspace + "\\" + it.rel.replace(/\//g, "\\");
  const idOf = it => /^mods\//i.test(it.rel) && it.rel.split("/").length === 2 ? it.name : it.rel;
  const list = h("div", { class: "fb-list" });
  for (const it of data.items) {
    const acts = [];
    if (it.kind === "rpf") {
      if (it.inProject) { acts.push(h("span", { class: "badge pack" }, L("✓ im Projekt", "✓ in project")), h("button", { class: "small", onclick: e => { e.stopPropagation(); MS.sel = idOf(it); MS.tree = null; MS.tab = "mods"; msRender(); } }, L("Anzeigen", "Show"))); }
      else acts.push(h("button", { class: "small primary", "data-tip": L("Wird direkt aus diesem Ordner gelesen – keine Kopie, nichts wird verändert", "Read directly from this folder – no copy, nothing changed"), onclick: async e => { e.stopPropagation(); const r = await api("/api/ms/useinplace", { files: [it.rel] }); if (r[0]?.error) toast(r[0].error); else { toast(L("Übernommen", "Added"), true); await msLoad(); } } }, L("Benutzen", "Use")));
    } else if (it.kind === "oiv" || it.kind === "foldermod" || it.kind === "zip") {
      acts.push(h("button", { class: "small primary", "data-tip": L("Wird in eine Mod (RPF) im Ordner „Mods“ umgewandelt – das Original bleibt", "Converted into a mod (RPF) in the Mods folder – the original stays"), onclick: async e => { e.stopPropagation(); await msImport([abs(it)]); } }, L("Als Mod übernehmen", "Add as mod")));
    } else if (it.kind === "ytd") acts.push(h("button", { class: "small", onclick: e => { e.stopPropagation(); msOpenYtd({ disk: abs(it) }); } }, L("Texturen", "Textures")));
    if (!it.dir && it.kind !== "rpf") acts.push(h("button", { class: "small st-link", onclick: e => { e.stopPropagation(); window.vps.openPath(abs(it)); } }, L("Öffnen", "Open")));
    if (it.dir && it.kind === "foldermod") acts.push(h("button", { class: "small st-link", onclick: e => { e.stopPropagation(); MS.dir = it.rel; msRender(); } }, L("Hineinschauen", "Look inside")));
    list.append(h("div", { class: "fb-row" + (it.dir ? " is-dir" : "") + (it.own ? " own" : ""), onclick: () => { if (it.dir) { MS.dir = it.rel; msRender(); } } },
      h("span", { class: "fb-ic" }, ICON[it.kind] || "📄"),
      h("div", { class: "nm" }, h("b", {}, it.name), it.own ? h("small", {}, L("Ordner von VELOX Mod-Studio", "VELOX Mod-Studio folder")) : it.kind === "foldermod" ? h("small", {}, L("entpacktes OIV-Paket", "unpacked OIV package")) : null),
      h("span", { class: "muted small" }, it.dir ? "" : fmtSize(it.size)),
      h("div", { class: "fb-acts" }, acts)));
  }
  el.append(list);
}
const _msRender2 = msRender;
msRender = function () {
  _msRender2();
  const nav = $(".ms-tabs");
  if (nav && !nav.querySelector('[data-k="folder"]')) {
    const b = h("button", { "data-k": "folder", class: MS.tab === "folder" ? "on" : "", onclick: () => { MS.tab = "folder"; msRender(); } }, L("Ordner", "Folder"));
    nav.prepend(b);
    if (MS.tab === "folder") [...nav.children].forEach(x => x !== b && x.classList.remove("on"));
  }
  const body = $(".ms-body");
  if (body && MS.tab === "folder" && MS.state?.workspace && MS.proj) { body.innerHTML = ""; msFolderTab(body); }
  if (body && MS.tab === "mods" && MS.found.length) { const left = $(".ms-left"); const ban = msFoundBanner(); if (left && ban) left.prepend(ban); }
};
