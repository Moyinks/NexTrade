-- ============================================================================
-- NEXTRADE — LEGACY -> LEDGER v2.1 CUTOVER
-- ============================================================================
-- Run this ONCE on an older NexTrade Supabase database BEFORE SCHEMA.sql.
--
-- Goals:
--   * preserve each account's exact legacy stored Spot balance at cutover,
--     while converting future accounting to a ledger-only model;
--   * derive Vault CASH only from transfer history (active investments are a
--     separate position value and are not folded into cash);
--   * normalize legacy statuses/strategy snapshots without deleting history;
--   * add the columns and constraints required by the canonical SCHEMA.sql;
--   * abort instead of silently guessing when legacy data is ambiguous.
--
-- Operational rule: put the application in maintenance/read-only mode while
-- this transaction runs. The advisory lock prevents two copies of this migration
-- from executing concurrently, but it cannot stop an old deployed client from
-- attempting writes against the same database during cutover.
-- ============================================================================

begin;

select pg_advisory_xact_lock(hashtext('nextrade-ledger-v2.1-cutover'));
set local lock_timeout = '15s';
set local statement_timeout = '0';

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. PREFLIGHT: THIS SCRIPT TARGETS THE LEGACY NEXTRADE DATABASE
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Cutover aborted: public.profiles does not exist';
  end if;
  if to_regclass('public.transactions') is null then
    raise exception 'Cutover aborted: public.transactions does not exist';
  end if;
  if to_regclass('public.investments') is null then
    raise exception 'Cutover aborted: public.investments does not exist';
  end if;
end $$;

-- Old guard/update triggers can block the normalization below. SCHEMA.sql
-- recreates the canonical versions after this cutover.
drop trigger if exists guard_profile_sensitive_write on public.profiles;
drop trigger if exists guard_transactions_server_only on public.transactions;
drop trigger if exists guard_investments_server_only on public.investments;
drop trigger if exists guard_transaction_immutability on public.transactions;
drop trigger if exists refresh_balance_caches on public.transactions;
drop trigger if exists set_updated_at_profiles on public.profiles;
drop trigger if exists set_updated_at_transactions on public.transactions;
drop trigger if exists set_updated_at_investments on public.investments;

-- The current product intentionally permits multiple active positions in the
-- same strategy and groups them in the portfolio UI.
drop index if exists public.investments_one_active_per_strategy;

-- ---------------------------------------------------------------------------
-- 1. STRUCTURAL UPGRADE
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists avatar_url text,
  add column if not exists role text,
  add column if not exists kyc_status text,
  add column if not exists spot_balance numeric(30,8),
  add column if not exists vault_balance numeric(30,8),
  add column if not exists holdings jsonb,
  add column if not exists withdrawal_passphrase_hash text,
  add column if not exists withdrawal_failed_attempts integer,
  add column if not exists withdrawal_locked_until timestamptz,
  add column if not exists withdrawal_verified_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.transactions
  add column if not exists type text,
  add column if not exists amount numeric(30,8),
  add column if not exists status text,
  add column if not exists description text,
  add column if not exists metadata jsonb,
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.investments
  add column if not exists strategy_id text,
  add column if not exists amount numeric(30,8),
  add column if not exists current_value numeric(30,8),
  add column if not exists apy numeric(8,4),
  add column if not exists duration_days integer,
  add column if not exists penalty_rate numeric(8,6),
  add column if not exists perf_fee numeric(8,4),
  add column if not exists profit numeric(30,8),
  add column if not exists status text,
  add column if not exists matures_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Ensure the strategy catalogue exists before investment snapshots are filled.
create table if not exists public.strategies (
  id            text primary key,
  name          text not null,
  tagline       text,
  category      text,
  apy           numeric(8,4) not null,
  min_amount    numeric(30,8) not null,
  duration_days integer not null,
  penalty_rate  numeric(8,6) not null,
  perf_fee      numeric(8,4) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.strategies
  (id,name,tagline,category,apy,min_amount,duration_days,penalty_rate,perf_fee)
values
  ('steady-accumulator','Steady Accumulator','90-day managed strategy cycle','Conservative · Strategy A',22,100,90,0.08,15),
  ('alpha-seeker','Surge Pool','30-day quantitative strategy cycle','Quant Momentum · Strategy B',67,1500,30,0.15,20)
on conflict (id) do update set
  name=excluded.name,
  tagline=excluded.tagline,
  category=excluded.category,
  apy=excluded.apy,
  min_amount=excluded.min_amount,
  duration_days=excluded.duration_days,
  penalty_rate=excluded.penalty_rate,
  perf_fee=excluded.perf_fee,
  updated_at=now();

-- KYC existed in some legacy databases and was absent in others.
create table if not exists public.kyc_documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  full_name        text,
  dob              date,
  country          text,
  doc_type         text,
  id_front_path    text,
  id_back_path     text,
  selfie_path      text,
  status           text,
  rejection_reason text,
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  updated_at       timestamptz
);

