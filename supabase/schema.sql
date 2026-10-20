-- =====================================================================
-- くらしの献立帖  データベース定義（Supabase / PostgreSQL 15+）
--
-- 使い方: Supabase の SQL Editor にこのファイルの中身をすべて貼り付けて
--         「Run」を押してください。何度実行しても壊れないように書いてあります。
--
-- 考え方
--  - データはすべて「スペース」に属します。
--      personal … 自分だけのスペース（ログインすると自動で1つ作られる）
--      shared   … ふたりのスペース（招待コードで相手が参加する）
--  - スペースのメンバーだけが、そのスペースのデータを読み書きできます。
--    これは Row Level Security（RLS）でサーバー側が強制します。
--  - 個人スペースのデータが勝手に共有されることはありません。
--    共有したいものは、アプリから「ふたりのスペースへコピー」したものだけです。
--  - すべての行に created_by / updated_by / created_at / updated_at が自動で入ります。
-- =====================================================================

-- ---------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  color        text not null default 'rose' check (color in ('rose','sky','sage','apricot','lavender')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('personal','shared')),
  name       text not null check (char_length(name) between 1 and 40),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists spaces_one_personal_per_user on public.spaces(owner_id) where kind = 'personal';

create table if not exists public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members(user_id);

create table if not exists public.space_invites (
  code       text primary key,
  space_id   uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz
);

create table if not exists public.recipes (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  category    text not null default 'その他' check (category in ('主菜','副菜','汁物','鍋','麺類','お菓子','その他')),
  ingredients jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredients) = 'array'),
  servings    int check (servings between 1 and 99),
  steps       text not null default '' check (char_length(steps) <= 20000),
  url         text not null default '' check (url = '' or url ~* '^https?://'),
  memo        text not null default '' check (char_length(memo) <= 5000),
  favorite    boolean not null default false,
  made        boolean not null default false,
  made_dates  jsonb not null default '[]'::jsonb check (jsonb_typeof(made_dates) = 'array'),
  thumb       text not null default '' check (char_length(thumb) <= 60000),
  has_photo   boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, space_id)
);
create index if not exists recipes_space_idx on public.recipes(space_id);

create table if not exists public.recipe_photos (
  recipe_id  uuid primary key,
  space_id   uuid not null,
  data       text not null check (char_length(data) <= 400000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (recipe_id, space_id) references public.recipes(id, space_id) on delete cascade
);

create table if not exists public.meal_items (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  date       date not null,
  slot       text not null check (slot in ('main','side','soup','other')),
  name       text not null check (char_length(name) between 1 and 200),
  recipe_id  uuid,
  position   double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 献立とレシピは同じスペースのものだけ紐づけられる。レシピを消すと紐づけだけ外れる
  foreign key (recipe_id, space_id) references public.recipes(id, space_id) on delete set null (recipe_id)
);
create index if not exists meal_items_space_date_idx on public.meal_items(space_id, date);

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('shift','plan')),
  type       text not null,
  title      text not null default '' check (char_length(title) <= 100),
  start_time text not null default '' check (start_time = '' or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time   text not null default '' check (end_time = '' or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  memo       text not null default '' check (char_length(memo) <= 1000),
  -- だれの予定か（null = ふたりの予定）
  person_id  uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'shift' and type in ('day','evening','night','off','other'))
      or (kind = 'plan'  and type in ('out','shopping','chores','custom')))
);
create index if not exists events_space_date_idx on public.events(space_id, date);

