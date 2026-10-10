# LaunchForensics

LaunchForensics reconstructs an Ethereum token launch from the pair contract. Paste a DEXTools or DexScreener pair URL. The app resolves the pair, reads Uniswap V2 events, reconciles WETH reserves, and writes a forensic report.

It does not scrape DEXTools. Figures come from logs, receipts, and contract calls. If a provider cannot return history, the affected module stops and says what is missing.

## What you can do

- Track a live analysis through ten measured stages.
- Inspect the launch timeline, buyers, sellers, wallets, WETH flows, liquidity, chart, and contract disclosure.
- Enter **known external wallets** (addresses you know are not team-controlled). Team wallets are optional.
- Recalculate classifications after editing that list.
- Compare completed launches, including a BARSTRO pair you choose to run.
- Export JSON, CSV, and PDF.

Known-external statistics are a lower bound on identified outside participation. Unclassified addresses are not labeled organic and are not labeled team.

## Requirements

- Node.js 22
- PostgreSQL 16
- Redis 7

Docker is optional. `docker-compose.yml` starts Postgres and Redis with the credentials in `.env.example`. This environment can also use locally installed Postgres and Redis.

No paid API key is required to start. Public Ethereum RPCs are used until you add your own. Archive history for older launches needs an archive endpoint in Settings. Etherscan and an OpenAI-compatible model are optional.

## Setup

```bash
cp .env.example .env
docker compose up -d   # or use a local Postgres and Redis
npm install
npx prisma migrate dev
npm run dev
```

- Web: http://127.0.0.1:4720
- API: http://127.0.0.1:4721
- Health: http://127.0.0.1:4721/api/health

## Published site

The GitHub Pages site is a static snapshot of the saved BARSTRO report: https://jackmiller825.github.io/TokenAnalysisAI/

Hash routes keep the same build working after a custom domain is attached. Add the domain in the repository Pages settings and put that hostname in a `CNAME` file at `web/public/CNAME`. Do not commit a CNAME until the domain is ready.

`npm run build:pages` builds that snapshot. Pushes to `main` on https://github.com/JackMiller825/TokenAnalysisAI run `.github/workflows/pages.yml`. Pages must use GitHub Actions as the source. The published site cannot start a new Ethereum job or store API keys. Those stay on the local API.

`npm test` runs unit tests and a live BARSTRO reconstruction against Ethereum. The live test passes only when the chain returns the reference transactions.

`npm run test:e2e` runs Playwright against a dev server that is already listening on port 4720. It checks navigation, the external-wallet form, and, when a completed BARSTRO report is stored, that a near-total price collapse is not labeled an exact −100% wipe.

`npm run build` writes the web bundle to `web/dist` and the API bundle to `dist/server.js`.

## Reference pair

Barstronaut (BARSTRO), Ethereum mainnet:

- Token `0x8c58abe623dcd8daeea8400a34384ef003c44ff9`
- Pair `0x0d108526a484eb7927e593fd41d8a8823fc35650`
- https://www.dextools.io/app/ether/pair-explorer/0x0d108526a484eb7927e593fd41d8a8823fc35650

The **Use BARSTRO pair** button fills that URL. It does not preload conclusions. Run the analysis to verify them.

## Methodology

See the in-app Methodology page. In short:

- Buys send WETH in and take tokens out. The actor is the transaction sender.
- Ending WETH = mints + buy inflows + direct inflows − burns − sell outflows − direct outflows.
- Burned LP blocks `removeLiquidity`. It does not stop sells from draining WETH.
- Realized PnL is average cost on pool trades, and only when inventory is reconstructable.
- Scores with missing inputs are **Not Assessed**. The average is not a safety rating.
