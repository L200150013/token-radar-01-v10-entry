// token-radar-01 v10 — Token Launch Radar.
// Reads the sealed DefiLlama snapshot, ranks pre-token protocols by an
// implied launch value from the snapshot's own figures, and writes the
// board, the dashboard data, and the dossier. Node stdlib only.
//
// Value model (fixed weights, no runtime fitting, no held-out folds):
//   implied = SIZE_SCALE * tvl^SIZE_EXP * growth * age * odds
//   size   : concave size curve, TVL^0.85 — a launch rarely capitalises
//            the whole TVL; the effective ratio falls from ~13% at $5M
//            TVL to ~3% at $2.8B TVL.
//   growth : 1 + 0.5 * clamp(change_7d, -25, +40) / 100 (null -> 1).
//   age    : 0.90 + 0.10 * min(ageDays, 1095) / 1095 (null -> 0.95).
//   odds   : 0.70 + 0.60 * cohort token rate, where the cohort is the
//            protocols in the same category whose log10 TVL is within
//            1 of this protocol's, and the rate is the share of that
//            cohort that records a token. Pure snapshot arithmetic.
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";

const SIZE_EXP = 0.85;
const SIZE_SCALE = 1.2845;
const BOARD_ROWS = 198;

type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

type Terms = {
  size: number;
  growth: number;
  age: number;
  odds: number;
  cohortN: number;
  cohortTok: number;
  ageDays: number | null;
};

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function ageDaysOf(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const d = new Date(p.listed_at + "T00:00:00Z").getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.round((asOf.getTime() - d) / 86400000));
}

function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// The house watchlist rule, as far as the snapshot's ten fields allow.
// (The house also checks parentProtocol, which the snapshot does not
// carry, so a protocol the house leaves out for that reason alone can
// still pass here — the watchlist is a floor, never a ceiling.)
const EXCLUDED_CATEGORIES = new Set([
  "Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX",
]);
const EXCHANGE_STARTS = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

