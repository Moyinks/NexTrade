-- NexTrade — Sepolia deposit smoke-test adapter
-- TESTNET ONLY. This file is intentionally separate from the canonical schema.
-- Run it only while validating the deposit lifecycle on a preview deployment.

begin;

create table if not exists public.testnet_deposit_proofs (
  tx_hash         text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_id  uuid not null unique references public.transactions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  chain_id        bigint not null check (chain_id = 11155111),
  sender          text not null check (sender ~ '^0x[0-9a-fA-F]{40}$'),
  recipient       text not null check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  value_wei       numeric(78,0) not null check (value_wei > 0),
  block_number    bigint not null check (block_number >= 0),
  confirmed_at    timestamptz not null default now()
);

alter table public.testnet_deposit_proofs enable row level security;
revoke all on public.testnet_deposit_proofs from anon, authenticated;

create or replace function public.confirm_sepolia_test_deposit(
  p_user_id uuid,
  p_transaction_id uuid,
  p_tx_hash text,
  p_sender text,
  p_recipient text,
  p_value_wei numeric,
  p_block_number bigint
)
returns table(tx_id uuid, spot_balance numeric, approved_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx public.transactions%rowtype;
  v_existing public.testnet_deposit_proofs%rowtype;
  v_hash text := lower(coalesce(p_tx_hash,''));
  v_now timestamptz := now();
begin
  if not public.is_service_role() then raise exception 'Service role required'; end if;
  if p_user_id is null or p_transaction_id is null then raise exception 'Invalid deposit identity'; end if;
  if v_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'Invalid Sepolia transaction hash'; end if;
  if p_sender !~ '^0x[0-9a-fA-F]{40}$' or p_recipient !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Invalid Ethereum address';
  end if;
  if p_value_wei is null or p_value_wei <= 0 then raise exception 'Invalid testnet transfer value'; end if;
  if p_block_number is null or p_block_number < 0 then raise exception 'Invalid block number'; end if;

  select * into v_tx
  from public.transactions
  where id=p_transaction_id
  for update;

  if not found then raise exception 'Deposit transaction not found'; end if;
  if v_tx.user_id is distinct from p_user_id then raise exception 'Deposit does not belong to user'; end if;
  if v_tx.type <> 'deposit' then raise exception 'Transaction is not a deposit'; end if;

  select * into v_existing
  from public.testnet_deposit_proofs
  where transaction_id=p_transaction_id;

  if found then
    if v_existing.tx_hash <> v_hash then
      raise exception 'Deposit transaction already has a different proof';
    end if;
    return query select v_tx.id, public.derive_spot_balance(p_user_id), v_existing.confirmed_at;
    return;
  end if;

  if exists(select 1 from public.testnet_deposit_proofs where tx_hash=v_hash) then
    raise exception 'Sepolia transaction hash was already used';
  end if;

  if v_tx.status <> 'pending' then raise exception 'Deposit is not pending'; end if;

  perform set_config('nextrade.bypass_financial_guard','1',true);

  insert into public.testnet_deposit_proofs(
    tx_hash, transaction_id, user_id, chain_id,
    sender, recipient, value_wei, block_number, confirmed_at
  ) values (
    v_hash, p_transaction_id, p_user_id, 11155111,
    p_sender, p_recipient, p_value_wei, p_block_number, v_now
  );

  update public.transactions
     set status='approved',
         metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
           'testnet', true,
           'chain_id', 11155111,
           'sepolia_tx_hash', v_hash,
           'sepolia_sender', lower(p_sender),
           'sepolia_recipient', lower(p_recipient),
           'sepolia_value_wei', p_value_wei::text,
           'sepolia_block_number', p_block_number
         )
   where id=p_transaction_id;

  return query select p_transaction_id, public.derive_spot_balance(p_user_id), v_now;
end;
$$;

revoke all on function public.confirm_sepolia_test_deposit(uuid,uuid,text,text,text,numeric,bigint)
  from public, anon, authenticated;
grant execute on function public.confirm_sepolia_test_deposit(uuid,uuid,text,text,text,numeric,bigint)
  to service_role;

commit;
