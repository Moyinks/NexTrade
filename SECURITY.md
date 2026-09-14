# NexTrade Security Model

## Trust boundaries

NexTrade assumes the browser is untrusted.

A user may modify JavaScript, replay requests, call Supabase RPCs directly, open multiple tabs, resend timed-out actions, manipulate DOM state, or submit arbitrary request bodies. Security therefore cannot depend on disabled buttons, modal order, hidden inputs, cached balances, or client-computed prices.

## Authorities

### Browser may

- authenticate through Supabase
- read explicitly permitted user/profile/ledger/position data under RLS
- request financial actions through approved RPC/API boundaries
- upload KYC JPEGs into its own UID-scoped private Storage prefix

### Browser may not

- write transaction, investment, protected profile, or KYC database rows directly
- choose an authoritative trade execution price
- read withdrawal-passphrase hashes, lock counters, or verification timestamps
- read/list KYC evidence from Storage
- invoke service-role-only RPCs

### Server/service role may

- resolve market price and call `execute_trade`
- allocate HD deposit addresses when explicitly enabled
- perform administrative KYC/transaction lifecycle operations

Service-role credentials and wallet configuration must exist only in protected deployment environment variables.

## Financial invariants

- money amounts must be finite, positive, and within bounded ranges
- each retryable mutation uses a scoped UUID idempotency key
- reusing a key for a different request is rejected
- user financial mutations serialize on the profile row
- transaction user/type/amount/idempotency identity is immutable after creation
- Spot is ledger-derived
- Vault cash is ledger-derived from transfers
- active investment value is position-derived, not fabricated by UI simulation
- pending withdrawals reserve Spot immediately
- a failed/rejected withdrawal releases its reservation through ledger status semantics
- claims cannot execute twice
- early claims require explicit penalty confirmation

## KYC

- KYC evidence is uploaded to a private `kyc-docs` bucket
- paths must be owned by the authenticated UID and match constrained filenames
- submitted Storage objects must exist
- applicant age, country, document type, and country/document combinations are validated server-side
- one pending submission per user is enforced
- only server/admin review can transition the authoritative KYC state

## Withdrawal confirmation

The five-word phrase is an additional confirmation secret, not independent MFA.

- stored using bcrypt via Postgres `crypt()`
- plaintext is never stored
- browser cannot read the hash
- five failed verifications trigger a temporary lockout
- successful verification is short-lived
- authorization is consumed atomically when a withdrawal request is created
- approved KYC is required at the database boundary

Production should add an independent factor/device authorization path for stronger account security.

## PWA/cache safety

The service worker never caches:

- non-GET/HEAD requests
- same-origin `/api/*` requests
- Supabase traffic
- arbitrary third-party/API data

Only app assets and an explicit CDN allowlist can enter Cache Storage.

## Public portfolio safety

Real deposits and withdrawals default to disabled in the database. Real deposit-address generation also requires a server environment flag and private wallet configuration. The checked-in browser configuration cannot enable this by itself.

## Known production requirements

This repository deliberately does not claim that static review equals production certification. An operational financial service still needs, at minimum:

- external security assessment and penetration testing
- dependency/SBOM and supply-chain controls
- API/WAF rate limiting and abuse prevention
- monitoring and incident response
- backup/restore and reconciliation procedures
- privileged admin authorization and audit logging
- custody/key-management review
- secrets rotation
- tested migration/rollback procedures
- jurisdiction-specific legal/compliance controls

## Reporting

For a public portfolio repository, report security findings privately to the repository owner rather than publishing exploitable details before a fix is available.