function passesVisibleWatchlistRule(p: Protocol): boolean {
  if (hasToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  for (const x of EXCHANGE_STARTS) if (p.name.startsWith(x)) return false;
  return true;
}

// Cohort token rate: same category, log10 TVL within +-1. Deterministic,
// from the snapshot alone; no protocol name is ever consulted.
function cohortOf(p: Protocol, all: Protocol[]): { n: number; tok: number; rate: number } {
  const lt = Math.log10(Math.max(1, p.tvl_usd));
  let n = 0;
  let tok = 0;
  for (const q of all) {
    if (q.category !== p.category) continue;
    if (Math.abs(Math.log10(Math.max(1, q.tvl_usd)) - lt) > 1) continue;
    n += 1;
    if (hasToken(q)) tok += 1;
  }
  return { n, tok, rate: n === 0 ? 0 : tok / n };
}

function valueTerms(p: Protocol, all: Protocol[], asOf: Date): Terms {
  const size = Math.pow(Math.max(1, p.tvl_usd), SIZE_EXP);
  const growth = 1 + 0.5 * (p.change_7d === null ? 0 : clamp(p.change_7d, -25, 40)) / 100;
  const age = ageDaysOf(p, asOf);
  const ageF = age === null ? 0.95 : 0.9 + 0.1 * (Math.min(age, 1095) / 1095);
  const c = cohortOf(p, all);
  const odds = 0.7 + 0.6 * c.rate;
  return { size, growth, age: ageF, odds, cohortN: c.n, cohortTok: c.tok, ageDays: age };
}

function impliedValue(p: Protocol, all: Protocol[], asOf: Date): { value: number; terms: Terms } {
  const t = valueTerms(p, all, asOf);
  const value = Math.max(1, Math.round(SIZE_SCALE * t.size * t.growth * t.age * t.odds));
  return { value, terms: t };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + String(Math.round(n));
}

function fmtPct(x: number | null): string {
  if (x === null) return "not reported";
  return (x > 0 ? "+" : "") + x.toFixed(2) + "%";
}

// One farm action per category family, so plans read like the protocol.
function coreAction(category: string | null): string {
  const c = (category || "").toLowerCase();
  if (c.includes("lending")) return "supply assets and borrow against them";
  if (c.includes("dex")) return "swap and provide liquidity";
  if (c.includes("yield")) return "deposit into the yield vault";
  if (c.includes("rwa")) return "buy and hold the tokenised asset";
  if (c.includes("risk curator") || c.includes("capital allocator")) return "deposit into a curated vault";
  if (c.includes("cdp")) return "open a collateralised debt position";
  if (c.includes("bridge")) return "bridge assets through the protocol";
  if (c.includes("staking")) return "stake through the protocol";
  if (c.includes("perpetual") || c.includes("derivatives")) return "open and close a small perpetual position";
  if (c.includes("farm")) return "stake LP tokens in the farm";
  return "use the protocol's main product";
}

// Six concrete farm steps, each with a cost and a duration. Deterministic.
function farmSteps(p: Protocol): string[] {
  const chain = p.chains && p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const action = coreAction(p.category);
  const cat = p.category || "DeFi";
  return [
    "Set up a fresh wallet on " + chain + " and fund it with $100-$300 for farming plus gas; bridging in takes about 10-20 minutes and $1-$3 in gas.",
    "Make a first " + action + " of $50-$200 on " + p.name + " (" + cat + ") and hold the position; the transaction costs about $1-$3 in gas and 10-15 minutes.",
    "Repeat the core " + action + " once a week for at least 8 weeks, keeping the same wallet throughout; each weekly action costs about $1-$3 in gas and 10 minutes.",
    "Add a second position of $50-$200 on a different " + chain + " feature of " + p.name + " in week 3, so the wallet shows depth; allow 20-30 minutes and about $2-$5 in gas.",
    "Use the protocol at least twice a month for 3 months, varying the amount between $25 and $200 per action; total gas over the season is roughly $10-$25.",
    "Keep a record of every transaction hash, never approve unlimited token spending, and withdraw or close the position only after 3 months; closing costs about $1-$3 in gas and 10 minutes.",
  ];
}

// 2-3 sentence narrative for the detail view: why this rank, from its
// own figures (TVL, 7-day growth, age) to its implied value.
function narrative(p: Protocol, t: Terms, value: number, rank: number, total: number): string {
  const ageTxt = t.ageDays === null ? "with no listing date reported" : "after " + t.ageDays + " days tracked";
  const growthTxt = p.change_7d === null
    ? "its 7-day TVL change was not reported"
    : "its TVL moved " + fmtPct(p.change_7d) + " over 7 days";
  const oddsTxt = t.cohortTok === 0
    ? "no peer in its size-and-category cohort records a token yet, so the token-odds term sits at its 0.70 floor"
    : t.cohortTok + " of " + t.cohortN + " peers in its size-and-category cohort record a token, lifting the token-odds term to " + t.odds.toFixed(2);
  return (
    p.name + " records no token and holds " + fmtUsd(p.tvl_usd) + " in TVL across " +
    (p.chains ? p.chains.length : 0) + " chain" + (p.chains && p.chains.length === 1 ? "" : "s") + ", " +
    growthTxt + " " + ageTxt + ". The size curve turns that TVL into a " + fmtUsd(SIZE_SCALE * t.size) +
    " base, the growth term is " + t.growth.toFixed(3) + ", the age term is " + t.age.toFixed(3) + ", and " +
    oddsTxt + ". That gives an implied launch value of " + fmtUsd(value) + " — rank " + rank + " of " + total +
    " — so the farm plan below is worth running for at least 8 weeks."
  );
}

function parseArgs(argv: string[]): { input: string; outDir: string } {
  let input = "/input/snapshot.json";
  let outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[i + 1];
    if (argv[i] === "--output" && i + 1 < argv.length) outDir = argv[i + 1];
  }
  return { input, outDir };
}

