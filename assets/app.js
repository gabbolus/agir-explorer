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
  const wrap = t => t.replace(/(.{1,70})(\s|$)/g, "$1<br>").replace(/<br>$/, "");
  const label = (ptype, t) => (ptype === "wave" ? WAVES[t] : String(t));
  function hexA(hex, a) {
    const h = hex.replace("#", ""), n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function baseLayout() {
    return {
      paper_bgcolor: css("--surface-1"), plot_bgcolor: css("--surface-1"),
      font: { family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 13, color: css("--text-secondary") },
      margin: { l: 56, r: 16, t: 36, b: 40 },
      hoverlabel: { align: "left", bgcolor: css("--surface-1"), bordercolor: css("--border"), font: { color: css("--text-primary") } },
      legend: { orientation: "h", y: 1.01, yanchor: "bottom", x: 0, font: { color: css("--text-primary") } }
    };
  }
  const axis = extra => Object.assign({ gridcolor: css("--grid"), zerolinecolor: css("--text-muted"),
    linecolor: css("--border"), tickfont: { color: css("--text-secondary") } }, extra);
  const CONFIG = { responsive: true, displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };

  // --------------------------------------------------------------- state ----
  const state = { ptype: "wave", from: 1, to: 7, group: "all", sort: "grd", cmp: ["", "", ""], table: false, exact: false };

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
  function fillCountries() {
    const opts = `<option value="">—</option>` + countries.map(c => `<option>${c}</option>`).join("");
    ["c1", "c2", "c3"].forEach((id, i) => { $(id).innerHTML = opts; $(id).value = state.cmp[i]; });
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
      const impNote = nimp ? `<div class="s imp">Partially imputed: ${[...new Set([...(a ? a.imp : []), ...(b ? b.imp : [])])].join(", ")} carried forward from their latest survey.</div>` : "";
      return `<div class="tile"><div class="k"><span class="swatch" style="background:${css(col)}"></span>${g} countries, average Age Group Income Ratio${nimp ? " *" : ""}</div>
        <div class="v">${v}</div><div class="s">${label(state.ptype, state.from)} to ${label(state.ptype, state.to)} ${ch ? "· " + ch : ""}</div>${impNote}</div>`;
    }).join("");
  }

  // ------------------------------------------------------------ chart 1 ----
  function renderAgir() {
    const traces = [];
    const xs = d => d.map(p => (state.ptype === "wave" ? WAVES[p.t] : p.t));
    // each line has its own marker shape; filled = observed, open = partially imputed
    [["High-income", "--series-1", "solid", "circle"], ["Middle-income", "--series-2", "dash", "square"]].forEach(([g, col, dash, sym]) => {
      const s = groupSeries(countries.filter(c => groupOf(c) === g && !CAVEAT[c]), state.ptype);
      const c = css(col);
      traces.push({ x: xs(s), y: s.map(d => d.v + 1.96 * d.se), mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      traces.push({ x: xs(s), y: s.map(d => d.v - 1.96 * d.se), mode: "lines", line: { width: 0 }, fill: "tonexty",
        fillcolor: hexA(c, 0.15), hoverinfo: "skip", showlegend: false });
      const impTxt = d => d.imp.length ? `<br><i>partially imputed: ${d.imp.length} of ${d.n} carried forward</i><br>(${d.imp.join(", ")})` : "";
      traces.push({ x: xs(s), y: s.map(d => d.v), name: `${g} average`, mode: "lines+markers",
        line: { color: c, width: 2, dash },
        marker: { size: 9, symbol: s.map(d => d.imp.length ? `${sym}-open` : sym), color: c,
          line: { color: s.map(d => d.imp.length ? c : css("--surface-1")), width: 2 } },
        customdata: s.map(d => [d.n, d.se, impTxt(d)]),
        hovertemplate: `<b>${g} average</b><br>%{x}: %{y:.3f}<br>±%{customdata[1]:.3f} SE · %{customdata[0]} countries%{customdata[2]}<extra></extra>` });
    });
    const cols = ["--series-3", "--series-4", "--series-5"];
    const syms = ["diamond", "triangle-up", "star"];
    // country lines: observed values only. The line joins the observed surveys; missing
    // periods have no marker or value and are listed as "no data" - never imputed.
    const grid = periodsAvailable(state.ptype), noData = [];
    state.cmp.forEach((c, i) => {
      if (!c) return;
      const obs = {};
      agirSeries(c, state.ptype).forEach(d => { obs[d.t] = d; });
      const col = css(cols[i]);
      const pts = grid.map(t => obs[t] || { t, v: null, se: null });
      const miss = grid.filter(t => !obs[t]).map(t => label(state.ptype, t));
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
    Plotly.react("agirChart", traces, lay, CONFIG);
    $("agirNote").innerHTML = "<strong>Partially imputed values.</strong> Group averages keep every country in every period: when a country has no survey in a period, its latest available Age Group Income Ratio is carried forward. Filled markers are observed values; hollow markers show averages that include carried-forward values (hover to see which countries). " +
      (state.ptype === "year" ? "With single years, many values are carried forward between surveys, so waves are more reliable. " : "") +
      "Shaded bands (group averages) and vertical lines (countries) are 95% confidence intervals. Dotted line: equal incomes. South Africa is not in the group averages. Country lines show observed values only." +
      (noData.length ? `<br><strong>No data</strong> (no marker; the line only joins observed surveys, nothing is imputed): ${noData.join("; ")}.` : "") +
      state.cmp.filter(c => c && NOTES[c]).map(c => `<br><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}`).join("");
  }

  // ------------------------------------------------------------ chart 2 ----
  let current = [];
  function renderDecomp() {
    const { ptype, from, to } = state;
    $("decompTitle").textContent = `What drove the change, ${label(ptype, from)} to ${label(ptype, to)}`;
    let list = countries.filter(c => state.group === "all" || groupOf(c) === state.group);
    const res = [], missing = [];
    if (from >= to) {
      Plotly.purge("decompChart");
      $("decompChart").innerHTML = `<p class="note">Choose a “To” period after the “From” period.</p>`;
      $("missingNote").textContent = ""; $("tableWrap").innerHTML = ""; current = [];
      return;
    }
    list.forEach(c => { const d = decomp(c, ptype, from, to); d ? res.push(d) : missing.push(c); });
    const keyOf = { grd: "growth", emp: "employ", wage: "wage" }[state.sort];
    res.sort((a, b) => state.sort === "name" ? b.country.localeCompare(a.country) : a[keyOf] - b[keyOf]);
    // group averages on top (excluding countries with caveats)
    const avg = g => {
      const a = res.filter(r => r.group === g && !CAVEAT[r.country]);
      if (!a.length) return null;
      const o = { country: `${g} avg`, group: g, isAvg: true };
      ["growth", ...MARGINS.map(m => m.key)].forEach(k => { o[k] = a.reduce((s, r) => s + r[k], 0) / a.length; });
      return o;
    };
    const avgs = ["Middle-income", "High-income"].filter(g => state.group === "all" || state.group === g).map(avg).filter(Boolean);
    const all = [...res, ...avgs];   // plotted bottom-to-top, so averages appear on top
    current = [...avgs.slice().reverse(), ...res.slice().reverse()];
    const yname = r => r.isAvg ? `<b>${r.country}</b>` : withMark(r.country);
    const ys = all.map(yname);
    const span = all.map(r => [r.isAvg ? "group average" : `${label(ptype, r.from)} to ${label(ptype, r.to)}`,
      !r.isAvg && NOTES[r.country] ? `<br><i>${NOTE_MARK} ${wrap(noteText(r.country))}</i>` : ""]);
    const traces = MARGINS.map(m => ({
      type: "bar", orientation: "h", name: m.label, y: ys, x: all.map(r => r[m.key]),
      customdata: all.map((r, j) => [...span[j], fmt(r[m.key])]),
      marker: { color: css(m.color), line: { color: css("--surface-1"), width: 1 } },
      hovertemplate: `<b>%{y}</b> (%{customdata[0]})<br>${m.label}: %{customdata[2]} pp/yr%{customdata[1]}<extra></extra>`
    }));
    traces.push({ type: "scatter", mode: "markers", name: "Total (GRD)", y: ys, x: all.map(r => r.growth), customdata: all.map((r, j) => [...span[j], fmt(r.growth)]),
      marker: { symbol: "diamond", size: 10, color: css("--total"), line: { color: css("--surface-1"), width: 2 } },
      hovertemplate: `<b>%{y}</b> (%{customdata[0]})<br>Total GRD: %{customdata[2]} pp/yr%{customdata[1]}<extra></extra>` });
    const lay = baseLayout();
    lay.barmode = "relative"; lay.bargap = 0.3;
    lay.margin.l = 170;
    lay.height = Math.max(360, 26 * all.length + 110);
    lay.xaxis = axis({ title: { text: "percentage points per year", font: { color: css("--text-secondary") } }, zeroline: true, zerolinewidth: 1.5 });
    lay.yaxis = axis({ automargin: true, tickfont: { color: css("--text-primary") } });
    lay.hovermode = "closest";
    Plotly.react("decompChart", traces, lay, CONFIG);
    const notes = [];
    const moved = res.filter(r => r.from !== from || r.to !== to);
    if (moved.length) notes.push(`Nearest available periods used for: ${moved.map(r => `${r.country} (${label(ptype, r.from)} to ${label(ptype, r.to)})`).join(", ")}.`);
    if (missing.length) notes.push(`Not shown, ${state.exact ? "no data in both periods" : "fewer than two periods in the range"}: ${missing.join(", ")}.`);
    const noted = res.filter(r => NOTES[r.country]).map(r => r.country);
    if (noted.length) notes.push(`${NOTE_MARK} Country notes apply to: ${noted.join(", ")} (hover a bar, or see “Country notes” below).`);
    $("missingNote").textContent = notes.join(" ");
    renderTable();
  }

  function renderTable() {
    const wrap = $("tableWrap");
    wrap.hidden = !state.table;
    $("toggleTable").textContent = state.table ? "Hide table" : "Show table";
    if (!state.table) return;
    const cols = [["growth", "Total GRD"], ...MARGINS.map(m => [m.key, m.label])];
    wrap.innerHTML = `<table><thead><tr><th>Country</th><th>Periods</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      current.map(r => `<tr class="${r.isAvg ? "group" : ""}"><td>${r.country}</td><td>${r.isAvg ? "" : label(state.ptype, r.from) + " to " + label(state.ptype, r.to)}</td>${cols.map(c => `<td>${fmt(r[c[0]])}</td>`).join("")}</tr>`).join("") +
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

  // ---------------------------------------------------------------- wire ----
  function renderAll() { renderTiles(); renderAgir(); renderDecomp(); }
  $("ptype").addEventListener("change", e => {
    state.ptype = e.target.value;
    if (state.ptype === "year") { state.from = 2004; state.to = 2022; } else { state.from = 1; state.to = 7; }
    fillPeriods(); renderAll();
  });
  $("from").addEventListener("change", e => { state.from = +e.target.value; renderTiles(); renderDecomp(); });
  $("to").addEventListener("change", e => { state.to = +e.target.value; renderTiles(); renderDecomp(); });
  $("group").addEventListener("change", e => { state.group = e.target.value; renderDecomp(); });
  $("exact").addEventListener("change", e => { state.exact = e.target.value === "exact"; renderDecomp(); });
  $("sort").addEventListener("change", e => { state.sort = e.target.value; renderDecomp(); });
  ["c1", "c2", "c3"].forEach((id, i) => $(id).addEventListener("change", e => { state.cmp[i] = e.target.value; renderAgir(); }));
  $("toggleTable").addEventListener("click", () => { state.table = !state.table; renderTable(); });
  $("download").addEventListener("click", download);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  $("countryNotes").innerHTML = Object.keys(NOTES).sort().map(c =>
    `<p><strong>${c}${NOTE_MARK}</strong> ${noteText(c)}</p>`).join("");
  fillPeriods(); fillCountries(); renderAll();
})();