create table if not exists public.shopping_items (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  qty        text not null default '' check (char_length(qty) <= 40),
  unit       text not null default '' check (char_length(unit) <= 20),
  category   text not null default 'その他' check (category in ('野菜','肉・魚','卵・乳製品','豆腐・加工食品','調味料','日用品','その他')),
  checked    boolean not null default false,
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  source     jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shopping_items_space_idx on public.shopping_items(space_id);

create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 判定用の関数（RLS から使う）
-- ---------------------------------------------------------------------

create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.space_members m
    where m.space_id = sid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.space_has_user(sid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is null or exists (
    select 1 from public.space_members m where m.space_id = sid and m.user_id = uid
  );
$$;

create or replace function public.shares_space_with(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.space_members a
    join public.space_members b on a.space_id = b.space_id
    where a.user_id = (select auth.uid()) and b.user_id = uid
  );
$$;

-- ---------------------------------------------------------------------
-- だれが・いつ書いたかを自動で記録する
-- ---------------------------------------------------------------------

create or replace function public.tg_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.space_id is distinct from old.space_id then
      raise exception 'space_id cannot be changed' using errcode = '22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tg_shopping_checked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.checked then
    if tg_op = 'INSERT' or not old.checked then
      new.checked_by := auth.uid();
      new.checked_at := now();
    else
      new.checked_by := old.checked_by;
      new.checked_at := old.checked_at;
    end if;
  else
    new.checked_by := null;
    new.checked_at := null;
  end if;
  return new;
end $$;

create or replace function public.tg_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['recipes','recipe_photos','meal_items','events','shopping_items'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit before insert or update on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

drop trigger if exists checked on public.shopping_items;
create trigger checked before insert or update on public.shopping_items
  for each row execute function public.tg_shopping_checked();

drop trigger if exists touch on public.profiles;
create trigger touch before update on public.profiles for each row execute function public.tg_touch();
drop trigger if exists touch on public.user_settings;
create trigger touch before update on public.user_settings for each row execute function public.tg_touch();

-- ---------------------------------------------------------------------
-- アプリから呼ぶ操作（RPC）
-- ---------------------------------------------------------------------

-- ログイン直後に毎回呼ぶ: プロフィール・個人スペース・設定がなければ作る
create or replace function public.bootstrap(p_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;

  insert into public.profiles (id, display_name)
  values (uid, left(coalesce(nullif(btrim(p_name), ''), 'わたし'), 40))
  on conflict (id) do nothing;

  insert into public.spaces (kind, name, owner_id) values ('personal', 'じぶん', uid)
  on conflict (owner_id) where kind = 'personal' do nothing;
  select id into sid from public.spaces where owner_id = uid and kind = 'personal';

  insert into public.space_members (space_id, user_id, role) values (sid, uid, 'owner')
  on conflict do nothing;

  insert into public.user_settings (user_id) values (uid) on conflict do nothing;
end $$;

-- ふたりのスペースを作る（v1 は1人につき1つまで）
create or replace function public.create_shared_space(p_name text default 'ふたりの献立帖') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if exists (
    select 1 from public.space_members m join public.spaces s on s.id = m.space_id
    where m.user_id = uid and s.kind = 'shared'
  ) then
    raise exception 'already_in_shared_space' using errcode = 'P0001';
  end if;
  insert into public.spaces (kind, name, owner_id)
  values ('shared', left(coalesce(nullif(btrim(p_name), ''), 'ふたりの献立帖'), 40), uid)
  returning id into sid;
  insert into public.space_members (space_id, user_id, role) values (sid, uid, 'owner');
  return sid;
end $$;

-- 招待コードを発行（3日間・1回だけ有効。前に出した未使用コードは無効になる）
create or replace function public.create_invite(p_space uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  idx constant int[] := array[0,1,2,3,4,5,16,17,18,19];
  b bytea;
  c text;
  i int;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not public.is_member(p_space) then raise exception 'not_member' using errcode = '42501'; end if;
  if (select kind from public.spaces where id = p_space) <> 'shared' then
    raise exception 'not_shared_space' using errcode = 'P0001';
  end if;
  delete from public.space_invites where space_id = p_space and used_at is null;
  loop
    b := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    c := '';
    foreach i in array idx loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.space_invites (code, space_id, created_by) values (c, p_space, uid);
      exit;
    exception when unique_violation then
      -- まれにコードが重なったら作り直す
    end;
  end loop;
  return c;
end $$;

-- 招待コードで参加
create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.space_invites%rowtype;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into inv from public.space_invites where code = v_code for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.space_members where space_id = inv.space_id and user_id = uid) then
    return inv.space_id;
  end if;
  if exists (
    select 1 from public.space_members m join public.spaces s on s.id = m.space_id
    where m.user_id = uid and s.kind = 'shared'
  ) then
    raise exception 'already_in_shared_space' using errcode = 'P0001';
  end if;
  insert into public.space_members (space_id, user_id, role) values (inv.space_id, uid, 'member');
  update public.space_invites set used_by = uid, used_at = now() where code = inv.code;
  return inv.space_id;
end $$;

-- ふたりのスペースから抜ける（最後の1人は抜けられない）
create or replace function public.leave_space(p_space uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sp public.spaces%rowtype;
  next_owner uuid;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into sp from public.spaces where id = p_space;
  if not found or not public.is_member(p_space) then raise exception 'not_member' using errcode = '42501'; end if;
  if sp.kind <> 'shared' then raise exception 'not_shared_space' using errcode = 'P0001'; end if;
  if (select count(*) from public.space_members where space_id = p_space) <= 1 then
    raise exception 'last_member' using errcode = 'P0001';
  end if;
  delete from public.space_members where space_id = p_space and user_id = uid;
  if sp.owner_id = uid then
    select user_id into next_owner from public.space_members where space_id = p_space order by joined_at limit 1;
    update public.spaces set owner_id = next_owner where id = p_space;
    update public.space_members set role = 'owner' where space_id = p_space and user_id = next_owner;
  end if;
end $$;

-- メンバーを外す（スペースの作成者だけ）
create or replace function public.remove_member(p_space uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.spaces where id = p_space and owner_id = uid and kind = 'shared') then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_user = uid then raise exception 'cannot_remove_self' using errcode = 'P0001'; end if;
  delete from public.space_members where space_id = p_space and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 権限（未ログインは何もできない。ログイン済みも RLS の範囲だけ）
-- ---------------------------------------------------------------------

revoke all on table
  public.profiles, public.spaces, public.space_members, public.space_invites,
  public.recipes, public.recipe_photos, public.meal_items, public.events,
  public.shopping_items, public.user_settings
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, color) on public.profiles to authenticated;
grant select on public.spaces to authenticated;
grant update (name) on public.spaces to authenticated;
grant select on public.space_members to authenticated;
grant select on public.space_invites to authenticated;
grant select, insert, update, delete on
  public.recipes, public.recipe_photos, public.meal_items, public.events, public.shopping_items
to authenticated;
grant select, insert, update on public.user_settings to authenticated;

revoke execute on function
  public.is_member(uuid), public.space_has_user(uuid, uuid), public.shares_space_with(uuid),
  public.bootstrap(text), public.create_shared_space(text), public.create_invite(uuid),
  public.accept_invite(text), public.leave_space(uuid), public.remove_member(uuid, uuid),
  public.tg_audit(), public.tg_shopping_checked(), public.tg_touch()
from public, anon, authenticated;

grant execute on function
  public.is_member(uuid), public.space_has_user(uuid, uuid), public.shares_space_with(uuid),
  public.bootstrap(text), public.create_shared_space(text), public.create_invite(uuid),
  public.accept_invite(text), public.leave_space(uuid), public.remove_member(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.spaces         enable row level security;
alter table public.space_members  enable row level security;
alter table public.space_invites  enable row level security;
alter table public.recipes        enable row level security;
alter table public.recipe_photos  enable row level security;
alter table public.meal_items     enable row level security;
alter table public.events         enable row level security;
alter table public.shopping_items enable row level security;
alter table public.user_settings  enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_space_with(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces for select to authenticated
  using (public.is_member(id));
drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces for update to authenticated
  using (public.is_member(id) and kind = 'shared') with check (public.is_member(id) and kind = 'shared');

drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members for select to authenticated
  using (public.is_member(space_id));

drop policy if exists invites_select on public.space_invites;
create policy invites_select on public.space_invites for select to authenticated
  using (created_by = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['recipes','recipe_photos','meal_items','shopping_items'] loop
    execute format('drop policy if exists member_select on public.%I', t);
    execute format('drop policy if exists member_insert on public.%I', t);
    execute format('drop policy if exists member_update on public.%I', t);
    execute format('drop policy if exists member_delete on public.%I', t);
    execute format('create policy member_select on public.%I for select to authenticated using (public.is_member(space_id))', t);
    execute format('create policy member_insert on public.%I for insert to authenticated with check (public.is_member(space_id))', t);
    execute format('create policy member_update on public.%I for update to authenticated using (public.is_member(space_id)) with check (public.is_member(space_id))', t);
    execute format('create policy member_delete on public.%I for delete to authenticated using (public.is_member(space_id))', t);
  end loop;
end $$;

drop policy if exists member_select on public.events;
create policy member_select on public.events for select to authenticated
  using (public.is_member(space_id));
drop policy if exists member_insert on public.events;
create policy member_insert on public.events for insert to authenticated
  with check (public.is_member(space_id) and public.space_has_user(space_id, person_id));
drop policy if exists member_update on public.events;
create policy member_update on public.events for update to authenticated
  using (public.is_member(space_id))
  with check (public.is_member(space_id) and public.space_has_user(space_id, person_id));
drop policy if exists member_delete on public.events;
create policy member_delete on public.events for delete to authenticated
  using (public.is_member(space_id));

drop policy if exists own_settings on public.user_settings;
create policy own_settings on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- リアルタイム反映（相手の変更がすぐ画面に出る）
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','spaces','space_members','recipes','meal_items','events','shopping_items'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
