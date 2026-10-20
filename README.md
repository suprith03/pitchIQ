# PitchIQ — Interactive Football Analytics Simulator

PitchIQ is a React/TypeScript football analytics application backed by Apollo GraphQL, football-data.org v4, MongoDB, and optional Oracle Database Free. Premier League teams, tables, fixtures, results, and scorer totals are shown only when returned by the provider or retained in a real provider snapshot. There is no bundled sample league, demo mode, or fictional fallback.

## Features

- League overview and standings, fixtures, Team DNA, Matchup Lab, What-If Simulator, season forecast, scorers, and Database Lab.
- What-If outcomes and forecasts are separate from official provider results.
- GraphQL API with typed operations, provider synchronization, validated CSV supplements, database health, and measured query benchmarks.
- MongoDB stores season snapshots, simulations, match events, and permitted CSV supplements. Unique indexes prevent duplicate season snapshots and fixtures.
- Oracle schema and PL/SQL procedures support structured authoritative storage when an Oracle instance is configured.
- If live synchronization fails, the application uses the latest persisted real provider snapshot when available. If neither source has data, the UI shows the connection error and an empty state.

See [docs/architecture.md](./docs/architecture.md) for system and entity relationship diagrams.

## Requirements

- Node.js 22.12+ and npm.
- MongoDB Community 7+ (local or Docker Compose) for persistent snapshots and simulations.
- Oracle Database Free with a `FREEPDB1` PDB for Oracle-backed storage. Oracle is optional in `provider-cache` mode.
- A football-data.org token with access to the Premier League endpoints/seasons you need.

## Setup

From the repository root:

```sh
npm install
cp .env.example .env
```

Edit the root `.env` and set `FOOTBALL_DATA_API_TOKEN` to the token from your football-data.org account. The value is read by the backend only. Vite exposes only `VITE_*` environment variables to frontend code; never rename the provider token to a `VITE_*` variable.

The `.env.example` leaves Oracle username and password blank. Supply the credentials for your own Oracle schema only if using Oracle mode. Keep `.env` local; it is ignored by Git. Other service values, such as the MongoDB URI and API port, can also be configured there. Restart the API after changing environment values.

Start MongoDB locally, or use Docker Compose where available:

```sh
docker compose up -d mongodb
```

Then start both applications:

```sh
npm run dev
```

The frontend is served at `http://localhost:5173`, the GraphQL endpoint is `http://localhost:4000/graphql`, and API health is `http://localhost:4000/health`. To run one process, use `npm run dev:api` or `npm run dev:web`.

The default `STORAGE_MODE=provider-cache` synchronizes the configured/current season at API startup and persists successful snapshots in MongoDB. If the provider is temporarily unavailable, a previous real snapshot remains usable and is labelled as cached. Without a live or cached season the app reports the sync error and does not substitute invented statistics.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment |
| `API_PORT` | `4000` | GraphQL API port |
| `WEB_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `STORAGE_MODE` | `provider-cache` | `provider-cache` or `oracle` |
| `ORACLE_USER` | blank | Your Oracle schema owner, if using Oracle |
| `ORACLE_PASSWORD` | blank | Your Oracle password, if using Oracle |
| `ORACLE_CONNECT_STRING` | `localhost:1521/FREEPDB1` | Oracle service address |
| `MONGO_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection URI |
| `MONGO_DATABASE` | `pitchiq` | MongoDB database |
| `FOOTBALL_DATA_API_TOKEN` | blank | Server-only football-data.org token |
| `FOOTBALL_DATA_COMPETITION` | `PL` | Provider competition code |
| `FOOTBALL_DATA_SEASON` | blank | Optional season start year |
| `CACHE_TTL_SECONDS` | `900` | TTL for transient API cache entries |
| `REQUEST_TIMEOUT_MS` | `10000` | Provider request timeout |
| `BENCHMARK_ITERATIONS` | `30` | Default benchmark repeat count |
| `VITE_GRAPHQL_URL` | `http://localhost:4000/graphql` | Optional browser GraphQL endpoint override |

The API loads the root `.env` using a path derived from its own location, so it works when started from the project root or as a compiled backend process. The API token is not logged or included in frontend bundles.

## Provider access and data policy

PitchIQ uses football-data.org API v4 and sends credentials in the `X-Auth-Token` HTTP header. A full season synchronization requests:

