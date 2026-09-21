-- ============================================================================
-- NEXTRADE — CANONICAL FRESH DATABASE SCHEMA v2.1
-- ============================================================================
-- Purpose: reproducible bootstrap for the public portfolio implementation.
--
-- Financial design:
--   * transactions is the Spot/Vault-cash ledger and source of truth.
--   * profiles.spot_balance / vault_balance are server-maintained read caches.
--   * active investment value is derived from immutable term snapshots.
--   * browser clients receive SELECT access only to financial rows.
--   * all money mutations cross SECURITY DEFINER RPCs or service-only endpoints.
--   * mutations serialize per user with SELECT ... FOR UPDATE.
--   * retryable mutations use per-user idempotency keys.
--
-- IMPORTANT: for a legacy database with real rows, do not blindly run a fresh
-- schema over unknown accounting history. See MIGRATION_V2_1_CUTOVER.sql first.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                         uuid primary key references auth.users(id) on delete cascade,
  email                      text,
  full_name                  text,
  avatar_url                 text,
  role                       text not null default 'user'
                             check (role in ('user','admin')),
  kyc_status                 text not null default 'none'
                             check (kyc_status in ('none','pending','approved','rejected')),
  spot_balance               numeric(30,8) not null default 0 check (spot_balance >= 0),
  vault_balance              numeric(30,8) not null default 0 check (vault_balance >= 0),
  holdings                   jsonb not null default '{}'::jsonb
                             check (jsonb_typeof(holdings)='object'),
  withdrawal_passphrase_hash text,
  withdrawal_failed_attempts integer not null default 0 check (withdrawal_failed_attempts >= 0),
  withdrawal_locked_until    timestamptz,
  withdrawal_verified_at     timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  type              text not null check (type in (
                      'opening_balance','migration_credit','migration_debit',
                      'deposit','withdraw','investment','claim',
                      'transfer_in','transfer_out','buy','sell'
                    )),
  amount            numeric(30,8) not null check (amount > 0 and amount <= 1000000000),
  status            text not null default 'pending'
                    check (status in ('pending','approved','completed','rejected','cancelled','failed')),
  description       text check (description is null or char_length(description) <= 500),
  metadata          jsonb not null default '{}'::jsonb,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint transactions_idempotency_format
    check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9:_-]{16,100}$')
);

create unique index if not exists transactions_user_idempotency_unique
  on public.transactions(user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists transactions_user_created_idx
  on public.transactions(user_id, created_at desc);
create index if not exists transactions_user_status_idx
  on public.transactions(user_id, status, type);

create table if not exists public.strategies (
  id            text primary key check (id ~ '^[a-z0-9_-]{2,60}$'),
  name          text not null,
  tagline       text,
  category      text,
  apy           numeric(8,4) not null check (apy >= 0 and apy <= 1000),
  min_amount    numeric(30,8) not null check (min_amount > 0),
  duration_days integer not null check (duration_days between 1 and 3650),
  penalty_rate  numeric(8,6) not null check (penalty_rate between 0 and 1),
  perf_fee      numeric(8,4) not null check (perf_fee between 0 and 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.investments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  strategy_id    text not null references public.strategies(id),
  amount         numeric(30,8) not null check (amount > 0 and amount <= 1000000000),
  current_value  numeric(30,8) not null check (current_value >= 0),
  apy            numeric(8,4) not null check (apy >= 0 and apy <= 1000),
  duration_days  integer not null check (duration_days between 1 and 3650),
  penalty_rate   numeric(8,6) not null check (penalty_rate between 0 and 1),
  perf_fee       numeric(8,4) not null check (perf_fee between 0 and 100),
  profit         numeric(30,8) not null default 0,
  status         text not null default 'active'
                 check (status in ('active','claimed','cancelled')),
  matures_at     timestamptz not null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists investments_user_status_idx
  on public.investments(user_id, status, created_at desc);

create table if not exists public.kyc_documents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  full_name        text not null check (char_length(full_name) between 2 and 120),
  dob              date not null,
  country          text not null check (country in ('NG','GH','KE','ZA','US','GB','CA','AU','DE','FR','AE','SG','OTHER')),
  doc_type         text not null check (doc_type in ('passport','nin','drivers_license','voters_card','residence_permit')),
  id_front_path    text not null,
  id_back_path     text,
  selfie_path      text not null,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  rejection_reason text,
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  updated_at       timestamptz not null default now()
);
create unique index if not exists kyc_one_pending_per_user
  on public.kyc_documents(user_id) where status = 'pending';
create index if not exists kyc_user_submitted_idx
  on public.kyc_documents(user_id, submitted_at desc);

create table if not exists public.deposit_addresses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  address          text not null unique check (address ~ '^0x[0-9a-fA-F]{40}$'),
  derivation_index bigint not null unique check (derivation_index >= 0),
  network          text not null default 'eth' check (network in ('eth')),
  expires_at       timestamptz not null,
  used             boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists public.app_settings (
  singleton                boolean primary key default true check (singleton),
  real_deposits_enabled    boolean not null default false,
  real_withdrawals_enabled boolean not null default false,
  updated_at               timestamptz not null default now()
);
insert into public.app_settings(singleton) values (true)
on conflict (singleton) do nothing;

create sequence if not exists public.deposit_address_derivation_seq start with 0 minvalue 0;

-- ---------------------------------------------------------------------------
-- 1b. LEGACY ATTACK-SURFACE CLEANUP
-- ---------------------------------------------------------------------------
-- PostgreSQL overloads functions by signature. An upgrade that only creates the
-- v2.1 signatures would leave old authenticated money RPCs callable. Likewise,
-- legacy RLS policies can survive CREATE TABLE IF NOT EXISTS. Remove the old
-- surface explicitly before installing the canonical policies/functions below.
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
-- 2. STATIC STRATEGY CATALOGUE
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3. GENERIC HELPERS + AUTH PROFILE CREATION
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,full_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data->>'full_name',''),120)
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_service_role()
returns boolean language sql stable set search_path=public as $$
  select coalesce(auth.role(),'') = 'service_role';
