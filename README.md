[![make.fun](https://make.fun/badge.svg)](https://make.fun/c/token-radar-01)

# Token Launch Radar — v10

Which pre-token protocol is worth farming next? This entry reads the sealed
DefiLlama snapshot (758 protocols at or above $5M TVL, 40 on the watchlist),
ranks the protocols that record no token by an implied launch value, and
hands in a dashboard with the board, a detail view for every protocol, and a
6-step farm plan each — every step with a cost and a duration.

## The value model

```
implied = 1.2845 * tvl^0.85 * growth * age * odds
```

- **size** — `1.2845 * tvl^0.85`: a concave size curve. A launch rarely
  capitalises the whole TVL, so the effective ratio falls from about 13%
  at $5M TVL to about 3% at $2.8B TVL.
- **growth** — `1 + 0.5 * clamp(change_7d, -25, +40) / 100`: seven-day TVL
  change, halved and clamped.
- **age** — `0.90 + 0.10 * min(ageDays, 1095) / 1095`: days since DefiLlama
  began tracking the protocol, capped at 3 years.
- **odds** — `0.70 + 0.60 * cohort token rate`: the share of the protocol's
  own cohort (same category, log10 TVL within 1) that records a token.

All weights are fixed constants. Nothing is fitted at run time, no held-out
folds, and no protocol name is ever consulted: the same figures rank any
snapshot.

## The board

198 rows: all 40 watchlist protocols, the pre-token protocols at or above
the $50M floor that pass the watchlist rule on the snapshot's own ten
fields, and the largest pre-token protocols below the floor. Rank 1 is
Sentora Curator at about $90.2M implied, rank 2 Steakhouse Financial at
about $89.2M. Protocols whose token already trades are kept off the board
and shown apart in the dashboard, with their market-cap-to-TVL ratios as
the reality check behind the size curve.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (standard library only). Writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` into the output directory.
Two runs from different working directories produce byte-identical output.
