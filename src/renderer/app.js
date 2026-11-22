"use strict";
// ============================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
};
async function api(p, body) {
  const u = new URL(p, "http://x");
  const r = await window.vps.api(u.pathname.replace(/^\/api\//, ""), Object.fromEntries(u.searchParams), body || null);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
async function openFolder(what) { const r = await api("/api/folderpath", { what }); if (r.path) window.vps.openPath(r.path); }
function toast(msg, good = false) {
  const t = h("div", { class: "toast" + (good ? " good" : "") }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 4200);
}
const enc = encodeURIComponent;
const clone = o => JSON.parse(JSON.stringify(o));
const isFav = key => (S.state.favorites || []).includes(key);

// ============================================================ state
const S = {
  presets: [], state: {}, techs: [], techByKey: {}, fx: {},
  cur: null,            // {rel, model, mtime}
  dirty: false, live: localStorage.getItem("live") === "1", liveBacked: new Set(),
  sel: null,            // selected technique key Name@File.fx
  undo: [], redo: [], lastUndo: 0, ownWrite: 0,
  collapsed: JSON.parse(localStorage.getItem("collapsed") || "{}"),
  view: "editor", paramFilter: "",
};

// ============================================================ model helpers
const M = {
  g(key) { const it = S.cur.model.global.find(i => i[0] === key); return it ? it[1] : null; },
  setG(key, val) {
    const g = S.cur.model.global; const it = g.find(i => i[0] === key);
    if (it) it[1] = val; else g.push([key, val]);
  },
  list(key) { return (this.g(key) || "").split(",").map(s => s.trim()).filter(Boolean); },
  enabled() { return this.list("Techniques"); },
  sorting() { return this.list("TechniqueSorting"); },
  sec(file, create = false) {
    let s = S.cur.model.sections.find(x => x.name.toLowerCase() === file.toLowerCase());
    if (!s && create) { s = { name: file, items: [] }; S.cur.model.sections.push(s); }
    return s;
  },
  get(file, key) { const s = this.sec(file); if (!s) return null; const it = s.items.find(i => i[0] === key); return it ? it[1] : null; },
  set(file, key, val) {
    const s = this.sec(file, true);
    const idx = s.items.findIndex(i => i[0] === key);
    if (val == null) { if (idx >= 0) s.items.splice(idx, 1); s.items = s.items.filter(i => i[0] !== key); return; }
    if (idx >= 0) { s.items[idx][1] = val; s.items = s.items.filter((i, n) => i[0] !== key || n === idx); }
    else s.items.push([key, val]);
  },
  defines(file) {
    const raw = this.get(file, "PreprocessorDefinitions");
    const out = {};
    if (!raw || raw === "0") return out;
    splitTop(raw).forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); else out[p.trim()] = "1"; });
    return out;
  },
  setDefines(file, obj) {
    const parts = Object.entries(obj).filter(([k, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${v}`);
    this.set(file, "PreprocessorDefinitions", parts.length ? parts.join(",") : null);
  },
  // technique ordering: enabled list keeps render order; sorting = enabled first then rest
  setOrder(enabledKeys, allOrder) {
    this.setG("Techniques", enabledKeys.join(","));
    const rest = (allOrder || this.sorting()).filter(k => !enabledKeys.includes(k));
    this.setG("TechniqueSorting", [...enabledKeys, ...rest].join(","));
  },
};
function splitTop(s) {
  const out = []; let buf = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q) { buf += s.slice(i, i + 2); i++; continue; }
    if (c === '"') q = !q;
    if (c === "," && !q) { out.push(buf); buf = ""; } else buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
const fileOf = key => key.split("@")[1] || "";
const nameOf = key => key.split("@")[0];

// ============================================================ value formatting
function parseVals(str, dim) {
  if (str == null) return null;
  const n = String(str).split(",").map(x => parseFloat(x));
  if (n.some(isNaN)) return null;
  while (n.length < dim) n.push(n[n.length - 1] ?? 0);
  return n.slice(0, dim);
}
function fmtVals(u, vals) {
  return vals.map(v => {
    if (u.base === "bool") return v ? "1" : "0";
    if (u.base === "int" || u.base === "uint") return String(Math.round(v));
    return Number(v).toFixed(6);
  }).join(",");
}
const sameVals = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-5);

// ============================================================ undo / save
function beforeChange() {
  const now = Date.now();
  if (now - S.lastUndo > 700) { S.undo.push(clone(S.cur.model)); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
  S.lastUndo = now;
}
function changed(rerender = false) {
  S.dirty = true;
  updateTop();
  if (S.live) liveSave();
  if (rerender) renderEditor();
}
let liveTimer = null;
function liveSave() { clearTimeout(liveTimer); liveTimer = setTimeout(() => save({ live: true }), 350); }
async function save({ live = false, label = "" } = {}) {
  if (!S.cur) return;
  try {
    const first = live && !S.liveBacked.has(S.cur.rel);
    const r = await api("/api/save", { rel: S.cur.rel, model: S.cur.model, live, firstLive: first, label });
    if (first) S.liveBacked.add(S.cur.rel);
    S.cur.mtime = r.mtime; S.ownWrite = Date.now(); S.dirty = false; updateTop();
    if (!live) toast("Gespeichert – Version gesichert", true);
  } catch (e) { toast("Speichern fehlgeschlagen: " + e.message); }
}
function undo() { if (!S.cur || !S.undo.length) return; S.redo.push(clone(S.cur.model)); S.cur.model = S.undo.pop(); S.lastUndo = 0; changed(true); }
function redo() { if (!S.cur || !S.redo.length) return; S.undo.push(clone(S.cur.model)); S.cur.model = S.redo.pop(); S.lastUndo = 0; changed(true); }

// ============================================================ loading
async function loadState() {
  S.state = await api("/api/state");
  const p = $("#gamePill");
  p.textContent = S.state.game ? "Spiel läuft" : "Spiel aus";
  p.classList.toggle("on", S.state.game);
}
async function loadPresets() { S.presets = await api("/api/presets"); renderPresetList(); }
async function loadTechs() {
  const r = await api("/api/techniques");
  if (!r.ready) { setTimeout(loadTechs, 800); return; }
  S.techs = r.techniques; S.techByKey = {};
  for (const t of S.techs) S.techByKey[`${t.name}@${t.file}`] = t;
  // detect shader packs: sub-folder name, or a shared file-name prefix for loose files (e.g. Pack.fx, Pack_Post.fx, Pack_LUT.fx)
  const pre = f => f.replace(/\.fx$/i, "").split(/[_\- .]/)[0];
  const cnt = {};
  for (const f of new Set(S.techs.filter(t => !t.folder).map(t => t.file))) cnt[pre(f).toLowerCase()] = (cnt[pre(f).toLowerCase()] || 0) + 1;
  for (const t of S.techs) t.pack = t.folder ? t.folder.split(/[\\/]/)[0] : (cnt[pre(t.file).toLowerCase()] >= 2 && pre(t.file).length >= 3 ? pre(t.file) : "");
  if (S.cur) renderEditor();
}
async function fxDetails(file) {
  if (!S.fx[file]) S.fx[file] = await api("/api/effect?file=" + enc(file));
  return S.fx[file];
}
async function openPreset(rel, keepSel = false) {
  if (S.dirty && !S.live && S.cur && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
  try {
    const r = await api("/api/preset?rel=" + enc(rel));
    S.cur = { rel, model: r.model, mtime: r.mtime };
    S.dirty = false; S.undo = []; S.redo = [];
    if (!keepSel) S.sel = M.enabled()[0] || null;
    localStorage.setItem("lastPreset", rel);
    renderPresetList(); renderEditor(); updateTop();
    if (S.view !== "editor" && ["versions", "compare"].includes(S.view)) showView(S.view);
  } catch (e) { toast("Konnte Preset nicht laden: " + e.message); }
}

// ============================================================ top bar
function updateTop() {
  $("#saveBtn").disabled = !S.cur || (!S.dirty && !S.live);
  $("#saveBtn").textContent = S.live ? "Version sichern" : (S.dirty ? "Speichern •" : "Gespeichert");
  $("#undoBtn").disabled = !S.undo.length; $("#redoBtn").disabled = !S.redo.length;
  if (S.cur) {
    const p = S.presets.find(x => x.rel === S.cur.rel);
    $("#presetName").textContent = (p ? p.name : S.cur.rel) + (S.dirty && !S.live ? " •" : "");
    const active = sameRel(S.state.active, S.cur.rel);
    $("#presetMeta").innerHTML = (active ? '<span class="ok">● Aktiv im Spiel</span> · ' : "") + esc(S.cur.rel) +
      (S.live ? ' · <span class="ok">Live: Änderungen gehen direkt in die Datei</span>' : "");
    $("#activateBtn").disabled = active;
  }
  ["activateBtn", "dupBtn", "renameBtn", "trashBtn"].forEach(id => $("#" + id).disabled = !S.cur || (id === "activateBtn" && sameRel(S.state.active, S.cur?.rel)));
}
const sameRel = (a, b) => (a || "").toLowerCase().replace(/^\.\\/, "") === (b || "").toLowerCase().replace(/^\.\\/, "");

// ============================================================ preset list
function renderPresetList() {
  const q = $("#presetSearch").value.toLowerCase();
  const box = $("#presetList"); box.innerHTML = "";
  const groups = {};
  for (const p of S.presets) {
    if (q && !(p.name + " " + p.folder).toLowerCase().includes(q)) continue;
    (groups[p.folder || "Presets"] ||= []).push(p);
  }
  const order = Object.keys(groups).sort((a, b) => (a === "Eigene" ? -1 : b === "Eigene" ? 1 : a.localeCompare(b)));
  for (const g of order) {
    const closed = S.collapsed["f:" + g] && !q;
    box.append(h("div", { class: "folder", onclick: () => { S.collapsed["f:" + g] = !closed; saveCollapsed(); renderPresetList(); } },
      h("span", {}, (closed ? "▸ " : "▾ ") + g), h("span", {}, groups[g].length)));
    if (closed) continue;
    for (const p of groups[g]) {
      const act = sameRel(S.state.active, p.rel);
      box.append(h("div", { class: "pitem" + (S.cur && S.cur.rel === p.rel ? " sel" : ""), title: p.rel, onclick: () => openPreset(p.rel) },
        p.name, act ? h("span", { class: "act" }, "● aktiv") : null));
    }
  }
}
function saveCollapsed() { localStorage.setItem("collapsed", JSON.stringify(S.collapsed)); }

// ============================================================ editor: stack
function stackEntries() {
  const en = M.enabled();
  const keys = [...en];
  // sections that exist with values but whose technique is not enabled
  const extra = [];
  for (const s of S.cur.model.sections) {
    if (en.some(k => fileOf(k).toLowerCase() === s.name.toLowerCase())) continue;
    const t = S.techs.filter(t => t.file.toLowerCase() === s.name.toLowerCase());
    if (t.length) t.forEach(x => extra.push(`${x.name}@${x.file}`));
    else extra.push(`?@${s.name}`);
  }
  return { on: keys, off: [...new Set(extra)] };
}
function renderStack() {
  const box = $("#stackList"); box.innerHTML = "";
  if (!S.cur) return;
  const { on, off } = stackEntries();
  if (!on.length) box.append(h("div", { class: "empty" }, "Noch keine Effekte. Klick auf „+ Effekt“."));
  on.forEach((k, i) => box.append(fxItem(k, true, i)));
  if (off.length) {
    box.append(h("div", { class: "stack-sep" }, "Im Preset gespeichert, aber aus"));
    off.forEach(k => box.append(fxItem(k, false)));
  }
}
function fxItem(key, on, idx) {
  const t = S.techByKey[key];
  const file = fileOf(key);
  const missing = S.techs.length && !t && !nameOf(key).startsWith("?");
  const el = h("div", { class: "fx" + (S.sel === key ? " sel" : "") + (on ? "" : " off"), draggable: on ? "true" : null, onclick: () => { S.sel = key; renderEditor(); } },
    on ? h("span", { class: "grip" }, "⋮⋮") : null,
    h("div", { class: "nm" }, h("b", {}, t ? t.label : nameOf(key).replace(/^\?$/, file)), h("small", {}, file)),
    t && t.pack ? h("span", { class: "badge pack", title: "Shader-Paket" }, t.pack) : null,
    isFav(key) ? h("span", { class: "badge", title: "Favorit" }, "★") : null,
    missing ? h("span", { class: "badge miss", title: "Shader-Datei nicht gefunden" }, "fehlt") : null,
    nameOf(key) !== "?" ? h("label", { class: "tog", onclick: e => e.stopPropagation() },
      h("input", { type: "checkbox", checked: on, onchange: e => toggleFx(key, e.target.checked) }), h("span", { class: "sw" })) : null);
  if (on) {
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", String(idx)); el.style.opacity = .4; });
    el.addEventListener("dragend", () => el.style.opacity = "");
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", e => {
      e.preventDefault(); el.classList.remove("drag-over");
      const from = +e.dataTransfer.getData("text/plain"); if (isNaN(from) || from === idx) return;
      beforeChange();
      const en = M.enabled(); const [m] = en.splice(from, 1); en.splice(from < idx ? idx - 1 : idx, 0, m);
      M.setOrder(en); changed(true);
    });
  }
  return el;
}
function toggleFx(key, on) {
  beforeChange();
  const en = M.enabled();
  if (on && !en.includes(key)) en.push(key);
  if (!on) { const i = en.indexOf(key); if (i >= 0) en.splice(i, 1); }
  M.setOrder(en);
  if (on) M.sec(fileOf(key), true);
  changed(true);
}

async function toggleFav(key) {
  try {
    const r = await api("/api/favorite", { key, on: !isFav(key) });
    S.state.favorites = r.favorites; renderEditor();
  } catch (e) { toast(e.message); }
}
async function chooseFolder(dir) {
  const f = dir || await window.vps.pickFolder();
  if (!f) return;
  try {
    toast("Ordner wird eingelesen…");
    await api("/api/setfolder", { folder: f });
    S.cur = null; S.sel = null; S.fx = {}; S.dirty = false;
    await loadState(); await loadPresets(); await loadTechs();
    const act = S.presets.find(p => sameRel(p.rel, S.state.active));
    if (act) openPreset(act.rel); else renderEditor();
    updateStatus(); showView("editor");
    toast("ReShade-Ordner gesetzt", true);
  } catch (e) { toast(e.message); }
}

// ============================================================ editor: params
let paramsToken = 0;
async function renderParams() {
  const box = $("#params");
  const tok = ++paramsToken;
  if (!S.cur || !S.sel) { box.innerHTML = '<div class="empty">Effekt in der Liste wählen.</div>'; return; }
  const key = S.sel, file = fileOf(key);
  const d = await fxDetails(file).catch(() => null);
  if (tok !== paramsToken) return;
  const scroll = box.scrollTop;
  box.innerHTML = "";
  const t = S.techByKey[key];
  const q = S.paramFilter.toLowerCase();
  const head = h("div", { class: "phead" },
    h("div", { class: "title" }, t ? t.label : file),
    h("span", { class: "muted" }, file),
    t && t.pack ? h("span", { class: "badge pack" }, t.pack) : null,
    t ? h("button", { class: "small fav" + (isFav(key) ? " on" : ""), title: "Als Favorit markieren – Favoriten stehen im Effekt-Katalog ganz oben", onclick: () => toggleFav(key) }, isFav(key) ? "★ Favorit" : "☆ Favorit") : null,
    h("div", { class: "spacer" }),
    h("input", { type: "search", placeholder: "Regler suchen…", value: S.paramFilter, oninput: e => { S.paramFilter = e.target.value; renderParams().then(() => { const i = $(".phead input[type=search]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); } }),
    h("button", { class: "small", onclick: () => takeFromModal(file) }, "Aus Preset übernehmen"),
    h("button", { class: "small", onclick: () => resetFx(file, d) }, "Alles auf Standard"));
  box.append(head);
  if (t?.tooltip) box.append(h("div", { class: "pdesc" }, t.tooltip));
  if (!d || d.missing) {
    box.append(h("div", { class: "pdesc" }, "Shader-Datei nicht gefunden – Werte werden roh angezeigt."));
  }
  const unis = d && !d.missing ? d.uniforms : [];
  const known = new Set(unis.map(u => u.name));
  // categories
  const cats = new Map();
  for (const u of unis) {
    if (q && !(u.label + " " + u.name + " " + u.category).toLowerCase().includes(q)) continue;
    const c = u.category || "Einstellungen";
    if (!cats.has(c)) cats.set(c, { closed: u.closed, list: [] });
    cats.get(c).list.push(u);
  }
  for (const [c, info] of cats) {
    const ck = "c:" + file + ":" + c;
    const closed = q ? false : (S.collapsed[ck] ?? info.closed);
    const cb = h("div", { class: "cb" });
    const cat = h("div", { class: "cat" + (closed ? " closed" : "") },
      h("div", { class: "ch", onclick: () => { S.collapsed[ck] = !cat.classList.contains("closed"); cat.classList.toggle("closed"); saveCollapsed(); } },
        h("span", {}, c), h("span", { class: "muted" }, info.list.length)), cb);
    for (const u of info.list) {
      if (u.text && !q) cb.append(h("div", { class: "note" }, u.text));
      cb.append(paramRow(file, u));
    }
    box.append(cat);
  }
  // raw / unknown keys
  const sec = M.sec(file);
  const raw = (sec?.items || []).filter(([k]) => !known.has(k) && k !== "PreprocessorDefinitions" && (!q || k.toLowerCase().includes(q)));
  if (raw.length) {
    const cb = h("div", { class: "cb" });
    for (const [k, v] of raw) {
      cb.append(h("div", { class: "row" }, h("div", { class: "lb", title: k }, k),
        h("input", { value: v, onchange: e => { beforeChange(); M.set(file, k, e.target.value); changed(); } }),
        h("button", { class: "rs vis", title: "Eintrag entfernen", onclick: () => { beforeChange(); M.set(file, k, null); changed(true); } }, "✕")));
    }
    box.append(h("div", { class: "cat" }, h("div", { class: "ch" }, h("span", {}, "Weitere gespeicherte Werte"), h("span", { class: "muted" }, raw.length)), cb));
  }
  // defines
  if (d && d.defines && d.defines.length && !q) box.append(definesBlock(file, d));
  box.scrollTop = scroll;
}

function axisLabels(u) {
  const tt = (u.tooltip + " " + u.text).toUpperCase();
  if (u.dim === 2 && tt.includes("DAY") && tt.includes("NIGHT")) return ["Tag", "Nacht"];
  if (u.dim === 2) return ["X", "Y"];
  if (u.dim === 3) return ["R", "G", "B"];
  if (u.dim === 4) return ["R", "G", "B", "A"];
  return [""];
}
function rangeOf(u, val) {
  let mn = u.min, mx = u.max;
  const isInt = u.base === "int" || u.base === "uint";
  if (mn == null) mn = Math.min(0, ...val, ...u.default);
  if (mx == null) mx = Math.max(isInt ? 10 : 1, ...u.default.map(v => v * 2), ...val);
  if (mx <= mn) mx = mn + 1;
  const step = u.step ?? (isInt ? 1 : Math.max((mx - mn) / 1000, 0.0001));
  return { mn, mx, step };
}
function paramRow(file, u) {
  const stored = parseVals(M.get(file, u.name), u.dim);
  const cur = stored || u.default.slice();
  const mod = stored && !sameVals(stored, u.default);
  const setV = vals => { beforeChange(); M.set(file, u.name, fmtVals(u, vals)); lb.classList.toggle("mod", !sameVals(vals, u.default)); rs.classList.toggle("vis", !sameVals(vals, u.default)); changed(); };
  const lb = h("div", { class: "lb" + (mod ? " mod" : ""), title: (u.tooltip ? u.tooltip + "\n\n" : "") + u.name }, u.label.trim() || u.name, u.label.trim() !== u.name ? h("small", {}, u.name) : null);
  const rs = h("button", { class: "rs" + (mod ? " vis" : ""), title: "Standard: " + u.default.join(", "), onclick: () => { beforeChange(); M.set(file, u.name, fmtVals(u, u.default)); changed(); renderParams(); } }, "↺");
  let ctl;
  const isInt = u.base === "int" || u.base === "uint";
  if (u.base === "bool") {
    ctl = h("label", { class: "tog" }, h("input", { type: "checkbox", checked: !!cur[0], onchange: e => setV([e.target.checked ? 1 : 0]) }), h("span", { class: "sw" }));
  } else if (isInt && u.items && u.items.length && u.dim === 1) {
    ctl = h("select", { onchange: e => setV([+e.target.value]) }, u.items.map((it, i) => h("option", { value: i, selected: Math.round(cur[0]) === i }, it)));
  } else if (u.ui_type === "color" && (u.dim === 3 || u.dim === 4)) {
    const toHex = v => "#" + v.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
    const nums = cur.map((v, i) => h("input", { type: "number", step: "0.01", value: +v.toFixed(4), title: axisLabels(u)[i], onchange: () => { const vals = nums.map(n => +n.value); pick.value = toHex(vals); setV(vals); } }));
    const pick = h("input", { type: "color", value: toHex(cur), oninput: e => {
      const hx = e.target.value; const rgb = [1, 3, 5].map(i => parseInt(hx.substr(i, 2), 16) / 255);
      rgb.forEach((v, i) => nums[i].value = +v.toFixed(4)); setV(nums.map(n => +n.value));
    } });
    ctl = h("div", { class: "colrow" }, pick, ...nums);
  } else {
    const { mn, mx, step } = rangeOf(u, cur);
    const labels = axisLabels(u);
    const rows = cur.map((v, i) => {
      const num = h("input", { type: "number", step: isInt ? 1 : "any", value: isInt ? Math.round(v) : +v.toFixed(4) });
      const rng = h("input", { type: "range", min: mn, max: mx, step, value: v });
      rng.addEventListener("input", () => { num.value = isInt ? Math.round(rng.value) : (+rng.value).toFixed(4); push(); });
      num.addEventListener("change", () => { rng.value = num.value; push(); });
      return { el: h("div", { class: "sl" }, u.dim > 1 ? h("span", { class: "ax" }, labels[i]) : null, rng, num), num };
    });
    const push = () => setV(rows.map(r => +r.num.value));
    ctl = h("div", { class: "ctl" }, rows.map(r => r.el));
  }
  return h("div", { class: "row" }, lb, ctl, rs);
}
function resetFx(file, d) {
  if (!d || d.missing) return;
  if (!confirm("Alle Regler von " + file + " auf Standard setzen?")) return;
  beforeChange();
  for (const u of d.uniforms) M.set(file, u.name, null);
  changed(true);
}
function definesBlock(file, d) {
  const cur = M.defines(file);
  const cb = h("div", { class: "cb" },
    h("div", { class: "note" }, "Shader-Optionen (Preprocessor). Änderungen brauchen im Spiel einen Shader-Reload. Leer = Standardwert."));
  const own = d.defines.filter(x => x.own), inc = d.defines.filter(x => !x.own);
  const mk = df => {
    const isTex = /\.(png|jpe?g|bmp|dds|tga)"?$/i.test(df.default) || /(TEXTURE|LUT_?FILE|FILE_?NAME|TEXNAME|_TEX\b)/i.test(df.name);
    const inp = h("input", { value: cur[df.name] ?? "", placeholder: df.default, onchange: e => {
      beforeChange(); const o = M.defines(file); o[df.name] = e.target.value.trim(); M.setDefines(file, o); changed();
    } });
    return h("div", { class: "defrow" }, h("div", { class: "lb", title: df.name }, df.name),
      inp,
      isTex ? h("button", { class: "small", onclick: () => texturePicker(name => { inp.value = `"${name}"`; inp.dispatchEvent(new Event("change")); }) }, "Textur…") : h("span"));
  };
  own.forEach(df => cb.append(mk(df)));
  if (inc.length) {
    const more = h("div", { class: "hidden" }, inc.map(mk));
    cb.append(h("button", { class: "small", style: "margin-top:6px", onclick: e => { more.classList.toggle("hidden"); e.target.remove(); } }, `+ ${inc.length} weitere aus Include-Dateien`), more);
  }
  return h("div", { class: "cat" + (S.collapsed["d:" + file] ? " closed" : "") },
    h("div", { class: "ch", onclick: e => { const c = e.currentTarget.parentNode; c.classList.toggle("closed"); S.collapsed["d:" + file] = c.classList.contains("closed"); saveCollapsed(); } },
      h("span", {}, "SHADER-OPTIONEN / TEXTUREN"), h("span", { class: "muted" }, d.defines.length)), cb);
}
function renderEditor() { renderStack(); renderParams(); updateTop(); }

// ============================================================ modals
function modal(title, body, buttons = []) {
  const m = $("#modal"), box = $(".modal-box", m);
  box.innerHTML = "";
  const close = () => m.classList.add("hidden");
  box.append(h("div", { class: "mh" }, h("div", { class: "title" }, title), h("button", { class: "icon", onclick: close }, "✕")),
    h("div", { class: "mb" }, body));
  if (buttons.length) box.append(h("div", { class: "mf" }, buttons.map(([lab, fn, cls]) => h("button", { class: cls || "", onclick: async () => { if ((await fn()) !== false) close(); } }, lab))));
  m.classList.remove("hidden");
  m.onclick = e => { if (e.target === m) close(); };
  return close;
}
function addFxModal() {
  if (!S.cur) return;
  const en = new Set(M.enabled());
  const list = h("div", { class: "cat-list" });
  const inp = h("input", { placeholder: "Effekt suchen (z. B. bloom, lut, sharpen)…", style: "width:100%" });
  const draw = () => {
    list.innerHTML = "";
    const q = inp.value.toLowerCase();
    const groups = new Map([["★ Favoriten", []]]);
    for (const t of S.techs) {
      const k = `${t.name}@${t.file}`;
      if (q && !(t.label + " " + t.name + " " + t.file + " " + t.folder).toLowerCase().includes(q)) continue;
      const g = isFav(k) ? "★ Favoriten" : (t.pack || "Standard");
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([k, t]);
    }
    let n = 0;
    for (const [g, arr] of groups) {
      if (!arr.length) continue;
      list.append(h("div", { class: "grp" }, g));
      for (const [k, t] of arr) {
        if (n++ > 400) break;
        list.append(h("div", { class: "tech", title: t.tooltip, onclick: () => { toggleFx(k, true); S.sel = k; close(); renderEditor(); } },
          h("b", {}, t.label), h("small", {}, t.file), en.has(k) ? h("span", { class: "in" }, "✓ schon drin") : null));
      }
    }
  };
  inp.oninput = draw;
  const close = modal("Effekt hinzufügen", h("div", {}, inp, list));
  draw(); inp.focus();
}
function texturePicker(onPick) {
  api("/api/textures").then(tex => {
    const grid = h("div", { class: "grid" });
    const inp = h("input", { placeholder: "Textur suchen…", style: "width:100%;margin-bottom:12px" });
    const draw = () => {
      grid.innerHTML = ""; const q = inp.value.toLowerCase();
      tex.filter(t => !q || t.rel.toLowerCase().includes(q)).slice(0, 300).forEach(t => grid.append(texTile(t, () => { onPick(t.rel.replace(/\\/g, "/")); close(); })));
    };
    inp.oninput = draw;
    const close = modal("Textur wählen", h("div", {}, inp, grid)); draw(); inp.focus();
  });
}
function texTile(t, onclick) {
  const im = h("div", { class: "im" });
  if ([".png", ".jpg", ".jpeg", ".bmp"].includes(t.ext)) im.style.backgroundImage = `url('vps://texture/?rel=${enc(t.rel)}&size=256')`; else im.textContent = t.ext.slice(1).toUpperCase();
  return h("div", { class: "tile", title: t.rel, onclick }, im, h("div", { class: "cap" }, t.rel));
}
async function takeFromModal(file) {
  const sel = h("select", { style: "width:100%" }, S.presets.filter(p => p.rel !== S.cur.rel).map(p => h("option", { value: p.rel }, `${p.folder} / ${p.name}`)));
  const info = h("p", { class: "muted" }, `Kopiert alle Werte von ${file} aus dem gewählten Preset in dieses.`);
  modal("Werte aus anderem Preset übernehmen", h("div", {}, info, sel), [
    ["Abbrechen", () => true],
    ["Übernehmen", async () => {
      const r = await api("/api/preset?rel=" + enc(sel.value));
      const src = r.model.sections.find(s => s.name.toLowerCase() === file.toLowerCase());
      if (!src) { toast("Das Preset hat keine Werte für " + file); return false; }
      beforeChange();
      const dst = M.sec(file, true); dst.items = clone(src.items);
      changed(true); toast("Werte übernommen", true);
    }, "primary"]]);
}
function newPresetModal(base) {
  const name = h("input", { value: base ? (base.name + " Kopie") : "", placeholder: "z. B. Mein Preset" });
  const folder = h("input", { value: "Eigene" });
  const tmpl = h("select", {},
    base ? h("option", { value: "copy" }, "Kopie von „" + base.name + "“") : null,
    (S.state.favorites || []).length ? h("option", { value: "favs" }, "Mit meinen Favoriten-Effekten") : null,
    h("option", { value: "empty" }, "Leer"));
  modal(base ? "Preset duplizieren" : "Neues Preset", h("div", { class: "form" },
    h("label", {}, "Name"), name, h("label", {}, "Ordner"), folder, h("label", {}, "Start"), tmpl), [
    ["Abbrechen", () => true],
    ["Erstellen", async () => {
      let model = { global: [["Techniques", ""], ["TechniqueSorting", ""]], sections: [] };
      if (tmpl.value === "copy") model = clone(base.model);
      if (tmpl.value === "favs") {
        const k = (S.state.favorites || []).filter(k => S.techByKey[k]);
        model.global = [["Techniques", k.join(",")], ["TechniqueSorting", k.join(",")]];
      }
      try {
        const r = await api("/api/new", { name: name.value, folder: folder.value, model });
        await loadPresets(); await openPreset(r.rel); toast("Preset erstellt", true);
      } catch (e) { toast(e.message); return false; }
    }, "primary"]]);
  name.focus(); name.select();
}

// ============================================================ other views
function showView(v) {
  S.view = v;
  $$("#views button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  $$(".view").forEach(el => el.classList.add("hidden"));
  $("#view-" + v).classList.remove("hidden");
  ({ editor: renderEditor, compare: renderCompare, textures: renderTextures, shots: renderShots, versions: renderVersions, setup: renderSetup })[v]?.();
}
function needPreset(el) {
  if (S.cur) return false;
  el.innerHTML = '<div class="empty">Zuerst links ein Preset wählen.</div>'; return true;
}

// ---- compare
let cmpRel = null;
async function renderCompare() {
  const el = $("#view-compare"); el.className = "view scroll";
  if (needPreset(el)) return;
  el.innerHTML = "";
  const sel = h("select", { onchange: e => { cmpRel = e.target.value; renderCompare(); } },
    h("option", { value: "" }, "— Preset zum Vergleichen wählen —"),
    S.presets.filter(p => p.rel !== S.cur.rel).map(p => h("option", { value: p.rel, selected: p.rel === cmpRel }, `${p.folder} / ${p.name}`)));
  el.append(h("div", { class: "toolbar" }, h("b", {}, "Dieses Preset"), h("span", { class: "muted" }, "vs."), sel,
    h("span", { class: "muted" }, "→ einzelne Werte oder ganze Effekte rüberholen")));
  if (!cmpRel) return;
  const other = (await api("/api/preset?rel=" + enc(cmpRel))).model;
  el.append(diffTable(S.cur.model, other, "Anderes Preset"));
}
function diffTable(a, b, bName) {
  const tbl = h("table", { class: "diff" }, h("tr", {}, h("th", {}, "Wert"), h("th", {}, "Dieses"), h("th", {}, bName), h("th", {}, "")));
  const listOf = (m, k) => ((m.global.find(i => i[0] === k) || [])[1] || "").split(",").filter(Boolean);
  const ea = listOf(a, "Techniques"), eb = listOf(b, "Techniques");
  const onlyB = eb.filter(k => !ea.includes(k)), onlyA = ea.filter(k => !eb.includes(k));
  if (onlyA.length || onlyB.length || ea.join() !== eb.join()) {
    tbl.append(h("tr", { class: "sec" }, h("td", { colspan: 3 }, "Aktive Effekte"), h("td", {},
      h("button", { class: "small", onclick: () => { beforeChange(); M.setOrder(eb, listOf(b, "TechniqueSorting")); changed(true); renderCompare(); toast("Effektliste übernommen", true); } }, "Liste übernehmen"))));
    tbl.append(h("tr", {}, h("td", {}, "Reihenfolge/Auswahl"), h("td", { class: "v" }, ea.map(nameOf).join(", ") || "—"), h("td", { class: "v" }, eb.map(nameOf).join(", ") || "—"), h("td")));
  }
  const names = [...new Set([...a.sections, ...b.sections].map(s => s.name))].sort();
  let count = 0;
  for (const n of names) {
    const sa = a.sections.find(s => s.name === n), sb = b.sections.find(s => s.name === n);
    const ma = Object.fromEntries(sa?.items || []), mb = Object.fromEntries(sb?.items || []);
    const keys = [...new Set([...Object.keys(ma), ...Object.keys(mb)])].filter(k => !numEq(ma[k], mb[k]));
    if (!keys.length) continue;
    count += keys.length;
    tbl.append(h("tr", { class: "sec" }, h("td", { colspan: 3 }, n), h("td", {},
      sb ? h("button", { class: "small", onclick: () => { beforeChange(); M.sec(n, true).items = clone(sb.items); changed(); renderCompare(); toast(n + " übernommen", true); } }, "Ganzen Effekt") : null)));
    for (const k of keys) {
      tbl.append(h("tr", {}, h("td", {}, k),
        h("td", { class: "v" + (ma[k] == null ? " na" : "") }, ma[k] ?? "Standard"),
        h("td", { class: "v" + (mb[k] == null ? " na" : "") }, mb[k] ?? "Standard"),
        h("td", {}, h("button", { class: "small", onclick: () => { beforeChange(); M.set(n, k, mb[k] ?? null); changed(); renderCompare(); } }, "←"))));
    }
  }
  if (!count && ea.join() === eb.join()) return h("div", { class: "empty" }, "Keine Unterschiede.");
  return tbl;
}
function numEq(x, y) {
  if (x === y) return true;
  if (x == null || y == null) return false;
  const a = x.split(",").map(Number), b = y.split(",").map(Number);
  return a.length === b.length && a.every((v, i) => !isNaN(v) && Math.abs(v - b[i]) < 1e-5);
}

// ---- textures
async function renderTextures() {
  const el = $("#view-textures"); el.className = "view scroll"; el.innerHTML = "";
  const tex = await api("/api/textures");
  const inp = h("input", { placeholder: "Suchen…", style: "width:260px" });
  const grid = h("div", { class: "grid" });
  const draw = () => {
    grid.innerHTML = ""; const q = inp.value.toLowerCase();
    tex.filter(t => !q || t.rel.toLowerCase().includes(q)).forEach(t => grid.append(texTile(t, () => {
      const big = h("img", { src: `vps://texture/?rel=${enc(t.rel)}`, style: "max-width:100%;max-height:60vh;display:block;margin:auto;background:#000" });
      modal(t.rel, h("div", {}, big, h("p", { class: "muted" }, "Name für Shader-Optionen: \"" + t.rel.replace(/\\/g, "/") + "\"")), [
        ["Namen kopieren", () => { navigator.clipboard.writeText(`"${t.rel.replace(/\\/g, "/")}"`); toast("Kopiert", true); }], ["Schließen", () => true]]);
    })));
  };
  inp.oninput = draw;
  el.append(h("div", { class: "toolbar" }, h("b", {}, tex.length + " Texturen"), inp,
    h("span", { class: "muted" }, "LUTs, Lens-Dirt, Masken usw. aus reshade-shaders\\Textures. Auswahl im Editor über „Shader-Optionen / Texturen“.")), grid);
  draw();
}

