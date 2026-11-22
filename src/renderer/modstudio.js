"use strict";
// VELOX Mod-Studio UI + start screen. Everything happens inside the chosen workspace folder;
// the live FiveM mods folder is only read / copied from.

const MS = { state: null, proj: null, sel: null, tab: "mods", ops: null, tree: null, treeFilter: "", treeSel: new Set(), progress: null, conflicts: [] };
const mname = f => String(f || "").split(/[\\/]/).pop().replace(/\.rpf$/i, "");
const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : b + " B";
const ENC_LABEL = () => ({ open: L("lesbar", "readable"), none: L("lesbar", "readable"), cfxp: L("geschützt (Cfx)", "protected (Cfx)"), aes: L("verschlüsselt", "encrypted"), ng: L("verschlüsselt", "encrypted"), unknown: L("unbekannt", "unknown") });

// ============================================================ modes / start screen
function setMode(m) {
  document.body.dataset.mode = m;
  localStorage.setItem("lastMode", m);
  if (m === "mods") msInit();
  if (m === "presets") { updateStatus(); }
  msStatus();
}
function renderHome() {
  const el = $("#home"); el.innerHTML = "";
  const tile = (mode, icon, title, sub, points) => h("div", { class: "home-tile", onclick: () => setMode(mode) },
    h("div", { class: "ht-icon" }, icon), h("div", { class: "ht-title" }, title), h("div", { class: "ht-sub" }, sub),
    h("ul", {}, points.map(p => h("li", {}, p))));
  el.append(
    h("div", { class: "home-brand" }, h("img", { src: "assets/logo.svg" }), h("div", {}, h("div", { class: "hb-name" }, "VELOX"), h("div", { class: "hb-sub" }, "PRESET STUDIO"))),
    h("div", { class: "home-q" }, L("Was möchtest du machen?", "What do you want to do?")),
    h("div", { class: "home-tiles" },
      tile("presets", "🎚️", L("ReShade-Presets", "ReShade presets"), L("Eigene Presets bauen und testen", "Build and test your own presets"),
        [L("Regler für jeden Shader", "Sliders for every shader"), L("Looks, Mischen, Vergleichen", "Looks, mixing, compare"), L("Galerie, Pakete, Backups", "Gallery, packs, backups")]),
      tile("mods", "🧩", L("Mod-Studio", "Mod-Studio"), L("Grafikmods zusammenstellen und eigene Packs bauen", "Combine graphics mods and build your own packs"),
        [L("RPF / OIV öffnen und durchsuchen", "Open and browse RPF / OIV"), L("Konflikte zwischen Mods erkennen", "Detect conflicts between mods"), L("Eigenes Mod-Pack als RPF bauen", "Build your own mod pack as RPF")])),
    h("div", { class: "home-foot muted" }, L("Tipp: Oben links auf das VELOX-Logo klicken, um hierher zurückzukommen.", "Tip: click the VELOX logo at the top left to come back here.")));
}
$$(".brand").forEach(b => { b.style.cursor = "pointer"; b.title = L("Startseite", "Home"); b.addEventListener("click", () => setMode("home")); });

// ============================================================ progress
window.vps.onMsProgress(p => {
  MS.progress = p;
  const bar = $("#msProgress");
  if (!bar) return;
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  bar.classList.toggle("hidden", p.done >= p.total);
  bar.querySelector(".pg-fill").style.width = pct + "%";
  bar.querySelector(".pg-lab").textContent = `${p.label} … ${p.total > 100000 ? fmtSize(p.done) + " / " + fmtSize(p.total) : p.done + " / " + p.total}`;
});

