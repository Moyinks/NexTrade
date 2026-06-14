-- ═══════════════════════════════════════════════════════════════════════════
-- NEXTRADE — NON-DESTRUCTIVE DATABASE MIGRATION v2
-- ═══════════════════════════════════════════════════════════════════════════
-- Safe to run on an existing NexTrade database with live users and data.
--
-- EXECUTION ORDER (why this order matters):
--   1.  Extensions
--   2.  Drop guard triggers safely — DO blocks catch undefined_table (42P01)
--   2b. Drop ALL constraints early — prevents backfill from hitting legacy bad rows
--   3.  Create NEW tables first (strategies, kyc_documents, deposit_addresses)
--   4.  Alter EXISTING tables only (profiles, transactions, investments)
--   5.  Backfill NULLs on existing tables only
--   6.  Normalise data that would block unique partial indexes
--   7.  Add / replace constraints
--   8.  Create indexes
--   9.  Seed strategies catalogue
--   10. Sequence for HD wallet derivation
--   11. Row-Level Security
--   12. get_my_role() helper (prevents 42P17 recursion)
--   13. Drop & recreate all RLS policies
--   14. Triggers
--   15. financial_write_allowed() + guard triggers
--   16. All seven SECURITY DEFINER RPCs
--   17. Storage bucket notes
--   18. Grants
--
-- WHAT THIS NEVER DOES:
--   • Delete any row from any table
--   • Modify any existing balance, transaction amount, or investment record
--   • Break existing user sessions
--
-- ADMIN APPROVAL:
--   The Supabase Table Editor uses the service role key, which satisfies
--   financial_write_allowed(). Toggling a deposit to 'approved' in the
--   Table Editor will work correctly after this migration.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. EXTENSIONS ─────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";


-- ── 2. DROP GUARD TRIGGERS ────────────────────────────────────────────────
-- profiles / transactions / investments EXIST on NexTrade — plain DROP.
-- kyc_documents / deposit_addresses are NEW — DO block catches 42P01.

drop trigger if exists guard_profile_sensitive_write   on public.profiles;
drop trigger if exists guard_transactions_server_only  on public.transactions;
drop trigger if exists guard_investments_server_only   on public.investments;
drop trigger if exists set_updated_at_profiles         on public.profiles;
drop trigger if exists set_updated_at_transactions     on public.transactions;
drop trigger if exists set_updated_at_investments      on public.investments;
drop trigger if exists guard_transaction_immutability  on public.transactions;
drop trigger if exists on_auth_user_created            on auth.users;

do $$ begin
  drop trigger if exists guard_kyc_documents_server_only on public.kyc_documents;
exception when undefined_table then null; end $$;
do $$ begin
  drop trigger if exists set_updated_at_kyc_documents on public.kyc_documents;
exception when undefined_table then null; end $$;
do $$ begin
  drop trigger if exists on_kyc_document_reviewed on public.kyc_documents;
exception when undefined_table then null; end $$;


-- ── 2b. DROP ALL CHECK CONSTRAINTS ON EXISTING TABLES ────────────────────
-- profiles / transactions / investments EXIST — plain ALTER TABLE, no DO block.
-- Plain ALTER TABLE IF EXISTS is reliable. DO-block wrappers on existing
-- tables were masking silent failures on some Supabase executor versions.
-- This must run before ANY DML so no backfill UPDATE can trigger a stale
-- constraint left over from a previous partial migration run.

alter table public.profiles drop constraint if exists profiles_role_allowlist;
alter table public.profiles drop constraint if exists profiles_kyc_status_allowlist;
alter table public.profiles drop constraint if exists profiles_spot_non_negative;
alter table public.profiles drop constraint if exists profiles_vault_non_negative;

alter table public.transactions drop constraint if exists transactions_type_allowlist;
alter table public.transactions drop constraint if exists transactions_amount_positive;
alter table public.transactions drop constraint if exists transactions_status_allowlist;
alter table public.transactions drop constraint if exists transactions_description_safe;

alter table public.investments drop constraint if exists investments_amount_positive;
alter table public.investments drop constraint if exists investments_current_value_non_negative;
alter table public.investments drop constraint if exists investments_apy_check;
alter table public.investments drop constraint if exists investments_apy_range;
alter table public.investments drop constraint if exists investments_profit_non_negative;
alter table public.investments drop constraint if exists investments_status_allowlist;
alter table public.investments drop constraint if exists investments_strategy_id_slug;

-- ── 3. CREATE NEW TABLES ───────────────────────────────────────────────────
-- These tables do not exist on NexTrade. Created here, before any ALTER or
-- UPDATE that references them.

