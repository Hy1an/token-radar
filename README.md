# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Hy1an/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Hy1an/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar over the sealed DefiLlama snapshot. The board ranks 197 protocols — the 40-protocol house watchlist plus 157 below-floor finds that pass the same product screen — by an implied launch value. Every row carries its snapshot inputs, the four model multipliers, a confidence band, comparable live tokens and an eight-step farm plan with cost and time. A detail page rebuilds each number from the 128 live-token comps, and the page works with no network.

## Run it

```sh
node main.ts --input /input/snapshot.json --output out
```

`main.ts` writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The page is plain HTML, CSS and JavaScript; `dashboard/model.js` is shared by Node and the browser, so the model the program runs is the model the page displays.

## The model

```
implied = TVL × peer mcap/TVL × momentum × maturity × chain breadth
```

- Peer mcap/TVL is calibrated from the snapshot's live-token protocols. A category with two or more comps uses its median; a thinner category borrows its family median, then the market median, each shrunk toward the market with a five-observation prior.
- Momentum is the protocol's seven-day TVL change, clamped to −60%…+120% and weighted 0.30.
- Maturity goes from 0.70 at listing to 1.15 at six years without a recorded token.
- Chain breadth adds 3% per chain, capped at six chains.
- CEX, bridge, liquid staking/restaking, wrapped/staked and versioned products are screened out of the ranking. The watchlist is always covered.

The result is an implied value, not a promise that a token launches or that it trades at that price. Farm plans are derived from category, chain, TVL and listing age.
