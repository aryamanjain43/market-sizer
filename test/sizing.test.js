const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/sizing.js");

const model = () => ({
  name: "Test",
  population: 1000000,
  filters: [
    { label: "In segment", percent: 50 },
    { label: "Has the problem", percent: 20 },
  ],
  arpu: 100,
  serviceable: 40,
  share: 5,
});

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("funnel walks the population through each filter", () => {
  const steps = S.funnel(model());
  assert.deepEqual(steps.map((s) => s.count), [1000000, 500000, 100000]);
  assert.equal(steps[2].label, "Has the problem");
});

test("top-down TAM, SAM and SOM follow the formula", () => {
  const r = S.topDown(model());
  close(r.customers, 100000);
  close(r.tam, 10000000);
  close(r.sam, 4000000);
  close(r.som, 200000);
});

test("top-down works with no filters", () => {
  const r = S.topDown({ ...model(), filters: [] });
  close(r.tam, 100000000);
});

test("bottom-up multiplies the counted units", () => {
  const r = S.bottomUp({ accounts: 2000, reached: 50, conversion: 10, price: 500, frequency: 2 });
  close(r.customers, 100);
  close(r.revenue, 100000);
});

test("reconcile labels the gap between methods", () => {
  assert.equal(S.reconcile(100, 150).verdict, "consistent");
  assert.equal(S.reconcile(100, 40).verdict, "check");
  assert.equal(S.reconcile(100, 1000).verdict, "far apart");
  assert.equal(S.reconcile(0, 10).verdict, "n/a");
  close(S.reconcile(200, 100).ratio, 0.5);
});

test("validation catches bad input", () => {
  assert.deepEqual(S.validateTopDown(model()), []);
  const errs = S.validateTopDown({ population: 0, filters: [{ label: "", percent: 150 }], arpu: -1, serviceable: 101, share: -5 });
  assert.equal(errs.length, 6);
  assert.deepEqual(S.validateBottomUp({ accounts: 1, reached: 1, conversion: 1, price: 1, frequency: 1 }), []);
  assert.equal(S.validateBottomUp({ accounts: 0, reached: -1, conversion: 200, price: -1, frequency: 0 }).length, 5);
});

test("projection grows SAM and ramps share to the target", () => {
  const rows = S.project(model(), { years: 3, growth: 10, startShare: 1 });
  assert.equal(rows.length, 3);
  close(rows[0].sam, 4000000);
  close(rows[2].sam, 4000000 * 1.21);
  close(rows[0].share, 1);
  close(rows[1].share, 3);
  close(rows[2].share, 5);
  close(rows[2].som, 4000000 * 1.21 * 0.05);
});

test("projection without a ramp holds share flat", () => {
  const rows = S.project(model(), { years: 2 });
  assert.deepEqual(rows.map((r) => r.share), [5, 5]);
});

test("sensitivity flexes each driver and sorts by effect", () => {
  const rows = S.sensitivity(model(), 20);
  assert.equal(rows.length, 6);
  // Every driver is a straight multiplier, so each one swings SOM by ±20%.
  for (const r of rows) {
    close(r.low, 160000);
    close(r.high, 240000);
  }
  // Ties sort alphabetically so the order is stable.
  assert.deepEqual(rows.map((r) => r.label), [...rows.map((r) => r.label)].sort());
});

test("sensitivity caps percentages at 100", () => {
  const m = { ...model(), serviceable: 100 };
  const row = S.sensitivity(m, 20).find((r) => r.label === "Serviceable %");
  close(row.high, S.topDown(m).som);
  assert.equal(S.sensitivity(m, 20)[S.sensitivity(m, 20).length - 1].label, "Serviceable %");
});

test("money formats short amounts", () => {
  assert.equal(S.money(950), "$950");
  assert.equal(S.money(1234), "$1.2K");
  assert.equal(S.money(5600000), "$5.6M");
  assert.equal(S.money(7.25e9), "$7.3B");
  assert.equal(S.money(250e6), "$250M");
  assert.equal(S.money(-2000), "-$2K");
});

test("summary includes the headline numbers and the cross-check", () => {
  const text = S.summary(model(), { accounts: 2000, reached: 50, conversion: 10, price: 500, frequency: 2 });
  assert.match(text, /TAM \$10M {2}\| {2}SAM \$4M {2}\| {2}SOM \$200K/);
  assert.match(text, /bottom-up is 0\.50x top-down SOM \(consistent\)/);
});

test("sensitivity uses custom ranges and ranks the widest first", () => {
  const m = { ...model(), ranges: { "filter:1": [10, 40], arpu: [80, 120] } };
  const rows = S.sensitivity(m, 20);
  assert.equal(rows[0].key, "filter:1");
  assert.equal(rows[0].custom, true);
  close(rows[0].low, 100000);
  close(rows[0].high, 400000);
  const arpu = rows.find((r) => r.key === "arpu");
  close(arpu.low, 160000);
  close(arpu.high, 240000);
  assert.equal(rows.find((r) => r.key === "population").custom, false);
});

test("invalid custom ranges fall back to the default swing", () => {
  const m = { ...model(), ranges: { share: [6, 9], serviceable: [30, 120], arpu: ["", 200] } };
  const rows = S.sensitivity(m, 10);
  for (const key of ["share", "serviceable", "arpu"]) assert.equal(rows.find((r) => r.key === key).custom, false, key);
});