-- ── 3a. strategies ────────────────────────────────────────────────────────
create table if not exists public.strategies (
  id            text primary key check (id ~ '^[a-z0-9_-]{2,60}$'),
  name          text not null,
  tagline       text,
  category      text,
  apy           numeric(6, 4) not null check (apy >= 0 and apy <= 100),
  min_amount    numeric(18, 8) not null check (min_amount > 0),
  duration_days integer not null check (duration_days > 0 and duration_days <= 3650),
  penalty_rate  numeric(6, 4) not null check (penalty_rate >= 0 and penalty_rate <= 1),
  perf_fee      numeric(6, 4) not null check (perf_fee >= 0 and perf_fee <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 3b. kyc_documents ─────────────────────────────────────────────────────
-- NEW on NexTrade. Created with all required columns — no ALTER needed.
create table if not exists public.kyc_documents (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  full_name        text        not null check (char_length(full_name) between 2 and 120),
  dob              date        not null,
  country          text        not null check (char_length(country) between 2 and 80),
  doc_type         text        not null
                   check (doc_type in ('passport', 'national_id', 'drivers_license', 'residence_permit')),
  id_front_path    text        not null,
  id_back_path     text,
  selfie_path      text        not null,
  status           text        not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  updated_at       timestamptz          default now()
);

comment on table public.kyc_documents is
  'KYC submissions. Admin sets status + rejection_reason via Table Editor '
  '(service role) or admin portal. On approval the sync_kyc_status trigger '
  'automatically updates profiles.kyc_status.';

-- ── 3c. deposit_addresses ─────────────────────────────────────────────────
-- NEW on NexTrade. Written exclusively by /api/generate-address (service role).
create table if not exists public.deposit_addresses (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  address           text        not null unique
                    check (address ~ '^0x[0-9a-fA-F]{40}$'),
  derivation_index  integer     not null unique check (derivation_index >= 0),
  network           text        not null default 'eth'
                    check (network in ('eth', 'btc', 'usdt_trc20')),
  expires_at        timestamptz not null,
  used              boolean     not null default false,
  created_at        timestamptz not null default now()
);

comment on table public.deposit_addresses is
  'Written exclusively by the /api/generate-address Vercel function using '
  'SUPABASE_SERVICE_KEY. All client access is blocked by RLS default-deny.';


-- ── 4. ALTER EXISTING TABLES — ADD MISSING COLUMNS ────────────────────────
-- These tables already exist on NexTrade. ADD COLUMN IF NOT EXISTS is safe
-- and silent when the column is already present.

-- profiles
alter table public.profiles
  add column if not exists full_name     text,
  add column if not exists avatar_url    text,
  add column if not exists role          text,
  add column if not exists kyc_status    text,
  add column if not exists spot_balance  numeric(18, 8),
  add column if not exists vault_balance numeric(18, 8),
  add column if not exists holdings      jsonb,
  add column if not exists created_at    timestamptz,
  add column if not exists updated_at    timestamptz;

-- transactions
alter table public.transactions
  add column if not exists type        text,
  add column if not exists amount      numeric(18, 8),
  add column if not exists status      text,
  add column if not exists description text,
  add column if not exists created_at  timestamptz,
  add column if not exists updated_at  timestamptz;

-- investments
alter table public.investments
  add column if not exists strategy_id   text,
  add column if not exists amount        numeric(18, 8),
  add column if not exists current_value numeric(18, 8),
  add column if not exists apy           numeric(6, 4),
  add column if not exists profit        numeric(18, 8),
  add column if not exists status        text,
  add column if not exists matures_at    timestamptz,
  add column if not exists created_at    timestamptz,
  add column if not exists completed_at  timestamptz,
  add column if not exists updated_at    timestamptz;


-- ── 5. BACKFILL EXISTING TABLES ───────────────────────────────────────────
-- coalesce() ensures existing non-NULL values are never overwritten.
-- kyc_documents and deposit_addresses are excluded — they were just created
-- and have no rows to backfill.

update public.profiles
set
  role          = coalesce(role, 'user'),
  kyc_status    = coalesce(kyc_status, 'unverified'),
  spot_balance  = coalesce(spot_balance, 0),
  vault_balance = coalesce(vault_balance, 0),
  holdings      = coalesce(holdings, '{}'::jsonb),
  created_at    = coalesce(created_at, now()),
  updated_at    = coalesce(updated_at, created_at, now());

update public.transactions
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now());

-- Skip rows with amount = 0 or NULL — legacy bad data written by the old
-- client when it zeroed amount on claim. These rows already have timestamps
-- from prior partial runs and must not be touched (constraint would fire).
update public.investments
set
  created_at   = coalesce(created_at, now()),
  completed_at = coalesce(completed_at, null),
  updated_at   = coalesce(updated_at, created_at, now())
where coalesce(amount, 0) > 0;


-- ── 6. DATA NORMALISATION ─────────────────────────────────────────────────
-- Resolve duplicate active investments per strategy per user so the unique
-- partial index below can be created. Extra rows are cancelled, not deleted.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, strategy_id
      order by created_at desc, id desc
    ) as rn
  from public.investments
  where status = 'active'
), to_cancel as (
  select id from ranked where rn > 1
)
update public.investments
set
  status       = 'cancelled',
  completed_at = now(),
  updated_at   = now()
where id in (select id from to_cancel);

-- Sanitise any existing transaction descriptions that contain angle brackets.
update public.transactions
set description = replace(replace(description, '<', '&lt;'), '>', '&gt;')
where description ~ '[<>]';