// ============================================================ main render
async function msInit() {
  try { MS.state = await api("/api/ms/state"); } catch (e) { toast(e.message); return; }
  if (MS.state.workspace) await msLoad(); else msRender();
}
async function msLoad() {
  try { MS.proj = await api("/api/ms/project"); MS.conflicts = await api("/api/ms/conflicts"); } catch (e) { toast(e.message); MS.proj = null; }
  if (MS.sel && !MS.proj?.mods.some(m => m.file === MS.sel)) MS.sel = null;
  if (!MS.sel && MS.proj?.mods.length) MS.sel = MS.proj.mods[0].file;
  msRender();
}
function msStatus() {
  const mode = document.body.dataset.mode;
  if (mode === "mods") { $("#stFolder").textContent = MS.state?.workspace ? L("Arbeitsordner: ", "Workspace: ") + MS.state.workspace : L("Kein Arbeitsordner", "No workspace"); }
  else if (mode === "presets") updateStatus();
  else $("#stFolder").textContent = "";
}
function msRender() {
  msStatus();
  const root = $("#ms"); root.innerHTML = "";
  const tabs = [["mods", L("Mods", "Mods")], ["conflicts", L("Konflikte", "Conflicts") + (MS.conflicts.length ? ` (${MS.conflicts.length})` : "")], ["own", L("Eigene Dateien", "Own files")], ["build", L("Pack bauen", "Build pack")]];
  root.append(h("header", { class: "ms-top" },
    h("div", { class: "brand", title: L("Startseite", "Home"), onclick: () => setMode("home") }, h("img", { src: "assets/logo.svg", class: "logo" }), h("span", {}, "VELOX"), h("small", {}, "MOD-STUDIO")),
    MS.state?.workspace ? h("nav", { class: "ms-tabs" }, tabs.map(([k, l]) => h("button", { class: MS.tab === k ? "on" : "", onclick: () => { MS.tab = k; msRender(); } }, l))) : null,
    h("div", { class: "spacer drag" }),
    MS.state?.workspace ? h("button", { class: "small", onclick: msWorkspaceModal }, "📁 " + MS.state.workspace.split(/[\\/]/).pop()) : null,
    h("button", { class: "small", onclick: () => setMode("presets") }, L("→ ReShade-Presets", "→ ReShade presets"))));
  root.append(h("div", { id: "msProgress", class: "ms-progress hidden" }, h("div", { class: "pg-fill" }), h("span", { class: "pg-lab" })));
  const body = h("div", { class: "ms-body" }); root.append(body);
  if (!MS.state?.workspace) { body.append(msWelcome()); return; }
  if (!MS.proj) { body.append(h("div", { class: "empty" }, L("Arbeitsordner konnte nicht geladen werden.", "Could not load workspace."))); return; }
  const tabFn = ({ mods: msModsTab, conflicts: msConflictsTab, own: msOwnTab, build: msBuildTab })[MS.tab];
  if (tabFn) tabFn(body);
}

