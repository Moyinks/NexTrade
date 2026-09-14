# NexTrade

**Ledger-first investment PWA · public engineering portfolio build**

NexTrade is both a product concept and an engineering case study: a mobile-first investment platform built around Spot balances, strategy pools, portfolio positions, market execution, KYC, deposits, withdrawals, and a tamper-resistant transaction ledger.

The repository is intentionally designed so that the **business model remains visible** while the checked-in public build fails closed around real-money infrastructure. It demonstrates the intended product architecture without pretending that operational counterparties, custody, compliance approvals, or historical performance already exist.

## Product model

NexTrade presents two managed strategy concepts:

- **Steady Accumulator** — a 90-day lower-volatility strategy cycle with a 22% gross target and 15% performance fee on positive profit.
- **Surge Pool** — a 30-day higher-risk quantitative strategy cycle with a 67% gross target and 20% performance fee on positive profit.

Those figures are product-model targets, not guarantees. The implementation keeps the strategy mechanics, fee model, early-exit logic, and customer experience intact while separating product intent from claims that would require real operating evidence.

## Architecture

### Browser

Vanilla JavaScript PWA with:

- mobile-first UI and route modules
- Supabase Auth
- realtime/state synchronization
- service-worker offline shell caching
- CoinGecko/Binance market data
- KYC document capture and private Storage upload
- transaction/activity history
- Spot, Vault-cash, and active-position views
- persistent idempotency identities for retryable money actions

### Database

Postgres/Supabase is the financial authority:

- `transactions` is the authoritative Spot/Vault-cash ledger
- `profiles.spot_balance` and `profiles.vault_balance` are server-maintained read caches
- financial tables are browser read-only
- money mutations cross `SECURITY DEFINER` RPCs or service-only server functions
- per-user profile row locks serialize financial mutations
- idempotency keys make ambiguous network retries safe
- investment strategy terms are snapshotted into each position
- KYC status and withdrawal authorization are enforced at the transaction boundary

### Serverless authority

`/api/execute-trade` authenticates the caller, resolves the asset mapping and fresh market price server-side, then calls a **service-role-only** trade RPC. The browser never chooses the execution price.

`/api/generate-address` is an optional HD-address allocator. It is disabled by default and requires explicit server and database enablement plus private environment configuration.

## Financial state model

### Spot

Spot is derived from ledger entries only. Credits include approved/completed deposits, claims, Vault→Spot transfers, sells, and explicit migration/opening entries. Debits include investments, Spot→Vault transfers, buys, and pending/approved/completed withdrawals.

A cached profile balance is never accepted as spendable authority inside a financial RPC.

### Vault

Vault is intentionally separated into:

1. **Vault cash** — cash moved from Spot into Vault but not invested.
2. **Active strategy positions** — value derived from immutable position terms and lifecycle progress.

Displayed Vault value may include both, but only uninvested Vault cash can transfer directly back to Spot.

### Investment claims

The claim formula is shared conceptually between UI previews and Postgres authority:

1. calculate lifecycle progress
2. calculate gross strategy profit from the snapshotted cycle target
3. deduct the performance fee from positive profit
4. apply any remaining-time early-exit penalty
5. credit the resulting claim through the ledger

Presentation-only pool animations never alter a monetary value.

## Security boundaries

Key protections include:

- RLS on user-owned tables
- explicit column-level profile reads; withdrawal-auth hashes/counters never reach the browser
- no authenticated browser writes to protected financial/KYC tables
- service-role-only trade price authority
- server/database KYC checks
- private KYC Storage bucket with UID-scoped uploads
- KYC RPC verifies referenced Storage objects actually exist
- recent withdrawal-passphrase verification is consumed atomically by the withdrawal request
- repeated passphrase failures trigger temporary lockout
- transaction identity/amount fields are immutable
- financial mutation retries are idempotent
- stale legacy RPC signatures are explicitly removed during upgrade
- CSP, frame blocking, HSTS, MIME-sniff protection, referrer policy, and permissions policy
- non-GET and `/api/*` service-worker requests are network-only

The five-word withdrawal phrase is **defense-in-depth, not MFA**. Production operation should add independent second-factor/device authorization rather than relabeling a same-session secret as MFA.

See [`SECURITY.md`](SECURITY.md) for the trust model and known operational requirements.

## Database setup

### Fresh database

Run:

```text
SCHEMA.sql
```

The canonical schema creates the required tables, constraints, indexes, functions, triggers, RLS policies, Storage policy, and grants.

### Existing older NexTrade database

Do **not** run the fresh schema blindly over legacy accounting history.

1. Put the application into maintenance/read-only mode.
2. Back up the database.
3. Run `MIGRATION_V2_1_CUTOVER.sql`.
4. Resolve any migration exception manually rather than weakening the checks.
5. Run `SCHEMA.sql` immediately afterwards.
6. Run end-to-end reconciliation before reopening writes.

The cutover preserves the legacy stored Spot value with explicit `migration_credit`/`migration_debit` ledger entries and reconstructs Vault cash from transfer history. Impossible or ambiguous history aborts instead of being silently clamped or rewritten.

## Environment

Copy `.env.example` into the deployment environment and fill values privately. Never commit service-role keys or wallet material.

The public repository ships with:

- `APP_CONFIG.environment = 'portfolio'`
- `realDeposit = false`
- `hdWallet = false`
- deliberately invalid static receiving-address placeholders
- database real-deposit/real-withdrawal flags defaulting to `false`

Real-money operation therefore requires multiple deliberate server/database changes rather than a single accidental frontend toggle.

## Runtime

Server functions target **Node.js 24.x**.

Direct dependencies are exact-pinned in `package.json`:

- `@supabase/supabase-js` 2.116.0
- `ethers` 5.8.0 (legacy-v5 API, intentionally retained because the address generator uses v5 syntax)

A lockfile is not fabricated in this archive because the build environment used for this review had no npm-registry access. On the first connected development environment, run `npm install`, review the dependency tree/audit output, and commit the generated `package-lock.json`.

## Release audit

Run:

```bash
npm run audit
```

The repository-owned audit checks:

- JavaScript syntax
- required JSON parsing
- duplicate DOM IDs
- local HTML asset references
- service-worker precache references
- runtime RPC names against `SCHEMA.sql`
- private sibling branding leakage
- obvious direct browser mutations of protected tables
- public fail-closed configuration
- obvious committed privileged secret patterns

It is intentionally a static release check, not a replacement for integration, penetration, concurrency, or database migration testing.

## Deployment checklist

Before treating NexTrade as an operational financial service rather than a portfolio/product implementation:

- deploy to a dedicated non-production Supabase project first
- run the schema/migration against realistic seeded history
- test signup → KYC → deposit approval → transfers → investment → early/mature claim → trade → withdrawal
- test duplicate/retried requests and parallel-tab races
- generate and commit a dependency lockfile
- add production monitoring, alerting, rate limiting, abuse controls, and reconciliation jobs
- perform independent security review/penetration testing
- define custody/key-management architecture and disaster recovery
- complete applicable legal, licensing, KYC/AML, privacy, and consumer-risk work for the jurisdictions served

## Reviewer note

The public implementation intentionally exposes the **engineering and business design**, while real operational credentials and private infrastructure are excluded. The code should be judged on its architecture, invariants, trust boundaries, and failure behavior—not on invented claims of live assets under management or historical investment performance.