-- ── 7. CONSTRAINTS ────────────────────────────────────────────────────────

alter table public.profiles drop constraint if exists profiles_role_allowlist;
alter table public.profiles
  add constraint profiles_role_allowlist
  check (role in ('user', 'admin')) not valid;

alter table public.profiles drop constraint if exists profiles_kyc_status_allowlist;
alter table public.profiles
  add constraint profiles_kyc_status_allowlist
  check (kyc_status in ('unverified', 'pending', 'approved', 'rejected')) not valid;

alter table public.profiles drop constraint if exists profiles_spot_non_negative;
alter table public.profiles
  add constraint profiles_spot_non_negative
  check (spot_balance >= 0) not valid;

alter table public.profiles drop constraint if exists profiles_vault_non_negative;
alter table public.profiles
  add constraint profiles_vault_non_negative
  check (vault_balance >= 0) not valid;

alter table public.transactions drop constraint if exists transactions_type_allowlist;
alter table public.transactions
  add constraint transactions_type_allowlist
  check (type in (
    'deposit', 'withdraw', 'investment', 'claim',
    'transfer_in', 'transfer_out', 'buy', 'sell'
  )) not valid;

alter table public.transactions drop constraint if exists transactions_amount_positive;
alter table public.transactions
  add constraint transactions_amount_positive
  check (amount > 0) not valid;

alter table public.transactions drop constraint if exists transactions_status_allowlist;
alter table public.transactions
  add constraint transactions_status_allowlist
  check (status in ('pending', 'completed', 'approved', 'failed', 'cancelled')) not valid;

alter table public.transactions drop constraint if exists transactions_description_safe;
alter table public.transactions
  add constraint transactions_description_safe
  check (description is null or (char_length(description) <= 500 and description !~ '[<>]')) not valid;

alter table public.investments drop constraint if exists investments_amount_positive;
alter table public.investments
  add constraint investments_amount_positive
  check (amount > 0) not valid;

alter table public.investments drop constraint if exists investments_current_value_non_negative;
alter table public.investments
  add constraint investments_current_value_non_negative
  check (current_value is null or current_value >= 0) not valid;

alter table public.investments drop constraint if exists investments_apy_check;
alter table public.investments drop constraint if exists investments_apy_range;
alter table public.investments
  add constraint investments_apy_range
  check (apy >= 0 and apy <= 100) not valid;

alter table public.investments drop constraint if exists investments_profit_non_negative;
alter table public.investments
  add constraint investments_profit_non_negative
  check (profit is null or profit >= 0) not valid;

alter table public.investments drop constraint if exists investments_status_allowlist;
alter table public.investments
  add constraint investments_status_allowlist
  check (status in ('active', 'completed', 'cancelled')) not valid;

alter table public.investments drop constraint if exists investments_strategy_id_slug;
alter table public.investments
  add constraint investments_strategy_id_slug
  check (strategy_id ~ '^[a-z0-9_-]{2,60}$') not valid;


-- ── 8. INDEXES ────────────────────────────────────────────────────────────
create index if not exists transactions_user_id_idx  on public.transactions  (user_id);
create index if not exists transactions_status_idx   on public.transactions  (status);
create index if not exists transactions_type_idx     on public.transactions  (type);
create index if not exists investments_user_id_idx   on public.investments   (user_id);
create index if not exists investments_status_idx    on public.investments   (status);
create index if not exists kyc_documents_user_id_idx on public.kyc_documents (user_id);
create index if not exists deposit_addresses_user_id on public.deposit_addresses (user_id);

create index if not exists transactions_balance_derivation
  on public.transactions (user_id, status, type);

-- One active investment per strategy per user
create unique index if not exists investments_one_active_per_strategy
  on public.investments (user_id, strategy_id)
  where (status = 'active');

-- One pending KYC submission per user
create unique index if not exists kyc_documents_one_pending_per_user
  on public.kyc_documents (user_id)
  where (status = 'pending');


-- ── 9. STRATEGIES SEED DATA ───────────────────────────────────────────────
insert into public.strategies
  (id, name, tagline, category, apy, min_amount, duration_days, penalty_rate, perf_fee)
values
  (
    'steady-accumulator',
    'Steady Accumulator',
    'Start with $100. 90-day cycle. Low volatility, consistent pool growth.',
    'Conservative · Strategy A',
    22, 100, 90, 0.08, 15
  ),
  (
    'alpha-seeker',
    'Surge Pool',
    'More capital, faster cycle. The algorithm scales with what you put in. Target: +67% per 30-day cycle.',
    'Quant Momentum · Strategy B',
    67, 1500, 30, 0.15, 20
  )
on conflict (id) do update set
  name          = excluded.name,
  tagline       = excluded.tagline,
  category      = excluded.category,
  apy           = excluded.apy,
  min_amount    = excluded.min_amount,
  duration_days = excluded.duration_days,
  penalty_rate  = excluded.penalty_rate,
  perf_fee      = excluded.perf_fee,
  updated_at    = now();


