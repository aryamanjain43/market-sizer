/**
 * Sizing logic for Market Sizer. No DOM, fully tested.
 *
 * Top-down:  start from a broad population and narrow it with filters.
 *   TAM = population × product(filter %) × annual revenue per customer
 *   SAM = TAM × serviceable %   (the part your product and channels can reach)
 *   SOM = SAM × obtainable share %   (what you can realistically win)
 *
 * Bottom-up: build revenue from units you can actually count.
 *   Revenue = target accounts × reached % × conversion % × price × purchases per year
 *
 * The two methods should land in the same ballpark. A big gap means one set of
 * assumptions needs another look, which is the point of doing both.
 */

const pct = (v) => Number(v) / 100;

function validateTopDown(m) {
  const errors = [];
  if (!(Number(m.population) > 0)) errors.push("Population must be greater than 0");
  (m.filters || []).forEach((f, i) => {
    if (!f.label || !String(f.label).trim()) errors.push(`Filter ${i + 1} needs a label`);
    const v = Number(f.percent);
    if (!(v >= 0 && v <= 100)) errors.push(`Filter ${i + 1} must be between 0 and 100%`);
  });
  if (!(Number(m.arpu) >= 0)) errors.push("Revenue per customer must be 0 or more");
  for (const [key, name] of [["serviceable", "Serviceable %"], ["share", "Obtainable share"]]) {
    const v = Number(m[key]);
    if (!(v >= 0 && v <= 100)) errors.push(`${name} must be between 0 and 100%`);
  }
  return errors;
}

function validateBottomUp(b) {
  const errors = [];
  if (!(Number(b.accounts) > 0)) errors.push("Target accounts must be greater than 0");
  for (const [key, name] of [["reached", "Reached %"], ["conversion", "Conversion %"]]) {
    const v = Number(b[key]);
    if (!(v >= 0 && v <= 100)) errors.push(`${name} must be between 0 and 100%`);
  }
  if (!(Number(b.price) >= 0)) errors.push("Price must be 0 or more");
  if (!(Number(b.frequency) > 0)) errors.push("Purchases per year must be greater than 0");
  return errors;
}

/** Walks the population through each filter so the funnel can be shown step by step. */
function funnel(m) {
  let count = Number(m.population);
  const steps = [{ label: "Starting population", count }];
  for (const f of m.filters || []) {
    count *= pct(f.percent);
    steps.push({ label: f.label, percent: Number(f.percent), count });
  }
  return steps;
}

function topDown(m) {
  const steps = funnel(m);
  const customers = steps[steps.length - 1].count;
  const tam = customers * Number(m.arpu);
  const sam = tam * pct(m.serviceable);
  const som = sam * pct(m.share);
  return { customers, tam, sam, som, steps };
}

function bottomUp(b) {
  const customers = Number(b.accounts) * pct(b.reached) * pct(b.conversion);
  const revenue = customers * Number(b.price) * Number(b.frequency);
  return { customers, revenue };
}

/**
 * How far apart the two estimates are, as bottom-up relative to top-down SOM.
 * Within 2x either way is "consistent", within 5x is "check", beyond is "far apart".
 */
function reconcile(som, bottomUpRevenue) {
  if (!(som > 0) || !(bottomUpRevenue > 0)) return { ratio: null, verdict: "n/a" };
  const ratio = bottomUpRevenue / som;
  const spread = Math.max(ratio, 1 / ratio);
  const verdict = spread <= 2 ? "consistent" : spread <= 5 ? "check" : "far apart";
  return { ratio, verdict };
}

/**
 * Projects SOM forward. The market grows at `growth` % a year, and your share
 * ramps linearly from `startShare` % in year 1 to the model's share in the final year.
 */
function project(m, { years = 5, growth = 0, startShare } = {}) {
  const base = topDown(m);
  const target = Number(m.share);
  const start = startShare === undefined ? target : Number(startShare);
  const rows = [];
  for (let y = 1; y <= years; y++) {
    const sam = base.sam * Math.pow(1 + pct(growth), y - 1);
    const share = years === 1 ? target : start + ((target - start) * (y - 1)) / (years - 1);
    rows.push({ year: y, sam, share, som: sam * pct(share) });
  }
  return rows;
}

/** Every input that feeds SOM, with a stable key, so ranges can be attached to each one. */
function drivers(m) {
  return [
    { key: "population", label: "Starting population", value: Number(m.population), isPercent: false },
    ...(m.filters || []).map((f, i) => ({ key: `filter:${i}`, label: f.label, value: Number(f.percent), isPercent: true })),
    { key: "arpu", label: "Revenue per customer", value: Number(m.arpu), isPercent: false },
    { key: "serviceable", label: "Serviceable %", value: Number(m.serviceable), isPercent: true },
    { key: "share", label: "Obtainable share", value: Number(m.share), isPercent: true },
  ];
}