// ---- screenshots
let shotSel = [];
async function renderShots() {
  const el = $("#view-shots"); el.className = "view scroll"; el.innerHTML = "";
  await loadState();
  const st = S.state;
  if (!st.shotsSetup || st.savePresetFile !== "1") {
    el.append(h("div", { class: "card" }, h("h3", {}, "Screenshots mit Preset verknüpfen"),
      h("p", {}, "Stellt ReShade so ein, dass Screenshots (Druck-Taste) im Ordner von Preset Studio landen und das benutzte Preset jeweils mit gespeichert wird. So siehst du hier, welches Preset wie aussieht, und kannst Bilder nebeneinander vergleichen."),
      st.game ? h("p", { class: "wrn" }, "Das Spiel läuft gerade – erst schließen, sonst überschreibt ReShade die Einstellung.") : null,
      h("button", { class: "primary", disabled: st.game, onclick: async () => {
        try { await api("/api/inisettings", { set: [["SCREENSHOT", "SavePath", "__SHOTS__"], ["SCREENSHOT", "SavePresetFile", "1"]] }); toast("Eingerichtet", true); renderShots(); }
        catch (e) { toast(e.message); }
      } }, "Jetzt einrichten")));
  }
  const shots = await api("/api/shots");
  shotSel = shotSel.filter(n => shots.some(s => s.name === n));
  el.append(h("div", { class: "toolbar" }, h("b", {}, shots.length + " Screenshots"),
    h("span", { class: "muted" }, "Klick = ansehen · Strg+Klick = 2 für Vorher/Nachher wählen"),
    h("div", { class: "spacer" }),
    h("button", { disabled: shotSel.length !== 2, onclick: () => compareShots(shotSel[0], shotSel[1]) }, "Vergleichen (" + shotSel.length + "/2)"),
    h("button", { onclick: () => openFolder("shots") }, "Ordner öffnen"),
    h("button", { onclick: renderShots }, "Aktualisieren")));
  if (!shots.length) el.append(h("div", { class: "empty" }, "Noch keine Screenshots. Im Spiel Druck-Taste drücken."));
  const grid = h("div", { class: "grid shots" });
  for (const s of shots) {
    const im = h("div", { class: "im" }); im.style.backgroundImage = `url('vps://shot/?name=${enc(s.name)}&size=480')`;
    grid.append(h("div", { class: "tile" + (shotSel.includes(s.name) ? " sel" : ""), onclick: e => {
      if (e.ctrlKey) { shotSel = shotSel.includes(s.name) ? shotSel.filter(x => x !== s.name) : [...shotSel, s.name].slice(-2); renderShots(); }
      else viewShot(s);
    } }, im, h("div", { class: "cap" }, (s.preset ? "◆ " : "") + new Date(s.mtime * 1000).toLocaleString("de-DE"))));
  }
  el.append(grid);
}
function viewShot(s) {
  const body = h("div", {}, h("img", { src: `vps://shot/?name=${enc(s.name)}`, style: "width:100%;display:block;border-radius:8px" }),
    h("p", { class: "muted" }, s.name + (s.preset ? " · Preset mitgespeichert" : "")));
  const btns = [["Schließen", () => true]];
  if (s.preset) btns.unshift(["Als neues Preset speichern", async () => {
    const r = await api("/api/shotpreset?name=" + enc(s.name));
    newPresetModal({ name: "Screenshot " + new Date(s.mtime * 1000).toLocaleDateString("de-DE"), model: r.model }); return false;
  }, "primary"]);
  modal("Screenshot", body, btns);
}
function compareShots(a, b) {
  const wrap = h("div", { class: "cmp" });
  const imB = h("img", { src: `vps://shot/?name=${enc(b)}` });
  const imA = h("img", { src: `vps://shot/?name=${enc(a)}` });
  const clip = h("div", { class: "clip" }, imA);
  const bar = h("div", { class: "bar" });
  wrap.append(imB, clip, bar, h("div", { class: "lab", style: "left:10px" }, "A"), h("div", { class: "lab", style: "right:10px" }, "B"));
  const setX = p => { p = Math.max(0, Math.min(1, p)); clip.style.clipPath = `inset(0 ${100 - p * 100}% 0 0)`; bar.style.left = p * 100 + "%"; };
  let drag = false;
  wrap.addEventListener("pointerdown", e => { drag = true; wrap.setPointerCapture(e.pointerId); move(e); });
  wrap.addEventListener("pointermove", e => drag && move(e));
  wrap.addEventListener("pointerup", () => drag = false);
  const move = e => { const r = wrap.getBoundingClientRect(); setX((e.clientX - r.left) / r.width); };
  setX(.5);
  modal("Vorher / Nachher", h("div", {}, wrap, h("p", { class: "muted" }, "A: " + a + "  ·  B: " + b)));
  $(".modal-box").style.width = "min(1500px, 96vw)";
}