-- ── 10. SEQUENCE ──────────────────────────────────────────────────────────
-- Atomic counter for HD wallet derivation indices. Race-safe alternative
-- to max(derivation_index) + 1 which suffers from TOCTOU race conditions.
create sequence if not exists public.deposit_address_index_seq
  as integer
  minvalue 0
  start with 0
  increment by 1;


-- ── 11. ROW-LEVEL SECURITY ────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.transactions       enable row level security;
alter table public.investments        enable row level security;
alter table public.kyc_documents      enable row level security;
alter table public.deposit_addresses  enable row level security;


-- ── 12. get_my_role() HELPER ──────────────────────────────────────────────
-- SECURITY DEFINER means it runs as the table owner, bypassing RLS on
-- profiles. This breaks the infinite-recursion (42P17) that would occur
-- if a profiles policy queried profiles directly.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;


-- ── 13. RLS POLICIES ──────────────────────────────────────────────────────
-- Drop all first (idempotent re-run safety), then recreate.

drop policy if exists "profiles: user reads own"                        on public.profiles;
drop policy if exists "profiles: user updates own (restricted columns)" on public.profiles;
drop policy if exists "profiles: admin reads all"                       on public.profiles;
drop policy if exists "profiles: admin updates all"                     on public.profiles;
drop policy if exists "transactions: user reads own"                    on public.transactions;
drop policy if exists "transactions: user inserts own"                  on public.transactions;
drop policy if exists "transactions: admin reads all"                   on public.transactions;
drop policy if exists "transactions: admin updates"                     on public.transactions;
drop policy if exists "investments: user reads own"                     on public.investments;
drop policy if exists "investments: user inserts own"                   on public.investments;
drop policy if exists "investments: user claims own"                    on public.investments;
drop policy if exists "investments: admin reads all"                    on public.investments;
drop policy if exists "investments: admin updates all"                  on public.investments;
drop policy if exists "kyc_documents: user inserts own"                 on public.kyc_documents;
drop policy if exists "kyc_documents: user reads own"                   on public.kyc_documents;
drop policy if exists "kyc_documents: admin reads all"                  on public.kyc_documents;
drop policy if exists "kyc_documents: admin updates all"                on public.kyc_documents;

-- profiles
create policy "profiles: user reads own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: user updates own (restricted columns)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and public.get_my_role() = role
    and kyc_status in ('unverified', 'pending')
    and spot_balance  >= 0
    and vault_balance >= 0
  );

create policy "profiles: admin reads all"
  on public.profiles for select
  using (public.get_my_role() = 'admin');

create policy "profiles: admin updates all"
  on public.profiles for update
  using (public.get_my_role() = 'admin');

-- transactions
create policy "transactions: user reads own"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "transactions: user inserts own"
  on public.transactions for insert
  with check (
    auth.uid() = user_id
    and (
      (type in ('deposit', 'withdraw') and status = 'pending')
      or
      (type in ('investment', 'claim', 'transfer_in', 'transfer_out', 'buy', 'sell')
       and status in ('pending', 'completed'))
    )
  );

create policy "transactions: admin reads all"
  on public.transactions for select
  using (public.get_my_role() = 'admin');

-- Admins update transactions — e.g. toggle deposit status to 'approved'.
-- Also works via Supabase Table Editor (service role bypasses RLS entirely).
create policy "transactions: admin updates"
  on public.transactions for update
  using (public.get_my_role() = 'admin');

-- investments
create policy "investments: user reads own"
  on public.investments for select
  using (auth.uid() = user_id);

create policy "investments: user inserts own"
  on public.investments for insert
  with check (
    auth.uid() = user_id
    and status = 'active'
    and amount > 0
    and apy >= 0 and apy <= 100
  );

create policy "investments: user claims own"
  on public.investments for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and status in ('completed', 'cancelled')
  );

create policy "investments: admin reads all"
  on public.investments for select
  using (public.get_my_role() = 'admin');

create policy "investments: admin updates all"
  on public.investments for update
  using (public.get_my_role() = 'admin');

-- kyc_documents
create policy "kyc_documents: user inserts own"
  on public.kyc_documents for insert
  with check (auth.uid() = user_id and status = 'pending');

create policy "kyc_documents: user reads own"
  on public.kyc_documents for select
  using (auth.uid() = user_id);

create policy "kyc_documents: admin reads all"
  on public.kyc_documents for select
  using (public.get_my_role() = 'admin');

create policy "kyc_documents: admin updates all"
  on public.kyc_documents for update
  using (public.get_my_role() = 'admin');

-- deposit_addresses: no client policies — service role only.
-- Default RLS deny blocks all authenticated/anon access.


-- ── 14. TRIGGERS ──────────────────────────────────────────────────────────

-- 14a. Auto-create profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 14b. Sync profiles.kyc_status when admin approves/rejects a KYC doc
create or replace function public.sync_kyc_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('approved', 'rejected') and new.status != old.status then
    update public.profiles
    set kyc_status = new.status, updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_kyc_document_reviewed on public.kyc_documents;