- `GET /v4/competitions/{code}`
- `GET /v4/competitions/{code}/teams`
- `GET /v4/competitions/{code}/standings`
- `GET /v4/competitions/{code}/matches`
- `GET /v4/competitions/{code}/scorers` (optional; unavailable scorer access is reported as a warning)

The default competition code is `PL`. Historical season-year requests depend on the account plan. PitchIQ reports provider permission errors and rate limits; it does not scrape the Premier League website or assume historical endpoint access. Use the Database Lab synchronization form to request a season. Check the current [v4 documentation](https://docs.football-data.org/general/v4/index.html) and [plan information](https://www.football-data.org/pricing) for current access and quotas.

## MongoDB persistence

The API creates indexes for unique competition/season snapshots, unique season/fixture CSV supplements, match-event upserts, simulations, and transient cache TTL. Snapshot and simulation documents survive process restarts. Database Lab displays actual collection counts and indexes when MongoDB is connected.

The `database/mongodb-init.js` script creates the MongoDB indexes for container initialization. The same indexes are also ensured by the backend at startup.

## Oracle Database Free

Oracle was not available in the original development environment; provision and validate your own instance before relying on this mode.

1. Create an Oracle schema user and grant required table, procedure, identity, and session privileges.
2. Connect SQL*Plus to the `FREEPDB1` PDB and apply the required migration:

   ```sql
   @database/migrations/001_initial_schema.sql
   ```

3. Set `STORAGE_MODE=oracle`, `ORACLE_USER`, `ORACLE_PASSWORD`, and `ORACLE_CONNECT_STRING` in the root `.env`.
4. Start the API. It will fail explicitly if Oracle mode is selected but the configured connection cannot be established.

The migration creates teams, players, matches, goal events, player match statistics, and standings, plus `validate_match_results` and `recalculate_standings` PL/SQL procedures. No fictional seed data is provided. The current Oracle schema models a single active season; historical season synchronization to Oracle is therefore restricted. Historical provider snapshots can be stored separately in MongoDB using provider-cache mode.

## CSV supplements

The Database Lab accepts CSV files with these headers:

```csv
matchday,date,homeTeam,awayTeam,homeGoals,awayGoals,status
```

CSV data is validated and deduplicated. In provider-cache mode, first synchronize a real provider season; imported fixtures must fall within that season and are stored separately from provider results. Oracle mode uses bound parameters and the PL/SQL validation/standings procedures. CSV imports are not a bundled data source and are not treated as provider-verified statistics.

## GraphQL example

```graphql
query League {
  standings {
    position team { name } played won drawn lost goalsFor goalsAgainst
    goalDifference points form
  }
  matches(status: "FINISHED", matchday: 1) {
    date homeTeam { name } awayTeam { name } homeGoals awayGoals status
  }
}
```

Use `dataHealth` to inspect the active data source, last successful sync, provider errors, MongoDB state, and persisted collection counts.

## Test, lint, build, and benchmark

```sh
npm test
npm run lint
npm run build
npm run benchmark -- --iterations 50
```

Tests use inline synthetic records only as isolated test fixtures; no test fixture is seeded or displayed by the application. Coverage includes standings, simulations, CSV validation, duplicate handling, provider mapping, GraphQL resolver behavior, and frontend interactions. Database integration and PL/SQL execution require the corresponding service to be available; do not interpret unit tests as proof that Oracle is running.

The benchmark command calls the live GraphQL `benchmark` query and reports actual measurements for connected database services. Missing services are listed as unavailable; no timing is fabricated. Set `PITCHIQ_GRAPHQL_URL` to benchmark another API endpoint.

## Troubleshooting

- **No league data:** Check `http://localhost:4000/health`, ensure the root `.env` contains a valid backend `FOOTBALL_DATA_API_TOKEN`, restart the API, and try Sync data. If a real MongoDB snapshot exists, it is used and labelled as cached.
- **Provider 401/403/429 or timeout:** Check the token, plan, competition, selected season, and request allowance. Rate limits are respected; inaccessible data is not generated.
- **MongoDB unavailable:** Start MongoDB locally or with `docker compose up -d mongodb`. Live results can appear for the session, but snapshots cannot survive restart until MongoDB is restored.
- **Oracle connection error:** Verify the service address, PDB, credentials, grants, and that `database/migrations/001_initial_schema.sql` ran successfully.
- **No top scorers:** Scorer access may be restricted or unavailable for the selected season. The UI reports this instead of inventing player totals.

## License

Project code is provided for development and educational use. Provider data remains subject to football-data.org terms and any source-data license.
