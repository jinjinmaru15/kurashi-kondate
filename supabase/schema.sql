-- =====================================================================
-- くらしの献立帖  データベース定義（Supabase / PostgreSQL 15+）
--
-- 使い方: Supabase の SQL Editor にこのファイルの中身をすべて貼り付けて
--         「Run」を押してください。何度実行しても壊れないように書いてあります。
--         （kurashi-kondate プロジェクトには適用済みです。末尾の「オプション」の
--           ふたつの関数だけは未適用なので、使うときは SQL Editor で実行してください）
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
  servings    text check (servings is null or char_length(servings) <= 20),  -- 「2」「2〜3」など
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
  constraint events_check check (
         (kind = 'shift' and type in ('day','evening','night','a','c','e','h','iri','ake','off','other'))
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
-- 以前の版からの更新（データは消さずに、ルールだけ広げる。何度実行しても大丈夫）
-- ---------------------------------------------------------------------
-- v2.3: 勤務区分に A・C・E・H・入り・明け を追加
alter table public.events drop constraint if exists events_check;
alter table public.events add constraint events_check check (
     (kind = 'shift' and type in ('day','evening','night','a','c','e','h','iri','ake','off','other'))
  or (kind = 'plan'  and type in ('out','shopping','chores','custom')));
-- v2.3: 「何人分」を文字で保存（今ある数字は "2" のような文字として残る）
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'recipes' and column_name = 'servings') = 'integer' then
    alter table public.recipes drop constraint if exists recipes_servings_check;
    alter table public.recipes alter column servings type text using servings::text;
    alter table public.recipes add constraint recipes_servings_check check (servings is null or char_length(servings) <= 20);
  end if;
end $$;

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

-- 共有スペースは名前だけ、プロフィールは名前と色だけ変更できる
create or replace function public.tg_space_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
     new.id is distinct from old.id or new.kind is distinct from old.kind
     or new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at) then
    raise exception 'only the name can be changed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.tg_profile_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'only display_name and color can be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch on public.profiles;
drop trigger if exists guard on public.profiles;
create trigger guard before update on public.profiles for each row execute function public.tg_profile_guard();
drop trigger if exists guard on public.spaces;
create trigger guard before update on public.spaces for each row execute function public.tg_space_guard();
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

-- 招待コードを発行（3日間・1回だけ有効。前に出した未使用コードは期限切れにする）
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
  update public.space_invites set expires_at = now() - interval '1 second'
  where space_id = p_space and used_at is null and expires_at > now();
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
  public.accept_invite(text),
  public.tg_audit(), public.tg_shopping_checked(), public.tg_touch(),
  public.tg_space_guard(), public.tg_profile_guard()
from public, anon, authenticated;

grant execute on function
  public.is_member(uuid), public.space_has_user(uuid, uuid), public.shares_space_with(uuid),
  public.bootstrap(text), public.create_shared_space(text), public.create_invite(uuid),
  public.accept_invite(text)
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
    execute format('drop policy if exists member_remove on public.%I', t);
    execute format('create policy member_select on public.%I for select to authenticated using (public.is_member(space_id))', t);
    execute format('create policy member_insert on public.%I for insert to authenticated with check (public.is_member(space_id))', t);
    execute format('create policy member_update on public.%I for update to authenticated using (public.is_member(space_id)) with check (public.is_member(space_id))', t);
    execute format('create policy member_remove on public.%I for delete to authenticated using (public.is_member(space_id))', t);
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
drop policy if exists member_remove on public.events;
create policy member_remove on public.events for delete to authenticated
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

-- ---------------------------------------------------------------------
-- 写真読み取り（AI）の1日あたりの利用回数。サーバー側の関数だけが読み書きする
-- ---------------------------------------------------------------------

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;