alter table public.kyc_documents
  add column if not exists full_name text,
  add column if not exists dob date,
  add column if not exists country text,
  add column if not exists doc_type text,
  add column if not exists id_front_path text,
  add column if not exists id_back_path text,
  add column if not exists selfie_path text,
  add column if not exists status text,
  add column if not exists rejection_reason text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at timestamptz;

create table if not exists public.deposit_addresses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  address          text,
  derivation_index bigint,
  network          text,
  expires_at       timestamptz,
  used             boolean,
  created_at       timestamptz
);

alter table public.deposit_addresses
  add column if not exists address text,
  add column if not exists derivation_index bigint,
  add column if not exists network text,
  add column if not exists expires_at timestamptz,
  add column if not exists used boolean,
  add column if not exists created_at timestamptz;

create table if not exists public.app_settings (
  singleton                boolean primary key default true,
  real_deposits_enabled    boolean not null default false,
  real_withdrawals_enabled boolean not null default false,
  updated_at               timestamptz not null default now()
);
insert into public.app_settings(singleton,real_deposits_enabled,real_withdrawals_enabled)
values(true,false,false)
on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------------
-- 1b. REMOVE LEGACY AUTHORIZATION/RPC SURFACE
-- ---------------------------------------------------------------------------
-- Old NexTrade versions granted browser EXECUTE on client-price trade RPCs and
-- two-argument money mutations. Because PostgreSQL overloads by signature, they
-- would otherwise survive next to the hardened v2.1 functions. Drop every
-- legacy public-table policy and the obsolete RPC signatures during maintenance
-- mode. SCHEMA.sql installs the canonical surface immediately after this cutover.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('profiles','transactions','investments','strategies','kyc_documents','deposit_addresses','app_settings')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop function if exists public.request_deposit(numeric,text);
drop function if exists public.request_withdrawal(numeric,text);
drop function if exists public.transfer_spot_vault(text,numeric);
drop function if exists public.execute_trade(text,text,numeric,numeric);
drop function if exists public.create_investment(text,numeric);
drop function if exists public.claim_investment(uuid,boolean);
drop function if exists public.derive_vault_balance(uuid);
drop function if exists public.reconcile_all_spot_balances();
drop function if exists public.get_my_role();

-- ---------------------------------------------------------------------------
-- 2. REMOVE LEGACY CHECKS BEFORE NORMALIZATION
-- ---------------------------------------------------------------------------
-- Only CHECK constraints are removed here; PK/FK/UNIQUE constraints remain.
-- Canonical checks are re-added below with stable names.