// ---- versions
async function renderVersions() {
  const el = $("#view-versions"); el.className = "view scroll";
  if (needPreset(el)) return;
  el.innerHTML = "";
  const lab = h("input", { placeholder: "Name für die Version (optional)", style: "width:280px" });
  el.append(h("div", { class: "toolbar" }, lab,
    h("button", { class: "primary", onclick: async () => { await save({ label: lab.value || "manuell" }); renderVersions(); } }, "Version jetzt sichern"),
    h("button", { onclick: () => openFolder("versions") }, "Ordner öffnen")));
  el.append(h("p", { class: "muted" }, "Jedes Speichern legt automatisch eine Sicherung an (die letzten 60 bleiben). Im Live-Modus wird einmal vor der ersten Änderung gesichert."));
  const vs = await api("/api/versions?rel=" + enc(S.cur.rel));
  if (!vs.length) { el.append(h("div", { class: "empty" }, "Noch keine Versionen.")); return; }
  const out = h("div");
  for (const v of vs) {
    out.append(h("div", { class: "card", style: "display:flex;gap:10px;align-items:center;padding:10px 14px;margin-bottom:8px" },
      h("b", { style: "flex:1" }, v.name.replace(/\.ini$/, "").replace("_", " ").replace(/-(\d\d)-(\d\d)( |$)/, ":$1:$2$3")),
      h("button", { class: "small", onclick: async () => {
        const r = await api(`/api/version?rel=${enc(S.cur.rel)}&name=${enc(v.name)}`);
        modal("Unterschiede: aktuell vs. " + v.name, diffTable(S.cur.model, r.model, "Version"));
      } }, "Unterschiede"),
      h("button", { class: "small primary", onclick: async () => {
        const r = await api(`/api/version?rel=${enc(S.cur.rel)}&name=${enc(v.name)}`);
        beforeChange(); S.cur.model = r.model; changed(); toast("Version geladen" + (S.live ? " und live geschrieben" : " – noch speichern"), true); showView("editor");
      } }, "Wiederherstellen")));
  }
  el.append(out);
}

