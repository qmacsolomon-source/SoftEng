-- =============================================================================
--  APA ENGINEERING SERVICES - PROJECT MANAGEMENT SYSTEM WITH COST ESTIMATION
--  File 01 of 04 : SCHEMA (tables, constraints, triggers, views, functions)
--
--  HOW TO RUN
--    Supabase Dashboard -> SQL Editor -> New query -> paste this file -> Run.
--    Run the files in order: 01_schema.sql, 02_rls.sql, 03_storage.sql, 04_seed.sql
--
--  The whole file is IDEMPOTENT: it can be re-run safely at any time.
-- =============================================================================

create extension if not exists "pgcrypto";

-- The helper functions in section 1 read public.profiles, which is created
-- later in this file. Skip the creation-time body check so they can be defined
-- first; they are only executed after every table exists.
set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- 0. SHARED CONSTANTS
--    The eight works covered by every quotation, in display order.
--    Kept as a CHECK constraint (not an enum) so it is easy to extend.
-- -----------------------------------------------------------------------------
--   flooring | ceiling | walls | roofing | doors_windows
--   toilet_bath | kitchen | electrical_lighting

-- -----------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Reusable "touch updated_at" trigger body.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Reads the role of the currently authenticated user (auth.uid()).
-- SECURITY DEFINER so it can read profiles without triggering RLS recursion.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- True when the caller is an Admin/Owner.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin' and p.is_active
       from public.profiles p
      where p.id = auth.uid()),
    false);
$$;

-- True when the caller is an active Admin or Staff member.
create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_active
       from public.profiles p
      where p.id = auth.uid()),
    false);
$$;

-- -----------------------------------------------------------------------------
-- 2. DOCUMENT NUMBERING
--    Atomic per-scope, per-period counter used to build reference numbers such
--    as QTE-2026-0001 and PRJ-2026-0001. Safe under concurrency.
-- -----------------------------------------------------------------------------
create table if not exists public.doc_counters (
  scope       text        not null,
  period      text        not null,
  last_value  integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (scope, period)
);

create or replace function public.next_doc_number(p_scope text, p_period text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.doc_counters (scope, period, last_value)
  values (p_scope, p_period, 1)
  on conflict (scope, period)
  do update set last_value  = public.doc_counters.last_value + 1,
                updated_at  = now()
  returning last_value into v_next;

  -- A new period always restarts at 1 (handled by the INSERT branch above).
  return v_next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. PROFILES
--    One row per Supabase Auth user. "role" drives the whole authorisation
--    model: Admin/Owner sees everything, Staff cannot manage users or prices.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid        primary key references auth.users (id) on delete cascade,
  email          text        not null,
  full_name      text        not null default '',
  phone          text,
  role           text        not null default 'staff',
  position       text,
  avatar_url     text,
  is_active      boolean     not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint profiles_role_check  check (role in ('admin', 'staff')),
  constraint profiles_email_ck    check (email ~* '^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$'),
  constraint profiles_name_len    check (char_length(full_name) between 2 and 120),
  constraint profiles_phone_ck    check (phone is null or phone ~ '^(\+639|09)[0-9]{9}$'),
  constraint profiles_email_uniq  unique (email)
);

create index if not exists profiles_role_idx on public.profiles (role);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create a profile row whenever an auth user is created.
-- Role is taken from the user metadata (set by the admin-only /api/users route),
-- defaulting to 'staff' which is the least-privileged role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, phone, position)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    case when (new.raw_user_meta_data ->> 'role') = 'admin' then 'admin' else 'staff' end,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'position', '')), '')
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        role       = excluded.role,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 4. CLIENTS
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid        primary key default gen_random_uuid(),
  full_name   text        not null,
  email       text,
  phone       text,
  address     text,
  notes       text,
  created_by  uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint clients_name_len  check (char_length(full_name) between 2 and 120),
  constraint clients_email_ck  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$'),
  constraint clients_phone_ck  check (phone is null or phone ~ '^(\+639|09)[0-9]{9}$')
);