// ============================================================ workspace
function msWelcome() {
  const name = h("input", { placeholder: L("z. B. Mein Grafikpack", "e.g. My graphics pack"), style: "flex:1" });
  return h("div", { class: "ms-welcome" },
    h("h2", {}, L("Arbeitsordner wählen", "Choose a workspace")),
    h("p", { class: "muted" }, L("Das Mod-Studio arbeitet nur in seinem eigenen Ordner. Mods, die du hinzufügst, werden dorthin kopiert – deine Originale (auch dein FiveM-mods-Ordner) werden nie verändert.",
      "The Mod-Studio only works in its own folder. Mods you add are copied there – your originals (including your FiveM mods folder) are never changed.")),
    h("div", { class: "card" }, h("h3", {}, L("Neuen Arbeitsordner anlegen", "Create a new workspace")),
      h("div", { class: "toolbar" }, name, h("button", { class: "primary", onclick: async () => {
        const n = name.value.trim(); if (!n) { toast(L("Bitte Namen eingeben", "Enter a name")); return; }
        await msOpen(MS.state.docs + "\\" + n.replace(/[<>:"/\\|?*]/g, ""), true);
      } }, L("Anlegen", "Create"))),
      h("p", { class: "muted small" }, L("Wird angelegt in: ", "Created in: ") + MS.state.docs)),
    h("div", { class: "card" }, h("h3", {}, L("Vorhandenen Ordner öffnen", "Open an existing folder")),
      h("button", { onclick: async () => { const d = await window.vps.pickDir(L("Arbeitsordner wählen", "Choose workspace")); if (d) msOpen(d, false); } }, L("Ordner wählen…", "Choose folder…")),
      (MS.state.recent || []).length ? h("div", { style: "margin-top:10px" }, MS.state.recent.map(r => h("div", { class: "tech", onclick: () => msOpen(r, false) }, r))) : null));
}
async function msOpen(dir, create) {
  try { await api("/api/ms/open", { dir, create }); MS.sel = null; MS.tab = "mods"; await msInit(); toast(L("Arbeitsordner geöffnet", "Workspace opened"), true); }
  catch (e) { toast(e.message); }
}
function msWorkspaceModal() {
  const box = h("div", {},
    h("p", {}, h("b", {}, MS.state.workspace)),
    h("div", { class: "toolbar" },
      ...[["ws", L("Arbeitsordner", "Workspace")], ["mods", "Mods"], ["export", "Export"], ["packs", "Packs"], ["own", L("Eigene Dateien", "Own files")]].map(([w, l]) =>
        h("button", { class: "small", onclick: async () => { const r = await api("/api/ms/folder", { what: w }); window.vps.openPath(r.path); } }, "📂 " + l))),
    h("h4", {}, L("Anderen Arbeitsordner", "Other workspace")),
    h("button", { onclick: () => { MS.state.workspace = ""; $(".modal-box .mh button").click(); msRender(); } }, L("Wechseln / neu anlegen…", "Switch / create…")));
  modal(L("Arbeitsordner", "Workspace"), box, [[L("Schließen", "Close"), () => true]]);
}

// ============================================================ Mods tab
function msModsTab(body) {
  const left = h("div", { class: "ms-left" }), right = h("div", { class: "ms-right" });
  body.append(left, right);
  left.append(h("div", { class: "ms-lhead" },
    h("b", {}, `${MS.proj.mods.length} Mods`),
    h("div", { class: "spacer" }),
    h("button", { class: "small primary", onclick: msAddFiles }, L("+ Dateien", "+ Files")),
    MS.state.liveExists ? h("button", { class: "small", onclick: msCopyLiveModal }, L("Aus FiveM kopieren", "Copy from FiveM")) : null));
  left.append(h("div", { class: "muted hint" }, L("Häkchen = kommt ins Pack · ziehen = Reihenfolge (unten gewinnt bei Konflikten) · Dateien einfach hierher ziehen", "Tick = goes into the pack · drag = order (lower wins conflicts) · drop files here")));
  const list = h("div", { class: "ms-modlist" }); left.append(list);
  const confMods = new Map();
  for (const c of MS.conflicts) for (const m of c.mods) confMods.set(m.mod, (confMods.get(m.mod) || 0) + 1);
  MS.proj.mods.forEach((m, i) => {
    const info = m.info; const encL = ENC_LABEL()[info.enc] || info.enc;
    const el = h("div", { class: "fx ms-mod" + (MS.sel === m.file ? " sel" : "") + (m.enabled ? "" : " off"), draggable: "true", onclick: () => { MS.sel = m.file; MS.tree = null; MS.treeSel.clear(); msRender(); } },
      h("span", { class: "grip" }, "⋮⋮"),
      h("div", { class: "nm" }, h("b", {}, mname(m.file)),
        h("small", {}, fmtSize(info.size) + (info.oiv ? ` · ${info.ops.length} ${L("Ersetzungen", "replacements")}` : "") + (info.inPlace ? " · " + L("vor Ort", "in place") : ""))),
      !info.readable ? h("span", { class: "badge logbad", "data-tip": L("Geschützt/verschlüsselt – Inhalt nicht lesbar, kann nicht ins Pack. Bleibt als einzelne Mod nutzbar.", "Protected/encrypted – content not readable, cannot go into a pack. Still usable as a single mod.") }, encL)
        : !info.oiv ? h("span", { class: "badge perf1", "data-tip": L("Kein OIV-Aufbau (assembly.xml fehlt) – nur ansehen und exportieren", "No OIV layout (assembly.xml missing) – browse and export only") }, L("ohne assembly", "no assembly")) : null,
      confMods.get(m.file) ? h("span", { class: "badge perf2", "data-tip": L("Hat Konflikte mit anderen Mods", "Conflicts with other mods") }, "⚡ " + confMods.get(m.file)) : null,
      h("label", { class: "tog", onclick: e => e.stopPropagation() }, h("input", { type: "checkbox", checked: m.enabled, disabled: !info.readable || !info.oiv, onchange: e => msSetMods(MS.proj.mods.map(x => x.file === m.file ? { ...x, enabled: e.target.checked } : x)) }), h("span", { class: "sw" })));
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/ms", String(i)); });
    el.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("text/ms")) { e.preventDefault(); el.classList.add("drag-over"); } });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", e => {
      const from = e.dataTransfer.getData("text/ms"); if (from === "") return;
      e.preventDefault(); e.stopPropagation(); el.classList.remove("drag-over");
      const mods = [...MS.proj.mods]; const [x] = mods.splice(+from, 1); mods.splice(+from < i ? i - 1 : i, 0, x); msSetMods(mods);
    });
    list.append(el);
  });
  if (!MS.proj.mods.length) list.append(h("div", { class: "empty" }, L("Noch keine Mods. „+ Dateien“ oder Dateien hierher ziehen (.rpf, .oiv, .zip).", "No mods yet. \"+ Files\" or drop files here (.rpf, .oiv, .zip).")));
  msModDetail(right);
}
async function msSetMods(mods) {
  try { await api("/api/ms/setmods", { mods: mods.map(m => ({ file: m.file, enabled: m.enabled, excluded: m.excluded })) }); await msLoad(); } catch (e) { toast(e.message); }
}
async function msAddFiles() {
  const files = await window.vps.pickFiles({ title: L("Mods hinzufügen (werden kopiert)", "Add mods (they are copied)"), filters: [{ name: "Mods", extensions: ["rpf", "oiv", "zip"] }] });
  if (files.length) msImport(files);
}
async function msImport(files) {
  try {
    const r = await api("/api/ms/import", { files });
    const ok = r.filter(x => x.file), bad = r.filter(x => x.error);
    if (ok.length) toast(L(`${ok.length} Mod(s) kopiert`, `${ok.length} mod(s) copied`) + (ok.some(x => x.converted) ? L(" (OIV umgewandelt)", " (OIV converted)") : ""), true);
    for (const b of bad) toast(b.from.split(/[\\/]/).pop() + ": " + b.error);
    if (ok.length) MS.sel = ok[ok.length - 1].file;
    await msLoad();
  } catch (e) { toast(e.message); }
}
async function msCopyLiveModal() {
  const live = await api("/api/ms/live");
  const checks = new Map();
  const total = h("b", {}, "0 B");
  const upd = () => { let s = 0; for (const [f, c] of checks) if (c.checked) s += live.mods.find(m => m.file === f).size; total.textContent = fmtSize(s); };
  const list = h("div", { class: "pkglist" }, live.mods.map(m => {
    const c = h("input", { type: "checkbox", disabled: m.inWorkspace, onchange: upd }); checks.set(m.file, c);
    return h("label", { class: "chk" }, c, " ", m.file, " ", h("span", { class: "muted small" }, fmtSize(m.size) + " · " + (ENC_LABEL()[m.enc] || m.enc) + (m.inWorkspace ? L(" · schon im Arbeitsordner", " · already in workspace") : "")));
  }));
  modal(L("Aus deinem FiveM-mods-Ordner kopieren", "Copy from your FiveM mods folder"), h("div", {},
    h("p", { class: "muted" }, L("Die gewählten Mods werden in den Arbeitsordner KOPIERT. Dein FiveM-Ordner bleibt unverändert.", "The selected mods are COPIED into the workspace. Your FiveM folder stays unchanged.")),
    h("p", { class: "muted small" }, live.dir), list, h("p", {}, L("Ausgewählt: ", "Selected: "), total)), [
    [L("Abbrechen", "Cancel"), () => true],
    [L("Kopieren", "Copy"), async () => {
      const files = [...checks].filter(([, c]) => c.checked).map(([f]) => f);
      if (!files.length) return false;
      try { const r = await api("/api/ms/copylive", { files }); toast(L(`${r.filter(x => x.file).length} Mod(s) kopiert`, `${r.filter(x => x.file).length} mod(s) copied`), true); await msLoad(); }
      catch (e) { toast(e.message); }
    }, "primary"]]);
}