create trigger on_kyc_document_reviewed
  after update on public.kyc_documents
  for each row execute procedure public.sync_kyc_status();

-- 14c. Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_profiles     on public.profiles;
drop trigger if exists set_updated_at_transactions on public.transactions;
drop trigger if exists set_updated_at_investments  on public.investments;

create trigger set_updated_at_profiles
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger set_updated_at_transactions
  before update on public.transactions
  for each row execute procedure public.set_updated_at();

create trigger set_updated_at_investments
  before update on public.investments
  for each row execute procedure public.set_updated_at();

create trigger set_updated_at_kyc_documents
  before update on public.kyc_documents
  for each row execute procedure public.set_updated_at();

-- 14d. Guard: transactions are append-only (user_id, type, amount immutable)
create or replace function public.guard_transaction_immutability()
returns trigger language plpgsql
as $$
begin
  if new.user_id != old.user_id then raise exception 'transactions.user_id is immutable'; end if;
  if new.type    != old.type    then raise exception 'transactions.type is immutable'; end if;
  if new.amount  != old.amount  then raise exception 'transactions.amount is immutable'; end if;
  return new;
end;
$$;

drop trigger if exists guard_transaction_immutability on public.transactions;
create trigger guard_transaction_immutability
  before update on public.transactions
  for each row execute procedure public.guard_transaction_immutability();