create index if not exists clients_name_idx on public.clients (lower(full_name));

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. MATERIALS AND PRICES
--    Live prices are sourced from the Wilcon Depot website. Until the live
--    connector is switched on, this table holds sample prices that an Admin can
--    edit by hand. The estimation basis follows Fajardo (Simplified
--    Construction Estimate) - i.e. cost per square metre of floor area.
-- -----------------------------------------------------------------------------
create table if not exists public.materials (
  id                 uuid          primary key default gen_random_uuid(),
  work_type          text          not null,
  name               text          not null,
  brand              text          not null default '',
  sku                text,
  unit               text          not null default 'pc',
  unit_price         numeric(12,2) not null default 0,
  supplier           text          not null default 'Wilcon Depot',
  source_url         text,
  thumbnail_url      text,
  style_variant      text,
  coverage_per_unit  numeric(10,4),
  -- Multiplier applied to the base installed rate of the work when this
  -- material is chosen on a Customized Quotation. 1.000 = the reference
  -- material, <1 is more economical, >1 is an upgrade.
  cost_factor        numeric(6,3)  not null default 1.000,
  notes              text,
  is_active          boolean       not null default true,
  last_updated_at    timestamptz   not null default now(),
  updated_by         uuid          references public.profiles (id) on delete set null,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),

  constraint materials_work_type_ck check (work_type in (
    'flooring', 'ceiling', 'walls', 'roofing',
    'doors_windows', 'toilet_bath', 'kitchen', 'electrical_lighting')),
  constraint materials_unit_ck check (unit in (
    'pc', 'sqm', 'sqft', 'lm', 'm', 'bag', 'kg', 'set', 'roll',
    'gal', 'ltr', 'box', 'length', 'sheet', 'cu.m', 'lot')),
  constraint materials_price_ck      check (unit_price >= 0),
  constraint materials_name_len      check (char_length(name) between 2 and 160),
  constraint materials_coverage_ck   check (coverage_per_unit is null or coverage_per_unit > 0),
  constraint materials_cost_factor_ck check (cost_factor between 0.10 and 5.00),
  constraint materials_sku_uniq      unique (sku)
);

create index if not exists materials_work_type_idx on public.materials (work_type) where is_active;
create index if not exists materials_brand_idx     on public.materials (lower(brand));

drop trigger if exists trg_materials_updated_at on public.materials;
create trigger trg_materials_updated_at
  before update on public.materials
  for each row execute function public.tg_set_updated_at();

-- Audit trail for the "Refresh prices from Wilcon" button.
create table if not exists public.price_refresh_log (
  id                 uuid        primary key default gen_random_uuid(),
  source             text        not null default 'wilcon',
  status             text        not null default 'manual',
  materials_updated  integer     not null default 0,
  message            text,
  triggered_by       uuid        references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint price_refresh_status_ck check (status in ('success', 'failed', 'manual'))
);

-- -----------------------------------------------------------------------------
-- 6. FINISH PACKAGES (Standard | Elegant | Luxury | Bare)
--    A package is a fixed set of materials AND a fixed rate per square metre
--    per work. The Quick Quotation estimate is:
--        total = floor_area_sqm x SUM(finish_package_items.rate_per_sqm)
-- -----------------------------------------------------------------------------
create table if not exists public.finish_packages (
  id            uuid        primary key default gen_random_uuid(),
  code          text        not null,
  name          text        not null,
  description   text,
  target_market text,
  sort_order    integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint finish_packages_code_ck check (code in ('standard', 'elegant', 'luxury', 'bare')),
  constraint finish_packages_code_uniq unique (code),
  constraint finish_packages_name_len  check (char_length(name) between 2 and 80)
);

drop trigger if exists trg_finish_packages_updated_at on public.finish_packages;
create trigger trg_finish_packages_updated_at
  before update on public.finish_packages
  for each row execute function public.tg_set_updated_at();

-- One row per work inside a package. This is what produces the per-work cost
-- breakdown shown on the quotation detail page.
create table if not exists public.finish_package_items (
  id                 uuid          primary key default gen_random_uuid(),
  finish_package_id  uuid          not null references public.finish_packages (id) on delete cascade,
  work_type          text          not null,
  material_id        uuid          references public.materials (id) on delete set null,
  description        text          not null default '',
  brand              text          not null default '',
  style_variant      text,
  unit               text          not null default 'sqm',
  unit_price         numeric(12,2) not null default 0,
  rate_per_sqm       numeric(12,2) not null default 0,
  sort_order         integer       not null default 0,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),

  constraint fpi_work_type_ck check (work_type in (
    'flooring', 'ceiling', 'walls', 'roofing',
    'doors_windows', 'toilet_bath', 'kitchen', 'electrical_lighting')),
  constraint fpi_rate_ck       check (rate_per_sqm >= 0),
  constraint fpi_unit_price_ck check (unit_price >= 0),
  constraint fpi_unique_work  unique (finish_package_id, work_type)
);