create or replace function public.bump_ai_usage(p_user uuid, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.ai_usage (user_id, day, count)
  values (p_user, (now() at time zone 'Asia/Tokyo')::date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  return n <= p_limit;
end $$;

revoke execute on function public.bump_ai_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, int) to service_role;

-- =====================================================================
-- 家事（v2.5）。今ある表には手を入れず、表を足すだけ。何度実行しても大丈夫
--   chores      … 家事（固定表示／チェック管理、現在と理想の担当・頻度）
--   chore_logs  … チェック管理の家事の完了記録（実施者・実施日）
--   chore_seeds … 初期の家事30項目を登録済みのスペース（1スペース1回だけ）
-- 担当・実施者は '' = 未設定、'both' = ふたり、それ以外はメンバーのユーザーID
-- =====================================================================
create table if not exists public.chores (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  category    text not null default 'life' check (category in ('cooking','cleaning','laundry','supplies','seasonal','life')),
  mode        text not null default 'fixed' check (mode in ('fixed','check')),
  current_who text not null default '' check (current_who in ('', 'both') or current_who ~ '^[0-9a-f-]{36}$'),
  ideal_who   text not null default '' check (ideal_who in ('', 'both') or ideal_who ~ '^[0-9a-f-]{36}$'),
  freq        text not null default 'weekly' check (freq in ('daily','days','weekly','biweekly','monthly','months','yearly','twice_yearly','irregular')),
  freq_n      int check (freq_n between 1 and 366),
  freq_note   text not null default '' check (char_length(freq_note) <= 60),
  actual_freq text not null default '' check (char_length(actual_freq) <= 60),
  duration    text not null default '' check (char_length(duration) <= 40),
  memo        text not null default '' check (char_length(memo) <= 1000),
  position    int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, space_id)
);
create index if not exists chores_space_idx on public.chores(space_id);

create table if not exists public.chore_logs (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  chore_id   uuid not null,
  done_on    date not null,
  done_by    text not null default '' check (done_by in ('', 'both') or done_by ~ '^[0-9a-f-]{36}$'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (chore_id, space_id) references public.chores(id, space_id) on delete cascade
);
create index if not exists chore_logs_chore_idx on public.chore_logs(chore_id, done_on);
create index if not exists chore_logs_space_idx on public.chore_logs(space_id);

create table if not exists public.chore_seeds (
  space_id  uuid primary key references public.spaces(id) on delete cascade,
  seeded_by uuid references auth.users(id) on delete set null,
  seeded_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['chores','chore_logs'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit before insert or update on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- 初期の家事を登録する。そのスペースで1回目のときだけ登録し、2回目以降は何もしない（0を返す）
-- 同時に呼ばれても、印の表の主キーで1回だけになる
create or replace function public.seed_chores(p_space uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not public.is_member(p_space) then raise exception 'not_member' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'bad_items' using errcode = '22023'; end if;
  insert into public.chore_seeds(space_id, seeded_by) values (p_space, (select auth.uid())) on conflict (space_id) do nothing;
  if not found then return 0; end if;
  insert into public.chores(space_id, name, category, mode, current_who, ideal_who, freq, freq_n, freq_note, actual_freq, duration, memo, position)
  select p_space, x->>'name', x->>'category', x->>'mode', coalesce(x->>'current_who', ''), coalesce(x->>'ideal_who', ''),
         x->>'freq', nullif(x->>'freq_n', '')::int, coalesce(x->>'freq_note', ''), coalesce(x->>'actual_freq', ''),
         coalesce(x->>'duration', ''), coalesce(x->>'memo', ''), coalesce(nullif(x->>'position', '')::int, 0)
  from jsonb_array_elements(p_items) as x;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on table public.chores, public.chore_logs, public.chore_seeds from anon, authenticated;
grant select, insert, update, delete on public.chores, public.chore_logs to authenticated;
grant select on public.chore_seeds to authenticated;
revoke execute on function public.seed_chores(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.seed_chores(uuid, jsonb) to authenticated;

alter table public.chores      enable row level security;
alter table public.chore_logs  enable row level security;
alter table public.chore_seeds enable row level security;

do $$
declare t text;
begin
  foreach t in array array['chores','chore_logs'] loop
    execute format('drop policy if exists member_select on public.%I', t);
    execute format('drop policy if exists member_insert on public.%I', t);
    execute format('drop policy if exists member_update on public.%I', t);
    execute format('drop policy if exists member_remove on public.%I', t);
    execute format('create policy member_select on public.%I for select to authenticated using (public.is_member(space_id))', t);
    execute format('create policy member_insert on public.%I for insert to authenticated with check (public.is_member(space_id))', t);
    execute format('create policy member_update on public.%I for update to authenticated using (public.is_member(space_id)) with check (public.is_member(space_id))', t);
    execute format('create policy member_remove on public.%I for delete to authenticated using (public.is_member(space_id))', t);
  end loop;
end $$;
drop policy if exists member_select on public.chore_seeds;
create policy member_select on public.chore_seeds for select to authenticated using (public.is_member(space_id));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chores','chore_logs'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =====================================================================
-- オプション：「ふたりのスペースから抜ける」「メンバーを外す」
-- 使うときだけ、この下を SQL Editor で実行してください。
-- =====================================================================

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

revoke execute on function public.leave_space(uuid), public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.leave_space(uuid), public.remove_member(uuid, uuid) to authenticated;