// ---- setup
async function renderSetup() {
  const el = $("#view-setup"); el.className = "view scroll"; el.innerHTML = "";
  await loadState();
  const st = S.state;
  const vkNames = { 0: "keine", 116: "F5", 117: "F6", 118: "F7", 119: "F8", 120: "F9", 121: "F10", 122: "F11", 123: "F12", 45: "Einfg", 36: "Pos1", 109: "Num -", 107: "Num +", 44: "Druck" };
  const vk = s => vkNames[(s || "0").split(",")[0]] || ("VK " + (s || "0").split(",")[0]);
  const rk = h("select", {}, [0, 116, 117, 118, 119, 120, 121, 122, 123, 45, 36].map(c => h("option", { value: c, selected: String(c) === (st.reloadKey || "0").split(",")[0] }, vkNames[c])));
  el.append(
    h("div", { class: "card" }, h("h3", {}, "ReShade-Ordner"),
      h("p", {}, "Der Ordner, in dem ReShade.ini liegt (meist neben der Spiel-.exe, bei manchen Spielen im plugins-Ordner)."),
      h("div", { class: "toolbar" }, h("b", {}, st.folder || "noch keiner gewählt"),
        st.folderOk ? h("span", { class: "ok" }, "✓ ReShade.ini gefunden") : h("span", { class: "bad" }, "✕ keine ReShade.ini"),
        h("div", { class: "spacer" }),
        h("button", { class: "primary", onclick: () => chooseFolder() }, "Ordner wählen…"),
        st.folderOk ? h("button", { onclick: () => openFolder("reshade") }, "Öffnen") : null),
      (st.recent || []).filter(r => r !== st.folder).length ? h("div", {}, h("p", {}, "Zuletzt benutzt:"),
        ...(st.recent || []).filter(r => r !== st.folder).map(r => h("div", { class: "tech", onclick: () => chooseFolder(r) }, r))) : null),
    await remoteCard(),
    h("div", { class: "card" }, h("h3", {}, "So testest du im Spiel"),
      h("ol", { class: "steps", html: `
        <li>Preset hier wählen und <b>„Im Spiel aktiv setzen“</b> (das Spiel muss dafür zu sein).</li>
        <li>Spiel starten. <b>Live</b> oben rechts einschalten.</li>
        <li>Regler hier bewegen – das Preset wird sofort gespeichert.</li>
        <li>Im Spiel neu laden: <b>Reload-Taste</b> (unten einstellen) oder im ReShade-Menü auf der Startseite <b>„Reload“</b>.
            Das ReShade-Menü dabei <b>geschlossen</b> lassen, sonst speichert ReShade seine eigenen Werte drüber.</li>
        <li>Mit <b>Druck</b> Screenshots machen → Tab „Screenshots“ → zwei wählen → Vorher/Nachher.</li>` })),
    h("div", { class: "card" }, h("h3", {}, "Status"),
      h("p", {}, "ReShade-Ordner: ", h("b", {}, st.folder || "—"), " ", st.folderOk ? h("span", { class: "ok" }, "✓ ReShade.ini gefunden") : h("span", { class: "bad" }, "✕ keine ReShade.ini")),
      h("p", {}, "Aktives Preset im Spiel: ", h("b", {}, st.active || "—")),
      h("p", {}, "Spiel: ", st.game ? h("span", { class: "wrn" }, "läuft (ReShade.ini-Änderungen erst nach dem Schließen möglich)") : h("span", { class: "ok" }, "aus")),
      h("p", {}, `Shader: ${st.fxCount} Dateien, ${S.techs.length} Effekte · Overlay-Taste: ${vk(st.overlayKey)} · Reload-Taste: ${vk(st.reloadKey)}`)),
    h("div", { class: "card" }, h("h3", {}, "Reload-Taste für ReShade"),
      h("p", {}, "Damit lädt ReShade Shader + Preset neu, ohne dass du ins Menü musst. Wird in ReShade.ini eingetragen (beim ersten Mal wird eine Sicherung ReShade.ini.presetstudio-backup angelegt)."),
      h("div", { class: "toolbar" }, rk, h("button", { class: "primary", disabled: st.game, onclick: async () => {
        try { await api("/api/inisettings", { set: [["INPUT", "KeyReload", `${rk.value},0,0,0`]] }); toast("Reload-Taste gesetzt", true); renderSetup(); } catch (e) { toast(e.message); }
      } }, "Übernehmen"))),
    h("div", { class: "card" }, h("h3", {}, "Werkzeuge"),
      h("div", { class: "toolbar" },
        h("button", { onclick: async () => { toast("Shader werden neu eingelesen…"); const r = await api("/api/reindex", {}); S.fx = {}; await loadTechs(); toast(r.count + " Shader eingelesen", true); renderSetup(); } }, "Shader neu einlesen"),
        h("button", { onclick: () => openFolder("presets") }, "Presets-Ordner"),
        h("button", { onclick: () => openFolder("versions") }, "Versionen-Ordner"),
        h("button", { onclick: () => openFolder("trash") }, "Papierkorb")),
      h("p", {}, "VELOX Preset Studio ändert nur Textdateien (Presets, ReShade.ini). Es greift nicht in das Spiel ein.")));
}

