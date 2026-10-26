/* UI wiring for Market Sizer. All the math lives in sizing.js. */
(function () {
  const S = window.Sizing;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "market-sizer:v1";

  // Illustrative assumptions for demonstration only.
  const PRESETS = {
    students: {
      model: {
        name: "Budgeting app for US college students",
        population: 19000000,
        filters: [
          { label: "Own a smartphone", percent: 95 },
          { label: "Want help budgeting", percent: 40 },
          { label: "Willing to pay for an app", percent: 15 },
        ],
        arpu: 48,
        serviceable: 70,
        share: 3,
        ranges: {
          population: [18000000, 20000000],
          "filter:0": [90, 98],
          "filter:1": [25, 55],
          "filter:2": [6, 25],
          arpu: [30, 60],
          serviceable: [60, 80],
          share: [1, 5],
        },
      },
      bottom: { accounts: 2000000, reached: 30, conversion: 4, price: 4, frequency: 12 },
      outlook: { growth: 6, startShare: 0.5 },
      swing: 20,
    },
    dental: {
      model: {
        name: "Scheduling software for US dental practices",
        population: 135000,
        filters: [
          { label: "Independent, not part of a chain", percent: 70 },
          { label: "No modern scheduling tool yet", percent: 35 },
        ],
        arpu: 1800,
        serviceable: 60,
        share: 4,
        ranges: {
          population: [125000, 145000],
          "filter:0": [60, 80],
          "filter:1": [20, 50],
          arpu: [1200, 2400],
          serviceable: [45, 75],
          share: [2, 6],
        },
      },
      bottom: { accounts: 20000, reached: 50, conversion: 5, price: 150, frequency: 12 },
      outlook: { growth: 4, startShare: 1 },
      swing: 20,
    },
    blank: {
      model: { name: "", population: 1000000, filters: [{ label: "In target segment", percent: 50 }], arpu: 100, serviceable: 50, share: 2, ranges: {} },
      bottom: { accounts: 10000, reached: 50, conversion: 5, price: 10, frequency: 12 },
      outlook: { growth: 5, startShare: 1 },
      swing: 20,
    },
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  let state = load() || clone(PRESETS.students);
  state.model.ranges = state.model.ranges || {};

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  const tdFields = ["population", "arpu", "serviceable", "share"];
  const buFields = ["accounts", "reached", "conversion", "price", "frequency"];

  function fillInputs() {
    $("name").value = state.model.name;
    tdFields.forEach((k) => ($(k).value = state.model[k]));
    buFields.forEach((k) => ($(k).value = state.bottom[k]));
    $("growth").value = state.outlook.growth;
    $("start-share").value = state.outlook.startShare;
    $("swing").value = state.swing;
    renderFilters();
  }

  function renderFilters() {
    const box = $("filters");
    box.innerHTML = "";
    state.model.filters.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "filter";
      row.innerHTML = `
        <input aria-label="Filter ${i + 1} label" data-i="${i}" data-k="label">
        <input aria-label="Filter ${i + 1} percent kept" type="number" min="0" max="100" step="1" data-i="${i}" data-k="percent">
        <button type="button" class="link danger" data-remove="${i}" aria-label="Remove filter ${i + 1}">Remove</button>`;
      row.querySelector('[data-k="label"]').value = f.label;
      row.querySelector('[data-k="percent"]').value = f.percent;
      box.appendChild(row);
    });
  }

  function readInputs() {
    state.model.name = $("name").value;
    tdFields.forEach((k) => (state.model[k] = $(k).value === "" ? NaN : Number($(k).value)));
    buFields.forEach((k) => (state.bottom[k] = $(k).value === "" ? NaN : Number($(k).value)));
    state.outlook.growth = Number($("growth").value) || 0;
    state.outlook.startShare = $("start-share").value === "" ? state.model.share : Number($("start-share").value);
    state.swing = Math.min(90, Math.max(1, Number($("swing").value) || 20));
    document.querySelectorAll("#filters input").forEach((el) => {
      const f = state.model.filters[Number(el.dataset.i)];
      f[el.dataset.k] = el.dataset.k === "percent" ? Number(el.value) : el.value;
    });
  }

  function showErrors(listId, errors) {
    $(listId).innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render() {
    const tdErr = S.validateTopDown(state.model);
    const buErr = S.validateBottomUp(state.bottom);
    showErrors("td-errors", tdErr);
    showErrors("bu-errors", buErr);

    const td = tdErr.length ? null : S.topDown(state.model);
    const bu = buErr.length ? null : S.bottomUp(state.bottom);

    $("tam").textContent = td ? S.money(td.tam) : "–";
    $("sam").textContent = td ? S.money(td.sam) : "–";
    $("som").textContent = td ? S.money(td.som) : "–";
    $("bu").textContent = bu ? S.money(bu.revenue) : "–";

    const verdict = $("verdict");
    if (td && bu) {
      const r = S.reconcile(td.som, bu.revenue);
      verdict.textContent = r.ratio === null ? "" : `${r.ratio.toFixed(2)}x SOM · ${r.verdict}`;
      verdict.className = `tag ${r.verdict.replace(" ", "-")}`;
      $("bu-explain").textContent = r.ratio === null ? "" : explain(r);
    } else {
      verdict.textContent = "";
      $("bu-explain").textContent = "";
    }

    renderRings(td);
    renderFunnel(td);
    $("bu-calc").textContent = bu
      ? `${S.count(state.bottom.accounts)} × ${state.bottom.reached}% × ${state.bottom.conversion}% = ${S.count(bu.customers)} customers × ${S.money(state.bottom.price)} × ${state.bottom.frequency}/yr = ${S.money(bu.revenue)} a year`
      : "";
    renderProjection(td);
    renderTornado(td);
    save();
  }

  function explain(r) {
    if (r.verdict === "consistent") return "The two methods agree within 2x, so the SOM looks grounded in something you can actually execute.";
    const higher = r.ratio > 1 ? "Bottom-up" : "Top-down";
    return `${higher} is the bigger number by ${Math.max(r.ratio, 1 / r.ratio).toFixed(1)}x. Recheck obtainable share against what your channels can realistically reach and convert.`;
  }

  function renderRings(td) {
    const svg = $("rings");
    if (!td || !(td.tam > 0)) { svg.innerHTML = ""; return; }
    // Circle area is proportional to value, with a floor so small rings stay visible.
    const R = 110, bottom = 230;
    const r = (v) => Math.max(R * Math.sqrt(v / td.tam), 7);
    const ring = (cls, radius, label) =>
      `<circle class="${cls}" cx="120" cy="${bottom - radius}" r="${radius}"><title>${label}</title></circle>`;
    svg.innerHTML =
      ring("ring-tam", R, `TAM ${S.money(td.tam)}`) +
      ring("ring-sam", r(td.sam), `SAM ${S.money(td.sam)}`) +
      ring("ring-som", r(td.som), `SOM ${S.money(td.som)}`);
  }

  function renderFunnel(td) {
    const body = $("funnel").querySelector("tbody");
    if (!td) { body.innerHTML = ""; return; }
    const rows = td.steps.map((s) =>
      `<tr><td>${escapeHtml(s.label)}</td><td class="num">${s.percent === undefined ? "" : s.percent + "%"}</td><td class="num">${S.count(s.count)}</td></tr>`);
    rows.push(`<tr><td>× ${S.money(state.model.arpu)} per customer</td><td></td><td class="num">TAM ${S.money(td.tam)}</td></tr>`);
    rows.push(`<tr><td>Serviceable</td><td class="num">${state.model.serviceable}%</td><td class="num">SAM ${S.money(td.sam)}</td></tr>`);
    rows.push(`<tr class="total"><td>Obtainable share</td><td class="num">${state.model.share}%</td><td class="num">SOM ${S.money(td.som)}</td></tr>`);
    body.innerHTML = rows.join("");
  }

  function renderProjection(td) {
    const body = $("projection").querySelector("tbody");
    const bars = $("bars");
    if (!td) { body.innerHTML = ""; bars.innerHTML = ""; return; }
    const rows = S.project(state.model, { years: 5, growth: state.outlook.growth, startShare: state.outlook.startShare });
    const max = Math.max(...rows.map((r) => r.som), 1);
    bars.innerHTML = rows
      .map((r) => `<div class="bar"><span class="v">${S.money(r.som)}</span><i style="height:${Math.max((r.som / max) * 100, 1)}%"></i><span class="y">Y${r.year}</span></div>`)
      .join("");
    body.innerHTML = rows
      .map((r) => `<tr><td>Year ${r.year}</td><td class="num">${S.money(r.sam)}</td><td class="num">${Number(r.share.toFixed(2))}%</td><td class="num">${S.money(r.som)}</td></tr>`)
      .join("");
  }

  function renderTornado(td) {
    const box = $("tornado");
    if (!td) { box.innerHTML = ""; return; }
    // Don't rebuild while someone is typing in a range box, or their cursor jumps.
    const active = document.activeElement;
    const typing = active && active.dataset && active.dataset.range;
    const base = td.som;
    const rows = S.sensitivity(state.model, state.swing);
    const maxDev = Math.max(...rows.map((r) => Math.max(base - r.low, r.high - base)), 1);
    const fmtIn = (r, v) => Number(Number(v).toFixed(r.key.startsWith("filter:") || ["serviceable", "share"].includes(r.key) ? 1 : 0));
    const unit = (r) => (r.key.startsWith("filter:") || ["serviceable", "share"].includes(r.key) ? "%" : r.key === "arpu" ? "$" : "");
    if (typing) {
      // Only refresh bars and SOM labels in place.
      rows.forEach((r) => {
        const row = box.querySelector(`[data-row="${r.key}"]`);
        if (!row) return;
        const lo = ((base - r.low) / maxDev) * 50, hi = ((r.high - base) / maxDev) * 50;
        row.style.order = rows.indexOf(r);
        row.querySelector(".lo").style.cssText = `left:${50 - lo}%;width:${lo}%`;
        row.querySelector(".hi").style.cssText = `left:50%;width:${hi}%`;
        row.querySelector(".t-range").textContent = `${S.money(r.low)} to ${S.money(r.high)}`;
        row.classList.toggle("default", !r.custom);
      });
      return;
    }
    box.innerHTML = rows
      .map((r) => {
        const lo = ((base - r.low) / maxDev) * 50;
        const hi = ((r.high - base) / maxDev) * 50;
        const u = unit(r);
        return `<div class="t-row${r.custom ? "" : " default"}" data-row="${r.key}">
          <span class="t-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}<span class="t-base">base ${u === "$" ? S.money(r.base) : u === "%" ? r.base + "%" : S.count(r.base)}</span></span>
          <span class="t-inputs">
            <input type="number" step="any" aria-label="${escapeHtml(r.label)} low" data-range="${r.key}" data-end="0" value="${fmtIn(r, r.lowValue)}">
            <span class="hint">to</span>
            <input type="number" step="any" aria-label="${escapeHtml(r.label)} high" data-range="${r.key}" data-end="1" value="${fmtIn(r, r.highValue)}">
          </span>
          <span class="t-track"><i class="lo" style="left:${50 - lo}%;width:${lo}%"></i><i class="hi" style="left:50%;width:${hi}%"></i><span class="mid"></span></span>
          <span class="t-range">${S.money(r.low)} to ${S.money(r.high)}</span>
        </div>`;
      })
      .join("");
  }

  function flash(msg) {
    $("status").textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => ($("status").textContent = ""), 3000);
  }

  function exportCsv() {
    const td = S.topDown(state.model);
    const bu = S.bottomUp(state.bottom);
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ["Scenario", state.model.name],
      [],
      ["Step", "Percent kept", "Count"],
      ...td.steps.map((s) => [s.label, s.percent === undefined ? "" : s.percent, Math.round(s.count)]),
      [],
      ["Metric", "Value"],
      ["Revenue per customer", state.model.arpu],
      ["TAM", Math.round(td.tam)],
      ["Serviceable %", state.model.serviceable],
      ["SAM", Math.round(td.sam)],
      ["Obtainable share %", state.model.share],
      ["SOM", Math.round(td.som)],
      ["Bottom-up customers", Math.round(bu.customers)],
      ["Bottom-up revenue", Math.round(bu.revenue)],
      [],
      ["Year", "SAM", "Share %", "SOM"],
      ...S.project(state.model, { years: 5, growth: state.outlook.growth, startShare: state.outlook.startShare })
        .map((r) => [r.year, Math.round(r.sam), Number(r.share.toFixed(2)), Math.round(r.som)]),
    ];
    const csv = lines.map((l) => l.map(q).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = (state.model.name || "market-sizing").toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Events
  document.querySelector("main").addEventListener("input", (e) => {
    if (e.target.id === "preset") return;
    if (e.target.dataset.range) {
      const key = e.target.dataset.range;
      const row = $("tornado").querySelector(`[data-row="${key}"]`);
      const [lo, hi] = [...row.querySelectorAll("input")].map((x) => x.value);
      state.model.ranges[key] = [lo === "" ? null : Number(lo), hi === "" ? null : Number(hi)];
      render();
      return;
    }
    readInputs();
    render();
  });
  $("tornado").addEventListener("focusout", () => setTimeout(() => {
    if (!(document.activeElement && document.activeElement.dataset.range)) render();
  }, 0));
  $("reset-ranges").addEventListener("click", () => {
    state.model.ranges = {};
    render();
    flash("Ranges reset to the default swing.");
  });
    $("filters").addEventListener("click", (e) => {
    const i = e.target.dataset.remove;
    if (i === undefined) return;
    state.model.filters.splice(Number(i), 1);
    // Filter ranges are keyed by position, so shift the ones after the removed filter.
    const ranges = {};
    for (const [k, v] of Object.entries(state.model.ranges)) {
      if (!k.startsWith("filter:")) { ranges[k] = v; continue; }
      const j = Number(k.slice(7));
      if (j < Number(i)) ranges[k] = v;
      else if (j > Number(i)) ranges[`filter:${j - 1}`] = v;
    }
    state.model.ranges = ranges;
    renderFilters();
    render();
  });
  $("add-filter").addEventListener("click", () => {
    state.model.filters.push({ label: "New filter", percent: 50 });
    renderFilters();
    render();
    $("filters").querySelector(".filter:last-child input").select();
  });
  $("preset").addEventListener("change", (e) => {
    if (!e.target.value) return;
    state = clone(PRESETS[e.target.value]);
    e.target.value = "";
    fillInputs();
    render();
    flash("Example loaded.");
  });
  $("copy").addEventListener("click", async () => {
    if (S.validateTopDown(state.model).length || S.validateBottomUp(state.bottom).length) return flash("Fix the input errors first.");
    try {
      await navigator.clipboard.writeText(S.summary(state.model, state.bottom, state.swing));
      flash("Summary copied. Paste it into a doc or deck.");
    } catch (e) {
      flash("Couldn't reach the clipboard in this browser.");
    }
  });
  $("export").addEventListener("click", () => {
    if (S.validateTopDown(state.model).length || S.validateBottomUp(state.bottom).length) return flash("Fix the input errors first.");
    exportCsv();
  });

  fillInputs();
  render();
})();
