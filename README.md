# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Hy1an/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Hy1an/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar over the sealed DefiLlama snapshot. The board ranks 197 protocols — the 40-protocol house watchlist, 138 below-floor finds and 19 above-floor records the house leaves off-list — by an implied launch value. The opening strip puts the held-out calibration and token odds next to the roster, not below the fold. Every row carries its snapshot inputs, a confidence band, comparable live tokens and a ten-step farm plan with cost and time. A detail page rebuilds each number from the fitted coefficients, walks through the value chain line by line, and prices every deposit × drop-share combination in the farm plan. The page works with no network.

## Run it

```sh
node main.ts --input /input/snapshot.json --output out
```

`main.ts` writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The page is plain HTML, CSS and JavaScript; `dashboard/model.js` is shared by Node and the browser, so the model the program runs is the model the page displays.

## The model

```
implied = TVL × exp(value fit) × token odds
```

- The value fit is a ridge regression of log(market cap / TVL) on log(TVL / $100M), fitted on the 95 traded peers that record a market cap and a listing date and trimmed 3% at each end. It is tested twice: leave-one-out over those peers, and five expanding walk-forward folds (the older half, then each later block). The flat-multiple baseline misses ×4.81 (leave-one-out) and ×5.24 (walk-forward); the size curve misses ×2.84 and ×3.19. Its P25–P75 residual band covers 46% of held-out peers, and 52% land within 3×.
- Seven-day growth and age are added to the size curve and retested. Both raise the held-out miss, so the launch fit keeps the size curve alone; both enter through the odds fit instead.
- The odds fit is a ridge-penalised logistic regression on all 758 records — size and age splines, eleven family dummies, interactions, growth and missingness flags. Its 10-fold accuracy is 70.0% against a 54.9% base rate; the top decile records a token 85.5% of the time. A single oldest-70% → newest-30% walk-forward scores 59.2%.
- CEX, bridge, liquid staking/restaking, wrapped/staked and versioned products are screened out of the ranking. The watchlist is always covered, and every snapshot record falls in exactly one ledger group.

The result is an implied value, not a promise that a token launches or that it trades at that price. Farm plans are derived from category, chain, TVL and listing age.