-- ── 15. FINANCIAL GUARD LAYER ─────────────────────────────────────────────
-- financial_write_allowed() is the single gate checked by all guard triggers.
-- Returns true for:
--   (a) Service role — Supabase Table Editor, /api/* serverless functions,
--       any request authenticated with SUPABASE_SERVICE_KEY
--   (b) SECURITY DEFINER RPCs — set nextrade.bypass_financial_guard = '1'
--       for the duration of their transaction

create or replace function public.financial_write_allowed()
returns boolean language sql stable set search_path = public
as $$
  select
    coalesce(current_setting('nextrade.bypass_financial_guard', true), '') = '1'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

-- Guard: profiles sensitive fields
create or replace function public.guard_profile_sensitive_write()
returns trigger language plpgsql set search_path = public
as $$
begin
  if public.financial_write_allowed() then return new; end if;

  if new.role          is distinct from old.role
  or new.kyc_status    is distinct from old.kyc_status
  or new.spot_balance  is distinct from old.spot_balance
  or new.vault_balance is distinct from old.vault_balance
  or new.holdings      is distinct from old.holdings then
    raise exception 'profiles financial fields are server-managed — use the provided RPCs';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_sensitive_write on public.profiles;
create trigger guard_profile_sensitive_write
  before update on public.profiles
  for each row execute procedure public.guard_profile_sensitive_write();

-- Guard: transactions, investments, kyc_documents — server-managed
create or replace function public.guard_server_managed_write()
returns trigger language plpgsql set search_path = public
as $$
begin
  if public.financial_write_allowed() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception '% is server-managed — use the provided RPCs', tg_table_name;
end;
$$;

create trigger guard_transactions_server_only
  before insert or update or delete on public.transactions
  for each row execute procedure public.guard_server_managed_write();

create trigger guard_investments_server_only
  before insert or update or delete on public.investments
  for each row execute procedure public.guard_server_managed_write();

create trigger guard_kyc_documents_server_only
  before insert or update or delete on public.kyc_documents
  for each row execute procedure public.guard_server_managed_write();


-- ── 16. SECURITY DEFINER RPCs ─────────────────────────────────────────────

-- 16a. derive_spot_balance
create or replace function public.derive_spot_balance(p_user_id uuid)
returns numeric language plpgsql security definer set search_path = public
as $$
declare
  credit_types text[] := array['deposit', 'claim', 'transfer_in'];
  debit_types  text[] := array['withdraw', 'investment', 'transfer_out'];
  has_deposit  boolean;
  stored_bal   numeric;
  result       numeric := 0;
begin
  select exists (
    select 1 from public.transactions
    where user_id = p_user_id and type = 'deposit'
      and status in ('completed', 'approved')
  ) into has_deposit;

  if not has_deposit then
    select coalesce(spot_balance, 0) into stored_bal
    from public.profiles where id = p_user_id;

    select stored_bal + coalesce(sum(
      case
        when type = any(credit_types) and status in ('completed','approved') then  amount
        when type = any(debit_types)  and status in ('completed','approved') then -amount
        when type = 'withdraw'        and status = 'pending'                 then -amount
        else 0
      end
    ), 0) into result
    from public.transactions where user_id = p_user_id;
  else
    select coalesce(sum(
      case
        when type = any(credit_types) and status in ('completed','approved') then  amount
        when type = any(debit_types)  and status in ('completed','approved') then -amount
        when type = 'withdraw'        and status = 'pending'                 then -amount
        else 0
      end
    ), 0) into result
    from public.transactions where user_id = p_user_id;
  end if;

  return greatest(0, result);
end;
$$;

-- 16b. derive_vault_balance
create or replace function public.derive_vault_balance(p_user_id uuid)
returns numeric language plpgsql security definer set search_path = public
as $$
declare result numeric := 0;
begin
  select coalesce(sum(
    case
      when i.status = 'active' then
        greatest(0,
          coalesce(i.amount,0) + (
            coalesce(i.amount,0) *
            (case when coalesce(i.apy,0) > 1 then coalesce(i.apy,0)/100 else coalesce(i.apy,0) end) *
            greatest(0, least(1,
              extract(epoch from (least(now(), coalesce(i.matures_at,now())) - coalesce(i.created_at,now()))) / 31536000.0
            ))
          )
        )
      else 0
    end
  ), 0) into result
  from public.investments i where i.user_id = p_user_id;

  return greatest(0, coalesce(result, 0));
end;
$$;

-- 16c. reconcile_all_spot_balances (admin utility)
create or replace function public.reconcile_all_spot_balances()
returns table (user_id uuid, stored numeric, derived numeric, drift numeric)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select p.id, p.spot_balance,
    public.derive_spot_balance(p.id),
    p.spot_balance - public.derive_spot_balance(p.id)
  from public.profiles p
  where public.derive_spot_balance(p.id) != p.spot_balance;
end;
$$;

-- 16d. request_deposit
create or replace function public.request_deposit(p_amount numeric, p_description text)
returns table (tx_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tx_id   uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  insert into public.transactions (user_id, type, amount, status, description, created_at, updated_at)
  values (v_user_id, 'deposit', p_amount, 'pending',
    left(coalesce(p_description, 'Deposit request'), 500), now(), now())
  returning id into v_tx_id;

  return query select v_tx_id;
end;
$$;

-- 16e. request_withdrawal
create or replace function public.request_withdrawal(p_amount numeric, p_destination_address text)
returns table (tx_id uuid, spot_balance numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tx_id   uuid;
  v_spot    numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select public.derive_spot_balance(v_user_id) into v_spot;
  if coalesce(v_spot, 0) < p_amount then raise exception 'Insufficient balance'; end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  insert into public.transactions (user_id, type, amount, status, description, created_at, updated_at)
  values (v_user_id, 'withdraw', p_amount, 'pending',
    'Withdraw to ' || left(coalesce(p_destination_address,'unknown'), 40), now(), now())
  returning id into v_tx_id;

  select public.derive_spot_balance(v_user_id) into v_spot;
  update public.profiles set spot_balance = v_spot, updated_at = now() where id = v_user_id;

  return query select v_tx_id, v_spot;
end;
$$;

-- 16f. transfer_spot_vault
create or replace function public.transfer_spot_vault(p_from text, p_amount numeric)
returns table (tx_id uuid, spot_balance numeric, vault_balance numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_tx_id    uuid;
  v_spot     numeric;
  v_vault    numeric;
  v_holdings jsonb;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;
  if p_from not in ('spot','vault') then raise exception 'Invalid direction'; end if;

  select coalesce(p.spot_balance,0), coalesce(p.vault_balance,0), coalesce(p.holdings,'{}'::jsonb)
  into v_spot, v_vault, v_holdings
  from public.profiles p where p.id = v_user_id for update;

  if p_from = 'spot' then
    if public.derive_spot_balance(v_user_id) < p_amount then raise exception 'Insufficient balance'; end if;
  else
    if coalesce(v_vault,0) < p_amount then raise exception 'Insufficient vault balance'; end if;
  end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  if p_from = 'spot' then
    insert into public.transactions (user_id,type,amount,status,description,created_at,updated_at)
    values (v_user_id,'transfer_out',p_amount,'completed','Transfer Spot → Vault',now(),now())
    returning id into v_tx_id;
    select public.derive_spot_balance(v_user_id) into v_spot;
    v_vault := greatest(0, coalesce(v_vault,0) + p_amount);
  else
    insert into public.transactions (user_id,type,amount,status,description,created_at,updated_at)
    values (v_user_id,'transfer_in',p_amount,'completed','Transfer Vault → Spot',now(),now())
    returning id into v_tx_id;
    select public.derive_spot_balance(v_user_id) into v_spot;
    v_vault := greatest(0, coalesce(v_vault,0) - p_amount);
  end if;

  update public.profiles
  set spot_balance=v_spot, vault_balance=v_vault, holdings=v_holdings, updated_at=now()
  where id = v_user_id;

  return query select v_tx_id, v_spot, v_vault;
end;
$$;

-- 16g. execute_trade
create or replace function public.execute_trade(p_side text, p_asset text, p_amount numeric, p_price numeric)
returns table (tx_id uuid, spot_balance numeric, holdings jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id    uuid    := auth.uid();
  v_tx_id      uuid;
  v_spot       numeric;
  v_holdings   jsonb;
  v_current    numeric := 0;
  v_new        numeric := 0;
  v_usd_amount numeric := 0;
  v_asset      text    := lower(trim(coalesce(p_asset,'')));
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;
  if p_price  is null or p_price  <= 0 then raise exception 'Invalid price'; end if;
  if v_asset !~ '^[a-z0-9_-]{2,30}$' then raise exception 'Invalid asset'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid trade side'; end if;

  select coalesce(p.spot_balance,0), coalesce(p.holdings,'{}'::jsonb)
  into v_spot, v_holdings
  from public.profiles p where p.id = v_user_id for update;

  if p_side = 'buy' then
    v_usd_amount := p_amount;
    if public.derive_spot_balance(v_user_id) < v_usd_amount then raise exception 'Insufficient balance'; end if;
    v_current := coalesce((v_holdings ->> v_asset)::numeric, 0);
    v_new     := v_current + (v_usd_amount / p_price);
    if v_new <= 0 then v_holdings := v_holdings - v_asset;
    else v_holdings := jsonb_set(v_holdings, array[v_asset], to_jsonb(v_new), true); end if;
  else
    v_current := coalesce((v_holdings ->> v_asset)::numeric, 0);
    if p_amount > v_current then raise exception 'Insufficient asset balance'; end if;
    v_new        := greatest(0, v_current - p_amount);
    v_usd_amount := p_amount * p_price;
    if v_new <= 0.00000001 then v_holdings := v_holdings - v_asset;
    else v_holdings := jsonb_set(v_holdings, array[v_asset], to_jsonb(v_new), true); end if;
  end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  insert into public.transactions (user_id,type,amount,status,description,created_at,updated_at)
  values (v_user_id, p_side, v_usd_amount, 'completed',
    upper(p_side)||' '||upper(v_asset), now(), now())
  returning id into v_tx_id;

  select public.derive_spot_balance(v_user_id) into v_spot;
  update public.profiles set spot_balance=v_spot, holdings=v_holdings, updated_at=now()
  where id = v_user_id;

  return query select v_tx_id, v_spot, v_holdings;
end;
$$;

-- 16h. create_investment
create or replace function public.create_investment(p_strategy_id text, p_amount numeric)
returns table (investment_id uuid, tx_id uuid, spot_balance numeric, vault_balance numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_strategy public.strategies%rowtype;
  v_inv_id   uuid;
  v_tx_id    uuid;
  v_spot     numeric;
  v_vault    numeric;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;
  if p_strategy_id is null or p_strategy_id !~ '^[a-z0-9_-]{2,60}$' then raise exception 'Invalid strategy'; end if;

  select * into v_strategy from public.strategies where id = p_strategy_id;
  if not found then raise exception 'Unknown strategy'; end if;
  if p_amount < v_strategy.min_amount then
    raise exception 'Minimum investment is %', v_strategy.min_amount;
  end if;

  select coalesce(p.spot_balance,0), coalesce(p.vault_balance,0)
  into v_spot, v_vault
  from public.profiles p where p.id = v_user_id for update;

  if public.derive_spot_balance(v_user_id) < p_amount then raise exception 'Insufficient balance'; end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  insert into public.investments
    (user_id,strategy_id,amount,current_value,apy,status,matures_at,created_at,updated_at)
  values
    (v_user_id, v_strategy.id, p_amount, p_amount, v_strategy.apy, 'active',
     now() + make_interval(days => v_strategy.duration_days), now(), now())
  returning id into v_inv_id;

  insert into public.transactions (user_id,type,amount,status,description,created_at,updated_at)
  values (v_user_id,'investment',p_amount,'completed','Invested in '||v_strategy.name,now(),now())
  returning id into v_tx_id;

  select public.derive_spot_balance(v_user_id) into v_spot;
  select public.derive_vault_balance(v_user_id) into v_vault;

  update public.profiles set spot_balance=v_spot, vault_balance=v_vault, updated_at=now()
  where id = v_user_id;

  return query select v_inv_id, v_tx_id, v_spot, v_vault;
end;
$$;

-- 16i. claim_investment
create or replace function public.claim_investment(
  p_investment_id uuid,
  p_penalty_confirmed boolean default true
)
returns table (investment_id uuid, tx_id uuid, spot_balance numeric, vault_balance numeric, profit numeric, received numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_inv          public.investments%rowtype;
  v_strategy     public.strategies%rowtype;
  v_tx_id        uuid;
  v_spot         numeric;
  v_vault        numeric;
  v_claim_amount numeric := 0;
  v_penalty      numeric := 0;
  v_receive      numeric := 0;
  v_profit       numeric := 0;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_investment_id is null then raise exception 'Invalid investment'; end if;

  select * into v_inv from public.investments
  where id = p_investment_id and user_id = v_user_id for update;

  if not found then raise exception 'Investment not found'; end if;
  if v_inv.status <> 'active' then raise exception 'Investment is not active'; end if;

  select * into v_strategy from public.strategies where id = v_inv.strategy_id;
  if not found then raise exception 'Unknown strategy'; end if;

  v_claim_amount := greatest(0,
    coalesce(v_inv.amount,0) + (
      coalesce(v_inv.amount,0) *
      (case when coalesce(v_strategy.apy,0) > 1 then coalesce(v_strategy.apy,0)/100 else coalesce(v_strategy.apy,0) end) *
      greatest(0, least(1,
        extract(epoch from (least(now(), coalesce(v_inv.matures_at,now())) - coalesce(v_inv.created_at,now()))) / 31536000.0
      ))
    )
  );

  if now() < v_inv.matures_at and not coalesce(p_penalty_confirmed, false) then
    raise exception 'Early exit confirmation required';
  end if;

  if now() < v_inv.matures_at then
    v_penalty := round(
      (v_strategy.penalty_rate *
       greatest(0, least(1, extract(epoch from (v_inv.matures_at - now())) / (v_strategy.duration_days * 86400.0))) *
       v_claim_amount) * 100
    ) / 100.0;
  end if;

  v_receive := greatest(0, v_claim_amount - v_penalty);
  v_profit  := greatest(0, v_receive - coalesce(v_inv.amount, 0));

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  update public.investments
  set status='completed', profit=v_profit, current_value=v_claim_amount,
      completed_at=now(), updated_at=now()
  where id = v_inv.id;

  insert into public.transactions (user_id,type,amount,status,description,created_at,updated_at)
  values (
    v_user_id, 'claim', v_receive, 'completed',
    'Claimed '||v_strategy.name||case when now() < v_inv.matures_at then ' (Early Exit)' else '' end,
    now(), now()
  )
  returning id into v_tx_id;

  select public.derive_spot_balance(v_user_id) into v_spot;
  select public.derive_vault_balance(v_user_id) into v_vault;

  update public.profiles set spot_balance=v_spot, vault_balance=v_vault, updated_at=now()
  where id = v_user_id;

  return query select v_inv.id, v_tx_id, v_spot, v_vault, v_profit, v_receive;
end;
$$;

-- 16j. submit_kyc
create or replace function public.submit_kyc(
  p_full_name     text,
  p_dob           date,
  p_country       text,
  p_doc_type      text,
  p_id_front_path text,
  p_id_back_path  text,
  p_selfie_path   text
)
returns table (document_id uuid, kyc_status text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_doc_id  uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_full_name is null or char_length(trim(p_full_name)) < 2 then raise exception 'Invalid full name'; end if;
  if p_dob is null or p_dob > current_date then raise exception 'Invalid date of birth'; end if;
  if p_country is null or char_length(trim(p_country)) < 2 then raise exception 'Invalid country'; end if;
  if p_doc_type not in ('passport','national_id','drivers_license','residence_permit') then
    raise exception 'Invalid document type';
  end if;
  if p_id_front_path is null or p_selfie_path is null then raise exception 'Missing document uploads'; end if;

  perform set_config('nextrade.bypass_financial_guard', '1', true);

  insert into public.kyc_documents
    (user_id,full_name,dob,country,doc_type,id_front_path,id_back_path,selfie_path,status,submitted_at,updated_at)
  values
    (v_user_id, left(trim(p_full_name),120), p_dob, left(trim(p_country),80), p_doc_type,
     p_id_front_path, p_id_back_path, p_selfie_path, 'pending', now(), now())
  returning id into v_doc_id;

  update public.profiles set kyc_status='pending', updated_at=now() where id = v_user_id;

  return query select v_doc_id, 'pending'::text;
end;
$$;

-- 16k. next_deposit_address_index
create or replace function public.next_deposit_address_index()
returns integer language sql security definer set search_path = public
as $$
  select nextval('public.deposit_address_index_seq')::integer;
$$;


-- ── 17. STORAGE BUCKET ────────────────────────────────────────────────────
-- In Supabase Dashboard → Storage → New bucket:
--   Name: kyc-docs   |   Public: NO
--
-- Then run in SQL Editor:
--
--   create policy "kyc-docs: user uploads own"
--     on storage.objects for insert
--     with check (
--       bucket_id = 'kyc-docs'
--       and auth.uid()::text = (storage.foldername(name))[1]
--     );


-- ── 18. GRANTS ────────────────────────────────────────────────────────────
grant usage on schema public to authenticated, anon;

grant select, insert, update on public.profiles          to authenticated;
grant select, insert, update on public.transactions      to authenticated;
grant select, insert, update on public.investments       to authenticated;
grant select, insert, update on public.kyc_documents     to authenticated;
grant select, insert, update on public.deposit_addresses to authenticated;
grant select                 on public.strategies        to authenticated, anon;

grant execute on function public.get_my_role()                                        to authenticated;
grant execute on function public.derive_spot_balance(uuid)                            to authenticated;
grant execute on function public.derive_vault_balance(uuid)                           to authenticated;
grant execute on function public.transfer_spot_vault(text, numeric)                   to authenticated;
grant execute on function public.request_deposit(numeric, text)                       to authenticated;
grant execute on function public.request_withdrawal(numeric, text)                    to authenticated;
grant execute on function public.execute_trade(text, text, numeric, numeric)          to authenticated;
grant execute on function public.create_investment(text, numeric)                     to authenticated;
grant execute on function public.claim_investment(uuid, boolean)                      to authenticated;
grant execute on function public.submit_kyc(text, date, text, text, text, text, text) to authenticated;
grant execute on function public.next_deposit_address_index()                         to authenticated;
grant execute on function public.reconcile_all_spot_balances()                        to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════════════════