async function msModDetail(box) {
  const m = MS.proj.mods.find(x => x.file === MS.sel);
  if (!m) { box.append(h("div", { class: "empty" }, L("Links eine Mod wählen.", "Pick a mod on the left."))); return; }
  const info = m.info;
  box.append(h("div", { class: "phead" },
    h("div", { class: "title" }, mname(m.file)),
    info.inPlace ? h("span", { class: "badge pack", "data-tip": L("Wird direkt aus deinem Ordner gelesen – nichts wird kopiert oder verändert", "Read directly from your folder – nothing is copied or changed") + "\n" + m.file }, L("vor Ort", "in place")) : null,
    h("span", { class: "muted" }, fmtSize(info.size)),
    info.meta?.author ? h("span", { class: "badge pack" }, info.meta.author) : null,
    info.meta?.version ? h("span", { class: "muted" }, "v" + info.meta.version) : null,
    h("div", { class: "spacer" }),
    info.readable ? h("button", { class: "small", onclick: () => msExport(m.file, [""]) }, L("Alles exportieren", "Export all")) : null,
    h("button", { class: "small danger", onclick: () => modal(info.inPlace ? L("Aus der Liste nehmen?", "Remove from list?") : L("Aus Arbeitsordner entfernen?", "Remove from workspace?"), h("p", {}, info.inPlace ? L("Die Mod wird nur aus der Liste genommen. Die Datei in deinem Ordner bleibt unverändert.", "The mod is only removed from the list. The file in your folder stays unchanged.") : L("Die KOPIE im Arbeitsordner wird gelöscht. Das Original bleibt, wo es ist.", "The COPY in the workspace is deleted. The original stays where it is.")), [[L("Abbrechen", "Cancel"), () => true], [L("Entfernen", "Remove"), async () => { await api("/api/ms/removemod", { file: m.file }); MS.sel = null; await msLoad(); }, "primary"]]) }, L("Entfernen", "Remove"))));
  if (info.meta?.description) box.append(h("div", { class: "pdesc" }, info.meta.description.slice(0, 600)));
  if (!info.readable) {
    box.append(h("div", { class: "card", style: "margin:16px" }, h("h3", {}, L("Inhalt nicht lesbar", "Content not readable")),
      h("p", {}, L("Diese Mod ist geschützt (" + (ENC_LABEL()[info.enc] || info.enc) + "). Sie lässt sich nicht öffnen und nicht in ein Pack zusammenführen – im Spiel funktioniert sie aber ganz normal als einzelne Datei.",
        "This mod is protected (" + (ENC_LABEL()[info.enc] || info.enc) + "). It cannot be opened or merged into a pack – in game it still works normally as a single file."))));
    return;
  }
  // replacements (OIV ops)
  if (info.oiv) {
    const confKeys = new Map(MS.conflicts.map(c => [c.key, c]));
    const ops = (await api("/api/ms/ops", { file: m.file })).ops;
    const cat = h("div", { class: "cat" }, h("div", { class: "ch" }, h("span", {}, L("ERSETZT IM SPIEL", "REPLACES IN GAME")), h("span", { class: "muted" }, ops.length)));
    const cb = h("div", { class: "cb" }); cat.append(cb);
    for (const o of ops.slice(0, 400)) {
      const ex = (m.excluded || []).includes(o.key);
      const c = confKeys.get(o.key);
      const win = c ? c.winner === m.file : true;
      cb.append(h("div", { class: "ms-op" + (ex ? " ex" : "") },
        h("label", { class: "tog", "data-tip": L("Im Pack verwenden", "Use in pack") }, h("input", { type: "checkbox", checked: !ex, disabled: o.kind !== "add" && o.kind !== "replace", onchange: async e => { await api("/api/ms/exclude", { file: m.file, key: o.key, on: !e.target.checked }); await msLoad(); } }), h("span", { class: "sw" })),
        h("div", { class: "nm" }, h("b", {}, o.targetRaw || o.target), h("small", {}, (o.archive ? o.archive + " · " : "") + o.kind + (o.source ? " ← " + o.source : ""))),
        c ? h("span", { class: "badge " + (win ? "pack" : "perf2"), "data-tip": c.mods.map(x => x.mod).join(" → ") }, win ? L("gewinnt", "wins") : L("verliert", "loses")) : null,
        (o.kind === "add" || o.kind === "replace") ? h("button", { class: "small", "data-tip": L("Eigene Datei für dieses Ziel nehmen (wird in den Arbeitsordner kopiert)", "Use your own file for this target (copied into the workspace)"), onclick: () => msOwnFor(m.file, o) }, L("Eigene Datei…", "Own file…")) : null));
    }
    if (ops.length > 400) cb.append(h("div", { class: "muted" }, `+ ${ops.length - 400} …`));
    box.append(cat);
  }
  // archive contents
  if (!MS.tree || MS.tree.file !== m.file) { try { MS.tree = { file: m.file, ...(await api("/api/ms/tree", { file: m.file })) }; } catch (e) { toast(e.message); return; } }
  const files = MS.tree.entries.filter(e => e.type !== "dir");
  const flt = h("input", { type: "search", placeholder: L("Dateien suchen (z. B. .ytd, skydome)…", "Search files (e.g. .ytd, skydome)…"), value: MS.treeFilter, style: "flex:1" });
  const listBox = h("div", { class: "ms-files" });
  const sumEl = h("span", { class: "muted" });
  const draw = () => {
    listBox.innerHTML = "";
    const q = MS.treeFilter.toLowerCase();
    const shown = files.filter(e => !q || e.path.toLowerCase().includes(q));
    sumEl.textContent = `${shown.length} / ${files.length} ${L("Dateien", "files")} · ${MS.treeSel.size} ${L("gewählt", "selected")}`;
    for (const e of shown.slice(0, 600)) {
      const c = h("input", { type: "checkbox", checked: MS.treeSel.has(e.path), onchange: ev => { ev.target.checked ? MS.treeSel.add(e.path) : MS.treeSel.delete(e.path); sumEl.textContent = `${shown.length} / ${files.length} ${L("Dateien", "files")} · ${MS.treeSel.size} ${L("gewählt", "selected")}`; } });
      listBox.append(h("label", { class: "ms-file" }, c, h("span", { class: "ft ft-" + (e.path.split(".").pop() || "").toLowerCase() }, (e.path.split(".").pop() || "").toUpperCase().slice(0, 4)),
        h("span", { class: "fp" }, e.path), h("span", { class: "muted small" }, e.nested ? L("Archiv", "archive") : fmtSize(e.size || 0))));
    }
    if (shown.length > 600) listBox.append(h("div", { class: "muted" }, L(`… ${shown.length - 600} weitere – Suche eingrenzen`, `… ${shown.length - 600} more – narrow the search`)));
  };
  flt.oninput = () => { MS.treeFilter = flt.value; draw(); };
  box.append(h("div", { class: "cat" }, h("div", { class: "ch" }, h("span", {}, L("DATEIEN IM ARCHIV", "FILES IN ARCHIVE")), sumEl),
    h("div", { class: "cb" }, h("div", { class: "toolbar" }, flt,
      h("button", { class: "small", onclick: () => { const q = MS.treeFilter.toLowerCase(); files.filter(e => !q || e.path.toLowerCase().includes(q)).forEach(e => MS.treeSel.add(e.path)); draw(); } }, L("Alle gefilterten wählen", "Select filtered")),
      h("button", { class: "small", onclick: () => { MS.treeSel.clear(); draw(); } }, L("Auswahl leeren", "Clear")),
      h("button", { class: "small primary", onclick: () => MS.treeSel.size ? msExport(m.file, [...MS.treeSel]) : toast(L("Nichts gewählt", "Nothing selected")) }, L("Auswahl exportieren", "Export selection"))), listBox)));
  draw();
}
async function msExport(file, paths) {
  try {
    const r = await api("/api/ms/export", { file, paths });
    toast(L(`${r.files} Dateien exportiert`, `${r.files} files exported`), true);
    window.vps.openPath(r.dir);
  } catch (e) { toast(e.message); }
}
async function msOwnFor(modFile, o) {
  const f = await window.vps.pickFiles({ title: L("Eigene Datei für ", "Own file for ") + (o.targetRaw || o.target) });
  if (!f.length) return;
  try { await api("/api/ms/override", { file: f[0], archive: o.archive, target: o.target, targetRaw: o.targetRaw, fromMod: modFile }); toast(L("Eigene Datei übernommen – sie gewinnt im Pack", "Own file added – it wins in the pack"), true); await msLoad(); }
  catch (e) { toast(e.message); }
}