do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype='c'
      and conrelid in (
        'public.profiles'::regclass,
        'public.transactions'::regclass,
        'public.investments'::regclass,
        'public.strategies'::regclass,
        'public.kyc_documents'::regclass,
        'public.deposit_addresses'::regclass,
        'public.app_settings'::regclass
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. NORMALIZE SAFE, UNAMBIGUOUS LEGACY STATES
-- ---------------------------------------------------------------------------

update public.profiles set
  role = coalesce(role,'user'),
  kyc_status = case when coalesce(kyc_status,'unverified')='unverified' then 'none' else coalesce(kyc_status,'none') end,
  spot_balance = coalesce(spot_balance,0),
  vault_balance = coalesce(vault_balance,0),
  holdings = coalesce(holdings,'{}'::jsonb),
  withdrawal_failed_attempts = coalesce(withdrawal_failed_attempts,0),
  created_at = coalesce(created_at,now()),
  updated_at = coalesce(updated_at,created_at,now());

update public.transactions set
  metadata = coalesce(metadata,'{}'::jsonb),
  created_at = coalesce(created_at,now()),
  updated_at = coalesce(updated_at,created_at,now());

update public.investments i set
  status = case when i.status='completed' then 'claimed' else coalesce(i.status,'active') end,
  apy = coalesce(i.apy,s.apy),
  duration_days = coalesce(i.duration_days,s.duration_days),
  penalty_rate = coalesce(i.penalty_rate,s.penalty_rate),
  perf_fee = coalesce(i.perf_fee,s.perf_fee),
  current_value = coalesce(i.current_value, i.amount + coalesce(i.profit,0), i.amount),
  profit = coalesce(i.profit, coalesce(i.current_value,i.amount,0)-coalesce(i.amount,0)),
  created_at = coalesce(i.created_at,now()),
  matures_at = coalesce(i.matures_at, coalesce(i.created_at,now()) + make_interval(days=>coalesce(i.duration_days,s.duration_days))),
  completed_at = case
    when (case when i.status='completed' then 'claimed' else i.status end)='claimed'
      then coalesce(i.completed_at,i.updated_at,now())
    else i.completed_at
  end,
  updated_at = coalesce(i.updated_at,i.created_at,now())
from public.strategies s
where s.id=i.strategy_id;

-- The legacy backend accepted generic national_id while the current product
-- uses Nigeria's NIN explicitly. This mapping is unambiguous only for NG.
update public.kyc_documents
set doc_type='nin'
where doc_type='national_id' and country='NG';

update public.kyc_documents set
  status=coalesce(status,'pending'),
  submitted_at=coalesce(submitted_at,now()),
  updated_at=coalesce(updated_at,submitted_at,now());

update public.deposit_addresses set
  network=coalesce(network,'eth'),
  used=coalesce(used,false),
  created_at=coalesce(created_at,now());

-- ---------------------------------------------------------------------------
-- 4. ABORT ON AMBIGUOUS / INVALID HISTORY
-- ---------------------------------------------------------------------------

do $$
begin
  if exists(select 1 from public.profiles where role not in ('user','admin')) then
    raise exception 'Cutover aborted: unknown profile role exists';
  end if;
  if exists(select 1 from public.profiles where kyc_status not in ('none','pending','approved','rejected')) then
    raise exception 'Cutover aborted: unknown KYC status exists';
  end if;
  if exists(select 1 from public.profiles where spot_balance<0 or vault_balance<0) then
    raise exception 'Cutover aborted: negative legacy profile balance exists';
  end if;
  if exists(select 1 from public.profiles where jsonb_typeof(holdings)<>'object') then
    raise exception 'Cutover aborted: holdings must be JSON objects';
  end if;
  if exists(
    select 1 from public.profiles p, lateral jsonb_each(p.holdings) h
    where h.key not in ('btc','eth','sol','bnb','xrp','ada','avax','dot','matic','doge','shib','trx','ltc','link','uni','ton','near','xlm','sui')
       or case when jsonb_typeof(h.value)='number'
          then (h.value::text)::numeric < 0 or (h.value::text)::numeric > 1000000000000000000
          else true end
  ) then
    raise exception 'Cutover aborted: holdings contain an unsupported asset or invalid quantity';
  end if;

  if exists(select 1 from public.transactions where type is null or type not in (
    'opening_balance','migration_credit','migration_debit','deposit','withdraw','investment','claim','transfer_in','transfer_out','buy','sell'
  )) then
    raise exception 'Cutover aborted: unknown transaction type exists';
  end if;
  if exists(select 1 from public.transactions where amount is null or amount<=0 or amount>1000000000) then
    raise exception 'Cutover aborted: invalid transaction amount exists';
  end if;
  if exists(select 1 from public.transactions where status is null or status not in ('pending','approved','completed','rejected','cancelled','failed')) then
    raise exception 'Cutover aborted: unknown transaction status exists';
  end if;
  if exists(select 1 from public.transactions where description is not null and char_length(description)>500) then
    raise exception 'Cutover aborted: transaction description exceeds 500 characters';
  end if;
  if exists(
    select user_id,idempotency_key from public.transactions
    where idempotency_key is not null
    group by user_id,idempotency_key having count(*)>1
  ) then
    raise exception 'Cutover aborted: duplicate transaction idempotency keys require manual review';
  end if;
  if exists(select 1 from public.transactions where idempotency_key is not null and idempotency_key !~ '^[A-Za-z0-9:_-]{16,100}$') then
    raise exception 'Cutover aborted: malformed transaction idempotency key exists';
  end if;

  if exists(select 1 from public.investments where strategy_id not in ('steady-accumulator','alpha-seeker')) then
    raise exception 'Cutover aborted: unknown investment strategy exists';
  end if;
  if exists(select 1 from public.investments where amount is null or amount<=0 or amount>1000000000) then
    raise exception 'Cutover aborted: invalid legacy investment principal exists; reconcile it manually rather than inventing principal';
  end if;
  if exists(select 1 from public.investments where current_value is null or current_value<0) then
    raise exception 'Cutover aborted: invalid investment current_value exists';
  end if;
  if exists(select 1 from public.investments where apy is null or apy<0 or apy>1000 or duration_days is null or duration_days not between 1 and 3650 or penalty_rate is null or penalty_rate not between 0 and 1 or perf_fee is null or perf_fee not between 0 and 100) then
    raise exception 'Cutover aborted: invalid investment strategy snapshot exists';
  end if;
  if exists(select 1 from public.investments where created_at is null or matures_at is null or matures_at <= created_at) then
    raise exception 'Cutover aborted: invalid investment lifecycle timestamps exist';
  end if;
  if exists(select 1 from public.investments where status='claimed' and completed_at is null) then
    raise exception 'Cutover aborted: claimed investment is missing completed_at';
  end if;
  if exists(select 1 from public.investments where status not in ('active','claimed','cancelled')) then
    raise exception 'Cutover aborted: unknown investment status exists';
  end if;

  if exists(select 1 from public.kyc_documents where country not in ('NG','GH','KE','ZA','US','GB','CA','AU','DE','FR','AE','SG','OTHER')) then
    raise exception 'Cutover aborted: KYC country requires manual normalization';
  end if;
  if exists(select 1 from public.kyc_documents where doc_type='national_id') then
    raise exception 'Cutover aborted: non-NG national_id requires manual document-type classification';
  end if;
  if exists(select 1 from public.kyc_documents where doc_type not in ('passport','nin','drivers_license','voters_card','residence_permit')) then
    raise exception 'Cutover aborted: unknown KYC document type exists';
  end if;
  if exists(select 1 from public.kyc_documents where dob is null or dob>current_date-interval '18 years' or dob<current_date-interval '120 years') then
    raise exception 'Cutover aborted: KYC DOB requires manual review (under 18 or implausible)';
  end if;
  if exists(select 1 from public.kyc_documents where status not in ('pending','approved','rejected')) then
    raise exception 'Cutover aborted: unknown KYC document status exists';
  end if;
  if exists(select 1 from public.kyc_documents where full_name is null or char_length(btrim(full_name)) not between 2 and 120 or id_front_path is null or selfie_path is null) then
    raise exception 'Cutover aborted: KYC record is missing required identity evidence';
  end if;
  if exists(select 1 from public.kyc_documents where doc_type='nin' and country<>'NG') then
    raise exception 'Cutover aborted: NIN exists outside Nigeria';
  end if;
  if exists(select 1 from public.kyc_documents where doc_type='voters_card' and country not in ('NG','GH')) then
    raise exception 'Cutover aborted: voter card exists for an unsupported country';
  end if;
  if exists(
    select 1 from public.kyc_documents k
    where k.id_front_path !~ ('^'||k.user_id::text||'/id_front_[0-9]{10,17}\.jpg$')
       or k.selfie_path !~ ('^'||k.user_id::text||'/selfie_[0-9]{10,17}\.jpg$')
       or (k.id_back_path is not null and k.id_back_path !~ ('^'||k.user_id::text||'/id_back_[0-9]{10,17}\.jpg$'))
  ) then
    raise exception 'Cutover aborted: KYC Storage path does not match the owning user';
  end if;
  if exists(select user_id from public.kyc_documents where status='pending' group by user_id having count(*)>1) then
    raise exception 'Cutover aborted: duplicate pending KYC submissions require manual review';
  end if;

  if exists(select 1 from public.deposit_addresses where network<>'eth') then
    raise exception 'Cutover aborted: legacy non-ETH generated deposit address requires manual migration';
  end if;
  if exists(select 1 from public.deposit_addresses where address is null or address !~ '^0x[0-9a-fA-F]{40}$') then
    raise exception 'Cutover aborted: invalid generated deposit address exists';
  end if;
  if exists(select 1 from public.deposit_addresses where lower(address)='0x0000000000000000000000000000000000000000' or derivation_index is null or derivation_index<0 or expires_at is null) then
    raise exception 'Cutover aborted: incomplete or zero generated deposit address exists';
  end if;
  if exists(select address from public.deposit_addresses group by address having count(*)>1)
     or exists(select derivation_index from public.deposit_addresses group by derivation_index having count(*)>1) then
    raise exception 'Cutover aborted: duplicate deposit address/index requires manual reconciliation';
  end if;
  if exists(select 1 from public.app_settings where singleton is distinct from true) then
    raise exception 'Cutover aborted: app_settings contains a non-singleton row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. LEDGER CUTOVER
-- ---------------------------------------------------------------------------
-- Preserve the exact legacy stored Spot balance by comparing it with the NEW
-- ledger interpretation and writing one explicit adjustment entry when needed.
-- The adjustment is auditable; nothing is hidden in profile cache state.

with new_ledger as (
  select p.id as user_id,
         p.spot_balance as legacy_spot,
         coalesce(sum(case
           when t.type in ('opening_balance','migration_credit','deposit','claim','transfer_in','sell')
                and t.status in ('completed','approved') then t.amount
           when t.type in ('migration_debit','investment','transfer_out','buy')
                and t.status in ('completed','approved') then -t.amount
           when t.type='withdraw' and t.status in ('pending','approved','completed') then -t.amount
           else 0 end),0) as ledger_spot
  from public.profiles p
  left join public.transactions t on t.user_id=p.id
  group by p.id,p.spot_balance
), delta as (
  select user_id,legacy_spot,ledger_spot,legacy_spot-ledger_spot as diff
  from new_ledger
)
insert into public.transactions(user_id,type,amount,status,description,metadata,created_at,updated_at)
select user_id,
       case when diff>0 then 'migration_credit' else 'migration_debit' end,
       abs(diff),
       'completed',
       'Legacy balance cutover adjustment',
       jsonb_build_object(
         'migration','nextrade-ledger-v2.1',
         'legacy_spot_balance',legacy_spot,
         'ledger_before_adjustment',ledger_spot,
         'adjustment',diff
       ),
       now(),now()
from delta
where abs(diff)>0.000000005;

-- Vault CASH is deliberately reconstructed only from transfer history. Active
-- investment value remains in investments and is added by AppState for display.
-- Negative derived cash means the historical transfer ledger is impossible and
-- must be reconciled manually rather than clamped.
do $$
begin
  if exists (
    select 1
    from (
      select p.id,
        coalesce(sum(case
          when t.type='transfer_out' and t.status in ('completed','approved') then t.amount
          when t.type='transfer_in'  and t.status in ('completed','approved') then -t.amount
          else 0 end),0) as vault_cash
      from public.profiles p
      left join public.transactions t on t.user_id=p.id
      group by p.id
    ) q
    where q.vault_cash < -0.000000005
  ) then
    raise exception 'Cutover aborted: transfer history implies negative Vault cash';
  end if;
end $$;

update public.profiles p
set vault_balance = greatest(0,coalesce(v.cash,0)), updated_at=now()
from (
  select p2.id,
    coalesce(sum(case
      when t.type='transfer_out' and t.status in ('completed','approved') then t.amount
      when t.type='transfer_in'  and t.status in ('completed','approved') then -t.amount
      else 0 end),0) as cash
  from public.profiles p2
  left join public.transactions t on t.user_id=p2.id
  group by p2.id
) v
where v.id=p.id;

-- Spot cache is now equal to the post-adjustment ledger by construction.
update public.profiles p
set spot_balance=q.balance, updated_at=now()
from (
  select p2.id,
    coalesce(sum(case
      when t.type in ('opening_balance','migration_credit','deposit','claim','transfer_in','sell')
           and t.status in ('completed','approved') then t.amount
      when t.type in ('migration_debit','investment','transfer_out','buy')
           and t.status in ('completed','approved') then -t.amount
      when t.type='withdraw' and t.status in ('pending','approved','completed') then -t.amount
      else 0 end),0) as balance
  from public.profiles p2
  left join public.transactions t on t.user_id=p2.id
  group by p2.id
) q
where q.id=p.id;

-- ---------------------------------------------------------------------------
-- 6. CANONICAL NULLABILITY + TYPES
-- ---------------------------------------------------------------------------

alter table public.profiles
  alter column role set default 'user',
  alter column role set not null,
  alter column kyc_status set default 'none',
  alter column kyc_status set not null,
  alter column spot_balance type numeric(30,8) using spot_balance::numeric(30,8),
  alter column spot_balance set default 0,
  alter column spot_balance set not null,
  alter column vault_balance type numeric(30,8) using vault_balance::numeric(30,8),
  alter column vault_balance set default 0,
  alter column vault_balance set not null,
  alter column holdings set default '{}'::jsonb,
  alter column holdings set not null,
  alter column withdrawal_failed_attempts set default 0,
  alter column withdrawal_failed_attempts set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.transactions
  alter column amount type numeric(30,8) using amount::numeric(30,8),
  alter column type set not null,
  alter column amount set not null,
  alter column status set default 'pending',
  alter column status set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.investments
  alter column amount type numeric(30,8) using amount::numeric(30,8),
  alter column current_value type numeric(30,8) using current_value::numeric(30,8),
  alter column apy type numeric(8,4) using apy::numeric(8,4),
  alter column penalty_rate type numeric(8,6) using penalty_rate::numeric(8,6),
  alter column perf_fee type numeric(8,4) using perf_fee::numeric(8,4),
  alter column profit type numeric(30,8) using profit::numeric(30,8),
  alter column strategy_id set not null,
  alter column amount set not null,
  alter column current_value set not null,
  alter column apy set not null,
  alter column duration_days set not null,
  alter column penalty_rate set not null,
  alter column perf_fee set not null,
  alter column profit set default 0,
  alter column profit set not null,
  alter column status set default 'active',
  alter column status set not null,
  alter column matures_at set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.kyc_documents
  alter column full_name set not null,
  alter column dob set not null,
  alter column country set not null,
  alter column doc_type set not null,
  alter column id_front_path set not null,
  alter column selfie_path set not null,
  alter column status set default 'pending',
  alter column status set not null,
  alter column submitted_at set default now(),
  alter column submitted_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.deposit_addresses
  alter column derivation_index type bigint using derivation_index::bigint,
  alter column address set not null,
  alter column derivation_index set not null,
  alter column network set default 'eth',
  alter column network set not null,
  alter column expires_at set not null,
  alter column used set default false,
  alter column used set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

-- ---------------------------------------------------------------------------
-- 7. CANONICAL CHECK CONSTRAINTS + INDEXES
-- ---------------------------------------------------------------------------

alter table public.profiles
  add constraint profiles_role_allowlist check (role in ('user','admin')),
  add constraint profiles_kyc_status_allowlist check (kyc_status in ('none','pending','approved','rejected')),
  add constraint profiles_spot_non_negative check (spot_balance>=0),
  add constraint profiles_vault_non_negative check (vault_balance>=0),
  add constraint profiles_holdings_object check (jsonb_typeof(holdings)='object'),
  add constraint profiles_withdrawal_attempts_non_negative check (withdrawal_failed_attempts>=0);

alter table public.transactions
  add constraint transactions_type_allowlist check (type in (
    'opening_balance','migration_credit','migration_debit','deposit','withdraw','investment','claim','transfer_in','transfer_out','buy','sell'
  )),
  add constraint transactions_amount_range check (amount>0 and amount<=1000000000),
  add constraint transactions_status_allowlist check (status in ('pending','approved','completed','rejected','cancelled','failed')),
  add constraint transactions_description_length check (description is null or char_length(description)<=500),
  add constraint transactions_idempotency_format check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9:_-]{16,100}$');