$$;

create or replace function public.assert_self(p_user_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_service_role() and auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized';
  end if;
end; $$;

create or replace function public.valid_money(p_amount numeric)
returns boolean language sql immutable set search_path=public as $$
  select p_amount is not null
     and p_amount::text not in ('NaN','Infinity','-Infinity')
     and p_amount > 0
     and p_amount <= 1000000000;
$$;

create or replace function public.valid_holdings(p_holdings jsonb)
returns boolean language sql immutable set search_path=public as $$
  select jsonb_typeof(p_holdings)='object'
     and not exists (
       select 1
       from jsonb_each(p_holdings) as h(asset,value)
       where asset not in ('btc','eth','sol','bnb','xrp','ada','avax','dot','matic','doge','shib','trx','ltc','link','uni','ton','near','xlm','sui')
          or case
               when jsonb_typeof(value)='number'
                 then (value::text)::numeric < 0 or (value::text)::numeric > 1000000000000000000
               else true
             end
     );
$$;

alter table public.profiles drop constraint if exists profiles_holdings_supported_values;
alter table public.profiles add constraint profiles_holdings_supported_values
  check (public.valid_holdings(holdings));

-- Cross-field invariants are installed with ALTER TABLE so they also apply when
-- SCHEMA.sql follows the legacy cutover rather than only on a fresh database.
alter table public.investments drop constraint if exists investments_maturity_after_creation;
alter table public.investments add constraint investments_maturity_after_creation
  check (matures_at > created_at);
alter table public.investments drop constraint if exists investments_claimed_has_completion;
alter table public.investments add constraint investments_claimed_has_completion
  check (status <> 'claimed' or completed_at is not null);

alter table public.kyc_documents drop constraint if exists kyc_country_document_pair;
alter table public.kyc_documents add constraint kyc_country_document_pair
  check ((doc_type <> 'nin' or country='NG') and (doc_type <> 'voters_card' or country in ('NG','GH')));
alter table public.kyc_documents drop constraint if exists kyc_front_path_owned;
alter table public.kyc_documents add constraint kyc_front_path_owned
  check (id_front_path ~ ('^'||user_id::text||'/id_front_[0-9]{10,17}\.jpg$'));
alter table public.kyc_documents drop constraint if exists kyc_selfie_path_owned;
alter table public.kyc_documents add constraint kyc_selfie_path_owned
  check (selfie_path ~ ('^'||user_id::text||'/selfie_[0-9]{10,17}\.jpg$'));
alter table public.kyc_documents drop constraint if exists kyc_back_path_owned;
alter table public.kyc_documents add constraint kyc_back_path_owned
  check (id_back_path is null or id_back_path ~ ('^'||user_id::text||'/id_back_[0-9]{10,17}\.jpg$'));

alter table public.deposit_addresses drop constraint if exists deposit_address_nonzero;
alter table public.deposit_addresses add constraint deposit_address_nonzero
  check (lower(address) <> '0x0000000000000000000000000000000000000000');

-- ---------------------------------------------------------------------------
-- 4. LEDGER DERIVATION
-- ---------------------------------------------------------------------------

create or replace function public.derive_spot_balance(p_user_id uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare v_balance numeric;
begin
  perform public.assert_self(p_user_id);
  select coalesce(sum(case
    when type in ('opening_balance','migration_credit','deposit','claim','transfer_in','sell')
         and status in ('completed','approved') then amount
    when type in ('migration_debit','investment','transfer_out','buy')
         and status in ('completed','approved') then -amount
    when type='withdraw' and status in ('pending','approved','completed') then -amount
    else 0 end),0)
  into v_balance
  from public.transactions where user_id=p_user_id;

  if v_balance < 0 then raise exception 'Spot ledger invariant violated'; end if;
  return v_balance;
end; $$;

create or replace function public.derive_vault_cash(p_user_id uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare v_balance numeric;
begin
  perform public.assert_self(p_user_id);
  select coalesce(sum(case
    when type='transfer_out' and status in ('completed','approved') then amount
    when type='transfer_in'  and status in ('completed','approved') then -amount
    else 0 end),0)
  into v_balance
  from public.transactions where user_id=p_user_id;

  if v_balance < 0 then raise exception 'Vault cash ledger invariant violated'; end if;
  return v_balance;
end; $$;

-- Read caches are repaired after any ledger mutation. They are never used as
-- authority inside the mutation RPCs.
create or replace function public.refresh_balance_caches()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_spot numeric; v_vault numeric;
begin
  v_user := case when tg_op='DELETE' then old.user_id else new.user_id end;
  perform set_config('nextrade.bypass_financial_guard','1',true);
  v_spot := public.derive_spot_balance(v_user);
  v_vault := public.derive_vault_cash(v_user);
  update public.profiles
     set spot_balance=v_spot, vault_balance=v_vault, updated_at=now()
   where id=v_user;
  return case when tg_op='DELETE' then old else new end;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. DEFENSE-IN-DEPTH WRITE GUARDS
-- ---------------------------------------------------------------------------

create or replace function public.financial_write_allowed()
returns boolean language sql stable set search_path=public as $$
  select public.is_service_role()
      or coalesce(current_setting('nextrade.bypass_financial_guard',true),'')='1';
$$;

create or replace function public.guard_profile_sensitive_write()
returns trigger language plpgsql set search_path=public as $$
begin
  if public.financial_write_allowed() then return new; end if;
  if new.role is distinct from old.role
     or new.kyc_status is distinct from old.kyc_status
     or new.spot_balance is distinct from old.spot_balance
     or new.vault_balance is distinct from old.vault_balance
     or new.holdings is distinct from old.holdings
     or new.withdrawal_passphrase_hash is distinct from old.withdrawal_passphrase_hash
     or new.withdrawal_failed_attempts is distinct from old.withdrawal_failed_attempts
     or new.withdrawal_locked_until is distinct from old.withdrawal_locked_until
     or new.withdrawal_verified_at is distinct from old.withdrawal_verified_at then
    raise exception 'Protected profile fields are server-managed';
  end if;
  return new;
end; $$;

create or replace function public.guard_server_managed_write()
returns trigger language plpgsql set search_path=public as $$
begin
  if public.financial_write_allowed() then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  raise exception '% is server-managed', tg_table_name;
end; $$;

create or replace function public.guard_transaction_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.user_id is distinct from old.user_id
     or new.type is distinct from old.type
     or new.amount is distinct from old.amount
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Transaction identity and amount are immutable';
  end if;
  return new;
end; $$;

-- updated_at triggers

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles before update on public.profiles
  for each row execute procedure public.set_updated_at();
drop trigger if exists set_updated_at_transactions on public.transactions;
create trigger set_updated_at_transactions before update on public.transactions
  for each row execute procedure public.set_updated_at();
drop trigger if exists set_updated_at_strategies on public.strategies;
create trigger set_updated_at_strategies before update on public.strategies
  for each row execute procedure public.set_updated_at();
drop trigger if exists set_updated_at_investments on public.investments;
create trigger set_updated_at_investments before update on public.investments
  for each row execute procedure public.set_updated_at();
drop trigger if exists set_updated_at_kyc on public.kyc_documents;
create trigger set_updated_at_kyc before update on public.kyc_documents
  for each row execute procedure public.set_updated_at();

drop trigger if exists guard_profile_sensitive_write on public.profiles;
create trigger guard_profile_sensitive_write before update on public.profiles
  for each row execute procedure public.guard_profile_sensitive_write();
drop trigger if exists guard_transactions_server_only on public.transactions;
create trigger guard_transactions_server_only before insert or update or delete on public.transactions
  for each row execute procedure public.guard_server_managed_write();
drop trigger if exists guard_investments_server_only on public.investments;
create trigger guard_investments_server_only before insert or update or delete on public.investments
  for each row execute procedure public.guard_server_managed_write();
drop trigger if exists guard_kyc_documents_server_only on public.kyc_documents;
create trigger guard_kyc_documents_server_only before insert or update or delete on public.kyc_documents
  for each row execute procedure public.guard_server_managed_write();
drop trigger if exists guard_transaction_immutability on public.transactions;
create trigger guard_transaction_immutability before update on public.transactions
  for each row execute procedure public.guard_transaction_immutability();
drop trigger if exists refresh_balance_caches on public.transactions;
create trigger refresh_balance_caches after insert or update or delete on public.transactions
  for each row execute procedure public.refresh_balance_caches();

-- Keep profiles.kyc_status synchronized with the latest admin review.
create or replace function public.sync_kyc_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    perform set_config('nextrade.bypass_financial_guard','1',true);
    update public.profiles set kyc_status=new.status where id=new.user_id;
    new.reviewed_at := coalesce(new.reviewed_at,now());
  end if;
  return new;
end; $$;
drop trigger if exists on_kyc_document_reviewed on public.kyc_documents;
create trigger on_kyc_document_reviewed before update of status on public.kyc_documents
  for each row execute procedure public.sync_kyc_status();

-- ---------------------------------------------------------------------------
-- 6. USER RPCs — ALL MUTATIONS SERIALIZE THE PROFILE ROW
-- ---------------------------------------------------------------------------

create or replace function public.request_deposit(
  p_amount numeric,
  p_description text,
  p_idempotency_key text
)
returns table(tx_id uuid, spot_balance numeric, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_existing public.transactions%rowtype; v_tx public.transactions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.valid_money(p_amount) then raise exception 'Invalid deposit amount'; end if;
  if p_amount < 10 then raise exception 'Minimum deposit is 10'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^deposit:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid deposit idempotency key'; end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_existing from public.transactions
   where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>'deposit' or v_existing.amount<>p_amount
       or v_existing.description<>left(coalesce(p_description,'Deposit request'),500) then
      raise exception 'Idempotency key was already used for a different deposit request';
    end if;
    return query select v_existing.id, public.derive_spot_balance(v_user), v_existing.created_at;
    return;
  end if;

  if not coalesce((select real_deposits_enabled from public.app_settings where singleton),false) then
    raise exception 'Real deposits are disabled for this deployment';
  end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  insert into public.transactions(user_id,type,amount,status,description,idempotency_key)
  values(v_user,'deposit',p_amount,'pending',left(coalesce(p_description,'Deposit request'),500),p_idempotency_key)
  returning * into v_tx;
  return query select v_tx.id, public.derive_spot_balance(v_user), v_tx.created_at;
end; $$;

create or replace function public.transfer_spot_vault(
  p_from text,
  p_amount numeric,
  p_idempotency_key text
)
returns table(tx_id uuid, spot_balance numeric, vault_cash numeric, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_spot numeric; v_vault numeric; v_type text; v_existing public.transactions%rowtype; v_tx public.transactions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_from not in ('spot','vault') then raise exception 'Invalid transfer source'; end if;
  if not public.valid_money(p_amount) then raise exception 'Invalid transfer amount'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^transfer:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid transfer idempotency key'; end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;
  v_type:=case when p_from='spot' then 'transfer_out' else 'transfer_in' end;

  select * into v_existing from public.transactions where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>v_type or v_existing.amount<>p_amount then
      raise exception 'Idempotency key was already used for a different transfer request';
    end if;
    return query select v_existing.id, public.derive_spot_balance(v_user), public.derive_vault_cash(v_user), v_existing.created_at;
    return;
  end if;

  v_spot:=public.derive_spot_balance(v_user); v_vault:=public.derive_vault_cash(v_user);
  if p_from='spot' and p_amount>v_spot then raise exception 'Insufficient Spot balance'; end if;
  if p_from='vault' and p_amount>v_vault then raise exception 'Insufficient Vault cash'; end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  insert into public.transactions(user_id,type,amount,status,description,idempotency_key)
  values(v_user,v_type,p_amount,'completed',case when p_from='spot' then 'Transfer Spot → Vault' else 'Transfer Vault → Spot' end,p_idempotency_key)
  returning * into v_tx;
  return query select v_tx.id, public.derive_spot_balance(v_user), public.derive_vault_cash(v_user), v_tx.created_at;
end; $$;

create or replace function public.create_investment(
  p_strategy_id text,
  p_amount numeric,
  p_idempotency_key text
)
returns table(investment_id uuid, tx_id uuid, spot_balance numeric, vault_cash numeric, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_spot numeric; v_strategy public.strategies%rowtype; v_inv public.investments%rowtype; v_tx public.transactions%rowtype; v_existing public.transactions%rowtype; v_existing_inv uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.valid_money(p_amount) then raise exception 'Invalid investment amount'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^investment:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid investment idempotency key'; end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_existing from public.transactions where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>'investment' or v_existing.amount<>p_amount
       or coalesce(v_existing.metadata->>'strategy_id','')<>p_strategy_id then
      raise exception 'Idempotency key was already used for a different investment request';
    end if;
    v_existing_inv := nullif(v_existing.metadata->>'investment_id','')::uuid;
    if v_existing_inv is null then raise exception 'Stored investment replay metadata is incomplete'; end if;
    return query select v_existing_inv, v_existing.id, public.derive_spot_balance(v_user), public.derive_vault_cash(v_user), v_existing.created_at;
    return;
  end if;

  select * into v_strategy from public.strategies where id=p_strategy_id;
  if not found then raise exception 'Unknown strategy'; end if;
  if p_amount<v_strategy.min_amount then raise exception 'Amount is below strategy minimum'; end if;
  v_spot:=public.derive_spot_balance(v_user);
  if p_amount>v_spot then raise exception 'Insufficient Spot balance'; end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  insert into public.investments(user_id,strategy_id,amount,current_value,apy,duration_days,penalty_rate,perf_fee,matures_at)
  values(v_user,v_strategy.id,p_amount,p_amount,v_strategy.apy,v_strategy.duration_days,v_strategy.penalty_rate,v_strategy.perf_fee,now()+make_interval(days=>v_strategy.duration_days))
  returning * into v_inv;

  insert into public.transactions(user_id,type,amount,status,description,metadata,idempotency_key)
  values(v_user,'investment',p_amount,'completed','Invested in '||v_strategy.name,jsonb_build_object('investment_id',v_inv.id,'strategy_id',v_strategy.id),p_idempotency_key)
  returning * into v_tx;

  return query select v_inv.id,v_tx.id,public.derive_spot_balance(v_user),public.derive_vault_cash(v_user),v_tx.created_at;
end; $$;

create or replace function public.claim_investment(
  p_investment_id uuid,
  p_penalty_confirmed boolean,
  p_idempotency_key text
)
returns table(tx_id uuid, spot_balance numeric, vault_cash numeric, received numeric, performance_fee numeric, penalty numeric, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_inv public.investments%rowtype; v_tx public.transactions%rowtype; v_existing public.transactions%rowtype;
  v_progress numeric; v_gross_profit numeric; v_fee numeric; v_value numeric; v_remaining numeric; v_penalty numeric; v_received numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^claim:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid claim idempotency key'; end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_existing from public.transactions where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>'claim' or coalesce(v_existing.metadata->>'investment_id','')<>p_investment_id::text then
      raise exception 'Idempotency key was already used for a different claim request';
    end if;
    return query select v_existing.id,public.derive_spot_balance(v_user),public.derive_vault_cash(v_user),
      coalesce((v_existing.metadata->>'received')::numeric,v_existing.amount),
      coalesce((v_existing.metadata->>'performance_fee')::numeric,0),
      coalesce((v_existing.metadata->>'penalty')::numeric,0),v_existing.created_at;
    return;
  end if;

  select * into v_inv from public.investments where id=p_investment_id and user_id=v_user for update;
  if not found then raise exception 'Investment not found'; end if;
  if v_inv.status<>'active' then raise exception 'Investment is not active'; end if;

  v_progress:=greatest(0,least(1,extract(epoch from (least(now(),v_inv.matures_at)-v_inv.created_at))/greatest(1,extract(epoch from (v_inv.matures_at-v_inv.created_at)))));
  v_gross_profit:=v_inv.amount*(v_inv.apy/100)*v_progress;
  v_fee:=greatest(v_gross_profit,0)*(v_inv.perf_fee/100);
  v_value:=greatest(0,v_inv.amount+v_gross_profit-v_fee);
  v_remaining:=1-v_progress;
  v_penalty:=case when v_progress<1 then v_value*v_inv.penalty_rate*v_remaining else 0 end;
  if v_progress<1 and not coalesce(p_penalty_confirmed,false) then raise exception 'Early-exit penalty confirmation required'; end if;
  v_received:=greatest(0,v_value-v_penalty);
  if not public.valid_money(v_received) then raise exception 'Invalid claim result'; end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  update public.investments set status='claimed',current_value=v_received,profit=v_received-v_inv.amount,completed_at=now() where id=v_inv.id;
  insert into public.transactions(user_id,type,amount,status,description,metadata,idempotency_key)
  values(v_user,'claim',v_received,'completed','Claimed investment',jsonb_build_object(
    'investment_id',v_inv.id,'received',v_received,'performance_fee',v_fee,'penalty',v_penalty
  ),p_idempotency_key) returning * into v_tx;
  return query select v_tx.id,public.derive_spot_balance(v_user),public.derive_vault_cash(v_user),v_received,v_fee,v_penalty,v_tx.created_at;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. WITHDRAWAL CONFIRMATION + WITHDRAWAL RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_withdrawal_passphrase_status()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select withdrawal_passphrase_hash is not null from public.profiles where id=auth.uid()),false);
$$;

create or replace function public.set_withdrawal_passphrase(p_passphrase text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_user uuid:=auth.uid(); v_phrase text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  v_phrase:=regexp_replace(btrim(coalesce(p_passphrase,'')),'\s+',' ','g');
  if char_length(v_phrase)<8 or char_length(v_phrase)>250 or array_length(regexp_split_to_array(v_phrase,'\s+'),1)<>5 then
    raise exception 'Passphrase must contain exactly 5 words';
  end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if (select withdrawal_passphrase_hash is not null from public.profiles where id=v_user) then
    raise exception 'Withdrawal passphrase is already set';
  end if;
  perform set_config('nextrade.bypass_financial_guard','1',true);
  update public.profiles set
    withdrawal_passphrase_hash=crypt(v_phrase,gen_salt('bf',12)),
    withdrawal_failed_attempts=0,
    withdrawal_locked_until=null,
    withdrawal_verified_at=now()
  where id=v_user;
  return true;
end; $$;

create or replace function public.verify_withdrawal_passphrase(p_passphrase text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare v_user uuid:=auth.uid(); v_profile public.profiles%rowtype; v_phrase text; v_ok boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  v_phrase:=regexp_replace(btrim(coalesce(p_passphrase,'')),'\s+',' ','g');
  if char_length(v_phrase)<8 or char_length(v_phrase)>250 or array_length(regexp_split_to_array(v_phrase,'\s+'),1)<>5 then
    raise exception 'Passphrase must contain exactly 5 words';
  end if;
  select * into v_profile from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.withdrawal_passphrase_hash is null then return false; end if;
  if v_profile.withdrawal_locked_until is not null and v_profile.withdrawal_locked_until>now() then
    raise exception 'Withdrawal confirmation is temporarily locked';
  end if;
  v_ok := v_profile.withdrawal_passphrase_hash=crypt(v_phrase,v_profile.withdrawal_passphrase_hash);
  perform set_config('nextrade.bypass_financial_guard','1',true);
  if v_ok then
    update public.profiles set withdrawal_failed_attempts=0,withdrawal_locked_until=null,withdrawal_verified_at=now() where id=v_user;
    return true;
  end if;
  if v_profile.withdrawal_failed_attempts+1>=5 then
    update public.profiles set withdrawal_failed_attempts=0,withdrawal_locked_until=now()+interval '15 minutes',withdrawal_verified_at=null where id=v_user;
  else
    update public.profiles set withdrawal_failed_attempts=v_profile.withdrawal_failed_attempts+1,withdrawal_verified_at=null where id=v_user;
  end if;
  return false;
end; $$;

create or replace function public.request_withdrawal(
  p_amount numeric,
  p_destination_address text,
  p_idempotency_key text
)
returns table(tx_id uuid, spot_balance numeric, created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_profile public.profiles%rowtype; v_existing public.transactions%rowtype; v_tx public.transactions%rowtype; v_spot numeric; v_address text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.valid_money(p_amount) then raise exception 'Invalid withdrawal amount'; end if;
  if p_amount < 10 then raise exception 'Minimum withdrawal is 10'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^withdraw:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid withdraw idempotency key'; end if;
  v_address:=btrim(coalesce(p_destination_address,''));
  if v_address !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid ERC-20 destination address'; end if;
  if lower(v_address)='0x0000000000000000000000000000000000000000' then raise exception 'Zero address is not a valid withdrawal destination'; end if;

  select * into v_profile from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_existing from public.transactions where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>'withdraw' or v_existing.amount<>p_amount
       or lower(coalesce(v_existing.metadata->>'destination_address',''))<>lower(v_address) then
      raise exception 'Idempotency key was already used for a different withdrawal request';
    end if;
    return query select v_existing.id,public.derive_spot_balance(v_user),v_existing.created_at;
    return;
  end if;

  if not coalesce((select real_withdrawals_enabled from public.app_settings where singleton),false) then
    raise exception 'Real withdrawals are disabled for this deployment';
  end if;
  if v_profile.kyc_status<>'approved' then raise exception 'Approved KYC is required'; end if;
  if v_profile.withdrawal_verified_at is null or v_profile.withdrawal_verified_at < now()-interval '2 minutes' then
    raise exception 'Withdrawal confirmation expired; verify your 5 words again';
  end if;
  if v_profile.withdrawal_locked_until is not null and v_profile.withdrawal_locked_until>now() then raise exception 'Withdrawal confirmation is locked'; end if;

  v_spot:=public.derive_spot_balance(v_user);
  if p_amount>v_spot then raise exception 'Insufficient Spot balance'; end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  -- Consume the recent passphrase authorization in the same serialized transaction.
  update public.profiles set withdrawal_verified_at=null where id=v_user;
  insert into public.transactions(user_id,type,amount,status,description,metadata,idempotency_key)
  values(v_user,'withdraw',p_amount,'pending','Withdrawal request',jsonb_build_object('destination_address',v_address,'network','ERC20'),p_idempotency_key)
  returning * into v_tx;
  return query select v_tx.id,public.derive_spot_balance(v_user),v_tx.created_at;
end; $$;

-- ---------------------------------------------------------------------------
-- 8. KYC SUBMISSION RPC
-- ---------------------------------------------------------------------------

create or replace function public.submit_kyc(
  p_full_name text,
  p_dob date,
  p_country text,
  p_doc_type text,
  p_id_front_path text,
  p_id_back_path text,
  p_selfie_path text
)
returns table(submission_id uuid, kyc_status text)
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_path_re text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_full_name,''))) not between 2 and 120 then raise exception 'Invalid legal name'; end if;
  if p_dob is null or p_dob>current_date-interval '18 years' or p_dob<current_date-interval '120 years' then raise exception 'Applicant must be an adult with a valid date of birth'; end if;
  if p_country not in ('NG','GH','KE','ZA','US','GB','CA','AU','DE','FR','AE','SG','OTHER') then raise exception 'Unsupported country'; end if;
  if p_doc_type not in ('passport','nin','drivers_license','voters_card','residence_permit') then raise exception 'Unsupported document type'; end if;
  if p_doc_type='nin' and p_country<>'NG' then raise exception 'NIN is only accepted for Nigeria'; end if;
  if p_doc_type='voters_card' and p_country not in ('NG','GH') then raise exception 'Voter card is not accepted for this country'; end if;

  v_path_re:='^'||v_user::text||'/(id_front|id_back|selfie)_[0-9]{10,17}\.jpg$';
  if coalesce(p_id_front_path,'') !~ v_path_re or coalesce(p_selfie_path,'') !~ v_path_re then raise exception 'Invalid KYC storage path'; end if;
  if p_id_front_path !~ ('^'||v_user::text||'/id_front_') then raise exception 'Invalid ID-front path'; end if;
  if p_selfie_path !~ ('^'||v_user::text||'/selfie_') then raise exception 'Invalid selfie path'; end if;
  if p_id_back_path is not null and (p_id_back_path !~ v_path_re or p_id_back_path !~ ('^'||v_user::text||'/id_back_')) then raise exception 'Invalid ID-back path'; end if;

  -- Paths alone are not evidence that an upload exists. Verify every submitted
  -- object is present in the private KYC bucket before accepting the record.
  if not exists(select 1 from storage.objects where bucket_id='kyc-docs' and name=p_id_front_path) then
    raise exception 'ID-front upload not found';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='kyc-docs' and name=p_selfie_path) then
    raise exception 'Selfie upload not found';
  end if;
  if p_id_back_path is not null and not exists(select 1 from storage.objects where bucket_id='kyc-docs' and name=p_id_back_path) then
    raise exception 'ID-back upload not found';
  end if;

  -- Serialize submissions on the profile row before checking the partial unique
  -- invariant. This gives a clean domain error instead of relying on a race to
  -- reach the unique-index violation.
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if exists(select 1 from public.kyc_documents where user_id=v_user and status='pending') then raise exception 'A KYC submission is already pending'; end if;
  perform set_config('nextrade.bypass_financial_guard','1',true);
  insert into public.kyc_documents(user_id,full_name,dob,country,doc_type,id_front_path,id_back_path,selfie_path,status)
  values(v_user,btrim(p_full_name),p_dob,p_country,p_doc_type,p_id_front_path,p_id_back_path,p_selfie_path,'pending')
  returning id into v_id;
  update public.profiles set kyc_status='pending' where id=v_user;
  return query select v_id,'pending'::text;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. SERVICE-ONLY TRADE + DEPOSIT ADDRESS RPCs
-- ---------------------------------------------------------------------------

create or replace function public.execute_trade(
  p_user_id uuid,
  p_side text,
  p_asset text,
  p_amount numeric,
  p_price numeric,
  p_idempotency_key text
)
returns table(tx_id uuid, spot_balance numeric, holdings jsonb, executed_price numeric, executed_usd_amount numeric, asset_quantity numeric)
language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles%rowtype; v_existing public.transactions%rowtype; v_tx public.transactions%rowtype; v_spot numeric; v_qty numeric; v_usd numeric; v_held numeric; v_holdings jsonb;
begin
  if not public.is_service_role() then raise exception 'Service role required'; end if;
  if p_user_id is null then raise exception 'User required'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid side'; end if;
  if p_asset not in ('btc','eth','sol','bnb','xrp','ada','avax','dot','matic','doge','shib','trx','ltc','link','uni','ton','near','xlm','sui') then raise exception 'Unsupported asset'; end if;
  if not public.valid_money(p_amount) or not public.valid_money(p_price) then raise exception 'Invalid trade amount or price'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^trade:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid trade idempotency key'; end if;

  select * into v_profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_holdings:=coalesce(v_profile.holdings,'{}'::jsonb);

  select * into v_existing from public.transactions where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.type<>p_side or coalesce(v_existing.metadata->>'asset','')<>p_asset
       or coalesce((v_existing.metadata->>'requested_amount')::numeric,-1)<>p_amount then
      raise exception 'Idempotency key was already used for a different trade request';
    end if;
    return query select v_existing.id,public.derive_spot_balance(p_user_id),v_holdings,
      coalesce((v_existing.metadata->>'executed_price')::numeric,p_price),v_existing.amount,
      coalesce((v_existing.metadata->>'asset_quantity')::numeric,0);
    return;
  end if;

  v_spot:=public.derive_spot_balance(p_user_id);
  v_held:=coalesce((v_holdings->>p_asset)::numeric,0);
  if p_side='buy' then
    v_usd:=p_amount; v_qty:=p_amount/p_price;
    if v_usd>v_spot then raise exception 'Insufficient Spot balance'; end if;
    v_holdings:=jsonb_set(v_holdings,array[p_asset],to_jsonb(v_held+v_qty),true);
  else
    v_qty:=p_amount; v_usd:=p_amount*p_price;
    if v_qty>v_held then raise exception 'Insufficient asset holding'; end if;
    v_holdings:=jsonb_set(v_holdings,array[p_asset],to_jsonb(greatest(0,v_held-v_qty)),true);
  end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);
  update public.profiles set holdings=v_holdings where id=p_user_id;
  insert into public.transactions(user_id,type,amount,status,description,metadata,idempotency_key)
  values(p_user_id,p_side,v_usd,'completed',upper(p_side)||' '||upper(p_asset),jsonb_build_object(
    'asset',p_asset,'asset_quantity',v_qty,'executed_price',p_price,'executed_usd_amount',v_usd,
    'requested_amount',p_amount,'requested_side',p_side
  ),p_idempotency_key) returning * into v_tx;
  return query select v_tx.id,public.derive_spot_balance(p_user_id),v_holdings,p_price,v_usd,v_qty;
end; $$;

create or replace function public.next_deposit_address_index()
returns bigint language plpgsql security definer set search_path=public as $$
begin
  if not public.is_service_role() then raise exception 'Service role required'; end if;
  if not coalesce((select real_deposits_enabled from public.app_settings where singleton),false) then
    raise exception 'Real deposits are disabled for this deployment';
  end if;
  return nextval('public.deposit_address_derivation_seq');
end; $$;

-- ---------------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.strategies enable row level security;
alter table public.investments enable row level security;
alter table public.kyc_documents enable row level security;
alter table public.deposit_addresses enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions for select to authenticated using (user_id=auth.uid());
drop policy if exists investments_select_own on public.investments;
create policy investments_select_own on public.investments for select to authenticated using (user_id=auth.uid());
drop policy if exists strategies_select on public.strategies;
create policy strategies_select on public.strategies for select to authenticated using (true);
-- KYC documents and deposit-address rows intentionally have no authenticated
-- SELECT/UPDATE/DELETE policy. Their sensitive details stay service-side.

-- Private KYC object bucket. Authenticated users may only insert into their own
-- UID folder; they cannot read, overwrite or delete evidence from the browser.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kyc-docs','kyc-docs',false,5242880,array['image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "kyc-docs: user uploads own" on storage.objects;
drop policy if exists kyc_docs_insert_own_folder on storage.objects;
create policy kyc_docs_insert_own_folder on storage.objects for insert to authenticated
with check (
  bucket_id='kyc-docs'
  and (storage.foldername(name))[1]=auth.uid()::text
  and name ~ ('^'||auth.uid()::text||'/(id_front|id_back|selfie)_[0-9]{10,17}\.jpg$')
);

-- ---------------------------------------------------------------------------
-- 11. PRIVILEGES
-- ---------------------------------------------------------------------------

revoke all on public.profiles,public.transactions,public.strategies,public.investments,public.kyc_documents,public.deposit_addresses,public.app_settings from anon,authenticated;

-- Trusted backend endpoints need PostgreSQL table privileges in addition to
-- service_role's RLS bypass. Browser roles remain restricted.
grant select,insert,update
  on public.profiles,public.transactions
  to service_role;

-- Expose only the profile fields the browser needs. Withdrawal passphrase
-- hashes, lock counters and verification timestamps never leave Postgres.
grant select (id,email,full_name,avatar_url,role,kyc_status,holdings,created_at,updated_at)
  on public.profiles to authenticated;
grant select (id,user_id,type,amount,status,description,metadata,created_at,updated_at)
  on public.transactions to authenticated;
grant select on public.investments,public.strategies to authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke that
-- default explicitly, then grant only the intended API surface.
revoke all on function public.set_updated_at() from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.is_service_role() from public,anon,authenticated;
revoke all on function public.assert_self(uuid) from public,anon,authenticated;
revoke all on function public.valid_money(numeric) from public,anon,authenticated;
revoke all on function public.valid_holdings(jsonb) from public,anon,authenticated;
revoke all on function public.refresh_balance_caches() from public,anon,authenticated;
revoke all on function public.financial_write_allowed() from public,anon,authenticated;
revoke all on function public.guard_profile_sensitive_write() from public,anon,authenticated;
revoke all on function public.guard_server_managed_write() from public,anon,authenticated;
revoke all on function public.guard_transaction_immutability() from public,anon,authenticated;
revoke all on function public.sync_kyc_status() from public,anon,authenticated;

-- Direct service-role writes need these helpers for constraints/write guards.
grant execute on function public.is_service_role()
  to service_role;
grant execute on function public.valid_holdings(jsonb)
  to service_role;
grant execute on function public.financial_write_allowed()
  to service_role;

revoke all on function public.derive_spot_balance(uuid) from public,anon,authenticated;
revoke all on function public.derive_vault_cash(uuid) from public,anon,authenticated;
grant execute on function public.derive_spot_balance(uuid) to authenticated,service_role;
grant execute on function public.derive_vault_cash(uuid) to authenticated,service_role;

revoke all on function public.request_deposit(numeric,text,text) from public,anon,authenticated;
revoke all on function public.request_withdrawal(numeric,text,text) from public,anon,authenticated;
revoke all on function public.transfer_spot_vault(text,numeric,text) from public,anon,authenticated;
revoke all on function public.create_investment(text,numeric,text) from public,anon,authenticated;
revoke all on function public.claim_investment(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.submit_kyc(text,date,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_withdrawal_passphrase_status() from public,anon,authenticated;
revoke all on function public.set_withdrawal_passphrase(text) from public,anon,authenticated;
revoke all on function public.verify_withdrawal_passphrase(text) from public,anon,authenticated;

grant execute on function public.request_deposit(numeric,text,text) to authenticated;
grant execute on function public.request_withdrawal(numeric,text,text) to authenticated;
grant execute on function public.transfer_spot_vault(text,numeric,text) to authenticated;
grant execute on function public.create_investment(text,numeric,text) to authenticated;
grant execute on function public.claim_investment(uuid,boolean,text) to authenticated;
grant execute on function public.submit_kyc(text,date,text,text,text,text,text) to authenticated;
grant execute on function public.get_withdrawal_passphrase_status() to authenticated;
grant execute on function public.set_withdrawal_passphrase(text) to authenticated;
grant execute on function public.verify_withdrawal_passphrase(text) to authenticated;

comment on column public.strategies.apy is
  'Legacy field name retained for compatibility. Value is the gross target return percentage for one strategy cycle, NOT annual percentage yield.';
comment on column public.investments.apy is
  'Immutable snapshot of the strategy gross target return percentage for this position cycle; NOT annualized APY.';

revoke all on function public.execute_trade(uuid,text,text,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.next_deposit_address_index() from public,anon,authenticated;
grant execute on function public.execute_trade(uuid,text,text,numeric,numeric,text) to service_role;
grant execute on function public.next_deposit_address_index() to service_role;
commit;