// ============================================================ conflicts tab
function msConflictsTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  el.append(h("div", { class: "toolbar" }, h("b", {}, MS.conflicts.length + " " + L("Konflikte", "conflicts")),
    h("span", { class: "muted" }, L("Mehrere Mods ersetzen dieselbe Spieldatei. Im Pack gewinnt die Mod, die in der Liste weiter unten steht – Reihenfolge im Tab „Mods“ per Ziehen ändern oder hier bei einer Mod ausschließen.",
      "Several mods replace the same game file. In the pack the mod lower in the list wins – change the order in the Mods tab by dragging, or exclude it here for one mod."))));
  if (!MS.conflicts.length) { el.append(h("div", { class: "empty" }, L("Keine Konflikte zwischen den Mods im Pack. ✓", "No conflicts between the mods in the pack. ✓"))); return; }
  const tbl = h("table", { class: "diff" }, h("tr", {}, h("th", {}, L("Spieldatei", "Game file")), h("th", {}, L("Mods (Reihenfolge)", "Mods (order)")), h("th", {}, L("Gewinnt", "Wins"))));
  for (const c of MS.conflicts.slice(0, 1500)) {
    tbl.append(h("tr", {}, h("td", { class: "v" }, c.target, h("div", { class: "muted small" }, c.archive)),
      h("td", {}, c.mods.map(x => h("div", { class: "cf-mod" + (x.mod === c.winner ? " win" : "") }, mname(x.mod),
        !x.own && x.mod !== c.winner ? null : null,
        !x.own ? h("button", { class: "small st-link", onclick: async () => { await api("/api/ms/exclude", { file: x.mod, key: c.key, on: true }); await msLoad(); } }, L("ausschließen", "exclude")) : null))),
      h("td", {}, h("b", { class: "ok" }, mname(c.winner)))));
  }
  el.append(tbl);
}