alter table public.strategies
  add constraint strategies_id_slug check (id ~ '^[a-z0-9_-]{2,60}$'),
  add constraint strategies_apy_range check (apy>=0 and apy<=1000),
  add constraint strategies_min_amount_positive check (min_amount>0),
  add constraint strategies_duration_range check (duration_days between 1 and 3650),
  add constraint strategies_penalty_range check (penalty_rate between 0 and 1),
  add constraint strategies_perf_fee_range check (perf_fee between 0 and 100);

alter table public.investments
  add constraint investments_amount_range check (amount>0 and amount<=1000000000),
  add constraint investments_current_value_non_negative check (current_value>=0),
  add constraint investments_apy_range check (apy>=0 and apy<=1000),
  add constraint investments_duration_range check (duration_days between 1 and 3650),
  add constraint investments_penalty_range check (penalty_rate between 0 and 1),
  add constraint investments_perf_fee_range check (perf_fee between 0 and 100),
  add constraint investments_status_allowlist check (status in ('active','claimed','cancelled')),
  add constraint investments_maturity_after_creation check (matures_at>created_at),
  add constraint investments_claimed_has_completion check (status<>'claimed' or completed_at is not null);

alter table public.kyc_documents
  add constraint kyc_name_length check (char_length(full_name) between 2 and 120),
  add constraint kyc_country_allowlist check (country in ('NG','GH','KE','ZA','US','GB','CA','AU','DE','FR','AE','SG','OTHER')),
  add constraint kyc_doc_type_allowlist check (doc_type in ('passport','nin','drivers_license','voters_card','residence_permit')),
  add constraint kyc_status_allowlist check (status in ('pending','approved','rejected')),
  add constraint kyc_country_document_pair check ((doc_type<>'nin' or country='NG') and (doc_type<>'voters_card' or country in ('NG','GH'))),
  add constraint kyc_front_path_owned check (id_front_path ~ ('^'||user_id::text||'/id_front_[0-9]{10,17}\.jpg$')),
  add constraint kyc_selfie_path_owned check (selfie_path ~ ('^'||user_id::text||'/selfie_[0-9]{10,17}\.jpg$')),
  add constraint kyc_back_path_owned check (id_back_path is null or id_back_path ~ ('^'||user_id::text||'/id_back_[0-9]{10,17}\.jpg$'));

