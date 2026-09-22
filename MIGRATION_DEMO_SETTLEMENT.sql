begin;

alter table public.app_settings
  add column if not exists demo_deposits_enabled boolean not null default true;

update public.app_settings
set demo_deposits_enabled=true,
    real_deposits_enabled=false,
    real_withdrawals_enabled=false
where singleton=true;

create table if not exists public.deposit_review_requests (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requester_email text,
  amount numeric(30,8) not null check (amount>=10 and amount<=100000),
  rail text not null check (rail in ('ETH_ERC20','USDT_TRC20','BTC')),
  deposit_reference text not null unique check (deposit_reference ~ '^NXT-[A-F0-9]{8}-[A-Z0-9]{4,20}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approve boolean not null default false,
  decline boolean not null default false,
  decline_reason text check (decline_reason is null or char_length(decline_reason)<=300),
  reviewed_by text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint deposit_review_single_decision check (not (approve and decline)),
  constraint deposit_review_decision_consistent check (
    (status='pending' and not approve and not decline) or
    (status='approved' and approve and not decline) or
    (status='rejected' and decline and not approve)
  )
);

create unique index if not exists deposit_review_one_pending_per_user
  on public.deposit_review_requests(user_id) where status='pending';
create index if not exists deposit_review_pending_idx
  on public.deposit_review_requests(status,submitted_at desc);
create index if not exists deposit_review_user_idx
  on public.deposit_review_requests(user_id,submitted_at desc);

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists admin_push_subscriptions_active_idx
  on public.admin_push_subscriptions(active,user_id);

alter table public.deposit_review_requests enable row level security;
alter table public.admin_push_subscriptions enable row level security;
revoke all on public.deposit_review_requests from public,anon,authenticated;
revoke all on public.admin_push_subscriptions from public,anon,authenticated;
grant select,insert,update on public.deposit_review_requests to service_role;
grant select,insert,update,delete on public.admin_push_subscriptions to service_role;

create or replace function public.assert_self(p_user_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_service_role()
     and coalesce(current_setting('nextrade.bypass_financial_guard',true),'') <> '1'
     and auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized';
  end if;
end; $$;
revoke all on function public.assert_self(uuid) from public,anon,authenticated;

create or replace function public.process_demo_deposit_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_now timestamptz:=now();
begin
  if new.transaction_id is distinct from old.transaction_id
     or new.user_id is distinct from old.user_id
     or new.requester_email is distinct from old.requester_email
     or new.amount is distinct from old.amount
     or new.rail is distinct from old.rail
     or new.deposit_reference is distinct from old.deposit_reference
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Review request identity fields are immutable';
  end if;
  if old.status<>'pending' then
    if new.approve is distinct from old.approve or new.decline is distinct from old.decline or new.status is distinct from old.status then
      raise exception 'Review decision is immutable once completed';
    end if;
    new.updated_at:=v_now; return new;
  end if;
  if new.approve and new.decline then raise exception 'Choose either approve or decline, not both'; end if;
  if new.approve and not old.approve then
    perform set_config('nextrade.bypass_financial_guard','1',true);
    update public.transactions
       set status='approved',
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('review_status','approved','reviewed_at',v_now),
           updated_at=v_now
     where id=old.transaction_id and user_id=old.user_id and type='deposit' and status='pending'
       and metadata->>'manual_deposit_test'='true' and metadata->>'test_only'='true';
    if not found then raise exception 'Linked pending demo deposit is unavailable'; end if;
    new.status:='approved'; new.approve:=true; new.decline:=false; new.reviewed_at:=v_now;
    new.reviewed_by:=coalesce(nullif(new.reviewed_by,''),current_user);
  elsif new.decline and not old.decline then
    perform set_config('nextrade.bypass_financial_guard','1',true);
    update public.transactions
       set status='rejected',
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('review_status','rejected','reviewed_at',v_now,'decline_reason',coalesce(new.decline_reason,'')),
           updated_at=v_now
     where id=old.transaction_id and user_id=old.user_id and type='deposit' and status='pending'
       and metadata->>'manual_deposit_test'='true' and metadata->>'test_only'='true';
    if not found then raise exception 'Linked pending demo deposit is unavailable'; end if;
    new.status:='rejected'; new.approve:=false; new.decline:=true; new.reviewed_at:=v_now;
    new.reviewed_by:=coalesce(nullif(new.reviewed_by,''),current_user);
  elsif new.status is distinct from old.status then
    raise exception 'Use the approve or decline switch to review this request';
  end if;
  new.updated_at:=v_now; return new;
end; $$;

drop trigger if exists process_demo_deposit_review on public.deposit_review_requests;
create trigger process_demo_deposit_review before update on public.deposit_review_requests
for each row execute procedure public.process_demo_deposit_review();

drop trigger if exists set_updated_at_admin_push on public.admin_push_subscriptions;
create trigger set_updated_at_admin_push before update on public.admin_push_subscriptions
for each row execute procedure public.set_updated_at();

create or replace function public.create_demo_deposit_request(
  p_user_id uuid,p_amount numeric,p_deposit_reference text,p_rail text,p_idempotency_key text
)
returns table(tx_id uuid,review_id uuid,tx_status text,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare
  v_tx public.transactions%rowtype;
  v_review public.deposit_review_requests%rowtype;
  v_email text; v_label text; v_recent_count integer;
begin
  if not public.is_service_role() then raise exception 'Service role required'; end if;
  if not coalesce((select demo_deposits_enabled from public.app_settings where singleton),false) then raise exception 'Demo deposits are disabled'; end if;
  if coalesce((select real_deposits_enabled from public.app_settings where singleton),false) then raise exception 'Demo deposit mode requires real deposits to remain disabled'; end if;
  if p_user_id is null then raise exception 'User is required'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<10 or p_amount>100000 then raise exception 'Demo amount must be between 10 and 100000'; end if;
  if p_deposit_reference is null or p_deposit_reference !~ '^NXT-[A-F0-9]{8}-[A-Z0-9]{4,20}$' then raise exception 'Invalid deposit reference'; end if;
  if p_rail not in ('ETH_ERC20','USDT_TRC20','BTC') then raise exception 'Invalid demo rail'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^deposit:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then raise exception 'Invalid deposit idempotency key'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select email into v_email from auth.users where id=p_user_id;
  v_label:=case p_rail when 'ETH_ERC20' then 'ETH / USDT (ERC-20)' when 'USDT_TRC20' then 'USDT (TRC-20)' when 'BTC' then 'Bitcoin (BTC)' end;
  select * into v_tx from public.transactions where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_tx.type<>'deposit' or v_tx.amount<>p_amount or v_tx.metadata->>'manual_deposit_test'<>'true' or v_tx.metadata->>'deposit_reference'<>p_deposit_reference or v_tx.metadata->>'rail'<>p_rail then raise exception 'Idempotency key conflict'; end if;
    select * into v_review from public.deposit_review_requests where transaction_id=v_tx.id;
    if not found then
      insert into public.deposit_review_requests(transaction_id,user_id,requester_email,amount,rail,deposit_reference,status,approve,decline,submitted_at)
      values(v_tx.id,p_user_id,v_email,v_tx.amount,p_rail,p_deposit_reference,
        case when v_tx.status in ('approved','completed') then 'approved' when v_tx.status in ('rejected','failed','cancelled') then 'rejected' else 'pending' end,
        v_tx.status in ('approved','completed'),v_tx.status in ('rejected','failed','cancelled'),v_tx.created_at)
      returning * into v_review;
    end if;
    return query select v_tx.id,v_review.id,v_tx.status,v_tx.created_at; return;
  end if;
  if exists(select 1 from public.deposit_review_requests where user_id=p_user_id and status='pending') then raise exception 'A demo deposit is already awaiting review'; end if;
  select count(*)::integer into v_recent_count from public.deposit_review_requests where user_id=p_user_id and submitted_at>=now()-interval '24 hours';
  if v_recent_count>=5 then raise exception 'Demo deposit limit reached for the last 24 hours'; end if;
  perform set_config('nextrade.bypass_financial_guard','1',true);
  insert into public.transactions(user_id,type,amount,status,description,metadata,idempotency_key)
  values(p_user_id,'deposit',p_amount,'pending','Demo deposit ('||v_label||') — Ref: '||p_deposit_reference,
    jsonb_build_object('manual_deposit_test',true,'test_only',true,'demo_deposit',true,'deposit_reference',p_deposit_reference,'rail',p_rail),p_idempotency_key)
  returning * into v_tx;
  insert into public.deposit_review_requests(transaction_id,user_id,requester_email,amount,rail,deposit_reference,submitted_at)
  values(v_tx.id,p_user_id,v_email,p_amount,p_rail,p_deposit_reference,v_tx.created_at) returning * into v_review;
  return query select v_tx.id,v_review.id,v_tx.status,v_tx.created_at;
end; $$;

revoke all on function public.create_demo_deposit_request(uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.create_demo_deposit_request(uuid,numeric,text,text,text) to service_role;
revoke all on function public.process_demo_deposit_review() from public,anon,authenticated;
grant execute on function public.process_demo_deposit_review() to service_role;

insert into public.deposit_review_requests(transaction_id,user_id,requester_email,amount,rail,deposit_reference,status,approve,decline,submitted_at)
select t.id,t.user_id,u.email,t.amount,coalesce(t.metadata->>'rail','ETH_ERC20'),t.metadata->>'deposit_reference',
  case when t.status in ('approved','completed') then 'approved' when t.status in ('rejected','failed','cancelled') then 'rejected' else 'pending' end,
  t.status in ('approved','completed'),t.status in ('rejected','failed','cancelled'),t.created_at
from public.transactions t join auth.users u on u.id=t.user_id
where t.type='deposit' and t.metadata->>'manual_deposit_test'='true' and t.metadata->>'test_only'='true' and t.metadata ? 'deposit_reference'
on conflict(transaction_id) do nothing;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='transactions') then
    execute 'alter publication supabase_realtime add table public.transactions';
  end if;
end $$;

commit;