// ============================================================ own files tab
function msOwnTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  el.append(h("div", { class: "card" }, h("h3", {}, L("Eigene Dateien", "Own files")),
    h("p", {}, L("Eigene Dateien ersetzen eine Spieldatei im Pack, z. B. eine selbst bearbeitete Textur (.ytd). Hinzufügen: im Tab „Mods“ bei einer Ersetzung auf „Eigene Datei…“ klicken. Die Datei wird in den Arbeitsordner kopiert und gewinnt immer.",
      "Own files replace a game file in the pack, e.g. a texture (.ytd) you edited. Add them in the Mods tab via \"Own file…\" on a replacement. The file is copied into the workspace and always wins."))));
  const ov = MS.proj.overrides || [];
  if (!ov.length) { el.append(h("div", { class: "empty" }, L("Noch keine eigenen Dateien.", "No own files yet."))); return; }
  ov.forEach((o, i) => el.append(h("div", { class: "card", style: "display:flex;gap:10px;align-items:center;padding:10px 14px;margin-bottom:8px" },
    h("div", { style: "flex:1" }, h("b", {}, o.file), h("div", { class: "muted small" }, "→ " + o.target + (o.archive ? "  (" + o.archive + ")" : ""))),
    h("button", { class: "small danger", onclick: async () => { await api("/api/ms/removeoverride", { index: i }); await msLoad(); } }, L("Entfernen", "Remove")))));
}