create index if not exists fpi_package_idx on public.finish_package_items (finish_package_id);

drop trigger if exists trg_fpi_updated_at on public.finish_package_items;
create trigger trg_fpi_updated_at
  before update on public.finish_package_items
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 6b. STYLE / LAYOUT OPTIONS  (Customized Quotation "style variant" radios)
--     A labour-and-complexity multiplier on top of the material cost factor.
--     Admin-editable, so APA can tune it as site conditions change.
-- -----------------------------------------------------------------------------
create table if not exists public.style_options (
  id          uuid          primary key default gen_random_uuid(),
  work_type   text          not null,
  code        text          not null,
  label       text          not null,
  description text,
  multiplier  numeric(6,3)  not null default 1.000,
  sort_order  integer       not null default 0,
  is_active   boolean       not null default true,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),

  constraint style_options_work_ck check (work_type in (
    'flooring', 'ceiling', 'walls', 'roofing',
    'doors_windows', 'toilet_bath', 'kitchen', 'electrical_lighting')),
  constraint style_options_mult_ck check (multiplier between 0.50 and 3.00),
  constraint style_options_unique  unique (work_type, code)
);

create index if not exists style_options_work_idx on public.style_options (work_type) where is_active;

drop trigger if exists trg_style_options_updated_at on public.style_options;
create trigger trg_style_options_updated_at
  before update on public.style_options
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. QUOTATIONS
--    quotation_type = 'quick'    -> driven by finish_package_id + floor area
--    quotation_type = 'detailed' -> driven by quotation_items (chosen materials)
-- -----------------------------------------------------------------------------
create table if not exists public.quotations (
  id                    uuid          primary key default gen_random_uuid(),
  reference_no          text          not null,
  quotation_type        text          not null default 'quick',
  status                text          not null default 'draft',

  client_id             uuid          references public.clients (id) on delete set null,
  client_name           text          not null,
  client_email          text,
  client_phone          text,
  project_name          text,
  project_location      text,
  project_type          text,

  floor_area_sqm        numeric(10,2) not null,
  number_of_floors      integer       not null default 1,
  finish_package_id     uuid          references public.finish_packages (id) on delete set null,
  base_finish_level     text,
  works_included        text[]        not null default '{}',

  target_start_date     date,
  validity_date         date,

  contingency_pct       numeric(5,2)  not null default 0,
  include_labor         boolean       not null default true,
  labor_pct             numeric(5,2)  not null default 0,

  subtotal              numeric(14,2) not null default 0,
  contingency_amount    numeric(14,2) not null default 0,
  labor_amount          numeric(14,2) not null default 0,
  total_amount          numeric(14,2) not null default 0,

  remarks               text,
  site_plan_path        text,
  attachment_path       text,
  price_source_at       timestamptz,

  created_by            uuid          references public.profiles (id) on delete set null,
  -- Snapshot of the creator's name at the time of creation. Keeps list views
  -- readable without needing to join profiles, whose rows are only visible to
  -- their owner (or an Admin) under RLS.
  created_by_name       text          not null default '',
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),

  constraint quotations_type_ck    check (quotation_type in ('quick', 'detailed')),
  constraint quotations_status_ck  check (status in ('draft', 'sent', 'approved', 'rejected', 'expired')),
  constraint quotations_ref_uniq   check (char_length(reference_no) between 6 and 40),
  constraint quotations_ref_unique unique (reference_no),
  constraint quotations_client_len check (char_length(client_name) between 2 and 120),
  constraint quotations_area_ck    check (floor_area_sqm between 10 and 5000),
  constraint quotations_floors_ck  check (number_of_floors between 1 and 20),
  constraint quotations_cont_ck    check (contingency_pct between 0 and 20),
  constraint quotations_labor_ck   check (labor_pct between 0 and 100),
  constraint quotations_amounts_ck check (
        subtotal >= 0 and contingency_amount >= 0
    and labor_amount >= 0 and total_amount >= 0),
  constraint quotations_email_ck   check (client_email is null or client_email ~* '^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$'),
  constraint quotations_phone_ck   check (client_phone is null or client_phone ~ '^(\+639|09)[0-9]{9}$'),
  constraint quotations_remarks_ck check (remarks is null or char_length(remarks) <= 300),
  constraint quotations_works_ck   check (works_included <@ array[
      'flooring', 'ceiling', 'walls', 'roofing',
      'doors_windows', 'toilet_bath', 'kitchen', 'electrical_lighting']::text[])
);