// ============================================================ external change watch
setInterval(async () => {
  if (!S.cur || document.hidden) return;
  try {
    const { mtime } = await api("/api/mtime?rel=" + enc(S.cur.rel));
    if (!mtime || Math.abs(mtime - S.cur.mtime) < 0.01 || Date.now() - S.ownWrite < 1500) return;
    if (!S.dirty || S.live) {
      const r = await api("/api/preset?rel=" + enc(S.cur.rel));
      S.cur.model = r.model; S.cur.mtime = r.mtime; S.dirty = false;
      renderEditor(); toast("Preset wurde von außen (ReShade) geändert – neu geladen");
    } else {
      S.cur.mtime = mtime;
      toast("Achtung: Preset-Datei wurde von außen geändert. Speichern überschreibt das.");
    }
  } catch { }
}, 2000);
setInterval(() => loadState().then(() => { updateTop(); }).catch(() => { }), 5000);

// ============================================================ wiring
$$("#views button").forEach(b => b.onclick = () => showView(b.dataset.view));
$("#presetSearch").oninput = renderPresetList;
$("#newPresetBtn").onclick = () => newPresetModal(null);
$("#addFxBtn").onclick = addFxModal;
$("#saveBtn").onclick = () => save({ label: S.live ? "manuell" : "" });
$("#undoBtn").onclick = undo; $("#redoBtn").onclick = redo;
$("#liveToggle").checked = S.live;
$("#liveToggle").onchange = e => {
  S.live = e.target.checked; localStorage.setItem("live", S.live ? "1" : "0");
  if (S.live && S.dirty) save({ live: true });
  updateTop(); toast(S.live ? "Live an: Änderungen landen sofort in der Preset-Datei" : "Live aus: mit Speichern übernehmen", S.live);
};
$("#activateBtn").onclick = async () => {
  try { await api("/api/activate", { rel: S.cur.rel }); await loadState(); renderPresetList(); updateTop(); toast("Beim nächsten Spielstart aktiv", true); }
  catch (e) { toast(e.message); }
};
$("#dupBtn").onclick = () => { const p = S.presets.find(x => x.rel === S.cur.rel); newPresetModal({ name: p?.name || "Preset", model: S.cur.model }); };
$("#renameBtn").onclick = () => {
  const p = S.presets.find(x => x.rel === S.cur.rel);
  const inp = h("input", { value: p?.name || "", style: "width:100%" });
  modal("Umbenennen", inp, [["Abbrechen", () => true], ["Umbenennen", async () => {
    try { const r = await api("/api/rename", { rel: S.cur.rel, name: inp.value }); S.cur.rel = r.rel; await loadPresets(); updateTop(); toast("Umbenannt", true); }
    catch (e) { toast(e.message); return false; }
  }, "primary"]]);
  inp.focus();
};
$("#trashBtn").onclick = () => {
  modal("Preset löschen?", h("p", {}, "„" + S.cur.rel + "“ wird in den Papierkorb von Preset Studio verschoben (nicht endgültig gelöscht)."), [
    ["Abbrechen", () => true],
    ["In Papierkorb", async () => { await api("/api/trash", { rel: S.cur.rel }); S.cur = null; S.sel = null; await loadPresets(); renderEditor(); toast("Verschoben", true); }, "primary"]]);
};
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save({ label: S.live ? "manuell" : "" }); }
  else if (e.ctrlKey && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  else if (e.ctrlKey && e.key.toLowerCase() === "y" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); redo(); }
  else if (e.key === "Escape") $("#modal").classList.add("hidden");
});
window.vps.onCloseRequest(() => {
  if (S.dirty && !S.live && !confirm("Ungespeicherte Änderungen verwerfen und beenden?")) return;
  window.vps.confirmClose();
});