// ============================================================ build tab
function msBuildTab(body) {
  const el = h("div", { class: "view scroll", style: "flex:1" }); body.append(el);
  const pk = MS.proj.pack || {};
  const name = h("input", { value: pk.name || "", style: "width:100%" });
  const ver = h("input", { value: pk.version || "1.0", style: "width:100%" });
  const author = h("input", { value: pk.author || "", placeholder: L("dein Name", "your name"), style: "width:100%" });
  const desc = h("textarea", { rows: 3, style: "width:100%" }, pk.description || "");
  const losers = h("input", { type: "checkbox", checked: true });
  const inPack = MS.proj.mods.filter(m => m.enabled && m.info.readable && m.info.oiv);
  const blocked = MS.proj.mods.filter(m => !m.info.readable || !m.info.oiv);
  el.append(h("div", { class: "card" }, h("h3", {}, L("Pack bauen", "Build pack")),
    h("div", { class: "form" }, h("label", {}, L("Name", "Name")), name, h("label", {}, L("Version", "Version")), ver, h("label", {}, L("Autor", "Author")), author, h("label", {}, L("Beschreibung", "Description")), desc,
      h("label", {}, L("Optionen", "Options")), h("label", { class: "chk" }, losers, " ", L("Dateien, die einen Konflikt verlieren, weglassen (kleineres Pack)", "Leave out files that lose a conflict (smaller pack)"))),
    h("p", {}, h("b", {}, `${inPack.length} Mods`), L(` kommen ins Pack, ${(MS.proj.overrides || []).length} eigene Dateien, ${MS.conflicts.length} Konflikte werden nach Reihenfolge aufgelöst.`, ` go into the pack, ${(MS.proj.overrides || []).length} own files, ${MS.conflicts.length} conflicts resolved by order.`)),
    blocked.length ? h("p", { class: "wrn" }, L("Nicht im Pack (geschützt oder ohne assembly.xml): ", "Not in the pack (protected or without assembly.xml): ") + blocked.map(m => m.file).join(", ")) : null,
    h("button", { class: "primary", onclick: async e => {
      e.target.disabled = true;
      try {
        const r = await api("/api/ms/build", { name: name.value, version: ver.value, author: author.value, description: desc.value, dropLosers: losers.checked });
        toast(L(`Pack gebaut: ${r.name} (${fmtSize(r.size)})`, `Pack built: ${r.name} (${fmtSize(r.size)})`), true);
        await msLoad();
      } catch (err) { toast(err.message); e.target.disabled = false; }
    } }, L("Pack bauen", "Build pack"))));
  const packs = (MS.proj.packs || []).sort((a, b) => b.mtime - a.mtime);
  el.append(h("div", { class: "card" }, h("h3", {}, L("Fertige Packs", "Built packs")),
    packs.length ? null : h("p", { class: "muted" }, L("Noch keine.", "None yet.")),
    ...packs.map(p => h("div", { class: "rep-row bk" }, h("span", {}, p.file), h("span", { class: "muted small" }, fmtSize(p.size) + " · " + new Date(p.mtime).toLocaleString(LANG === "en" ? "en-GB" : "de-DE")),
      h("button", { class: "small", onclick: async () => { const r = await api("/api/ms/folder", { what: "packs" }); window.vps.openPath(r.path); } }, L("Ordner", "Folder")),
      MS.state.liveExists ? h("button", { class: "small primary", onclick: () => msInstallConfirm(p.file) }, L("In FiveM kopieren…", "Copy to FiveM…")) : null))));
}
function msInstallConfirm(file) {
  return new Promise(resolve => {
    modal(L("Pack in FiveM kopieren?", "Copy pack to FiveM?"), h("div", {},
      h("p", {}, h("b", {}, file)),
      h("p", {}, L("Das Pack wird in deinen FiveM-mods-Ordner KOPIERT. Dort wird nichts überschrieben oder gelöscht – gibt es den Namen schon, bekommt die Kopie eine Nummer.", "The pack is COPIED into your FiveM mods folder. Nothing there is overwritten or deleted – if the name exists, the copy gets a number.")),
      h("p", { class: "wrn" }, L("Hinweis: Wenn die einzelnen Mods aus dem Pack dort auch noch liegen, werden sie doppelt geladen. Die räumst du dort selbst weg – das Studio fasst deinen FiveM-Ordner nicht an.", "Note: if the single mods from the pack are still in there, they load twice. Tidy those up yourself – the studio never touches your FiveM folder.")),
      h("p", { class: "muted small" }, MS.state.liveDir)), [
      [L("Abbrechen", "Cancel"), () => { resolve({ ok: false, cancelled: true }); return true; }],
      [L("Kopieren", "Copy"), async () => {
        try { const r = await api("/api/ms/install", { file }); toast(L("Kopiert nach FiveM: ", "Copied to FiveM: ") + r.name, true); resolve(r); }
        catch (e) { toast(e.message); resolve({ ok: false, error: e.message }); }
      }, "primary"]], () => resolve({ ok: false, cancelled: true }));
  });
}