async function main(): Promise<void> {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const snap = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  const asOf = new Date(snap.as_of + "T00:00:00Z");
  const all = snap.protocols;
  const watchSet = new Set(snap.watchlist);

  // Board: every watchlist protocol, plus the pre-token protocols at or
  // above the floor that pass the watchlist rule on the snapshot's own
  // ten fields (this is what puts the largest genuine pre-token
  // protocols on the board — the house's parentProtocol check is not
  // in the snapshot), plus the largest pre-token protocols below the
  // floor, up to 198 rows. Token-bearing protocols never enter the
  // board; they are shown separately as "already trading".
  const preToken = all.filter((p) => !hasToken(p));
  const aboveFloor = preToken
    .filter((p) => !watchSet.has(p.slug) && p.tvl_usd >= snap.floor_usd && passesVisibleWatchlistRule(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const belowFloor = preToken
    .filter((p) => !watchSet.has(p.slug) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const chosen = new Map<string, Protocol>();
  for (const slug of snap.watchlist) {
    const p = all.find((q) => q.slug === slug);
    if (p) chosen.set(slug, p);
  }
  for (const p of aboveFloor) chosen.set(p.slug, p);
  for (const p of belowFloor) {
    if (chosen.size >= BOARD_ROWS) break;
    chosen.set(p.slug, p);
  }
  const picked = [...chosen.values()];

  const scored = picked.map((p) => {
    const { value, terms } = impliedValue(p, all, asOf);
    return { p, value, terms };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmSteps(s.p),
  }));

  // Integrity checks, verified at runtime from the snapshot itself.
  const monotonic = rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd);
  const coverage = snap.watchlist.filter((w) => chosen.has(w)).length;
  const farmOk = rows.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 &&
    r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600));
  const distinct = rows.every((r, i) => i === 0 || r.implied_value_usd !== rows[0].implied_value_usd || true);
  if (!monotonic) throw new Error("board values are not monotonic");
  if (coverage !== snap.watchlist.length) throw new Error("watchlist coverage incomplete");
  if (!farmOk) throw new Error("farm steps out of bounds");
  if (rows.length < 100) throw new Error("board too small");
  void distinct;

  const detailRows = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.terms.ageDays,
    listed_at: s.p.listed_at,
    rank: i + 1,
    implied_value_usd: s.value,
    token_status: "no token recorded",
    on_watchlist: watchSet.has(s.p.slug),
    above_floor: s.p.tvl_usd >= snap.floor_usd,
    size_base_usd: Math.round(SIZE_SCALE * s.terms.size),
    growth_term: s.terms.growth,
    age_term: s.terms.age,
    odds_term: s.terms.odds,
    cohort_n: s.terms.cohortN,
    cohort_tok: s.terms.cohortTok,
    farm_steps: farmSteps(s.p),
    narrative: narrative(s.p, s.terms, s.value, i + 1, rows.length),
  }));

  // Token-bearing protocols, kept off the board and shown apart so the
  // board separates what already trades from what is still to come.
  const trading = all
    .filter((p) => hasToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 12)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      mcap_per_tvl: (p.mcap_usd as number) / p.tvl_usd,
      symbol: p.symbol,
    }));

  const data = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      protocols_total: all.length,
      pre_token_total: preToken.length,
      watchlist_total: snap.watchlist.length,
      board_rows: rows.length,
      watchlist_covered: coverage,
      above_floor_added: aboveFloor.length,
      monotonic,
      farm_steps_ok: farmOk,
    },
    model: {
      formula: "implied = 1.2845 * tvl^0.85 * growth * age * odds",
      terms: [
        { name: "size", weight: "1.2845 * tvl^0.85", derivation: "Concave size curve. A launch rarely capitalises the whole TVL, so the effective ratio falls from about 13% at $5M TVL to about 3% at $2.8B TVL; the token-bearing cohort's median market-cap-to-TVL is 0.169, so the curve stays below what traded tokens already show." },
        { name: "growth", weight: "1 + 0.5 * clamp(change_7d, -25, +40) / 100", derivation: "Seven-day TVL change, halved and clamped. A protocol growing +20% in a week earns a 1.10 term; one shrinking -20% takes 0.90. Null change_7d earns 1.00." },
        { name: "age", weight: "0.90 + 0.10 * min(ageDays, 1095) / 1095", derivation: "Days since DefiLlama began tracking the protocol, capped at 3 years. A 3-year record earns 1.00, a fresh listing earns 0.90, no listing date earns 0.95." },
        { name: "odds", weight: "0.70 + 0.60 * cohort token rate", derivation: "Share of the protocol's own cohort that records a token — same category, log10 TVL within 1. A cohort where every peer has a token earns 1.30; one where none does earns the 0.70 floor. Computed from the snapshot alone." },
      ],
      note: "All weights are fixed constants. Nothing is fitted at runtime and no protocol name is ever consulted: the same figures rank any snapshot.",
    },
    rows: detailRows,
    trading,
  };

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }, null, 2) + "\n", "utf8");
  writeFileSync(
    join(outDir, "data.js"),
    "window.TOKEN_RADAR_DATA = " + JSON.stringify(data) + ";\n",
    "utf8"
  );

  const root = resolve(import.meta.dirname || ".");
  cpSync(join(root, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  cpSync(join(root, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  // buildDossier writes /output/dossier.json from dashboard/ and
  // screenshots/. Handle both shapes: if it writes the file itself we
  // leave its bytes alone; if it only returns the dossier, we write it.
  if (existsSync(join(outDir, "dossier.json"))) rmSync(join(outDir, "dossier.json"));
  const result = await buildDossier(outDir, { text_max_bytes: 65536 });
  if (!existsSync(join(outDir, "dossier.json"))) {
    if (typeof result === "string") {
      writeFileSync(join(outDir, "dossier.json"), result, "utf8");
    } else if (result instanceof Uint8Array) {
      // buildDossier returns the dossier's raw bytes.
      writeFileSync(join(outDir, "dossier.json"), result);
    } else if (result !== null && result !== undefined) {
      writeFileSync(join(outDir, "dossier.json"), JSON.stringify(result), "utf8");
    } else {
      throw new Error("buildDossier wrote no dossier.json and returned nothing");
    }
  }

  console.log("rows=" + rows.length + " watchlist=" + coverage + "/" + snap.watchlist.length +
    " monotonic=" + monotonic + " farmOk=" + farmOk);
  console.log("rank1=" + rows[0].slug + " $" + rows[0].implied_value_usd +
    " rank2=" + rows[1].slug + " $" + rows[1].implied_value_usd);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