async function remoteCard() {
  const ri = await window.vps.remoteInfo();
  const cmd = `claude mcp add --scope user velox-preset -- node "${ri.mcp}"`;
  return h("div", { class: "card" }, h("h3", {}, "Fernsteuerung für Claude (MCP)"),
    h("p", {}, "Damit kann Claude Code die App bedienen: Presets öffnen, Regler setzen, Effekte schalten, speichern, Screenshots ansehen. Nur lokal (127.0.0.1) mit zufälligem Schlüssel."),
    h("div", { class: "toolbar" },
      h("label", { class: "live" }, h("input", { type: "checkbox", checked: ri.on, onchange: async e => { await window.vps.setRemote(e.target.checked); renderSetup(); } }), h("span", { class: "sw" }), ri.on ? "Aktiv" : "Aus")),
    h("p", {}, "Einmalig in einem Terminal ausführen (Node.js nötig):"),
    h("div", { class: "toolbar" }, h("input", { value: cmd, readonly: true, style: "flex:1;font-family:Consolas,monospace;font-size:12px" }),
      h("button", { onclick: () => { navigator.clipboard.writeText(cmd); toast("Kopiert", true); } }, "Kopieren")));
}

// ============================================================ remote control (Claude via MCP)
const findPreset = a => {
  if (a.rel) return S.presets.find(p => sameRel(p.rel, a.rel));
  const n = String(a.name || "").toLowerCase();
  return S.presets.find(p => p.name.toLowerCase() === n) || S.presets.find(p => p.name.toLowerCase().includes(n));
};
const needCur = () => { if (!S.cur) throw new Error("Kein Preset offen – erst open"); };
async function setParamRemote(file, key, value) {
  needCur();
  if (value === null || value === undefined) { M.set(file, key, null); return; }
  if (typeof value === "string" && isNaN(Number(value.split(",")[0]))) { M.set(file, key, value); return; }
  const d = await fxDetails(file).catch(() => null);
  const u = d && d.uniforms ? d.uniforms.find(x => x.name === key) : null;
  let vals = Array.isArray(value) ? value.map(Number) : typeof value === "boolean" ? [value ? 1 : 0] : String(value).split(",").map(Number);
  if (u) {
    if (vals.length === 1 && u.dim > 1) vals = Array(u.dim).fill(vals[0]);
    M.set(file, key, fmtVals(u, vals.slice(0, u.dim)));
  } else M.set(file, key, vals.map(v => Number.isInteger(v) ? String(v) : v.toFixed(6)).join(","));
}
const REMOTE = {
  commands: { help: "Liste aller Befehle", run: () => Object.fromEntries(Object.entries(REMOTE).map(([k, v]) => [k, v.help])) },
  getCurrent: { help: "Offenes Preset: rel, name, Effektliste, ausgewählter Effekt, ungespeichert?, Live?", run: () => S.cur ? {
    rel: S.cur.rel, name: (S.presets.find(p => p.rel === S.cur.rel) || {}).name, enabled: M.enabled(), selected: S.sel,
    dirty: S.dirty, live: S.live, view: S.view, sections: S.cur.model.sections.map(s => s.name) } : { rel: null, live: S.live, view: S.view } },
  presets: { help: "Alle Presets {rel,name,folder}", run: () => S.presets.map(p => ({ rel: p.rel, name: p.name, folder: p.folder })) },
  open: { help: "{name|rel} Preset öffnen", run: async a => { const p = findPreset(a); if (!p) throw new Error("Preset nicht gefunden"); S.dirty = false; await openPreset(p.rel); showView("editor"); return { rel: p.rel }; } },
  model: { help: "Komplettes Preset-Modell {global:[[k,v]],sections:[{name,items:[[k,v]]}]}", run: () => (needCur(), S.cur.model) },
  findEffect: { help: "{query} Effekte/Techniken suchen", run: a => { const q = String(a.query || "").toLowerCase(); return S.techs.filter(t => (t.label + " " + t.name + " " + t.file + " " + (t.pack || "")).toLowerCase().includes(q)).slice(0, 80).map(t => ({ key: `${t.name}@${t.file}`, label: t.label, pack: t.pack || "" })); } },
  effect: { help: "{file} Regler eines Shaders mit Typ, Bereich, Standard und aktuellem Wert im offenen Preset", run: async a => {
    const d = await fxDetails(a.file);
    return { file: a.file, missing: !!d.missing, uniforms: d.uniforms.map(u => ({ key: u.name, label: u.label, category: u.category, type: u.base + (u.dim > 1 ? u.dim : ""), ui: u.ui_type, min: u.min, max: u.max, items: u.items, default: u.default, value: S.cur ? M.get(a.file, u.name) : null, tooltip: u.tooltip || undefined })),
      defines: d.defines.filter(x => x.own).map(x => ({ name: x.name, default: x.default, value: S.cur ? (M.defines(a.file)[x.name] ?? null) : null })) };
  } },
  select: { help: "{key} Effekt im Editor anzeigen (Name@Datei.fx)", run: a => { S.sel = a.key; showView("editor"); return { ok: true }; } },
  setParam: { help: "{file,key,value} Reglerwert setzen (Zahl, Array für float2/3/4, bool oder Text; null = Standard)", run: async a => { needCur(); beforeChange(); await setParamRemote(a.file, a.key, a.value); changed(true); return { value: M.get(a.file, a.key) }; } },
  setParams: { help: "{items:[{file,key,value}]} mehrere Werte auf einmal", run: async a => { needCur(); beforeChange(); for (const it of a.items || []) await setParamRemote(it.file, it.key, it.value); changed(true); return { count: (a.items || []).length }; } },
  setDefine: { help: "{file,name,value} Shader-Option / Textur setzen (Text, leer = Standard)", run: a => { needCur(); beforeChange(); const o = M.defines(a.file); o[a.name] = String(a.value ?? ""); M.setDefines(a.file, o); changed(true); return { ok: true }; } },
  enableEffect: { help: "{key,on} Effekt an/aus (Name@Datei.fx); neu = wird ans Ende gehängt", run: a => { needCur(); toggleFx(a.key, a.on !== false); return { enabled: M.enabled() }; } },
  order: { help: "{keys:[...]} Reihenfolge der aktiven Effekte setzen", run: a => { needCur(); beforeChange(); M.setOrder(a.keys || []); changed(true); return { enabled: M.enabled() }; } },
  takeFrom: { help: "{rel|name, file} alle Werte eines Shaders aus anderem Preset übernehmen", run: async a => {
    needCur(); const p = findPreset(a); if (!p) throw new Error("Quell-Preset nicht gefunden");
    const r = await api("/api/preset?rel=" + enc(p.rel)); const src = r.model.sections.find(s => s.name.toLowerCase() === String(a.file).toLowerCase());
    if (!src) throw new Error("Quell-Preset hat keine Werte für " + a.file);
    beforeChange(); M.sec(a.file, true).items = clone(src.items); changed(true); return { ok: true };
  } },
  save: { help: "{label?} speichern + Version sichern", run: async a => { await save({ label: a.label || "" }); return { ok: true }; } },
  live: { help: "{on} Live-Modus (jede Änderung sofort in die Datei)", run: a => { const t = $("#liveToggle"); if (t.checked !== !!a.on) t.click(); return { live: S.live }; } },
  undo: { help: "Rückgängig", run: () => (undo(), { ok: true }) },
  redo: { help: "Wiederholen", run: () => (redo(), { ok: true }) },
  newPreset: { help: "{name, folder?, from:'empty'|'current'} neues Preset anlegen und öffnen", run: async a => {
    const model = a.from === "current" && S.cur ? clone(S.cur.model) : { global: [["Techniques", ""], ["TechniqueSorting", ""]], sections: [] };
    const r = await api("/api/new", { name: a.name, folder: a.folder || "Eigene", model }); await loadPresets(); S.dirty = false; await openPreset(r.rel); return { rel: r.rel };
  } },
  activate: { help: "offenes Preset beim nächsten Spielstart aktiv setzen (Spiel muss zu sein)", run: async () => { needCur(); await api("/api/activate", { rel: S.cur.rel }); await loadState(); renderPresetList(); updateTop(); return { ok: true }; } },
  view: { help: "{name} Ansicht wechseln: editor|compare|textures|shots|versions|setup", run: a => (showView(a.name || "editor"), { ok: true }) },
  refresh: { help: "Presets/Zustand neu einlesen", run: async () => { await loadState(); await loadPresets(); return { ok: true }; } },
};
window.vps.onRemote(async (command, args) => {
  const c = REMOTE[command];
  if (!c) throw new Error("Unbekannter Befehl: " + command + " (siehe commands)");
  return await c.run(args || {});
});

