# NexTrade v2.1 — Engineering Review Notes

## Review objective

Bring the public NexTrade implementation to behavioral/UI parity with the more advanced internal product architecture while preserving NexTrade's independent public identity and hardening the public codebase for senior-engineer review.

The work was treated as a cross-layer release audit rather than a visual reskin.

## Important corrections made

### Accounting

- made the transaction ledger the sole Spot authority
- retained profile Spot/Vault numbers only as server-maintained caches
- included `buy` and `sell` correctly in authoritative Spot derivation
- separated Vault cash from active strategy value
- aligned claim/early-exit/performance-fee formulas across UI and SQL
- removed presentation simulation from monetary position values
- made ambiguous legacy accounting fail migration instead of being guessed

### Concurrency and retries

- serialized mutations per user with profile row locks
- added scoped idempotency keys to deposit, withdrawal, transfer, investment, claim, and trade
- made the client reuse pending action identities after ambiguous timeouts
- reject idempotency-key reuse with changed request parameters

### Trading

- removed browser-authoritative execution prices
- added server-side allowlisted asset mapping and fresh-price resolution
- made the database trade RPC service-role-only
- preserved user identity from the verified access token rather than request body

### Withdrawal authorization

- moved KYC/passphrase gates into the database transaction boundary
- added short-lived verification consumption
- added failed-attempt lockout
- removed passphrase hashes/counters/timestamps from browser-readable profile columns
- documented the phrase accurately as defense-in-depth rather than MFA

### KYC

- private UID-scoped Storage policy
- server-side country/document/age/path validation
- referenced Storage objects must exist
- browser cannot read/list KYC evidence
- duplicate pending submissions rejected
- KYC database invariants apply to trusted writes as well as the normal UI path

### Legacy upgrade safety

- old PostgreSQL function overloads are explicitly dropped
- legacy RLS policies are removed before canonical policies are installed
- obsolete client-priced trade RPC is removed
- obsolete two-argument money RPCs are removed
- legacy all-user reconciliation helper is removed
- exact legacy Spot state is represented through explicit migration adjustment ledger rows
- Vault cash is reconstructed from transfer history
- impossible holdings, KYC, investment, idempotency, address, or ledger history aborts cutover

### Browser/PWA

- non-GET and local API requests are network-only in the service worker
- arbitrary third-party resources are not cached
- external/user strings were hardened at identified HTML interpolation surfaces
- generic Card strings no longer become trusted HTML by default
- stale hard-coded wallet-address presentation removed
- private internal product naming removed from the public tree

## Static validation completed

`npm run audit` currently reports zero failures and checks:

- JavaScript parse validity
- JSON parse validity
- duplicate DOM IDs
- missing local assets
- missing service-worker precache targets
- runtime RPC / canonical-schema parity
- private-name leakage
- obvious direct browser writes to protected tables
- fail-closed public configuration
- obvious committed privileged-secret patterns

Additional manual review checked the ledger equations, RPC privilege surface, idempotency semantics, service-worker strategies, trade-price trust boundary, KYC Storage path rules, and legacy migration assumptions against the original NexTrade schema.

## Not claimed as tested

The following require a connected test deployment and are **not** represented as proven by static review:

- authenticated Supabase end-to-end flows
- running `MIGRATION_V2_1_CUTOVER.sql` against a cloned real database
- concurrent multi-session/database stress testing
- live CoinGecko/Binance behavior under outages/rate limits
- Vercel serverless execution with real environment values
- real HD-address generation
- deposit-chain monitoring/custody
- real withdrawal settlement
- production admin/KYC tooling
- penetration testing
- jurisdictional compliance

## Dependency note

The review environment could not access npm's registry, so a real dependency installation and lockfile generation could not be performed here. Direct runtime dependencies are exact-pinned. Generate, inspect, and commit `package-lock.json` in the first connected environment before treating the repository as a production release.

## Recommended acceptance test

Use a dedicated test Supabase project and run, at minimum:

1. create account and recover session
2. submit/reject/resubmit/approve KYC
3. create and approve a deposit
4. Spot→Vault and Vault→Spot transfers
5. create multiple positions in both strategies
6. early claim and matured claim
7. buy/sell every allowlisted asset with server price authority
8. set/verify/fail/lock withdrawal phrase
9. create/reject/approve withdrawal
10. retry every money action with the same idempotency key
11. retry the same key with changed parameters and confirm rejection
12. issue simultaneous actions from two sessions and verify serialization
13. force network timeout after commit and verify retry returns the existing transaction
14. verify balances by independently summing the ledger
15. test service-worker upgrade/offline behavior without caching financial/API responses