function withValue(m, key, v) {
  if (key.startsWith("filter:")) {
    const i = Number(key.slice(7));
    return { ...m, filters: m.filters.map((f, j) => (j === i ? { ...f, percent: v } : f)) };
  }
  return { ...m, [key]: v };
}

/**
 * The low and high values to test for one driver. Uses the range the user set
 * in `m.ranges[key]` when it is valid (low <= base <= high), otherwise flexes the
 * base by ± `swing` %. Percent inputs never go above 100 or below 0.
 */
function rangeFor(m, d, swing) {
  const r = (m.ranges || {})[d.key];
  if (Array.isArray(r) && r.length === 2 && r.every((x) => Number.isFinite(Number(x)) && x !== "" && x !== null)) {
    const [lo, hi] = r.map(Number);
    if (lo >= 0 && lo <= d.value && hi >= d.value && (!d.isPercent || hi <= 100)) return { low: lo, high: hi, custom: true };
  }
  const low = Math.max(d.value * (1 - swing / 100), 0);
  const high = d.isPercent ? Math.min(d.value * (1 + swing / 100), 100) : d.value * (1 + swing / 100);
  return { low, high, custom: false };
}

/**
 * Tornado-style sensitivity on SOM: test each driver at its low and high value,
 * holding everything else at base. Sorted by the size of the effect, biggest first,
 * so the top row is the assumption most worth researching.
 */
function sensitivity(m, swing = 20) {
  return drivers(m)
    .map((d) => {
      const { low: lowValue, high: highValue, custom } = rangeFor(m, d, swing);
      const low = topDown(withValue(m, d.key, lowValue)).som;
      const high = topDown(withValue(m, d.key, highValue)).som;
      return { key: d.key, label: d.label, base: d.value, lowValue, highValue, custom, low, high, range: high - low };
    })
    .sort((a, b) => b.range - a.range || a.label.localeCompare(b.label));
}

/** Short money format: 1234 -> $1.2K, 5600000 -> $5.6M, 7.2e9 -> $7.2B. */
function money(n) {
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const fmt = (x, s) => `${sign}$${x >= 100 ? Math.round(x) : Number(x.toFixed(1))}${s}`;
  if (a >= 1e12) return fmt(a / 1e12, "T");
  if (a >= 1e9) return fmt(a / 1e9, "B");
  if (a >= 1e6) return fmt(a / 1e6, "M");
  if (a >= 1e3) return fmt(a / 1e3, "K");
  return `${sign}$${Math.round(a)}`;
}

function count(n) {
  return Math.round(Number(n)).toLocaleString("en-US");
}

/** A plain-text summary ready to paste into a doc, deck or email. */
function summary(m, b, swing = 20) {
  const td = topDown(m);
  const bu = bottomUp(b);
  const r = reconcile(td.som, bu.revenue);
  const lines = [
    `Market sizing: ${m.name || "Untitled"}`,
    "",
    `TAM ${money(td.tam)}  |  SAM ${money(td.sam)}  |  SOM ${money(td.som)}`,
    "",
    "Top-down:",
    ...td.steps.map((s) => `  ${s.percent === undefined ? "" : `× ${s.percent}% `}${s.label}: ${count(s.count)}`),
    `  × ${money(m.arpu)} per customer per year = TAM ${money(td.tam)}`,
    `  × ${m.serviceable}% serviceable = SAM ${money(td.sam)}`,
    `  × ${m.share}% obtainable share = SOM ${money(td.som)}`,
    "",
    "Bottom-up:",
    `  ${count(b.accounts)} target accounts × ${b.reached}% reached × ${b.conversion}% convert = ${count(bu.customers)} customers`,
    `  × ${money(b.price)} × ${b.frequency} per year = ${money(bu.revenue)}`,
    "",
    r.ratio === null
      ? "Cross-check: not enough data"
      : `Cross-check: bottom-up is ${r.ratio.toFixed(2)}x top-down SOM (${r.verdict})`,
  ];
  const top = sensitivity(m, swing)[0];
  if (top && top.range > 0) {
    lines.push(`Biggest uncertainty: ${top.label} (SOM ranges ${money(top.low)} to ${money(top.high)})`);
  }
  return lines.join("\n");
}

const api = { validateTopDown, validateBottomUp, funnel, topDown, bottomUp, reconcile, project, drivers, rangeFor, sensitivity, money, count, summary };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.Sizing = api;