// ============================================================ status bar + updates
function updateStatus() {
  $("#stFolder").textContent = S.state.folderOk ? S.state.folder : "Kein ReShade-Ordner gewählt";
  $("#stFolder").title = "Klicken zum Ändern";
}
$("#stFolder").onclick = () => showView("setup");
const upd = { state: "idle", percent: 0, version: "" };
function drawUpd() {
  const b = $("#updBtn");
  b.className = "upd " + upd.state;
  b.disabled = ["checking", "progress", "available"].includes(upd.state);
  b.textContent = {
    idle: "Nach Updates suchen", dev: "Entwicklerversion", checking: "Suche Updates…", none: "✓ Aktuell – erneut prüfen",
    available: `Update ${upd.version} gefunden…`, progress: `Update lädt ${Math.round(upd.percent)} %`,
    ready: `⟳ Update ${upd.version} installieren & neu starten`, error: "Update-Prüfung fehlgeschlagen – erneut",
  }[upd.state] || "Nach Updates suchen";
  if (upd.state === "error") b.title = upd.message || "";
}
window.vps.onUpdate(s => { Object.assign(upd, s); if (s.state === "available") upd.version = s.version; drawUpd(); });
$("#updBtn").onclick = async () => {
  if (upd.state === "ready") { if (S.dirty && !S.live) await save(); window.vps.installUpdate(); return; }
  upd.state = "checking"; drawUpd();
  const r = await window.vps.checkUpdate();
  if (r.state === "dev") { upd.state = "dev"; drawUpd(); }
  if (r.state === "error") { upd.state = "error"; upd.message = r.message; drawUpd(); }
};
window.vps.info().then(i => { $("#stVersion").textContent = "v" + i.version; if (!i.packaged) { upd.state = "dev"; drawUpd(); } });
$("#ghLink").onclick = () => window.vps.openUrl("https://github.com/VELOX-Designs/velox-preset-studio");
drawUpd();

(async function init() {
  await loadState().catch(e => toast("Server nicht erreichbar: " + e.message));
  updateStatus();
  await loadPresets();
  loadTechs();
  const last = localStorage.getItem("lastPreset");
  const start = (last && S.presets.find(p => p.rel === last)) ? last : (S.presets.find(p => sameRel(p.rel, S.state.active))?.rel);
  if (start) openPreset(start); else updateTop();
  if (!S.state.folderOk) showView("setup");
})();