create index if not exists quotations_created_idx  on public.quotations (created_at desc);
create index if not exists quotations_status_idx   on public.quotations (status);
create index if not exists quotations_type_idx     on public.quotations (quotation_type);
create index if not exists quotations_client_idx   on public.quotations (client_id);
create index if not exists quotations_search_idx   on public.quotations
  using gin (to_tsvector('simple', coalesce(client_name,'') || ' ' || coalesce(project_name,'') || ' ' || coalesce(reference_no,'')));

drop trigger if exists trg_quotations_updated_at on public.quotations;
create trigger trg_quotations_updated_at
  before update on public.quotations
  for each row execute function public.tg_set_updated_at();

-- Line items. Used by BOTH quotation types: quick quotations store the package
-- breakdown, detailed quotations store the user's own material choices.
create table if not exists public.quotation_items (
  id             uuid          primary key default gen_random_uuid(),
  quotation_id   uuid          not null references public.quotations (id) on delete cascade,
  work_type      text          not null,
  material_id    uuid          references public.materials (id) on delete set null,
  description    text          not null default '',
  brand          text          not null default '',
  style_variant  text,
  unit           text          not null default 'sqm',
  quantity       numeric(12,4) not null default 0,
  unit_price     numeric(12,2) not null default 0,
  rate_per_sqm   numeric(12,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  sort_order     integer       not null default 0,
  created_at     timestamptz   not null default now(),

  constraint qi_work_type_ck check (work_type in (
    'flooring', 'ceiling', 'walls', 'roofing',
    'doors_windows', 'toilet_bath', 'kitchen', 'electrical_lighting')),
  constraint qi_quantity_ck  check (quantity >= 0),
  constraint qi_price_ck     check (unit_price >= 0),
  constraint qi_rate_ck      check (rate_per_sqm >= 0),
  constraint qi_total_ck     check (line_total >= 0),
  constraint qi_unique_work  unique (quotation_id, work_type)
);

create index if not exists qi_quotation_idx on public.quotation_items (quotation_id);

-- -----------------------------------------------------------------------------
-- 8. PROJECTS AND STATUS UPDATES
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id               uuid          primary key default gen_random_uuid(),
  project_code     text          not null,
  name             text          not null,
  client_id        uuid          references public.clients (id) on delete set null,
  client_name      text,
  location         text,
  quotation_id     uuid          references public.quotations (id) on delete set null,
  status           text          not null default 'planning',
  progress_pct     integer       not null default 0,
  floor_area_sqm   numeric(10,2),
  contract_amount  numeric(14,2) not null default 0,
  start_date       date,
  target_end_date  date,
  actual_end_date  date,
  created_by       uuid          references public.profiles (id) on delete set null,
  created_by_name  text          not null default '',
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),

  constraint projects_status_ck    check (status in ('planning', 'ongoing', 'completed')),
  constraint projects_progress_ck  check (progress_pct between 0 and 100),
  constraint projects_code_uniq    unique (project_code),
  constraint projects_name_len     check (char_length(name) between 2 and 160),
  constraint projects_amount_ck    check (contract_amount >= 0),
  constraint projects_area_ck      check (floor_area_sqm is null or floor_area_sqm between 10 and 5000),
  constraint projects_dates_ck     check (
        target_end_date is null or start_date is null or target_end_date >= start_date)
);

create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_created_idx on public.projects (created_at desc);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.tg_set_updated_at();

create table if not exists public.project_status_updates (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references public.projects (id) on delete cascade,
  status            text        not null,
  milestone_name    text        not null,
  progress_pct      integer     not null,
  milestone_date    date        not null default current_date,
  time_logged       time,
  remarks           text,
  photo_path        text,
  notify_owner      boolean     not null default false,
  updated_by        uuid        references public.profiles (id) on delete set null,
  updated_by_name   text,
  created_at        timestamptz not null default now(),

  constraint psu_status_ck     check (status in ('planning', 'ongoing', 'completed')),
  constraint psu_progress_ck   check (progress_pct between 0 and 100),
  constraint psu_milestone_len check (char_length(milestone_name) between 2 and 120)
);

