-- Phase 0: 기본 스키마 + RLS
-- 원칙: 월드 데이터(층/재료/손님)는 읽기 전용, 유저 데이터는 RPC(security definer)로만 쓴다.

-- ───────── 월드 데이터 ─────────
create table public.dungeon_floors (
  id               serial primary key,
  floor_no         smallint not null unique check (floor_no > 0),
  name             text not null,
  description      text not null default '',
  duration_seconds integer not null check (duration_seconds > 0), -- 채집 파견 소요 시간
  danger_level     smallint not null check (danger_level between 1 and 5),
  created_at       timestamptz not null default now()
);

create table public.ingredients (
  id          serial primary key,
  code        text not null unique,
  name        text not null,
  icon        text not null default 'package', -- lucide 아이콘 이름
  rarity      text not null check (rarity in ('common', 'rare', 'legendary')),
  heat        smallint not null check (heat   between 0 and 10), -- 열기
  umami       smallint not null check (umami  between 0 and 10), -- 감칠맛
  sweet       smallint not null check (sweet  between 0 and 10), -- 단맛
  mana        smallint not null check (mana   between 0 and 10), -- 마력
  toxin       smallint not null check (toxin  between 0 and 10), -- 독성
  description text not null default ''
);

-- 재료 출현 층 (채집 드랍 테이블의 기반, weight = 상대 확률)
create table public.floor_ingredients (
  floor_id      integer not null references public.dungeon_floors(id) on delete cascade,
  ingredient_id integer not null references public.ingredients(id) on delete cascade,
  weight        integer not null default 10 check (weight > 0),
  primary key (floor_id, ingredient_id)
);

create table public.customer_types (
  id           serial primary key,
  code         text not null unique,
  name         text not null,
  race         text not null,
  job          text not null,
  icon         text not null default 'user',
  -- 선호 속성 가중치 (-10 ~ 10, 음수는 기피)
  pref_heat    smallint not null default 0 check (pref_heat  between -10 and 10),
  pref_umami   smallint not null default 0 check (pref_umami between -10 and 10),
  pref_sweet   smallint not null default 0 check (pref_sweet between -10 and 10),
  pref_mana    smallint not null default 0 check (pref_mana  between -10 and 10),
  pref_toxin   smallint not null default 0 check (pref_toxin between -10 and 10),
  budget_min   integer not null check (budget_min >= 0),
  budget_max   integer not null check (budget_max >= budget_min),
  spawn_weight integer not null default 10 check (spawn_weight > 0)
);

-- ───────── 유저 데이터 ─────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null unique check (char_length(nickname) between 2 and 12),
  gold       integer not null default 100 check (gold >= 0),
  reputation integer not null default 0,
  created_at timestamptz not null default now()
);

-- shop_type 으로 직업 구분: 이후 'merchant' 등은 check 만 확장하면 된다.
create table public.shops (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  shop_type  text not null default 'food_stall' check (shop_type in ('food_stall')),
  name       text not null check (char_length(name) between 2 and 20),
  floor_id   integer not null references public.dungeon_floors(id),
  created_at timestamptz not null default now(),
  unique (owner_id, shop_type)
);

create table public.user_ingredients (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  ingredient_id integer not null references public.ingredients(id),
  quantity      integer not null default 0 check (quantity >= 0),
  primary key (user_id, ingredient_id)
);

-- ───────── RLS (모든 테이블) ─────────
alter table public.dungeon_floors    enable row level security;
alter table public.ingredients       enable row level security;
alter table public.floor_ingredients enable row level security;
alter table public.customer_types    enable row level security;
alter table public.profiles          enable row level security;
alter table public.shops             enable row level security;
alter table public.user_ingredients  enable row level security;

-- 월드 데이터: 로그인 유저 읽기 전용 (쓰기 정책 없음 = 거부)
create policy "world read" on public.dungeon_floors    for select to authenticated using (true);
create policy "world read" on public.ingredients       for select to authenticated using (true);
create policy "world read" on public.floor_ingredients for select to authenticated using (true);
create policy "world read" on public.customer_types    for select to authenticated using (true);

-- 유저 데이터: 본인 행만 읽기. 쓰기는 RPC 전용이므로 insert/update/delete 정책 없음.
create policy "own profile read"     on public.profiles         for select to authenticated using (id = auth.uid());
create policy "own shop read"        on public.shops            for select to authenticated using (owner_id = auth.uid());
create policy "own ingredients read" on public.user_ingredients for select to authenticated using (user_id = auth.uid());

-- 테이블 권한도 최소화: 클라이언트 롤은 select 만
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- ───────── RPC: 요리사 등록 ─────────
create or replace function public.register_cook(p_nickname text, p_shop_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_floor integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'already_registered';
  end if;

  p_nickname  := btrim(p_nickname);
  p_shop_name := btrim(p_shop_name);
  if char_length(p_nickname) not between 2 and 12 then
    raise exception 'invalid_nickname';
  end if;
  if char_length(p_shop_name) not between 2 and 20 then
    raise exception 'invalid_shop_name';
  end if;

  select id into v_floor from dungeon_floors order by floor_no limit 1;

  begin
    insert into profiles (id, nickname) values (v_uid, p_nickname);
  exception when unique_violation then
    raise exception 'nickname_taken';
  end;

  insert into shops (owner_id, shop_type, name, floor_id)
  values (v_uid, 'food_stall', p_shop_name, v_floor);
end;
$$;

revoke all on function public.register_cook(text, text) from public, anon;
grant execute on function public.register_cook(text, text) to authenticated;