alter table public.deposit_addresses
  add constraint deposit_address_eth_format check (address ~ '^0x[0-9a-fA-F]{40}$' and lower(address)<>'0x0000000000000000000000000000000000000000'),
  add constraint deposit_derivation_non_negative check (derivation_index>=0),
  add constraint deposit_network_allowlist check (network='eth');

alter table public.app_settings
  add constraint app_settings_singleton_true check (singleton);

create unique index if not exists transactions_user_idempotency_unique
  on public.transactions(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists transactions_user_created_idx
  on public.transactions(user_id,created_at desc);
create index if not exists transactions_user_status_idx
  on public.transactions(user_id,status,type);
create index if not exists investments_user_status_idx
  on public.investments(user_id,status,created_at desc);
create unique index if not exists kyc_one_pending_per_user
  on public.kyc_documents(user_id) where status='pending';
create index if not exists kyc_user_submitted_idx
  on public.kyc_documents(user_id,submitted_at desc);
create unique index if not exists deposit_addresses_address_unique on public.deposit_addresses(address);
create unique index if not exists deposit_addresses_derivation_unique on public.deposit_addresses(derivation_index);

-- Canonical sequence name. Start beyond any already-allocated index.
create sequence if not exists public.deposit_address_derivation_seq minvalue 0 start with 0;
select setval(
  'public.deposit_address_derivation_seq',
  greatest(coalesce((select max(derivation_index) from public.deposit_addresses),-1)+1,0),
  false
);

-- Final invariant: the stored Spot cache must equal the new ledger exactly.
do $$
begin
  if exists (
    select 1
    from public.profiles p
    where abs(p.spot_balance - coalesce((
      select sum(case
        when t.type in ('opening_balance','migration_credit','deposit','claim','transfer_in','sell') and t.status in ('completed','approved') then t.amount
        when t.type in ('migration_debit','investment','transfer_out','buy') and t.status in ('completed','approved') then -t.amount
        when t.type='withdraw' and t.status in ('pending','approved','completed') then -t.amount
        else 0 end)
      from public.transactions t where t.user_id=p.id
    ),0)) > 0.000000005
  ) then
    raise exception 'Cutover aborted: Spot reconciliation invariant failed';
  end if;
end $$;

comment on column public.strategies.apy is
  'Legacy field name retained for compatibility. Value is the gross target return percentage for one strategy cycle, NOT annual percentage yield.';
comment on column public.investments.apy is
  'Immutable snapshot of the strategy gross target return percentage for this position cycle; NOT annualized APY.';

commit;

-- NEXT STEP (required): run SCHEMA.sql immediately after this migration to
-- install the canonical functions, triggers, RLS policies, grants, Storage
-- policy, and service-only financial boundaries.
