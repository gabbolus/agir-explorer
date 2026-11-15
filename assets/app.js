// AGIR Explorer - all computations happen in the browser from data/agir_data.js
(function () {
  "use strict";

  // ---------------------------------------------------------------- data ----
  const RICH = new Set(["Australia", "Austria", "Belgium", "Canada", "Czechia", "Denmark",
    "Finland", "France", "Germany", "Iceland", "Ireland", "Israel", "Italy", "Netherlands",
    "Norway", "Slovenia", "Spain", "Sweden", "Switzerland", "United Kingdom", "United States"]);
  const CAVEAT = {};   // countries kept out of the group averages (none at present)
  // country notes: data features that affect the interpretation (marked with † in the charts)
  const UNEMP = "Transfers exclude unemployment benefits (not reported consistently across survey years).";
  const NOTES = {
    "Israel": ["No individual-level transfer income in the LIS data; transfer components are zero by construction.", UNEMP],
    "Mexico": ["New ENIGH survey series from 2024; comparisons across 2024 are not like-for-like.", UNEMP],
    "Germany": ["Employment status missing for 15–26% of respondents aged 25–64 in 2018–2022; employment rates refer to respondents with non-missing status."],
    "Sweden": ["Sample size reduced from 2013 (to about one third of earlier years); lower precision from 2013 onwards."],
    "Denmark": ["Sample size increased from 2015 (about threefold)."],
    "Norway": ["Sample size increased from 2007."],
    "United Kingdom": ["Unusually small sample in 2020 (survey fieldwork affected by COVID-19)."],
    "Italy": ["Income taxes recorded from 2014; income treated as net throughout for consistency, as in the paper."],
    "Switzerland": ["Surveys before 2006 excluded, as in the paper."],
    "Paraguay": ["Small annual samples; year-to-year changes are imprecise. Wave averages are more reliable.", UNEMP],
    "Brazil": [UNEMP], "Chile": [UNEMP], "Colombia": [UNEMP], "Panama": [UNEMP], "Peru": [UNEMP], "Romania": [UNEMP]
  };
  const NOTE_MARK = "†";
  const withMark = c => (NOTES[c] ? `${c}${NOTE_MARK}` : c);
  const pickName = c => withMark(c) + (CAVEAT[c] ? ` <span class="nm-sub">(not in averages)</span>` : "");
  const noteText = c => (NOTES[c] || []).join(" ");
  const WAVES = { 1: "2004–06", 2: "2007–09", 3: "2010–12", 4: "2013–15", 5: "2016–18",
    6: "2019–21", 7: "2022–24", 8: "2025–27" };
  const OLD = 5, YOUNG = 2;
  const MARGINS = [
    { key: "wage", label: "Wages", color: "--m-wage" },
    { key: "employ", label: "Employment", color: "--m-emp" },
    { key: "tr_inc", label: "Transfer income", color: "--m-trinc" },
    { key: "tr_share", label: "Transfer share", color: "--m-trsh" },
    { key: "other", label: "Other income", color: "--m-oth" }
  ];

  const num = v => (v === "" || v === undefined ? NaN : +v);
  const lines = window.AGIR_CSV.trim().split("\n");
  const head = lines[0].split(",");
  const rows = lines.slice(1).map(l => {
    const v = l.split(","), o = {};
    head.forEach((h, i) => { o[h] = (h === "Country" || h === "pt") ? v[i] : num(v[i]); });
    if (isNaN(o.th) && o.p === 0) o.th = 0;   // nobody receives transfers
    return o;
  });
  const groupOf = c => (RICH.has(c) ? "High-income" : "Middle-income");
  const countries = [...new Set(rows.map(r => r.Country))].sort();

  // index: cell[pt][country][period][age]
  const cell = { year: {}, wave: {} };
  rows.forEach(r => {
    const a = (cell[r.pt][r.Country] ||= {});
    (a[r.period] ||= {})[r.age] = r;
  });

  // annual AGIR by country-year, and wave AGIR = mean of annual AGIRs (as in the paper)
  function agirYear(c, yr) {
    const k = cell.year[c] && cell.year[c][yr];
    if (!k || !k[OLD] || !k[YOUNG]) return null;
    const o = k[OLD], y = k[YOUNG], R = o.y / y.y;
    const se = R * Math.sqrt((o.yse / o.y) ** 2 + (y.yse / y.y) ** 2);
    return { v: R, se };
  }
  const waveOf = yr => Math.min(Math.floor((yr - 2004) / 3) + 1, 8);
  function agirSeries(c, ptype) {
    const years = Object.keys(cell.year[c] || {}).map(Number).sort((a, b) => a - b);
    const annual = years.map(yr => ({ t: yr, ...agirYear(c, yr) })).filter(d => d.v);
    if (ptype === "year") return annual;
    const byW = {};
    annual.forEach(d => (byW[waveOf(d.t)] ||= []).push(d));
    return Object.keys(byW).map(Number).sort((a, b) => a - b).map(w => {
      const a = byW[w], n = a.length;
      return { t: w, v: a.reduce((s, d) => s + d.v, 0) / n,
        se: Math.sqrt(a.reduce((s, d) => s + d.se ** 2, 0)) / n };
    });
  }
  // Group averages with last-value-carried-forward: a country with no survey in a
  // period keeps its most recent AGIR (from its first survey onwards). Points that
  // use carried-forward values are flagged as including carried-forward values.
  function groupSeries(list, ptype) {
    const grid = periodsAvailable(ptype);
    const acc = {};
    list.forEach(c => {
      const obs = {};
      agirSeries(c, ptype).forEach(d => { obs[d.t] = d; });
      let last = null;
      grid.forEach(t => {
        if (obs[t]) { last = obs[t]; (acc[t] ||= []).push({ ...obs[t], c, imp: false }); }
        else if (last) { (acc[t] ||= []).push({ ...last, c, imp: true }); }
      });
    });
    return grid.filter(t => acc[t]).map(t => {
      const a = acc[t], n = a.length, imp = a.filter(d => d.imp).map(d => d.c);
      return { t, n, imp, v: a.reduce((s, d) => s + d.v, 0) / n,
        se: Math.sqrt(a.reduce((s, d) => s + d.se ** 2, 0)) / n };
    });
  }

  // GRD decomposition between two periods (exact split, as in LISSY_03)
  // nearest available endpoints inside [from, to] when state.exact is false
  function endpoints(c, ptype, from, to) {
    const P = cell[ptype][c];
    if (!P) return null;
    const ok = Object.keys(P).map(Number).filter(t => P[t][OLD] && P[t][YOUNG]).sort((a, b) => a - b);
    if (state.exact) return ok.includes(from) && ok.includes(to) ? [from, to] : null;
    const f = ok.find(t => t >= from), l = [...ok].reverse().find(t => t <= to);
    return f !== undefined && l !== undefined && f < l ? [f, l] : null;
  }
  function decomp(c, ptype, from0, to0) {
    const P = cell[ptype][c];
    const ep = endpoints(c, ptype, from0, to0);
    if (!ep) return null;
    const [from, to] = ep;
    const out = {};
    for (const age of [OLD, YOUNG]) {
      const a = P[from][age], b = P[to][age];
      if (!a || !b) return null;
      const h = b.yrm - a.yrm;
      if (!(h > 0)) return null;
      const r0 = a.y - a.e * a.w - a.p * a.th, r1 = b.y - b.e * b.w - b.p * b.th;
      const d = x => 100 * x / a.y / h;   // percentage points per year
      out[age] = {
        growth: d(b.y - a.y), wage: d(b.e * (b.w - a.w)), employ: d(a.w * (b.e - a.e)),
        tr_inc: d(b.p * (b.th - a.th)), tr_share: d(a.th * (b.p - a.p)), other: d(r1 - r0), h
      };
    }
    const res = { country: c, group: groupOf(c), h: out[OLD].h, from, to };
    ["growth", ...MARGINS.map(m => m.key)].forEach(k => { res[k] = out[OLD][k] - out[YOUNG][k]; });
    if (MARGINS.some(m => !isFinite(res[m.key]))) return null;
    return res;
  }

  // ------------------------------------------------------------- helpers ----
  const css = n => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(n).trim();
  const $ = id => document.getElementById(id);
  const fmt = (x, d = 2) => (!isFinite(x) ? "–" : Math.abs(x) < 0.5 * 10 ** -d ? (0).toFixed(d) : (x > 0 ? "+" : "") + x.toFixed(d));
  // break long hover text into lines of ~70 characters
  const wrap = (t, n = isNarrow() ? 30 : 70) => t.replace(new RegExp(`(.{1,${n}})(\\s|$)`, "g"), "$1<br>").replace(/<br>$/, "");
  // compact period text for phone row labels: from ’07, to ’21, ’07–’21, only ’10
  const cYr = (ptype, t, end) => { if (ptype !== "wave") return "\u2019" + String(t).slice(2); const m = WAVES[t].match(/^(\d{4})\u2013(\d\d)$/); return "\u2019" + (end ? m[2] : m[1].slice(2)); };
  const cOnly = (ptype, t) => ptype !== "wave" ? "\u2019" + String(t).slice(2) : (m => "\u2019" + m[1].slice(2) + "\u2013" + m[2])(WAVES[t].match(/^(\d{4})\u2013(\d\d)$/));
  const label = (ptype, t) => (ptype === "wave" ? WAVES[t] : String(t));
  function hexA(hex, a) {
    const h = hex.replace("#", ""), n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function baseLayout() {
    return {
      paper_bgcolor: css("--surface-1"), plot_bgcolor: css("--surface-1"),
      font: { family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 14, color: css("--text-secondary") },
      dragmode: false,
      margin: { l: 56, r: 16, t: 36, b: 40 },
      hoverlabel: { align: "left", bgcolor: css("--surface-1"), bordercolor: css("--border"), font: { color: css("--text-primary") } },
      legend: { orientation: "h", y: 1.01, yanchor: "bottom", x: 0, font: { color: css("--text-primary") } }
    };
  }
  const axis = extra => Object.assign({ fixedrange: true, gridcolor: css("--grid"), zerolinecolor: css("--text-muted"),
    linecolor: css("--border"), tickfont: { color: css("--text-secondary") } }, extra);
  // charts are fixed: no zoom or pan by touch, mouse or scroll (hover/tap for values still works)
  const CONFIG = { responsive: true, displaylogo: false, scrollZoom: false, doubleClick: false,
    modeBarButtonsToRemove: ["zoom2d", "pan2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d", "lasso2d", "select2d"] };

  // the chart's own camera button is replaced so the saved picture still has a legend
  function exportPng(gd, name, legend = true) {
    const lay = legend ? Object.assign({}, gd.layout, { showlegend: true, margin: Object.assign({}, gd.layout.margin, { t: 60 }),
      legend: Object.assign({}, gd.layout.legend, { traceorder: "normal" }) }) : Object.assign({}, gd.layout);
    Plotly.toImage({ data: gd.data, layout: lay }, { format: "png", width: gd.offsetWidth, height: gd.offsetHeight + (legend ? 46 : 0), scale: 2 })
      .then(url => { const a = document.createElement("a"); a.href = url; a.download = name + ".png"; document.body.appendChild(a); a.click(); a.remove(); });
  }
  const AGIR_CONFIG = Object.assign({}, CONFIG, { modeBarButtonsToRemove: [...CONFIG.modeBarButtonsToRemove, "toImage"],
    modeBarButtonsToAdd: [{ name: "Download plot as a PNG", icon: Plotly.Icons.camera, click: gd => exportPng(gd, "age_group_income_ratio") }] });

  const PHONE_CONFIG = Object.assign({}, CONFIG, { displayModeBar: false });
  const isNarrow = () => window.innerWidth < 600;
  let announceTimer;
  function announce(msg) {          // screen-reader status message after a control changes
    const el = $("status"); el.textContent = "";
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.textContent = msg; }, 250);
  }

  // --------------------------------------------------------------- state ----
  const state = { ptype: "wave", from: 1, to: 7, ov: { ptype: "wave", from: 1, to: 7 }, dr: { ptype: "wave", from: 1, to: 7 }, group: "all", sort: "grd", cmp: [], grp: { "High-income": true, "Middle-income": true }, osort: "to", drAll: false, ovTable: false, table: false, agirTable: false, exact: false,
    ovSel: { c: new Set(), g: { "High-income": true, "Middle-income": true } }, drSel: { c: new Set(), g: { "High-income": true, "Middle-income": true } } };
  countries.forEach(c => { state.ovSel.c.add(c); state.drSel.c.add(c); });

  function periodsAvailable(ptype) {
    const s = new Set();
    rows.filter(r => r.pt === ptype).forEach(r => s.add(r.period));
    return [...s].sort((a, b) => a - b).filter(t => ptype === "year" || t <= 7);
  }
  // each chart has its own period choice: type (waves or single years), from and to
  function fillPer(o, ids) {
    const ps = periodsAvailable(o.ptype);
    if (!ps.includes(o.from)) o.from = ps[0];
    if (!ps.includes(o.to)) o.to = o.ptype === "wave" ? 7 : ps[ps.length - 1];
    $(ids[0]).value = o.ptype;
    ids.slice(1).forEach((id, k) => {
      $(id).innerHTML = ps.map(t => `<option value="${t}">${label(o.ptype, t)}</option>`).join("");
      $(id).value = k === 0 ? o.from : o.to;
    });
  }
  const PER = [[state, ["ptype", "from", "to"]], [state.ov, ["ovPtype", "ovFrom", "ovTo"]], [state.dr, ["drPtype", "drFrom", "drTo"]]];
  function fillPeriods() { PER.forEach(([o, ids]) => fillPer(o, ids)); }
  function wirePer(o, ids, render, msg) {
    $(ids[0]).addEventListener("change", e => {
      o.ptype = e.target.value;
      if (o.ptype === "year") { o.from = 2004; o.to = 2022; } else { o.from = 1; o.to = 7; }
      fillPer(o, ids); render(); announce(msg());
    });
    $(ids[1]).addEventListener("change", e => { o.from = +e.target.value; render(); announce(msg()); });
    $(ids[2]).addEventListener("change", e => { o.to = +e.target.value; render(); announce(msg()); });
  }
  // ---- line picker: any mix of the two group averages and up to MAXC countries
  const MAXC = 6;
  const SLOT_COL = ["--series-3", "--series-4", "--series-5", "--series-6", "--series-7", "--series-8"];
  const SLOT_SYM = ["diamond", "triangle-up", "star", "pentagon", "triangle-down", "hexagon"];
  const GROUPS = [["High-income", "--series-1"], ["Middle-income", "--series-2"]];
  const GSYM = { "High-income": "circle", "Middle-income": "square" };
  // small picture of a line as drawn in the chart: its colour, dash and marker shape
  function lineIcon(sym, col, dash = false) {
    const f = `fill="var(${col})"`;
    const shape = sym === "circle" ? `<circle cx="6" cy="6" r="4.5" ${f}/>` : sym === "square" ? `<rect x="1.5" y="1.5" width="9" height="9" ${f}/>`
      : `<polygon points="${SHAPES[sym]}" ${f}/>`;
    return `<svg class="ico" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" focusable="false"><line x1="0" y1="6" x2="28" y2="6" stroke="var(${col})" stroke-width="2"${dash ? ' stroke-dasharray="5 3"' : ""}/><g transform="translate(8 0)">${shape}</g></svg>`;
  }
  const groupIcon = g => lineIcon(GSYM[g], GROUPS.find(x => x[0] === g)[1], g === "Middle-income");
  const countryIcon = c => lineIcon(SLOT_SYM[slotOf[c]], SLOT_COL[slotOf[c]]);
  // ticked countries are bold, with a dot in their line colour, in the other charts too
  const hiLabel = (c, n) => c && state.cmp.includes(c) ? `<span style="color:${css(SLOT_COL[slotOf[c]])}">\u25CF</span> <b>${n}</b>` : n;
  const slotOf = {};
  const anyGroup = () => state.grp["High-income"] || state.grp["Middle-income"];
  function setCountry(c, on) {
    const i = state.cmp.indexOf(c);
    if (on && i < 0) {
      if (state.cmp.length >= MAXC) return false;
      const used = new Set(state.cmp.map(x => slotOf[x]));
      let s = 0; while (used.has(s)) s++;
      slotOf[c] = s; state.cmp.push(c);
    }
    if (!on && i >= 0) { state.cmp.splice(i, 1); delete slotOf[c]; }
    return true;
  }
  function lineLabel() {
    const ng = Object.values(state.grp).filter(Boolean).length;
    return `Choose lines \u00b7 ${ng + state.cmp.length}`;
  }
  function buildPicker() {
    const row = (key, text, extra = "") => `<label class="prow" data-key="${key}" data-name="${text.replace(/<[^>]+>/g, "").toLowerCase()}"><input type="checkbox" value="${key}"><span class="sw" aria-hidden="true"></span><span class="nm">${text}</span>${extra}</label>`;
    const sect = (title, items) => `<div class="p-sec" role="group" aria-label="${title}"><h3>${title}</h3>${items}</div>`;
    const cl = g => countries.filter(c => groupOf(c) === g);
    $("pickList").innerHTML =
      sect("Group averages", GROUPS.map(([g]) => row("G:" + g, g + " average")).join("")) +
      GROUPS.map(([g]) => sect(`${g} countries`, cl(g).map(c => row("C:" + c, pickName(c))).join(""))).join("") +
      `<p class="p-empty" id="pickEmpty" hidden>No country matches your search.</p>`;
  }
  function syncPicker() {
    const full = state.cmp.length >= MAXC;
    document.querySelectorAll("#pickList .prow").forEach(r => {
      const key = r.dataset.key, cb = r.querySelector("input");
      let on, ico = "";
      if (key.startsWith("G:")) { const g = key.slice(2); on = state.grp[g]; if (on) ico = groupIcon(g); }
      else { const c = key.slice(2); on = state.cmp.includes(c); if (on) ico = countryIcon(c); }
      cb.checked = !!on;
      cb.disabled = !on && key.startsWith("C:") && full;
      r.classList.toggle("off", cb.disabled);
      r.querySelector(".sw").innerHTML = ico;
    });
    $("pickLabel").textContent = lineLabel();
    $("pickCount").textContent = `${state.cmp.length} of ${MAXC} countries` + (full ? ": untick one to add another." : ".");
    const chips = [];
    GROUPS.forEach(([g]) => { if (state.grp[g]) chips.push([`G:${g}`, `${g} average`, groupIcon(g), `${g} avg`]); });
    state.cmp.forEach(c => chips.push([`C:${c}`, withMark(c), countryIcon(c)]));
    $("selChips").innerHTML = chips.length
      ? chips.map(([k, t, ico, short]) => `<li><button type="button" class="chip-x" data-key="${k}" aria-label="Remove ${t.replace(NOTE_MARK, "")} from the chart">${ico}${short ? `<span class="full">${t}</span><span class="short" aria-hidden="true">${short}</span>` : t}<span class="x" aria-hidden="true">&times;</span></button></li>`).join("")
      : `<li class="none">No lines selected.</li>`;
  }
  function togglePick(key, on) {
    let ok = true, name;
    if (key.startsWith("G:")) { name = key.slice(2) + " average"; state.grp[key.slice(2)] = on; }
    else { name = key.slice(2); ok = setCountry(name, on); }
    syncPicker();
    if (!ok) { announce(`Maximum of ${MAXC} countries. Untick one to add another.`); return; }
    renderAll();
    announce(`${name} ${on ? "added to" : "removed from"} the chart. ${state.cmp.length} countries and ${Object.values(state.grp).filter(Boolean).length} averages shown.`);
  }
  function openPicker(open) {
    const p = $("pickPanel");
    p.hidden = !open; $("pickBackdrop").hidden = !open || !isNarrow();
    $("pickBtn").setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("sheet-open", open && isNarrow());
    if (open) { p.focus({ preventScroll: true }); }
    else { $("pickSearch").value = ""; filterPicker(); }
  }
  function filterPicker() {
    const q = $("pickSearch").value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll("#pickList .prow").forEach(r => {
      const hit = !q || r.dataset.name.includes(q);
      r.hidden = !hit;
      if (hit && r.dataset.key.startsWith("C:")) shown++;
    });
    document.querySelectorAll("#pickList .p-sec").forEach(s => { s.hidden = ![...s.querySelectorAll(".prow")].some(r => !r.hidden); });
    $("pickEmpty").hidden = !q || shown > 0;
  }
  function wirePicker() {
    buildPicker(); syncPicker();
    $("pickBtn").addEventListener("click", () => openPicker($("pickPanel").hidden));
    $("pickDone").addEventListener("click", () => { openPicker(false); $("pickBtn").focus(); });
    $("pickBackdrop").addEventListener("click", () => openPicker(false));
    $("pickSearch").addEventListener("input", filterPicker);
    $("pickClear").addEventListener("click", () => {
      GROUPS.forEach(([g]) => { state.grp[g] = false; });
      state.cmp.slice().forEach(c => setCountry(c, false));
      syncPicker(); renderAll(); announce("All lines removed from the chart.");
    });
    $("pickList").addEventListener("change", e => { if (e.target.matches("input")) togglePick(e.target.value, e.target.checked); });
    $("selChips").addEventListener("click", e => {
      const b = e.target.closest(".chip-x"); if (!b) return;
      const next = b.closest("li").nextElementSibling || b.closest("li").previousElementSibling;
      togglePick(b.dataset.key, false);
      const f = next && next.querySelector(".chip-x"); (f || $("pickBtn")).focus();
    });
    document.addEventListener("click", e => { if (!$("pickPanel").hidden && !isNarrow() && !e.target.closest("#picker")) openPicker(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pickPanel").hidden) { openPicker(false); $("pickBtn").focus(); } });
  }


  // ---- country pickers for the two lower charts: any set of countries, plus the two group averages
  function subPicker(id, sel, onChange, what) {
    const root = $(id), N = countries.length;
    root.innerHTML = `<button type="button" aria-haspopup="dialog" aria-expanded="false"><span class="pl"></span><span class="caret" aria-hidden="true">&#9662;</span></button>` +
      `<div class="backdrop" hidden></div><div class="panel" role="dialog" aria-label="Choose which countries to show in the ${what}" tabindex="-1" hidden>` +
      `<div class="p-head"><input type="search" placeholder="Search countries" aria-label="Search countries" autocomplete="off"><button type="button" class="pnone">Clear all</button></div>` +
      `<div class="p-body"><div class="p-quick" role="group" aria-label="Quick choices"><button type="button" data-q="all">All countries</button><button type="button" data-q="High-income">High-income only</button><button type="button" data-q="Middle-income">Middle-income only</button></div>` +
      `<div class="p-sec" role="group" aria-label="Group averages"><h3>Group averages</h3>${GROUPS.map(([g]) => `<label class="prow" data-key="G:${g}" data-name="${g.toLowerCase()} average"><input type="checkbox" value="G:${g}"><span class="nm">${g} average</span></label>`).join("")}</div>` +
      GROUPS.map(([g]) => `<div class="p-sec" role="group" aria-label="${g} countries"><h3>${g} countries</h3>${countries.filter(c => groupOf(c) === g).map(c => `<label class="prow" data-key="C:${c}" data-name="${c.toLowerCase()}"><input type="checkbox" value="C:${c}"><span class="nm">${pickName(c)}</span></label>`).join("")}</div>`).join("") +
      `<p class="p-empty" hidden>No country matches your search.</p></div>` +
      `<div class="p-foot"><span class="pc" aria-live="polite"></span><button type="button" class="primary pdone">Done</button></div></div>`;
    const btn = root.querySelector(":scope > button"), panel = root.querySelector(".panel"), back = root.querySelector(".backdrop"), search = root.querySelector("input[type=search]");
    const sync = () => {
      root.querySelectorAll(".prow").forEach(r => {
        const k = r.dataset.key; r.querySelector("input").checked = k.startsWith("G:") ? !!sel.g[k.slice(2)] : sel.c.has(k.slice(2));
      });
      const na = Object.values(sel.g).filter(Boolean).length;
      root.querySelector(".pl").textContent = `Countries · ${sel.c.size === N ? "all " + N : sel.c.size + " of " + N}` + (na < 2 ? ` · ${na} avg` : "");
      root.querySelector(".pc").textContent = `${sel.c.size} of ${N} countries.`;
    };
    const open = o => {
      panel.hidden = !o; back.hidden = !o || !isNarrow();
      btn.setAttribute("aria-expanded", String(o));
      document.documentElement.classList.toggle("sheet-open", o && isNarrow());
      if (o) panel.focus({ preventScroll: true }); else { search.value = ""; filter(); }
    };
    const filter = () => {
      const q = search.value.trim().toLowerCase(); let shown = 0;
      root.querySelectorAll(".prow").forEach(r => { const hit = !q || r.dataset.name.includes(q); r.hidden = !hit; if (hit && r.dataset.key.startsWith("C:")) shown++; });
      root.querySelectorAll(".p-sec").forEach(s => { s.hidden = ![...s.querySelectorAll(".prow")].some(r => !r.hidden); });
      root.querySelector(".p-quick").hidden = !!q;
      root.querySelector(".p-empty").hidden = !q || shown > 0;
    };
    const change = msg => { sync(); onChange(); announce(msg + ` ${sel.c.size} countries shown.`); };
    btn.addEventListener("click", () => open(panel.hidden));
    root.querySelector(".pdone").addEventListener("click", () => { open(false); btn.focus(); });
    back.addEventListener("click", () => open(false));
    search.addEventListener("input", filter);
    root.querySelector(".pnone").addEventListener("click", () => { sel.c.clear(); change("All countries removed."); });
    root.querySelector(".p-quick").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      sel.c.clear(); countries.filter(c => b.dataset.q === "all" || groupOf(c) === b.dataset.q).forEach(c => sel.c.add(c));
      change(b.textContent + ".");
    });
    root.querySelector(".p-body").addEventListener("change", e => {
      if (!e.target.matches("input")) return;
      const k = e.target.value, on = e.target.checked;
      if (k.startsWith("G:")) sel.g[k.slice(2)] = on; else (on ? sel.c.add(k.slice(2)) : sel.c.delete(k.slice(2)));
      change(`${k.slice(2)}${k.startsWith("G:") ? " average" : ""} ${on ? "added" : "removed"}.`);
    });
    document.addEventListener("click", e => { if (!panel.hidden && !isNarrow() && !e.target.closest("#" + id)) open(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { open(false); btn.focus(); } });
    sync();
    return sync;
  }
  let syncOvPicker = () => {}, syncDrPicker = () => {};

  // ------------------------------------------------------------ chart 1 ----
  let agirTbl = [];
  function renderAgir() {
    const traces = [], summ = [], tbl = [], impAll = {}, ends = [];
    const inRange = d => d.filter(p => p.t >= state.from && p.t <= state.to);
    const xs = d => d.map(p => (state.ptype === "wave" ? WAVES[p.t] : p.t));
    // each line has its own marker shape; filled = observed, open = includes carried-forward values
    [["High-income", "--series-1", "solid", "circle"], ["Middle-income", "--series-2", "dash", "square"]].filter(x => state.grp[x[0]]).forEach(([g, col, dash, sym]) => {
      const s = inRange(groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), state.ptype));
      const c = css(col);
      tbl.push({ name: `${g} average`, pts: s.map(d => ({ t: d.t, v: d.v, ci: 1.96 * d.se, imp: d.imp.length > 0 })) });
      summ.push(`${g} average: ` + s.map(d => `${label(state.ptype, d.t)} ${d.v.toFixed(2)}${d.imp.length ? " (includes carried-forward values)" : ""}`).join(", ") + ".");
      traces.push({ x: xs(s), y: s.map(d => d.v + 1.96 * d.se), mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      traces.push({ x: xs(s), y: s.map(d => d.v - 1.96 * d.se), mode: "lines", line: { width: 0 }, fill: "tonexty",
        fillcolor: hexA(c, 0.15), hoverinfo: "skip", showlegend: false });
      impAll[g] = [...new Set(s.flatMap(d => d.imp))];
      if (s.length) ends.push({ x: xs(s)[s.length - 1], y: s[s.length - 1].v, text: g, color: c });
      traces.push({ x: xs(s), y: s.map(d => d.v), name: `${g} average`, mode: "lines+markers",
        line: { color: c, width: 2, dash },
        marker: { size: 9, symbol: s.map(d => d.imp.length ? `${sym}-open` : sym), color: c,
          line: { color: s.map(d => d.imp.length ? c : css("--surface-1")), width: 2 } },
        customdata: s.map(d => [d.n]),
        hovertemplate: `<b>${g} average</b><br>%{x}: %{y:.3f}<extra></extra>` });
    });
    const cols = SLOT_COL, syms = SLOT_SYM;
    // country lines: observed values only. The line joins the observed surveys; missing
    // periods have no marker or value and are listed as "no data" - never imputed.
    const grid = periodsAvailable(state.ptype).filter(t => t >= state.from && t <= state.to), noData = [];
    state.cmp.forEach(c => {
      const i = slotOf[c];
      const obs = {};
      agirSeries(c, state.ptype).forEach(d => { obs[d.t] = d; });
      const col = css(cols[i]);
      const pts = grid.map(t => obs[t] || { t, v: null, se: null });
      const miss = grid.filter(t => !obs[t]).map(t => label(state.ptype, t));
      const seen = pts.filter(d => d.v !== null);
      tbl.push({ name: withMark(c), pts: seen.map(d => ({ t: d.t, v: d.v, ci: 1.96 * d.se, imp: false })) });
      summ.push(`${c}: ` + seen.map(d => `${label(state.ptype, d.t)} ${d.v.toFixed(2)}`).join(", ") + (miss.length ? `; no data for ${miss.join(", ")}` : "") + ".");
      if (miss.length) noData.push(`${c}: ${miss.join(", ")}`);
      if (seen.length) ends.push({ x: xs([seen[seen.length - 1]])[0], y: seen[seen.length - 1].v, text: withMark(c), color: col });
      traces.push({ x: xs(pts), y: pts.map(d => d.v), name: withMark(c), mode: "lines+markers", connectgaps: true,
        line: { color: col, width: 2 }, marker: { size: 12, symbol: syms[i], color: col, line: { color: css("--surface-1"), width: 1 } },
        error_y: { type: "data", array: pts.map(d => (d.se === null ? null : 1.96 * d.se)), color: hexA(col, 0.8), thickness: 1.75, width: 3 },
        hovertemplate: `<b>${c}</b><br>%{x}: %{y:.3f}<extra></extra>` });
    });
    const lay = baseLayout();
    lay.xaxis = axis({ type: "category", categoryorder: "array",
      categoryarray: (state.ptype === "wave" ? periodsAvailable("wave").map(t => WAVES[t]) : periodsAvailable("year")).filter((_, k) => { const t = periodsAvailable(state.ptype)[k]; return t >= state.from && t <= state.to; }) });
    lay.yaxis = axis({ title: { text: "Age Group Income Ratio, 55–64 / 25–34", font: { color: css("--text-secondary") } } });
    lay.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--text-muted"), width: 1, dash: "dot" } }];
    lay.hovermode = "x unified";
    lay.showlegend = false; lay.margin.t = 14;   // the chips above the chart are the legend
    if (isNarrow()) { lay.yaxis.title.text = "AGIR, 55–64 / 25–34"; lay.margin.r = 24; lay.margin.b = 64; lay.xaxis.automargin = true; lay.xaxis.tickangle = -40; lay.xaxis.tickfont = { size: 13, color: css("--text-secondary") }; }
    // direct labels at the end of each line (desktop); the chips above stay the controls
    if (!isNarrow() && ends.length) {
      const ally = traces.flatMap(t => (t.y || []).filter(v => v !== null && isFinite(v)));
      const rng = Math.max(0.05, Math.max(...ally, 1) - Math.min(...ally, 1));
      const plotH = (($("agirChart").clientHeight || 420) - 14 - 40) / (rng * 1.1);
      const byX = {};
      ends.forEach(e => (byX[e.x] ||= []).push(e));
      Object.values(byX).forEach(g => {
        g.sort((a, b) => b.y - a.y);
        let prev = null;
        g.forEach(e => { let px = e.y * plotH; if (prev !== null && px > prev - 16) px = prev - 16; e.shift = px - e.y * plotH; prev = px; });
      });
      lay.annotations = ends.map(e => ({ xref: "x", yref: "y", x: e.x, y: e.y, text: `<span style="color:${e.color}">\u25CF</span> ${e.text}`, showarrow: false,
        xanchor: "left", xshift: 12, yshift: e.shift, font: { size: 13, color: css("--text-primary") } }));
      lay.margin.r = Math.min(210, 24 + 7.4 * Math.max(...ends.map(e => e.text.length + 2)));
    }
    const chartEl = $("agirChart");
    if (state.from > state.to) { traces.length = 0; chartEl.dataset.msg = "order"; } else delete chartEl.dataset.msg;
    if (!traces.length) {
      Plotly.purge("agirChart");
      chartEl.innerHTML = chartEl.dataset.msg === "order" ? `<p class="note empty-msg">Choose a &ldquo;To&rdquo; period that is not before the &ldquo;From&rdquo; period.</p>` : `<p class="note empty-msg">Nothing to show: open &ldquo;Choose lines&rdquo; and tick a group average or a country.</p>`;
    } else {
      if (chartEl.querySelector(".empty-msg")) chartEl.innerHTML = "";
      Plotly.react("agirChart", traces, lay, isNarrow() ? PHONE_CONFIG : AGIR_CONFIG);
    }
    $("agirSummary").textContent = "Line chart of the Age Group Income Ratio, 55 to 64 year-olds over 25 to 34 year-olds, by period. A value above 1 means older people have the higher average income. " + summ.join(" ");
    agirTbl = tbl; renderAgirTable();
    const how = "<strong>Carried-forward values.</strong> Group averages keep every country in every period: when a country has no survey in a period, its latest available Age Group Income Ratio is carried forward. " +
      ["High-income", "Middle-income"].filter(g => impAll[g] && impAll[g].length).map(g => `<br><strong>${g}, carried forward in at least one period:</strong> ${impAll[g].join(", ")}.`).join("") + "<br>" +
      (state.ptype === "year" ? "With single years, many values are carried forward between surveys, so waves are more reliable. " : "") +
      "Country lines show observed values only.";
    const readMe = "<strong>How to read the chart.</strong> The dotted line marks equal incomes (ratio of 1). Vertical lines on countries" + (anyGroup() ? " and shaded bands on group averages" : "") + " are 95% confidence intervals." +
      (anyGroup() ? " Filled markers are observed values; hollow markers include carried-forward values." : "") +
      " A country line joins the surveys we observe; a period without a survey has no marker and nothing is imputed." +
      "<br><strong>Periods, From and To</strong> choose the range shown here and in the summary cards below the chart. The two charts further down have their own period choice.";
    const groupNote = anyGroup() ? "<br>" + how : "";
    const cnotes = state.cmp.filter(c => NOTES[c]).map(c => `<br><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}`).join("");
    $("agirNote").innerHTML = `<button type="button" class="imp-btn inline pill" aria-expanded="false" aria-controls="imp-agir"><span class="i" aria-hidden="true">i</span>Notes</button>` +
      `<div class="imp-pop" id="imp-agir" role="note" hidden>${readMe}${groupNote}${cnotes}</div>`;
    renderReadLine(); syncUrl();
  }

  // ---- "What the line says": plain-language reading of one or two country lines
  const SHAPES = {
    "diamond": "6,0 12,6 6,12 0,6", "triangle-up": "6,0.5 12,11.5 0,11.5", "triangle-down": "0,0.5 12,0.5 6,11.5",
    "pentagon": "6,0 11.7,4.4 9.5,11.2 2.5,11.2 0.3,4.4", "hexagon": "3,0.5 9,0.5 12,6 9,11.5 3,11.5 0,6",
    "star": "6,0 7.5,4.2 12,4.4 8.5,7.2 9.7,11.6 6,9 2.3,11.6 3.5,7.2 0,4.4 4.5,4.2" };
  const pct = v => Math.round(100 * (v - 1));
  const gapWords = (v, than = true) => { const p = pct(v); return p === 0 ? "about the same" + (than ? " as" : "") : `${Math.abs(p)}% ${p > 0 ? "higher" : "lower"}` + (than ? " than" : ""); };
  const gapThan = v => `<strong>${gapWords(v, false)}</strong>${pct(v) === 0 ? " as" : " than"}`;
  function renderReadLine() {
    const { ptype, from, to } = state, P = t => label(ptype, t);
    const old = `<span class="chip old">55&ndash;64</span>`, young = `<span class="chip young">25&ndash;34</span>`;
    const useC = state.cmp.length >= 1 && state.cmp.length <= 2;
    const hint = $("readLineHint");
    $("readLineTitle").textContent = useC && state.cmp.length === 1 ? "What the line says" : "What the lines say";
    if (from >= to) { hint.hidden = false; hint.textContent = "Choose a \u201cTo\u201d period after the \u201cFrom\u201d period."; $("readLineBody").innerHTML = ""; return; }
    hint.hidden = useC;
    hint.textContent = useC ? "" : `Average of the countries in each group. Tick ${state.cmp.length > 2 ? "only " : ""}one or two countries in the chart above to read their lines here.`;
    const fig = d => `<div class="fig"><div class="yr">${P(d.t)}</div><div class="big">${d.v.toFixed(2)}</div><div class="sub">AGIR${d.imp && d.imp.length ? ", incl. carried-forward values" : ""}</div></div>`;
    const card = (col, ico, title, pts, who, edge = () => "", extra = "") => {
      const head = `<header>${ico}<h3>${title}</h3></header>`;
      if (!pts.length) return `<article class="lc" style="--lc:var(${col})">${head}<p>No survey for this country between ${P(from)} and ${P(to)}.</p></article>`;
      const a = pts[0], z = pts[pts.length - 1];
      if (a === z) return `<article class="lc" style="--lc:var(${col})">${head}<div class="pair">${fig(a)}</div><p>${who}, the average income of ${old} year-olds was ${gapThan(a.v)} that of ${young} year-olds in ${P(a.t)}. That is the only survey in the selected range.</p>${extra}</article>`;
      const dp = Math.round(100 * (z.v - a.v));
      const delta = dp === 0 ? "The figure is unchanged." : `A change of <strong>${dp > 0 ? "+" : "\u2212"}${Math.abs(dp)} percentage points</strong> since ${P(a.t)}.`;
      return `<article class="lc" style="--lc:var(${col})">${head}<div class="pair">${fig(a)}<span class="arrow" aria-hidden="true">&rarr;</span>${fig(z)}</div>` +
        `<p>${who}, the average income of ${old} year-olds was ${gapThan(a.v)} that of ${young} year-olds in ${P(a.t)}${edge(a, from)}. ` +
        `In ${P(z.t)}${edge(z, to)} it was <strong>${gapWords(z.v, false)}</strong>. ${delta}</p>${extra}</article>`;
    };
    if (useC) {
      const edge = (d, want) => d.t !== want ? ` <span class="edge">(${want === from ? "first" : "last"} survey in the selected range)</span>` : "";
      $("readLineBody").innerHTML = state.cmp.map(c => card(SLOT_COL[slotOf[c]], countryIcon(c), withMark(c),
        agirSeries(c, ptype).filter(d => d.t >= from && d.t <= to), `In <strong>${c}</strong>`, edge)).join("");
      return;
    }
    $("readLineBody").innerHTML = GROUPS.map(([g, col]) => {
      const s = groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), ptype);
      const pts = [s.find(d => d.t === from), s.find(d => d.t === to)].filter(Boolean);
      const imp = [...new Set(pts.flatMap(d => d.imp))];
      const id = `imp-rl-${g}`;
      const extra = imp.length ? `<button type="button" class="imp-btn" aria-expanded="false" aria-controls="${id}" aria-label="Carried-forward values: show which countries"><span aria-hidden="true">i</span></button><div class="imp-pop" id="${id}" role="note" hidden><strong>Carried-forward values.</strong> ${imp.join(", ")} carried forward from their latest survey.</div>` : "";
      return card(col, groupIcon(g), `${g} average`, pts, `In the average ${g.toLowerCase()} country`, () => "", extra);
    }).join("");
  }

  // ------------------------------------------------------------ overview ----
  // one row per country: the ratio in the From period (open dot) and the To period (filled dot)
  let ovRows = [], ovAnnounce = "";
  function renderOverview() {
    const { ptype, from, to } = state.ov, P = t => label(ptype, t), narrow = isNarrow();
    $("ovPeriod").textContent = `${P(from)} and ${P(to)}`;
    const ch = $("ovChart");
    if (from >= to) {
      Plotly.purge("ovChart"); ch.innerHTML = `<p class="note">Choose a \u201cTo\u201d period after the \u201cFrom\u201d period.</p>`;
      $("ovNote").innerHTML = ""; $("ovLegend").innerHTML = ""; $("ovTableWrap").innerHTML = ""; ovRows = [];
      $("ovSummary").textContent = ovAnnounce = "Choose a To period after the From period."; syncUrl(); return;
    }
    const osel = state.ovSel;
    if (!osel.c.size && !Object.values(osel.g).some(Boolean)) {
      Plotly.purge("ovChart"); ch.innerHTML = `<p class="note">No countries selected. Use \u201cCountries\u201d above to choose some.</p>`;
      $("ovNote").innerHTML = ""; $("ovLegend").innerHTML = ""; $("ovTableWrap").innerHTML = ""; ovRows = [];
      $("ovSummary").textContent = ovAnnounce = "No countries selected."; syncUrl(); return;
    }
    if (ch.querySelector(".note")) ch.innerHTML = "";
    const rows = [], missing = [];
    countries.filter(c => osel.c.has(c)).forEach(c => {
      const obs = agirSeries(c, ptype).filter(d => d.t >= from && d.t <= to);
      if (!obs.length) { missing.push(c); return; }
      const a = obs[0], z = obs[obs.length - 1];
      rows.push({ name: c, a, z, single: a === z, moved: a.t !== from || z.t !== to });
    });
    const avgs = [["Middle-income", "--series-2"], ["High-income", "--series-1"]].filter(([g]) => osel.g[g]).map(([g]) => {
      const s = groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), ptype);
      const a = s.find(d => d.t === from), z = s.find(d => d.t === to);
      return a && z ? { name: `${g} average`, isAvg: true, a, z, single: false, moved: false } : null;
    }).filter(Boolean);
    const val = { to: r => r.z.v, change: r => (r.single ? -1e9 : r.z.v - r.a.v) }[state.osort];
    rows.sort((x, y) => state.osort === "name" ? y.name.localeCompare(x.name) : val(x) - val(y));
    const all = [...rows, ...avgs];       // drawn bottom to top: averages at the top
    ovRows = all.slice().reverse();
    const muted = css("--text-muted");
    const shortP = r => r.single ? `only ${P(r.z.t)}` : r.a.t !== from && r.z.t !== to ? `${P(r.a.t)} to ${P(r.z.t)}` : r.z.t !== to ? `to ${P(r.z.t)}` : `from ${P(r.a.t)}`;
    const shortC = r => r.single ? `only ${cOnly(ptype, r.z.t)}` : r.a.t !== from && r.z.t !== to ? `${cYr(ptype, r.a.t)}\u2013${cYr(ptype, r.z.t, true)}` : r.z.t !== to ? `to ${cYr(ptype, r.z.t, true)}` : `from ${cYr(ptype, r.a.t)}`;
    const ys = all.map(r => {
      let n = r.isAvg ? `<b>${r.name}</b>` : withMark(r.name);
      if (narrow) n = n.replace("United Kingdom", "UK").replace("United States", "US").replace(" average", " avg");
      n = hiLabel(r.isAvg ? null : r.name, n);
      if (r.moved) n = `<i><span style="color:${muted}">${n}${narrow ? " " + shortC(r) : ` (${shortP(r)})`}</span></i>`;
      return n;
    });
    const up = css("--c-old"), down = css("--c-young"), flat = css("--text-secondary");
    const dir = r => (r.single || Math.round(100 * (r.z.v - r.a.v)) === 0 ? 0 : r.z.v > r.a.v ? 1 : -1);
    const tip = r => `<b>${r.name}${!r.isAvg && NOTES[r.name] ? NOTE_MARK : ""}</b>` + (r.single ? `<br>${P(r.z.t)}: ${r.z.v.toFixed(2)} (only survey in the range)` :
      `<br>${P(r.a.t)}: ${r.a.v.toFixed(2)}<br>${P(r.z.t)}: ${r.z.v.toFixed(2)}<br>Change: ${fmt(100 * (r.z.v - r.a.v), 0)} percentage points`);
    const seg = s => { const x = [], y = []; all.forEach((r, i) => { if (!r.single && dir(r) === s) { x.push(r.a.v, r.z.v, null); y.push(ys[i], ys[i], null); } }); return { x, y }; };
    const traces = [1, -1, 0].map(s => ({ type: "scatter", mode: "lines", ...seg(s), line: { color: s > 0 ? up : s < 0 ? down : flat, width: 3 }, hoverinfo: "skip", showlegend: false }));
    const two = all.map((r, i) => i).filter(i => !all[i].single);
    traces.push({ type: "scatter", mode: "markers", x: two.map(i => all[i].a.v), y: two.map(i => ys[i]), text: two.map(i => tip(all[i])),
      marker: { symbol: "circle-open", size: 9, color: flat, line: { width: 2 } }, hovertemplate: "%{text}<extra></extra>", showlegend: false });
    traces.push({ type: "scatter", mode: "markers", x: all.map(r => r.z.v), y: ys, text: all.map(tip),
      marker: { symbol: "circle", size: 10, color: all.map(r => (dir(r) > 0 ? up : dir(r) < 0 ? down : flat)), line: { color: css("--surface-1"), width: 1 } },
      hovertemplate: "%{text}<extra></extra>", showlegend: false });
    traces.push({ type: "scatter", mode: "markers", x: [1], y: [ys[0]], xaxis: "x2", marker: { opacity: 0 }, hoverinfo: "skip", showlegend: false });
    const lay = baseLayout();
    lay.showlegend = false; lay.hovermode = "closest";
    lay.margin = narrow ? { l: 8, r: 12, t: 30, b: 56 } : Object.assign(lay.margin, { l: 170, t: 30 });
    lay.height = Math.max(narrow ? 200 : 220, (narrow ? 26 : 24) * all.length + 100);
    lay.xaxis = axis({ title: { text: narrow ? "AGIR" : "Age Group Income Ratio, 55–64 / 25–34", font: { color: css("--text-secondary") } } });
    lay.xaxis2 = axis({ overlaying: "x", side: "top", matches: "x", showgrid: false, zeroline: false, showline: false });
    // rows in sorted order (otherwise Plotly orders them by the first trace that uses them)
    lay.yaxis = axis({ automargin: true, categoryorder: "array", categoryarray: ys, tickfont: { size: narrow ? 13 : 14, color: css("--text-primary") } });
    lay.shapes = [{ type: "line", xref: "x", yref: "paper", x0: 1, x1: 1, y0: 0, y1: 1, line: { color: css("--text-muted"), width: 1, dash: "dot" } }];
    Plotly.react("ovChart", traces, lay, narrow ? PHONE_CONFIG : CONFIG);
    $("ovLegend").innerHTML = `<span><i class="seg up"></i>Rising: shifting towards 55&ndash;64</span><span><i class="seg down"></i>Falling: shifting towards 25&ndash;34</span>` +
      `<span><i class="dot open"></i>${P(from)}</span><span><i class="dot"></i>${P(to)}</span>`;
    const moved = rows.filter(r => r.moved), pop = [];
    if (moved.length) pop.push(`<strong>Shorter periods</strong> (first and last survey in the range): ${moved.map(r => `${r.name} (${r.single ? "only " + P(r.z.t) : P(r.a.t) + " to " + P(r.z.t)})`).join(", ")}.`);
    if (missing.length) pop.push(`<strong>Not shown</strong>, no survey in the range: ${missing.join(", ")}.`);
    pop.push("Group averages carry each country&rsquo;s latest value forward when a survey is missing, so they always use the chosen periods.");
    $("ovNote").innerHTML = (moved.length ? `<p class="note key">Names in <i>grey italics</i> use the first or last survey available in the range. Hover or tap a dot for the years.</p>` : "") +
      `<button type="button" class="imp-btn inline pill" aria-expanded="false" aria-controls="imp-ov"><span class="i" aria-hidden="true">i</span>Notes</button><div class="imp-pop" id="imp-ov" role="note" hidden>${pop.join("<br>")}</div>`;
    const cs = rows.filter(r => !r.single), byZ = rows.slice().sort((x, y) => y.z.v - x.z.v);
    const nUp = cs.filter(r => dir(r) > 0).length, nDown = cs.filter(r => dir(r) < 0).length;
    ovAnnounce = `All countries at a glance, ${P(from)} and ${P(to)}. The Age Group Income Ratio rose in ${nUp} countries and fell in ${nDown}.` +
      (byZ.length ? ` Highest in the last period: ${byZ[0].name}, ${byZ[0].z.v.toFixed(2)}. Lowest: ${byZ[byZ.length - 1].name}, ${byZ[byZ.length - 1].z.v.toFixed(2)}.` : "");
    $("ovSummary").textContent = `Dot chart of the Age Group Income Ratio in ${P(from)} and ${P(to)}, one row per country, with the two group averages. ${ovAnnounce} Use the Show table button for all values.`;
    renderOvTable(); syncUrl();
  }
  function renderOvTable() {
    const w = $("ovTableWrap");
    w.hidden = !state.ovTable;
    $("toggleOvTable").textContent = state.ovTable ? "Hide data table" : "Show data table";
    $("toggleOvTable").setAttribute("aria-expanded", String(state.ovTable));
    if (!state.ovTable) return;
    const P = t => label(state.ov.ptype, t);
    const cellV = (d, want) => `${d.v.toFixed(2)}${d.t !== want ? ` <span class="per-note">(${P(d.t)})</span>` : ""}`;
    w.innerHTML = `<table><caption class="sr-only">Age Group Income Ratio in ${P(state.ov.from)} and ${P(state.ov.to)}</caption><thead><tr><th scope="col">Country</th><th scope="col">${P(state.ov.from)}</th><th scope="col">${P(state.ov.to)}</th><th scope="col">Change, percentage points</th></tr></thead><tbody>` +
      ovRows.map(r => `<tr class="${r.isAvg ? "group" : ""}"><th scope="row">${r.isAvg ? r.name : withMark(r.name)}</th><td>${r.single ? "&ndash;" : cellV(r.a, state.ov.from)}</td><td>${cellV(r.z, state.ov.to)}</td><td>${r.single ? "&ndash;" : fmt(100 * (r.z.v - r.a.v), 0)}</td></tr>`).join("") +
      `</tbody></table><p class="note">A year in brackets: the nearest survey in the range was used.</p>`;
  }

  // ---------------------------------------------------------- shareable link ----
  // the current choices are kept in the address (?lines=Italy,Spain&from=2004&to=2022 ...)
  const SORTS = { grd: "", name: "name", wage: "wages", emp: "employment", trinc: "transfer-income", trshare: "transfer-share" };
  const startYear = (pt, t) => (pt === "wave" ? 2004 + 3 * (t - 1) : t);
  const fromYear = (pt, y) => (pt === "wave" ? Math.floor((y - 2004) / 3) + 1 : y);
  let urlReady = false;
  // countries chosen in a lower chart: nothing when all, "high" or "middle" for a whole group, "none", or a list
  const GSET = g => countries.filter(c => groupOf(c) === g);
  function selParam(set) {
    if (set.size === countries.length) return "";
    if (!set.size) return "none";
    for (const [g, w] of [["High-income", "high"], ["Middle-income", "middle"]]) { const l = GSET(g); if (l.length === set.size && l.every(c => set.has(c))) return w; }
    return countries.filter(c => set.has(c)).map(encodeURIComponent).join(",");
  }
  function readSel(sl, cs, as) {
    if (cs) { sl.c.clear(); (cs === "none" ? [] : cs === "high" ? GSET("High-income") : cs === "middle" ? GSET("Middle-income") : cs.split(",").map(x => x.trim()).filter(c => countries.includes(c))).forEach(c => sl.c.add(c)); }
    if (as) { sl.g["High-income"] = as === "high"; sl.g["Middle-income"] = as === "middle"; }
  }
  function syncUrl() {
    if (!urlReady) return;
    const p = [];
    if (state.cmp.length) p.push("lines=" + state.cmp.map(encodeURIComponent).join(","));
    const g = GROUPS.filter(([x]) => state.grp[x]).map(([x]) => x === "High-income" ? "high" : "middle");
    if (g.length < 2) p.push("averages=" + (g.length ? g[0] : "none"));
    const nper = p.length;
    [[state, "periods", "from", "to"], [state.ov, "ovp", "ovfrom", "ovto"], [state.dr, "drp", "drfrom", "drto"]].forEach(([o, pk, fk, tk]) => {
      const dFrom = o.ptype === "wave" ? 1 : 2004, dTo = o.ptype === "wave" ? 7 : 2022;
      if (o.ptype === "year") p.push(pk + "=years");
      if (o.from !== dFrom) p.push(fk + "=" + startYear(o.ptype, o.from));
      if (o.to !== dTo) p.push(tk + "=" + startYear(o.ptype, o.to));
    });
    if (p.length > nper) p.push("pv=2");   // marks links that carry a separate period choice per chart
    if (state.osort !== "to") p.push("rank=" + state.osort);
    [["ov", state.ovSel], ["dr", state.drSel]].forEach(([k, sl]) => {
      const cs = selParam(sl.c); if (cs) p.push(`${k}=${cs}`);
      const gs = GROUPS.filter(([x]) => sl.g[x]).map(([x]) => x === "High-income" ? "high" : "middle");
      if (gs.length < 2) p.push(`${k}a=${gs.length ? gs[0] : "none"}`);
    });
    if (SORTS[state.sort]) p.push("sort=" + SORTS[state.sort]);
    const url = location.pathname + (p.length ? "?" + p.join("&") : "") + location.hash;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
  }
  function readUrl() {
    const q = new URLSearchParams(location.search);
    // older links (no pv=2) set one period choice for all charts; newer links set each chart's own
    const legacy = !q.has("pv");
    const readPer = (o, pk, fk, tk) => {
      const pick = (k, lk) => (q.has(k) ? q.get(k) : legacy ? q.get(lk) : null);
      const yrs = pick(pk, "periods") === "years";
      o.ptype = yrs ? "year" : "wave"; o.from = yrs ? 2004 : 1; o.to = yrs ? 2022 : 7;
      const ps = periodsAvailable(o.ptype);
      [["from", pick(fk, "from")], ["to", pick(tk, "to")]].forEach(([k, v]) => { const y = parseInt(v, 10); if (y && ps.includes(fromYear(o.ptype, y))) o[k] = fromYear(o.ptype, y); });
    };
    readPer(state, "periods", "from", "to"); readPer(state.ov, "ovp", "ovfrom", "ovto"); readPer(state.dr, "drp", "drfrom", "drto");
    (q.get("lines") || "").split(",").map(s => s.trim()).filter(c => countries.includes(c)).forEach(c => setCountry(c, true));
    const av = q.get("averages");
    if (av) { state.grp["High-income"] = av === "high"; state.grp["Middle-income"] = av === "middle"; }
    if (["change", "name"].includes(q.get("rank"))) { state.osort = q.get("rank"); $("osort").value = state.osort; }
    readSel(state.ovSel, q.get("ov"), q.get("ova"));
    readSel(state.drSel, q.get("dr"), q.get("dra"));
    const dr = q.get("drivers");   // older links
    if (dr === "high" || dr === "middle") readSel(state.drSel, dr, dr);
    const so = Object.keys(SORTS).find(k => SORTS[k] && SORTS[k] === q.get("sort"));
    if (so) { state.sort = so; $("sort").value = so; }
  }

  function renderAgirTable() {
    const w = $("agirTableWrap");
    w.hidden = !state.agirTable;
    $("toggleAgirTable").textContent = state.agirTable ? "Hide data table" : "Show data table";
    $("toggleAgirTable").setAttribute("aria-expanded", String(state.agirTable));
    if (!state.agirTable) return;
    const ps = periodsAvailable(state.ptype).filter(t => t >= state.from && t <= state.to);
    w.innerHTML = `<table><caption class="sr-only">Age Group Income Ratio by period, with 95% confidence interval</caption><thead><tr><th scope="col">Period</th>${agirTbl.map(s => `<th scope="col">${s.name}</th>`).join("")}</tr></thead><tbody>` +
      ps.map(t => `<tr><th scope="row">${label(state.ptype, t)}</th>${agirTbl.map(s => { const d = s.pts.find(x => x.t === t); return `<td>${d ? `${d.v.toFixed(2)} ±${d.ci.toFixed(2)}${d.imp ? " *" : ""}` : "no data"}</td>`; }).join("")}</tr>`).join("") +
      `</tbody></table><p class="note">Ratio ± 95% confidence interval. * includes carried-forward values (a country with no survey in that period keeps its latest value).</p>`;
  }

  // ------------------------------------------------------------ chart 2 ----
  let current = [];
  let decompAnnounce = "";
  function renderDecomp() {
    const { ptype, from, to } = state.dr;
    $("decompPeriod").textContent = `${label(ptype, from)} to ${label(ptype, to)}`;
    const dsel = state.drSel, list = countries.filter(c => dsel.c.has(c));
    const res = [], missing = [];
    $("drMore").innerHTML = "";
    if (from >= to) {
      Plotly.purge("decompChart");
      $("decompLegend").hidden = true;
      $("decompChart").innerHTML = `<p class="note">Choose a “To” period after the “From” period.</p>`;
      $("missingNote").textContent = ""; $("tableWrap").innerHTML = ""; current = [];
      $("decompSummary").textContent = decompAnnounce = "Choose a To period after the From period.";
      return;
    }
    if (!list.length && !Object.values(dsel.g).some(Boolean)) {
      Plotly.purge("decompChart"); $("decompLegend").hidden = true;
      $("decompChart").innerHTML = `<p class="note">No countries selected. Use \u201cCountries\u201d above to choose some.</p>`;
      $("missingNote").textContent = ""; $("tableWrap").innerHTML = ""; current = [];
      $("decompSummary").textContent = decompAnnounce = "No countries selected."; syncUrl(); return;
    }
    $("decompLegend").hidden = false;
    list.forEach(c => { const d = decomp(c, ptype, from, to); d ? res.push(d) : missing.push(c); });
    const keyOf = { grd: "growth", wage: "wage", emp: "employ", trinc: "tr_inc", trshare: "tr_share" }[state.sort];
    res.sort((a, b) => state.sort === "name" ? b.country.localeCompare(a.country) : a[keyOf] - b[keyOf]);
    // group averages on top (excluding countries with caveats)
    const avg = g => {
      const a = countries.filter(c => groupOf(c) === g && !CAVEAT[c]).map(c => decomp(c, ptype, from, to)).filter(Boolean);
      if (!a.length) return null;
      const o = { country: g, group: g, isAvg: true };
      ["growth", ...MARGINS.map(m => m.key)].forEach(k => { o[k] = a.reduce((s, r) => s + r[k], 0) / a.length; });
      return o;
    };
    const avgs = ["Middle-income", "High-income"].filter(g => dsel.g[g]).map(avg).filter(Boolean);
    const parts = avgs.slice().reverse().map(r => `${r.country} average: total ${fmt(r.growth)} percentage points per year (wages ${fmt(r.wage)}, employment ${fmt(r.employ)}, transfer income ${fmt(r.tr_inc)}, transfer share ${fmt(r.tr_share)}, other income ${fmt(r.other)}).`);
    const byG = res.slice().sort((a, b) => b.growth - a.growth);
    const ext = byG.length ? ` Among the ${byG.length} countries shown, the total ranges from ${fmt(byG[byG.length - 1].growth)} (${byG[byG.length - 1].country}) to ${fmt(byG[0].growth)} (${byG[0].country}).` : "";
    $("decompSummary").textContent = `Bar chart, ${label(ptype, from)} to ${label(ptype, to)}, of the annual growth rate differential between people aged 55 to 64 and 25 to 34, split into wages, employment, transfer income, transfer share and other income, in percentage points per year. Positive values mean the Age Group Income Ratio is rising, so income is shifting towards 55 to 64 year-olds. ${parts.join(" ")}${ext} Use the Show table button for all values.`;
    decompAnnounce = `What drove the change, ${label(ptype, from)} to ${label(ptype, to)}. ${parts.join(" ")}`;
    // phones: with many countries, draw the largest changes (plus ticked countries); the table and CSV keep every row
    const TRIM = 12, KEEP = 10;
    let all = [...res, ...avgs];     // plotted bottom-to-top, so averages appear on top
    let hiddenRows = 0;
    if (isNarrow() && !state.drAll && res.length > TRIM) {
      const top = new Set(res.slice().sort((a, b) => Math.abs(b.growth) - Math.abs(a.growth)).slice(0, KEEP).map(r => r.country));
      state.cmp.forEach(c => top.add(c));
      const keep = res.filter(r => top.has(r.country));
      hiddenRows = res.length - keep.length;
      all = [...keep, ...avgs];
    }
    const mr = $("drMore");
    mr.innerHTML = isNarrow() && res.length > TRIM
      ? `<button type="button" class="linkbtn" id="drMoreBtn">${state.drAll ? "Show only the largest changes" : `Show all ${res.length} countries`}</button>` +
        (hiddenRows ? ` <span class="note">Showing the ${res.length - hiddenRows} largest changes (and countries you ticked above). The table has all ${res.length}.</span>` : "")
      : "";
    current = [...avgs.slice().reverse(), ...res.slice().reverse()];
    // rows that had to use a shorter period (a survey is missing) get grey italic names
    res.forEach(r => { r.moved = r.from !== from || r.to !== to; });
    const shortP = r => r.from !== from && r.to !== to ? `${label(ptype, r.from)} to ${label(ptype, r.to)}` : r.to !== to ? `to ${label(ptype, r.to)}` : `from ${label(ptype, r.from)}`;
    const shortC = r => r.from !== from && r.to !== to ? `${cYr(ptype, r.from)}\u2013${cYr(ptype, r.to, true)}` : r.to !== to ? `to ${cYr(ptype, r.to, true)}` : `from ${cYr(ptype, r.from)}`;
    const muted = css("--text-muted");
    const yname = r => {   // on phones the label column is kept narrow so the bars get the room
      let n = r.isAvg ? `<b>${r.country}</b>` : withMark(r.country);
      if (isNarrow()) n = n.replace("United Kingdom", "UK").replace("United States", "US");
      n = hiLabel(r.isAvg ? null : r.country, n);
      if (r.moved) n = `<i><span style="color:${muted}">${n}${isNarrow() ? " " + shortC(r) : ` (${shortP(r)})`}</span></i>`;
      return n;
    };
    const ys = all.map(yname);
    labelRows = {};
    all.forEach((r, i) => { labelRows[plainLabel(ys[i])] = r; });
    const span = all.map(r => [r.isAvg ? "group average" : `${label(ptype, r.from)} to ${label(ptype, r.to)}`,
      ""]);
    const traces = MARGINS.map(m => ({
      type: "bar", orientation: "h", name: m.label, y: ys, x: all.map(r => r[m.key]),
      customdata: all.map((r, j) => [...span[j], fmt(r[m.key])]),
      marker: { color: css(m.color), line: { color: css("--surface-1"), width: 1 } },
      hovertemplate: `<b>${"%{y}"}</b><br>%{customdata[0]}<br>${m.label}: %{customdata[2]} pp/yr<extra></extra>`
    }));
    traces.push({ type: "scatter", mode: "markers", name: "Total (GRD)", y: ys, x: all.map(r => r.growth), customdata: all.map((r, j) => [...span[j], fmt(r.growth)]),
      marker: { symbol: "diamond", size: 10, color: css("--total"), line: { color: css("--surface-1"), width: 2 } },
      hovertemplate: `<b>%{y}</b><br>%{customdata[0]}<br>Total GRD: %{customdata[2]} pp/yr<extra></extra>` });
    const lay = baseLayout();
    lay.barmode = "relative"; lay.bargap = 0.3;
    const narrow = isNarrow();
    // on phones the labels get only the room they need, so the bars use the full width
    lay.margin = narrow ? { l: 8, r: 8, t: 30, b: 56 } : Object.assign(lay.margin, { l: 170, t: 30 });
    lay.height = Math.max(narrow ? 200 : 220, (narrow ? 30 : 26) * all.length + 100);
    // the legend is plain HTML above the chart, so it can use the full width and leave room for the top scale
    lay.showlegend = false;
    const lg = $("decompLegend");
    lg.innerHTML = MARGINS.map(m => `<span><i class="sw" style="background:${css(m.color)}"></i>${m.label}</span>`).join("") +
      `<span><i class="dia"></i>Total (GRD)</span>`;

    lay.xaxis = axis({ title: { text: narrow ? "pp per year" : "percentage points per year", font: { color: css("--text-secondary") } }, zeroline: true, zerolinewidth: 1.5 });
    // the chart is tall, so the scale is repeated at the top
    lay.xaxis2 = axis({ overlaying: "x", side: "top", matches: "x", showgrid: false, zeroline: false, showline: false });
    traces.push({ type: "scatter", mode: "markers", x: [0], y: [ys[0]], xaxis: "x2", marker: { opacity: 0 }, hoverinfo: "skip", showlegend: false });
    lay.yaxis = axis({ automargin: true, tickfont: { size: narrow ? 13 : 14, color: css("--text-primary") } });
    lay.hovermode = "closest";
    Plotly.react("decompChart", traces, lay, narrow ? PHONE_CONFIG : CONFIG);
    const moved = res.filter(r => r.moved);
    const pop = [];
    if (moved.length) pop.push(`<strong>Shorter periods</strong> (nearest surveys available): ${moved.map(r => `${r.country} (${label(ptype, r.from)} to ${label(ptype, r.to)})`).join(", ")}.`);
    if (missing.length) pop.push(`<strong>Not shown</strong>, fewer than two periods in the range: ${missing.join(", ")}.`);
    const noted = res.filter(r => NOTES[r.country]).map(r => r.country);
    if (noted.length) pop.push(`<strong>${NOTE_MARK} Country notes</strong> apply to: ${noted.join(", ")}. Hover or tap the country name, or <a href="#country-notes" class="notes-link">read the country notes</a>.`);
    $("missingNote").innerHTML = (moved.length ? `<p class="note key">Names in <i>grey italics</i> use a shorter period, because a survey is missing in the chosen one. Hover or tap the name or bar for the years.</p>` : "") +
      (pop.length ? `<button type="button" class="imp-btn inline pill" aria-expanded="false" aria-controls="imp-decomp"><span class="i" aria-hidden="true">i</span>Notes</button><div class="imp-pop" id="imp-decomp" role="note" hidden>${pop.join("<br>")}</div>` : "");
    renderTable(); syncUrl();
  }

  function renderTable() {
    const wrap = $("tableWrap");
    wrap.hidden = !state.table;
    $("toggleTable").textContent = state.table ? "Hide data table" : "Show data table";
    $("toggleTable").setAttribute("aria-expanded", String(state.table));
    if (!state.table) return;
    const cols = [["growth", "Total GRD"], ...MARGINS.map(m => [m.key, m.label])];
    wrap.innerHTML = `<table><caption class="sr-only">Decomposition of the growth rate differential, percentage points per year</caption><thead><tr><th scope="col">Country</th><th scope="col" class="per">Periods</th>${cols.map(c => `<th scope="col">${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      current.map(r => `<tr class="${r.isAvg ? "group" : ""}"><td>${r.country}${r.moved ? `<span class="per-sub">${label(state.dr.ptype, r.from)} to ${label(state.dr.ptype, r.to)}</span>` : ""}</td><td class="per${r.moved ? " short" : ""}">${r.isAvg ? "" : label(state.dr.ptype, r.from) + " to " + label(state.dr.ptype, r.to)}</td>${cols.map(c => `<td>${fmt(r[c[0]])}</td>`).join("")}</tr>`).join("") +
      `</tbody></table><p class="note">Percentage points per year.</p>`;
  }

  // save a text file (UTF-8 with BOM, so spreadsheet programs show the dashes correctly)
  function saveCsv(text, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Age Group Income Ratio for every country (observed) and both group averages, current period type
  function downloadAgir() {
    const pt = state.ptype, out = ["series,type,income_group,periods,period,agir,se,ci95_low,ci95_high,carried_forward"];
    const line = (name, type, g, d, cf) => [`"${name}"`, type, g, pt === "wave" ? "3-year waves" : "single years", label(pt, d.t),
      d.v.toFixed(4), d.se.toFixed(4), (d.v - 1.96 * d.se).toFixed(4), (d.v + 1.96 * d.se).toFixed(4), `"${cf}"`].join(",");
    GROUPS.forEach(([g]) => groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), pt)
      .forEach(d => out.push(line(`${g} average`, "group average", g, d, d.imp.join("; ")))));
    countries.forEach(c => agirSeries(c, pt).forEach(d => out.push(line(c, "country", groupOf(c), d, ""))));
    saveCsv(out.join("\n"), `age_group_income_ratio_${pt === "wave" ? "waves" : "years"}.csv`);
  }

  function download() {
    const cols = ["growth", ...MARGINS.map(m => m.key)];
    const csv = ["country,group,from,to," + cols.map(c => c === "growth" ? "grd" : c).join(",")]
      .concat(current.map(r => [`"${r.country}"`, r.group, r.isAvg ? label(state.dr.ptype, state.dr.from) : label(state.dr.ptype, r.from), r.isAvg ? label(state.dr.ptype, state.dr.to) : label(state.dr.ptype, r.to),
        ...cols.map(c => r[c].toFixed(4))].join(","))).join("\n");
    saveCsv(csv, `agir_decomposition_${label(state.dr.ptype, state.dr.from)}_to_${label(state.dr.ptype, state.dr.to)}.csv`.replace(/\u2013/g, "-"));
  }

  // ------------------------------------------------- notes on country names ----
  let labelRows = {};
  const plainLabel = s => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const tip = $("noteTip"), decompEl = $("decompChart");
  function labelAt(x, y) {
    for (const t of decompEl.querySelectorAll(".ytick text")) {
      const r = labelRows[plainLabel(t.textContent)];
      if (!r || r.isAvg || !(NOTES[r.country] || r.moved)) continue;
      const b = t.getBoundingClientRect();
      if (x >= b.left - 6 && x <= b.right + 6 && y >= b.top - 3 && y <= b.bottom + 3) return r;
    }
    return null;
  }
  function showTip(r, x, y) {
    const c = r.country;
    tip.innerHTML = `<strong>${withMark(c)}</strong>` +
      (r.moved ? ` Shorter period: ${label(state.dr.ptype, r.from)} to ${label(state.dr.ptype, r.to)}, the nearest surveys available.` : "") +
      (NOTES[c] ? ` ${noteText(c)}` : "");
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + "px";
    tip.style.top = (y + 18 + h > window.innerHeight ? Math.max(8, y - h - 12) : y + 18) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  decompEl.addEventListener("mousemove", e => {
    const c = labelAt(e.clientX, e.clientY);
    decompEl.style.cursor = c ? "help" : "";
    c ? showTip(c, e.clientX, e.clientY) : hideTip();
  });
  decompEl.addEventListener("mouseleave", hideTip);
  decompEl.addEventListener("click", e => { const c = labelAt(e.clientX, e.clientY); c ? showTip(c, e.clientX, e.clientY) : hideTip(); });
  document.addEventListener("scroll", hideTip, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });

  // ---------------------------------------------------------------- wire ----
  function renderKeyFind() {
    const grp = g => groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), "wave");
    const items = [];
    ["High-income", "Middle-income"].forEach(g => {
      const s = grp(g), a = s.find(d => d.t === 1), z = s.find(d => d.t === 7);
      if (!a || !z) return;
      const d = Math.round(100 * (z.v - a.v));
      items.push(`<li><span class="k">${g} countries:</span> the average ratio went from <strong>${a.v.toFixed(2)}</strong> in ${WAVES[1]} to <strong>${z.v.toFixed(2)}</strong> in ${WAVES[7]}, ${d >= 0 ? "up" : "down"} <strong>${Math.abs(d)} percentage points</strong>.</li>`);
    });
    const hi = countries.filter(c => groupOf(c) === "High-income" && !CAVEAT[c]).map(c => decomp(c, "wave", 1, 7)).filter(Boolean);
    if (hi.length) {
      const m = k => hi.reduce((s, r) => s + r[k], 0) / hi.length;
      const top = MARGINS.slice().sort((a, b) => m(b.key) - m(a.key))[0];
      if (m("growth") > 0 && m(top.key) > 0) items.push(`<li><span class="k">What drove it:</span> in high-income countries the rise comes mostly from <strong>${top.label.toLowerCase()}</strong> (average of the countries, ${WAVES[1]} to ${WAVES[7]}; see the drivers chart below).</li>`);
    }
    $("keyFindList").innerHTML = items.join("") + `<li class="src">Group averages include carried-forward values where a country has no survey in a period.</li>`;
    $("keyFind").hidden = !items.length;
  }
  function renderAll() {
    renderAgir(); renderOverview(); renderDecomp(); renderKeyFind();
    ["agirChart", "ovChart", "decompChart"].forEach(i => $(i).classList.remove("loading"));
  }
  wirePer(state, ["ptype", "from", "to"], renderAgir, () => $("agirSummary").textContent.slice(0, 200));
  wirePer(state.ov, ["ovPtype", "ovFrom", "ovTo"], renderOverview, () => ovAnnounce);
  wirePer(state.dr, ["drPtype", "drFrom", "drTo"], renderDecomp, () => decompAnnounce);
  $("sort").addEventListener("change", e => { state.sort = e.target.value; renderDecomp(); announce(decompAnnounce); });
  $("osort").addEventListener("change", e => { state.osort = e.target.value; renderOverview(); announce(ovAnnounce); });
  $("toggleOvTable").addEventListener("click", () => { state.ovTable = !state.ovTable; renderOvTable(); });
  $("downloadAgir").addEventListener("click", downloadAgir);
  $("copyLink").addEventListener("click", () => {
    const btn = $("copyLink"), box = $("linkBox"), url = location.href;
    const done = () => { btn.textContent = "Link copied"; announce("Link to this view copied."); setTimeout(() => { btn.textContent = "Copy link"; }, 2000); };
    const fallback = () => { box.hidden = false; box.value = url; box.focus(); box.select(); announce("Copy the selected link."); };
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url).then(done, fallback) : fallback();
  });
  function copyText(text, msg) {
    const s = $("citeStatus");
    const ok = () => { s.textContent = msg; setTimeout(() => { s.textContent = ""; }, 2500); };
    const fail = () => { s.textContent = "Copying is blocked here: select the text and copy it."; };
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(ok, fail) : fail();
  }
  $("copyCite").addEventListener("click", () => copyText($("citeText").textContent.replace(/\s+/g, " ").trim(), "Citation copied."));
  $("copyBib").addEventListener("click", () => copyText($("bibText").textContent, "BibTeX copied."));
  $("toggleTable").addEventListener("click", () => { state.table = !state.table; renderTable(); });
  $("toggleAgirTable").addEventListener("click", () => { state.agirTable = !state.agirTable; renderAgirTable(); });
  $("download").addEventListener("click", download);
  // small "i" buttons open/close the imputation note (click outside or Escape closes it)
  function closePops(except) {
    document.querySelectorAll(".imp-pop").forEach(p => {
      if (p === except) return;
      p.hidden = true;
      const b = document.querySelector(`[aria-controls="${p.id}"]`);
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".imp-btn");
    if (!b) { if (!e.target.closest(".imp-pop")) closePops(); return; }
    const p = $(b.getAttribute("aria-controls"));
    closePops(p);
    p.hidden = !p.hidden;
    b.setAttribute("aria-expanded", String(!p.hidden));
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".imp-btn[aria-expanded='true']");
    closePops();
    if (open) open.focus();
  });
  // "country notes" links open the notes section (touch screens have no hover)
  document.addEventListener("click", e => {
    const a = e.target.closest("a.notes-link");
    if (!a) return;
    e.preventDefault();
    const d = $("country-notes");
    d.open = true;
    d.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    d.querySelector("summary").focus();
  });
  // re-lay out the charts when the screen crosses the phone breakpoint (e.g. rotation)
  let wasNarrow = isNarrow(), resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderAll(); } }, 200);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  $("countryNotes").innerHTML = Object.keys(NOTES).sort().map(c =>
    `<p><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}</p>`).join("");
  if (!isNarrow()) { $("defs").open = true; }
  if (isNarrow()) $("limits").open = false;
  // PNG downloads for the two lower charts
  $("pngOv").addEventListener("click", () => { if ($("ovChart").data) exportPng($("ovChart"), "agir_all_countries", false); });
  $("pngDr").addEventListener("click", () => { if ($("decompChart").data) exportPng($("decompChart"), "agir_drivers", true); });
  $("drMore").addEventListener("click", e => { if (e.target.closest("#drMoreBtn")) { state.drAll = !state.drAll; renderDecomp(); const b = $("drMoreBtn"); if (b) b.focus(); } });
  // jump navigation: mark the section in view
  if ("IntersectionObserver" in window) {
    const links = [...document.querySelectorAll(".jump a")], map = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { links.forEach(a => a.removeAttribute("aria-current")); const a = map.get(e.target.id); if (a) a.setAttribute("aria-current", "true"); } }), { rootMargin: "-20% 0px -70% 0px" });
    map.forEach((_, id) => { const el = $(id); if (el) io.observe(el); });
  }
  // printing: open every section
  let wasOpen = [];
  window.addEventListener("beforeprint", () => { wasOpen = [...document.querySelectorAll("details")].map(d => [d, d.open]); wasOpen.forEach(([d]) => { d.open = true; }); });
  window.addEventListener("afterprint", () => { wasOpen.forEach(([d, o]) => { d.open = o; }); });
  readUrl();
  fillPeriods(); wirePicker();
  syncOvPicker = subPicker("ovPicker", state.ovSel, renderOverview, "overview chart");
  syncDrPicker = subPicker("drPicker", state.drSel, renderDecomp, "drivers chart");
  urlReady = true; renderAll();
})();