// ============================================================ drag & drop files anywhere (mods mode)
document.addEventListener("dragover", e => { if (document.body.dataset.mode === "mods" && e.dataTransfer.types.includes("Files")) { e.preventDefault(); document.body.classList.add("dropping"); } });
document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
document.addEventListener("drop", e => {
  document.body.classList.remove("dropping");
  if (document.body.dataset.mode !== "mods" || !e.dataTransfer.files.length) return;
  e.preventDefault();
  if (!MS.state?.workspace) { toast(L("Erst einen Arbeitsordner wählen", "Choose a workspace first")); return; }
  const files = [...e.dataTransfer.files].map(f => window.vps.pathForFile(f)).filter(Boolean);
  if (files.length) msImport(files);
});

// ============================================================ remote commands (Claude)
Object.assign(REMOTE, {
  mode: { help: "{name: home|presets|mods} Bereich wechseln", run: a => (setMode(a.name || "home"), { mode: document.body.dataset.mode }) },
  msState: { help: "Mod-Studio: Arbeitsordner, zuletzt benutzt, FiveM-mods-Pfad", run: () => api("/api/ms/state") },
  msOpen: { help: "{dir, create?} Arbeitsordner öffnen/anlegen (nie den FiveM-mods-Ordner)", run: async a => { const r = await api("/api/ms/open", { dir: a.dir, create: !!a.create }); setMode("mods"); return r; } },
  msProject: { help: "Mods im Arbeitsordner mit Infos (Reihenfolge, im Pack, Verschlüsselung, Ersetzungen)", run: async () => { const p = await api("/api/ms/project"); return { ...p, mods: p.mods.map(m => ({ file: m.file, enabled: m.enabled, excluded: m.excluded, size: m.info.size, enc: m.info.enc, oiv: m.info.oiv, ops: m.info.ops.length, meta: m.info.meta })) }; } },
  msImport: { help: "{files:[absolute paths]} .rpf/.oiv/.zip in den Arbeitsordner KOPIEREN", run: async a => { const r = await api("/api/ms/import", { files: a.files || [] }); await msLoad(); return r; } },
  msLive: { help: "Mods im FiveM-mods-Ordner (nur lesen)", run: () => api("/api/ms/live") },
  msCopyLive: { help: "{files:[names]} Mods aus dem FiveM-mods-Ordner in den Arbeitsordner kopieren", run: async a => { const r = await api("/api/ms/copylive", { files: a.files || [] }); await msLoad(); return r; } },
  msOps: { help: "{file} Was eine Mod im Spiel ersetzt (assembly.xml)", run: a => api("/api/ms/ops", { file: a.file }) },
  msTree: { help: "{file, filter?} Dateien in der Mod (max 2000)", run: async a => { const t = await api("/api/ms/tree", { file: a.file }); const q = String(a.filter || "").toLowerCase(); return { enc: t.enc, readable: t.readable, entries: t.entries.filter(e => !q || e.path.toLowerCase().includes(q)).slice(0, 2000) }; } },
  msExport: { help: "{file, paths:[...], target?} Dateien aus einer Mod exportieren (Standard: Arbeitsordner\\Export)", run: a => api("/api/ms/export", { file: a.file, paths: a.paths || [""], target: a.target }) },
  msConflicts: { help: "Konflikte zwischen Mods im Pack", run: () => api("/api/ms/conflicts") },
  msSetOrder: { help: "{mods:[{file, enabled}]} Reihenfolge/Auswahl fürs Pack setzen", run: async a => { await msSetMods(a.mods || []); return { ok: true }; } },
  msExclude: { help: "{file, key, on} Ersetzung einer Mod aus dem Pack nehmen (key aus msOps/msConflicts)", run: async a => { const r = await api("/api/ms/exclude", { file: a.file, key: a.key, on: a.on !== false }); await msLoad(); return r; } },
  msOverride: { help: "{file (eigene Datei), fromMod, archive, target} eigene Datei für ein Ziel nehmen", run: async a => { const r = await api("/api/ms/override", a); await msLoad(); return r; } },
  msBuild: { help: "{name, version?, author?, description?, dropLosers?} Pack als RPF im Arbeitsordner bauen", run: async a => { const r = await api("/api/ms/build", a); await msLoad(); return r; } },
  msInstall: { help: "{file} Pack in den FiveM-mods-Ordner kopieren – der Nutzer muss im Fenster bestätigen", run: a => { setMode("mods"); return msInstallConfirm(a.file); } },
});

// ============================================================ start
renderHome();
document.body.dataset.mode = "home";
msStatus();
