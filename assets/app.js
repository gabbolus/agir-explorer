// AGIR Explorer - all computations happen in the browser from data/agir_data.js
(function () {
  "use strict";

  // ---------------------------------------------------------------- data ----
  const RICH = new Set(["Australia", "Austria", "Belgium", "Canada", "Czechia", "Denmark",
    "Finland", "France", "Germany", "Iceland", "Ireland", "Israel", "Italy", "Netherlands",
    "Norway", "Slovenia", "Spain", "Sweden", "Switzerland", "United Kingdom", "United States"]);
  const CAVEAT = { "South Africa": "survey series changes in 2023" };
  // country notes: data features that affect the interpretation (marked with † in the charts)
  const UNEMP = "Transfers exclude unemployment benefits (not reported consistently across survey years).";
  const NOTES = {
    "Israel": ["No individual-level transfer income in the LIS data; transfer margins are zero by construction.", UNEMP],
    "South Africa": ["Change of survey in 2023 (NIDS replaced by the Income and Expenditure Survey); comparisons across 2023 are not like-for-like. Excluded from group averages.", UNEMP],
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
  const noteText = c => (NOTES[c] || []).join(" ");
  const WAVES = { 1: "2004–06", 2: "2007–09", 3: "2010–12", 4: "2013–15", 5: "2016–18",
    6: "2019–21", 7: "2022–24", 8: "2025–27" };
  const OLD = 5, YOUNG = 2;
  const MARGINS = [
    { key: "wage", label: "Wages", color: "--series-1" },
    { key: "employ", label: "Employment", color: "--series-2" },
    { key: "tr_inc", label: "Transfer income", color: "--series-3" },
    { key: "tr_share", label: "Transfer share", color: "--series-4" },
    { key: "other", label: "Other income", color: "--series-5" }
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
  // use carried-forward values are flagged as partially imputed.
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

  const isNarrow = () => window.innerWidth < 600;
  let announceTimer;
  function announce(msg) {          // screen-reader status message after a control changes
    const el = $("status"); el.textContent = "";
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.textContent = msg; }, 250);
  }

  // --------------------------------------------------------------- state ----
  const state = { ptype: "wave", from: 1, to: 7, group: "all", sort: "grd", cmp: [], grp: { "High-income": true, "Middle-income": true }, table: false, agirTable: false, exact: false };

  function periodsAvailable(ptype) {
    const s = new Set();
    rows.filter(r => r.pt === ptype).forEach(r => s.add(r.period));
    return [...s].sort((a, b) => a - b).filter(t => ptype === "year" || t <= 7);
  }
  function fillPeriods() {
    const ps = periodsAvailable(state.ptype);
    if (!ps.includes(state.from)) state.from = ps[0];
    if (!ps.includes(state.to)) state.to = state.ptype === "wave" ? 7 : ps[ps.length - 1];
    for (const id of ["from", "to"]) {
      $(id).innerHTML = ps.map(t => `<option value="${t}">${label(state.ptype, t)}</option>`).join("");
      $(id).value = state[id];
    }
  }
  // ---- line picker: any mix of the two group averages and up to MAXC countries
  const MAXC = 6;
  const SLOT_COL = ["--series-3", "--series-4", "--series-5", "--series-6", "--series-7", "--series-8"];
  const SLOT_SYM = ["diamond", "triangle-up", "star", "pentagon", "triangle-down", "hexagon"];
  const GROUPS = [["High-income", "--series-1"], ["Middle-income", "--series-2"]];
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
    const row = (key, text, extra = "") => `<label class="prow" data-key="${key}" data-name="${text.toLowerCase()}"><input type="checkbox" value="${key}"><span class="sw" aria-hidden="true"></span><span class="nm">${text}</span>${extra}</label>`;
    const sect = (title, items) => `<div class="p-sec" role="group" aria-label="${title}"><h3>${title}</h3>${items}</div>`;
    const cl = g => countries.filter(c => groupOf(c) === g);
    $("pickList").innerHTML =
      sect("Group averages", GROUPS.map(([g]) => row("G:" + g, g + " average")).join("")) +
      GROUPS.map(([g]) => sect(`${g} countries`, cl(g).map(c => row("C:" + c, withMark(c))).join(""))).join("") +
      `<p class="p-empty" id="pickEmpty" hidden>No country matches your search.</p>`;
  }
  function syncPicker() {
    const full = state.cmp.length >= MAXC;
    document.querySelectorAll("#pickList .prow").forEach(r => {
      const key = r.dataset.key, cb = r.querySelector("input");
      let on, col = null;
      if (key.startsWith("G:")) { const g = key.slice(2); on = state.grp[g]; col = GROUPS.find(x => x[0] === g)[1]; }
      else { const c = key.slice(2); on = state.cmp.includes(c); if (on) col = SLOT_COL[slotOf[c]]; }
      cb.checked = !!on;
      cb.disabled = !on && key.startsWith("C:") && full;
      r.classList.toggle("off", cb.disabled);
      r.style.setProperty("--sw", col ? `var(${col})` : "transparent");
    });
    $("pickLabel").textContent = lineLabel();
    $("pickCount").textContent = `${state.cmp.length} of ${MAXC} countries` + (full ? ": untick one to add another." : ".");
    const chips = [];
    GROUPS.forEach(([g, col]) => { if (state.grp[g]) chips.push([`G:${g}`, `${g} average`, col, `${g} avg`]); });
    state.cmp.forEach(c => chips.push([`C:${c}`, withMark(c), SLOT_COL[slotOf[c]]]));
    $("selChips").innerHTML = chips.length
      ? chips.map(([k, t, col, short]) => `<li><button type="button" class="chip-x" data-key="${k}" aria-label="Remove ${t.replace(NOTE_MARK, "")} from the chart"><span class="sw" style="background:var(${col})" aria-hidden="true"></span>${short ? `<span class="full">${t}</span><span class="short" aria-hidden="true">${short}</span>` : t}<span class="x" aria-hidden="true">&times;</span></button></li>`).join("")
      : `<li class="none">No lines selected.</li>`;
  }
  function togglePick(key, on) {
    let ok = true, name;
    if (key.startsWith("G:")) { name = key.slice(2) + " average"; state.grp[key.slice(2)] = on; }
    else { name = key.slice(2); ok = setCountry(name, on); }
    syncPicker();
    if (!ok) { announce(`Maximum of ${MAXC} countries. Untick one to add another.`); return; }
    renderAgir();
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
      syncPicker(); renderAgir(); announce("All lines removed from the chart.");
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

  // --------------------------------------------------------------- tiles ----
  function renderTiles() {
    const groups = [["High-income", "--series-1"], ["Middle-income", "--series-2"]];
    $("tiles").innerHTML = groups.map(([g, col]) => {
      const list = countries.filter(c => groupOf(c) === g && !CAVEAT[c]);
      const s = groupSeries(list, state.ptype);
      const a = s.find(d => d.t === state.from), b = s.find(d => d.t === state.to);
      const v = a && b ? `${a.v.toFixed(2)} → ${b.v.toFixed(2)}` : "–";
      const ch = a && b ? `${fmt(100 * (b.v - a.v), 0)} points` : "";
      const nimp = (a ? a.imp.length : 0) + (b ? b.imp.length : 0);
      const popId = `imp-${g}`;
      const impNote = nimp ? `<button type="button" class="imp-btn" aria-expanded="false" aria-controls="${popId}" aria-label="Partially imputed: show which countries"><span aria-hidden="true">i</span></button>
        <div class="imp-pop" id="${popId}" role="note" hidden><strong>Partially imputed.</strong> ${[...new Set([...(a ? a.imp : []), ...(b ? b.imp : [])])].join(", ")} carried forward from their latest survey.</div>` : "";
      return `<div class="tile"><div class="k"><span class="swatch" aria-hidden="true" style="background:${css(col)}"></span>${g} countries, average Age Group Income Ratio${nimp ? " *" : ""}</div>
        <div class="v">${v}</div><div class="s">${label(state.ptype, state.from)} to ${label(state.ptype, state.to)} ${ch ? "· " + ch : ""}</div>${impNote}</div>`;
    }).join("");
  }

  // ------------------------------------------------------------ chart 1 ----
  let agirTbl = [];
  function renderAgir() {
    const traces = [], summ = [], tbl = [], impAll = {};
    const xs = d => d.map(p => (state.ptype === "wave" ? WAVES[p.t] : p.t));
    // each line has its own marker shape; filled = observed, open = partially imputed
    [["High-income", "--series-1", "solid", "circle"], ["Middle-income", "--series-2", "dash", "square"]].filter(x => state.grp[x[0]]).forEach(([g, col, dash, sym]) => {
      const s = groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), state.ptype);
      const c = css(col);
      tbl.push({ name: `${g} average`, pts: s.map(d => ({ t: d.t, v: d.v, ci: 1.96 * d.se, imp: d.imp.length > 0 })) });
      summ.push(`${g} average: ` + s.map(d => `${label(state.ptype, d.t)} ${d.v.toFixed(2)}${d.imp.length ? " (partly imputed)" : ""}`).join(", ") + ".");
      traces.push({ x: xs(s), y: s.map(d => d.v + 1.96 * d.se), mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      traces.push({ x: xs(s), y: s.map(d => d.v - 1.96 * d.se), mode: "lines", line: { width: 0 }, fill: "tonexty",
        fillcolor: hexA(c, 0.15), hoverinfo: "skip", showlegend: false });
      impAll[g] = [...new Set(s.flatMap(d => d.imp))];
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
    const grid = periodsAvailable(state.ptype), noData = [];
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
      traces.push({ x: xs(pts), y: pts.map(d => d.v), name: withMark(c), mode: "lines+markers", connectgaps: true,
        line: { color: col, width: 2 }, marker: { size: 12, symbol: syms[i], color: col, line: { color: css("--surface-1"), width: 1 } },
        error_y: { type: "data", array: pts.map(d => (d.se === null ? null : 1.96 * d.se)), color: hexA(col, 0.8), thickness: 1.75, width: 3 },
        hovertemplate: `<b>${c}</b><br>%{x}: %{y:.3f}<extra></extra>` });
    });
    const lay = baseLayout();
    lay.xaxis = axis({ type: "category", categoryorder: "array",
      categoryarray: state.ptype === "wave" ? Object.values(WAVES).slice(0, 7) : periodsAvailable("year") });
    lay.yaxis = axis({ title: { text: "Age Group Income Ratio, 55–64 / 25–34", font: { color: css("--text-secondary") } } });
    lay.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--text-muted"), width: 1, dash: "dot" } }];
    lay.hovermode = "x unified";
    if (isNarrow()) { lay.margin.r = 24; lay.margin.b = 64; lay.xaxis.automargin = true; lay.xaxis.tickangle = -40; lay.xaxis.tickfont = { size: 12, color: css("--text-secondary") }; }
    const chartEl = $("agirChart");
    if (!traces.length) {
      Plotly.purge("agirChart");
      chartEl.innerHTML = `<p class="note empty-msg">Nothing to show: open &ldquo;Choose lines&rdquo; and tick a group average or a country.</p>`;
    } else {
      if (chartEl.querySelector(".empty-msg")) chartEl.innerHTML = "";
      Plotly.react("agirChart", traces, lay, CONFIG);
    }
    $("agirSummary").textContent = "Line chart of the Age Group Income Ratio, 55 to 64 year-olds over 25 to 34 year-olds, by period. A value above 1 means older people have the higher average income. " + summ.join(" ");
    agirTbl = tbl; renderAgirTable();
    const how = "<strong>Partially imputed values.</strong> Group averages keep every country in every period: when a country has no survey in a period, its latest available Age Group Income Ratio is carried forward. " +
      ["High-income", "Middle-income"].filter(g => impAll[g] && impAll[g].length).map(g => `<br><strong>${g}, carried forward in at least one period:</strong> ${impAll[g].join(", ")}.`).join("") + "<br>" +
      (state.ptype === "year" ? "With single years, many values are carried forward between surveys, so waves are more reliable. " : "") +
      "South Africa is not in the group averages. Country lines show observed values only.";
    const readMe = "<strong>How to read the chart.</strong> The dotted line marks equal incomes (ratio of 1). Vertical lines on countries" + (anyGroup() ? " and shaded bands on group averages" : "") + " are 95% confidence intervals." +
      (anyGroup() ? " Filled markers are observed values; hollow markers include carried-forward values." : "") +
      " A country line joins the surveys we observe; a period without a survey has no marker and nothing is imputed." +
      "<br><strong>From and To</strong> also set the headline numbers above and the decomposition further down.";
    const groupNote = anyGroup() ? "<br>" + how : "";
    const cnotes = state.cmp.filter(c => NOTES[c]).map(c => `<br><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}`).join("");
    $("agirNote").innerHTML = `<button type="button" class="imp-btn inline pill" aria-expanded="false" aria-controls="imp-agir"><span class="i" aria-hidden="true">i</span>Notes</button>` +
      `<div class="imp-pop" id="imp-agir" role="note" hidden>${readMe}${groupNote}${cnotes}</div>`;
    renderReadLine();
  }

  // ---- "What the line says": plain-language reading of one or two country lines
  const SHAPES = {
    "diamond": "6,0 12,6 6,12 0,6", "triangle-up": "6,0.5 12,11.5 0,11.5", "triangle-down": "0,0.5 12,0.5 6,11.5",
    "pentagon": "6,0 11.7,4.4 9.5,11.2 2.5,11.2 0.3,4.4", "hexagon": "3,0.5 9,0.5 12,6 9,11.5 3,11.5 0,6",
    "star": "6,0 7.5,4.2 12,4.4 8.5,7.2 9.7,11.6 6,9 2.3,11.6 3.5,7.2 0,4.4 4.5,4.2" };
  const mark = (sym, col) => `<svg class="mk" viewBox="0 0 12 12" width="18" height="18" aria-hidden="true"><polygon points="${SHAPES[sym]}" fill="var(${col})"/></svg>`;
  const pct = v => Math.round(100 * (v - 1));
  const gapWords = (v, than = true) => { const p = pct(v); return p === 0 ? "about the same" + (than ? " as" : "") : `${Math.abs(p)}% ${p > 0 ? "higher" : "lower"}` + (than ? " than" : ""); };
  function renderReadLine() {
    const sec = $("readLine");
    if (state.cmp.length < 1 || state.cmp.length > 2) { sec.hidden = true; return; }
    sec.hidden = false;
    const old = `<span class="chip old">55&ndash;64</span>`, young = `<span class="chip young">25&ndash;34</span>`;
    $("readLineBody").innerHTML = state.cmp.map(c => {
      const col = SLOT_COL[slotOf[c]], sym = SLOT_SYM[slotOf[c]];
      const obs = agirSeries(c, state.ptype).filter(d => d.t >= state.from && d.t <= state.to);
      const head = `<header>${mark(sym, col)}<h3>${withMark(c)}</h3></header>`;
      if (!obs.length) return `<article class="lc" style="--lc:var(${col})">${head}<p>No survey for this country between ${label(state.ptype, state.from)} and ${label(state.ptype, state.to)}.</p></article>`;
      const a = obs[0], z = obs[obs.length - 1];
      const fig = (d, when) => `<div class="fig"><div class="yr">${label(state.ptype, d.t)}</div><div class="big">${d.v.toFixed(2)}</div><div class="sub">AGIR</div></div>`;
      const edge = (d, want) => d.t !== want ? ` <span class="edge">(${want === state.from ? "first" : "last"} survey in the selected range)</span>` : "";
      let body, delta = "";
      if (a === z) {
        body = `<p>In <strong>${c}</strong>, the average income of ${old} year-olds was <strong>${gapWords(a.v)}</strong> that of ${young} year-olds in ${label(state.ptype, a.t)}. That is the only survey in the selected range.</p>`;
        return `<article class="lc" style="--lc:var(${col})">${head}<div class="pair">${fig(a)}</div>${body}</article>`;
      }
      const dp = Math.round(100 * (z.v - a.v));
      delta = dp === 0 ? "The figure is unchanged." : `A change of <strong>${dp > 0 ? "+" : "\u2212"}${Math.abs(dp)} percentage points</strong> since ${label(state.ptype, a.t)}.`;
      return `<article class="lc" style="--lc:var(${col})">${head}<div class="pair">${fig(a)}<span class="arrow" aria-hidden="true">&rarr;</span>${fig(z)}</div>` +
        `<p>In <strong>${c}</strong>, the average income of ${old} year-olds was <strong>${gapWords(a.v)}</strong> that of ${young} year-olds in ${label(state.ptype, a.t)}${edge(a, state.from)}. ` +
        `In ${label(state.ptype, z.t)}${edge(z, state.to)} it was <strong>${gapWords(z.v, false)}</strong>. ${delta}</p></article>`;
    }).join("");
  }

  function renderAgirTable() {
    const w = $("agirTableWrap");
    w.hidden = !state.agirTable;
    $("toggleAgirTable").textContent = state.agirTable ? "Hide table" : "Show table";
    $("toggleAgirTable").setAttribute("aria-expanded", String(state.agirTable));
    if (!state.agirTable) return;
    const ps = periodsAvailable(state.ptype);
    w.innerHTML = `<table><caption class="sr-only">Age Group Income Ratio by period, with 95% confidence interval</caption><thead><tr><th scope="col">Period</th>${agirTbl.map(s => `<th scope="col">${s.name}</th>`).join("")}</tr></thead><tbody>` +
      ps.map(t => `<tr><th scope="row">${label(state.ptype, t)}</th>${agirTbl.map(s => { const d = s.pts.find(x => x.t === t); return `<td>${d ? `${d.v.toFixed(2)} ±${d.ci.toFixed(2)}${d.imp ? " *" : ""}` : "no data"}</td>`; }).join("")}</tr>`).join("") +
      `</tbody></table><p class="note">Ratio ± 95% confidence interval. * partially imputed (some countries&rsquo; values carried forward).</p>`;
  }

  // ------------------------------------------------------------ chart 2 ----
  let current = [];
  let decompAnnounce = "";
  function renderDecomp() {
    const { ptype, from, to } = state;
    $("decompPeriod").textContent = `${label(ptype, from)} to ${label(ptype, to)}`;
    let list = countries.filter(c => state.group === "all" || groupOf(c) === state.group);
    const res = [], missing = [];
    if (from >= to) {
      Plotly.purge("decompChart");
      $("decompLegend").hidden = true;
      $("decompChart").innerHTML = `<p class="note">Choose a “To” period after the “From” period.</p>`;
      $("missingNote").textContent = ""; $("tableWrap").innerHTML = ""; current = [];
      $("decompSummary").textContent = decompAnnounce = "Choose a To period after the From period.";
      return;
    }
    list.forEach(c => { const d = decomp(c, ptype, from, to); d ? res.push(d) : missing.push(c); });
    const keyOf = { grd: "growth", wage: "wage", emp: "employ", trinc: "tr_inc", trshare: "tr_share" }[state.sort];
    res.sort((a, b) => state.sort === "name" ? b.country.localeCompare(a.country) : a[keyOf] - b[keyOf]);
    // group averages on top (excluding countries with caveats)
    const avg = g => {
      const a = res.filter(r => r.group === g && !CAVEAT[r.country]);
      if (!a.length) return null;
      const o = { country: g, group: g, isAvg: true };
      ["growth", ...MARGINS.map(m => m.key)].forEach(k => { o[k] = a.reduce((s, r) => s + r[k], 0) / a.length; });
      return o;
    };
    const avgs = ["Middle-income", "High-income"].filter(g => state.group === "all" || state.group === g).map(avg).filter(Boolean);
    const parts = avgs.slice().reverse().map(r => `${r.country} average: total ${fmt(r.growth)} percentage points per year (wages ${fmt(r.wage)}, employment ${fmt(r.employ)}, transfer income ${fmt(r.tr_inc)}, transfer share ${fmt(r.tr_share)}, other income ${fmt(r.other)}).`);
    const byG = res.slice().sort((a, b) => b.growth - a.growth);
    const ext = byG.length ? ` Among the ${byG.length} countries shown, the total ranges from ${fmt(byG[byG.length - 1].growth)} (${byG[byG.length - 1].country}) to ${fmt(byG[0].growth)} (${byG[0].country}).` : "";
    $("decompSummary").textContent = `Bar chart, ${label(ptype, from)} to ${label(ptype, to)}, of the annual growth rate differential between people aged 55 to 64 and 25 to 34, split into wages, employment, transfer income, transfer share and other income, in percentage points per year. Positive values widen the gap in favour of the old. ${parts.join(" ")}${ext} Use the Show table button for all values.`;
    decompAnnounce = `What drove the change, ${label(ptype, from)} to ${label(ptype, to)}. ${parts.join(" ")}`;
    const all = [...res, ...avgs];   // plotted bottom-to-top, so averages appear on top
    current = [...avgs.slice().reverse(), ...res.slice().reverse()];
    const yname = r => {   // on phones the label column is kept narrow so the bars get the room
      const n = r.isAvg ? `<b>${r.country}</b>` : withMark(r.country);
      return isNarrow() ? n.replace("United Kingdom", "UK").replace("United States", "US") : n;
    };
    const ys = all.map(yname);
    const span = all.map(r => [r.isAvg ? "group average" : `${label(ptype, r.from)} to ${label(ptype, r.to)}`,
      ""]);
    const traces = MARGINS.map(m => ({
      type: "bar", orientation: "h", name: m.label, y: ys, x: all.map(r => r[m.key]),
      customdata: all.map((r, j) => [...span[j], fmt(r[m.key])]),
      marker: { color: css(m.color), line: { color: css("--surface-1"), width: 1 } },
      hovertemplate: `<b>%{y}</b><br>${m.label}: %{customdata[2]} pp/yr<extra></extra>`
    }));
    traces.push({ type: "scatter", mode: "markers", name: "Total (GRD)", y: ys, x: all.map(r => r.growth), customdata: all.map((r, j) => [...span[j], fmt(r.growth)]),
      marker: { symbol: "diamond", size: 10, color: css("--total"), line: { color: css("--surface-1"), width: 2 } },
      hovertemplate: `<b>%{y}</b><br>Total GRD: %{customdata[2]} pp/yr<extra></extra>` });
    const lay = baseLayout();
    lay.barmode = "relative"; lay.bargap = 0.3;
    const narrow = isNarrow();
    // on phones the labels get only the room they need, so the bars use the full width
    lay.margin = narrow ? { l: 8, r: 8, t: 36, b: 56 } : Object.assign(lay.margin, { l: 170 });
    lay.height = Math.max(360, (narrow ? 28 : 26) * all.length + 130);
    lay.legend.font.size = narrow ? 12 : 14;
    // on phones the legend is plain HTML above the chart, so it can use the full width
    lay.showlegend = !narrow;
    if (narrow) lay.margin.t = 8;
    const lg = $("decompLegend");
    lg.hidden = !narrow;
    lg.innerHTML = MARGINS.map(m => `<span><i class="sw" style="background:${css(m.color)}"></i>${m.label}</span>`).join("") +
      `<span><i class="dia"></i>Total (GRD)</span>`;

    lay.xaxis = axis({ title: { text: "percentage points per year", font: { color: css("--text-secondary") } }, zeroline: true, zerolinewidth: 1.5 });
    lay.yaxis = axis({ automargin: true, tickfont: { size: narrow ? 11 : 14, color: css("--text-primary") } });
    lay.hovermode = "closest";
    Plotly.react("decompChart", traces, lay, CONFIG);
    const notes = [];
    const moved = res.filter(r => r.from !== from || r.to !== to);
    if (moved.length) notes.push(`Nearest available periods used for: ${moved.map(r => `${r.country} (${label(ptype, r.from)} to ${label(ptype, r.to)})`).join(", ")}.`);
    if (missing.length) notes.push(`Not shown, ${state.exact ? "no data in both periods" : "fewer than two periods in the range"}: ${missing.join(", ")}.`);
    const noted = res.filter(r => NOTES[r.country]).map(r => r.country);
    if (noted.length) notes.push(`${NOTE_MARK} Country notes apply to: ${noted.join(", ")} (hover or tap the country name, or <a href="#country-notes" class="notes-link">read the country notes</a>).`);
    $("missingNote").innerHTML = notes.join(" ");
    renderTable();
  }

  function renderTable() {
    const wrap = $("tableWrap");
    wrap.hidden = !state.table;
    $("toggleTable").textContent = state.table ? "Hide table" : "Show table";
    $("toggleTable").setAttribute("aria-expanded", String(state.table));
    if (!state.table) return;
    const cols = [["growth", "Total GRD"], ...MARGINS.map(m => [m.key, m.label])];
    wrap.innerHTML = `<table><caption class="sr-only">Decomposition of the growth rate differential, percentage points per year</caption><thead><tr><th scope="col">Country</th><th scope="col" class="per">Periods</th>${cols.map(c => `<th scope="col">${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      current.map(r => `<tr class="${r.isAvg ? "group" : ""}"><td>${r.country}</td><td class="per">${r.isAvg ? "" : label(state.ptype, r.from) + " to " + label(state.ptype, r.to)}</td>${cols.map(c => `<td>${fmt(r[c[0]])}</td>`).join("")}</tr>`).join("") +
      `</tbody></table><p class="note">Percentage points per year.</p>`;
  }

  function download() {
    const cols = ["growth", ...MARGINS.map(m => m.key)];
    const csv = ["country,group,from,to," + cols.map(c => c === "growth" ? "grd" : c).join(",")]
      .concat(current.map(r => [`"${r.country}"`, r.group, r.isAvg ? label(state.ptype, state.from) : label(state.ptype, r.from), r.isAvg ? label(state.ptype, state.to) : label(state.ptype, r.to),
        ...cols.map(c => r[c].toFixed(4))].join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `agir_decomposition_${state.from}_${state.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------- notes on country names ----
  const FULL = { UK: "United Kingdom", US: "United States" };
  const tip = $("noteTip"), decompEl = $("decompChart");
  function labelAt(x, y) {
    for (const t of decompEl.querySelectorAll(".ytick text")) {
      if (!t.textContent.includes(NOTE_MARK)) continue;
      const r = t.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 3 && y <= r.bottom + 3) {
        const n = t.textContent.replace(NOTE_MARK, "").trim();
        return NOTES[FULL[n] || n] ? FULL[n] || n : null;
      }
    }
    return null;
  }
  function showTip(c, x, y) {
    tip.innerHTML = `<strong>${c}${NOTE_MARK}</strong> ${noteText(c)}`;
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
  function renderAll() { renderTiles(); renderAgir(); renderDecomp(); }
  $("ptype").addEventListener("change", e => {
    state.ptype = e.target.value;
    if (state.ptype === "year") { state.from = 2004; state.to = 2022; } else { state.from = 1; state.to = 7; }
    fillPeriods(); renderAll(); announce(decompAnnounce);
  });
  $("from").addEventListener("change", e => { state.from = +e.target.value; renderTiles(); renderDecomp(); announce(decompAnnounce); });
  $("to").addEventListener("change", e => { state.to = +e.target.value; renderTiles(); renderDecomp(); announce(decompAnnounce); });
  $("group").addEventListener("change", e => { state.group = e.target.value; renderDecomp(); announce(decompAnnounce); });
  $("sort").addEventListener("change", e => { state.sort = e.target.value; renderDecomp(); announce(decompAnnounce); });
  $("toggleTable").addEventListener("click", () => { state.table = !state.table; renderTable(); });
  $("toggleAgirTable").addEventListener("click", () => { state.agirTable = !state.agirTable; renderAgirTable(); });
  $("download").addEventListener("click", download);
  // small "i" button on a tile opens/closes the imputation note (click outside or Escape closes it)
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
    resizeTimer = setTimeout(() => { if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderAgir(); renderDecomp(); } }, 200);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  $("countryNotes").innerHTML = Object.keys(NOTES).sort().map(c =>
    `<p><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}</p>`).join("");
  fillPeriods(); wirePicker(); renderAll();
})();