create index if not exists psu_project_idx on public.project_status_updates (project_id, milestone_date desc);

-- Keep the project's headline status/progress in sync with its latest update.
create or replace function public.tg_apply_status_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects p
     set status       = new.status,
         progress_pct = new.progress_pct,
         actual_end_date = case
           when new.status = 'completed' then coalesce(p.actual_end_date, new.milestone_date)
           else null end,
         updated_at   = now()
   where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists trg_psu_apply on public.project_status_updates;
create trigger trg_psu_apply
  after insert on public.project_status_updates
  for each row execute function public.tg_apply_status_update();

-- -----------------------------------------------------------------------------
-- 9. ACTIVITY LOG (Dashboard "recent activity")
-- -----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id           uuid        primary key default gen_random_uuid(),
  actor_id     uuid        references public.profiles (id) on delete set null,
  actor_name   text        not null default 'System',
  action       text        not null,
  entity_type  text        not null,
  entity_id    uuid,
  summary      text        not null,
  created_at   timestamptz not null default now(),

  constraint activity_entity_ck check (entity_type in (
    'quotation', 'project', 'status_update', 'material', 'user', 'auth', 'client')),
  constraint activity_action_len check (char_length(action) between 2 and 40)
);

create index if not exists activity_created_idx on public.activity_log (created_at desc);

-- -----------------------------------------------------------------------------
-- 10. VIEWS
-- -----------------------------------------------------------------------------

-- Aggregate rate per square metre for each finish package.
create or replace view public.v_finish_package_rates as
select
  fp.id,
  fp.code,
  fp.name,
  fp.description,
  fp.target_market,
  fp.sort_order,
  fp.is_active,
  coalesce(sum(fpi.rate_per_sqm), 0)::numeric(14,2) as total_rate_per_sqm,
  count(fpi.id)::integer                            as works_count
from public.finish_packages fp
left join public.finish_package_items fpi on fpi.finish_package_id = fp.id
group by fp.id;

-- Flat list used by the Quotation list page and the CSV export.
create or replace view public.v_quotation_list as
select
  q.id,
  q.reference_no,
  q.quotation_type,
  q.status,
  q.client_name,
  q.client_email,
  q.client_phone,
  q.project_name,
  q.project_location,
  q.project_type,
  q.floor_area_sqm,
  q.number_of_floors,
  q.total_amount,
  q.subtotal,
  q.contingency_pct,
  q.validity_date,
  q.target_start_date,
  q.created_at,
  q.updated_at,
  q.price_source_at,
  q.created_by_name,
  fp.code as finish_package_code,
  fp.name as finish_package_name
from public.quotations q
left join public.finish_packages fp on fp.id = q.finish_package_id;

-- Projects with their latest milestone attached.
create or replace view public.v_project_progress as
select
  pr.id,
  pr.project_code,
  pr.name,
  pr.client_name,
  pr.location,
  pr.status,
  pr.progress_pct,
  pr.contract_amount,
  pr.floor_area_sqm,
  pr.start_date,
  pr.target_end_date,
  pr.actual_end_date,
  pr.created_at,
  pr.updated_at,
  pr.quotation_id,
  pr.created_by_name,
  lu.milestone_name  as last_milestone,
  lu.milestone_date  as last_milestone_date,
  lu.updated_by_name as last_updated_by,
  (select count(*)::integer from public.project_status_updates s where s.project_id = pr.id) as updates_count
from public.projects pr
left join lateral (
  select s.milestone_name, s.milestone_date, s.updated_by_name
    from public.project_status_updates s
   where s.project_id = pr.id
   order by s.milestone_date desc, s.created_at desc
   limit 1
) lu on true;

-- -----------------------------------------------------------------------------
-- 11. GRANTS  (RLS still applies on top of these)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant execute on function public.next_doc_number(text, text) to authenticated;
grant execute on function public.current_user_role()         to authenticated;
grant execute on function public.is_admin()                  to authenticated;
grant execute on function public.is_staff_or_admin()         to authenticated;

grant select                          on public.v_finish_package_rates to authenticated;
grant select                          on public.v_quotation_list       to authenticated;
grant select                          on public.v_project_progress     to authenticated;

-- =============================================================================
--  END OF 01_schema.sql  --  next: run 02_rls.sql
-- =============================================================================
