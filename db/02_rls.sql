-- =============================================================================
--  APA ENGINEERING SERVICES - PROJECT MANAGEMENT SYSTEM
--  File 02 of 04 : ROW LEVEL SECURITY
--
--  Authorisation model
--    Admin/Owner : full access, including user management and price settings.
--    Staff       : can create/edit clients, quotations and project updates,
--                  but CANNOT manage users, materials/prices or finish packages,
--                  and cannot delete quotations or projects.
--
--  Every policy is created defensively so this file can be re-run safely.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. VIEWS MUST RESPECT RLS
--    Postgres views run with the *owner's* rights unless security_invoker is on.
--    Without this, our reporting views would leak data past RLS.
-- -----------------------------------------------------------------------------
alter view if exists public.v_finish_package_rates set (security_invoker = on);
alter view if exists public.v_quotation_list       set (security_invoker = on);
alter view if exists public.v_project_progress     set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- 1. ENABLE RLS EVERYWHERE (default deny)
-- -----------------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.clients                 enable row level security;
alter table public.materials               enable row level security;
alter table public.price_refresh_log       enable row level security;
alter table public.finish_packages         enable row level security;
alter table public.finish_package_items    enable row level security;
alter table public.style_options           enable row level security;
alter table public.quotations              enable row level security;
alter table public.quotation_items         enable row level security;
alter table public.projects                enable row level security;
alter table public.project_status_updates  enable row level security;
alter table public.activity_log            enable row level security;
alter table public.doc_counters            enable row level security;

-- =============================================================================
-- 2. PROFILES
-- =============================================================================

-- A user may read their own profile; an Admin may read every profile.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

-- A user may update their own profile (name, phone, position, avatar).
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- An Admin may update any profile (role changes, deactivation).
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Only an Admin may insert or delete profile rows directly.
-- (Normal creation happens through the SECURITY DEFINER auth trigger.)
drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.is_admin() and id <> auth.uid());   -- cannot delete yourself

-- Guards privilege escalation: a non-Admin can never change their own role,
-- is_active flag or email through a plain UPDATE.
create or replace function public.tg_protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role       := old.role;
    new.is_active  := old.is_active;
    new.email      := old.email;
  end if;
  -- There must always be at least one active admin.
  if old.role = 'admin' and (new.role <> 'admin' or new.is_active = false) then
    if (select count(*) from public.profiles where role = 'admin' and is_active and id <> old.id) = 0 then
      raise exception 'At least one active Admin account must remain.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_fields on public.profiles;
create trigger trg_protect_profile_fields
  before update on public.profiles
  for each row execute function public.tg_protect_profile_fields();

-- =============================================================================
-- 3. CLIENTS  (Staff may manage the client book)
-- =============================================================================
drop policy if exists clients_select on public.clients;
create policy clients_select
  on public.clients for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists clients_insert on public.clients;
create policy clients_insert
  on public.clients for insert
  to authenticated with check (public.is_staff_or_admin());

drop policy if exists clients_update on public.clients;
create policy clients_update
  on public.clients for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists clients_delete_admin on public.clients;
create policy clients_delete_admin
  on public.clients for delete
  to authenticated using (public.is_admin());

-- =============================================================================
-- 4. MATERIALS AND PRICES  (read: everyone | write: Admin only)
-- =============================================================================
drop policy if exists materials_select on public.materials;
create policy materials_select
  on public.materials for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists materials_insert_admin on public.materials;
create policy materials_insert_admin
  on public.materials for insert
  to authenticated with check (public.is_admin());

drop policy if exists materials_update_admin on public.materials;
create policy materials_update_admin
  on public.materials for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists materials_delete_admin on public.materials;
create policy materials_delete_admin
  on public.materials for delete
  to authenticated using (public.is_admin());

drop policy if exists price_log_select on public.price_refresh_log;
create policy price_log_select
  on public.price_refresh_log for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists price_log_insert_admin on public.price_refresh_log;
create policy price_log_insert_admin
  on public.price_refresh_log for insert
  to authenticated with check (public.is_admin());

-- =============================================================================
-- 5. FINISH PACKAGES  (read: everyone | write: Admin only)
-- =============================================================================
drop policy if exists fpack_select on public.finish_packages;
create policy fpack_select
  on public.finish_packages for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists fpack_write_admin on public.finish_packages;
create policy fpack_write_admin
  on public.finish_packages for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists fpi_select on public.finish_package_items;
create policy fpi_select
  on public.finish_package_items for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists fpi_write_admin on public.finish_package_items;
create policy fpi_write_admin
  on public.finish_package_items for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- Style / layout multipliers are part of price settings -> Admin only writes.
drop policy if exists styleopt_select on public.style_options;
create policy styleopt_select
  on public.style_options for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists styleopt_write_admin on public.style_options;
create policy styleopt_write_admin
  on public.style_options for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 6. QUOTATIONS  (Staff may create and edit; only Admin may delete)
-- =============================================================================
drop policy if exists quotations_select on public.quotations;
create policy quotations_select
  on public.quotations for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists quotations_insert on public.quotations;
create policy quotations_insert
  on public.quotations for insert
  to authenticated with check (public.is_staff_or_admin());

drop policy if exists quotations_update on public.quotations;
create policy quotations_update
  on public.quotations for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists quotations_delete_admin on public.quotations;
create policy quotations_delete_admin
  on public.quotations for delete
  to authenticated using (public.is_admin());

drop policy if exists qitems_select on public.quotation_items;
create policy qitems_select
  on public.quotation_items for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists qitems_insert on public.quotation_items;
create policy qitems_insert
  on public.quotation_items for insert
  to authenticated with check (public.is_staff_or_admin());

drop policy if exists qitems_update on public.quotation_items;
create policy qitems_update
  on public.quotation_items for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists qitems_delete on public.quotation_items;
create policy qitems_delete
  on public.quotation_items for delete
  to authenticated
  using (public.is_staff_or_admin() or public.is_admin());

-- =============================================================================
-- 7. PROJECTS AND STATUS UPDATES
-- =============================================================================
drop policy if exists projects_select on public.projects;
create policy projects_select
  on public.projects for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists projects_insert on public.projects;
create policy projects_insert
  on public.projects for insert
  to authenticated with check (public.is_staff_or_admin());

drop policy if exists projects_update on public.projects;
create policy projects_update
  on public.projects for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists projects_delete_admin on public.projects;
create policy projects_delete_admin
  on public.projects for delete
  to authenticated using (public.is_admin());

drop policy if exists psu_select on public.project_status_updates;
create policy psu_select
  on public.project_status_updates for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists psu_insert on public.project_status_updates;
create policy psu_insert
  on public.project_status_updates for insert
  to authenticated with check (public.is_staff_or_admin());

drop policy if exists psu_update_admin on public.project_status_updates;
create policy psu_update_admin
  on public.project_status_updates for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists psu_delete_admin on public.project_status_updates;
create policy psu_delete_admin
  on public.project_status_updates for delete
  to authenticated using (public.is_admin());

-- =============================================================================
-- 8. ACTIVITY LOG  (append-only for everyone, readable by everyone on staff)
-- =============================================================================
drop policy if exists activity_select on public.activity_log;
create policy activity_select
  on public.activity_log for select
  to authenticated using (public.is_staff_or_admin());

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert
  on public.activity_log for insert
  to authenticated with check (public.is_staff_or_admin());

-- =============================================================================
-- 9. DOC COUNTERS
--    Deliberately NO policies: direct access is denied for everyone.
--    Numbering only happens through the SECURITY DEFINER function.
-- =============================================================================

-- =============================================================================
-- 10. SANITY CHECK - run this query after the file completes.
--     It should list every table above with rowsecurity = true.
-- =============================================================================
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' order by tablename;

-- =============================================================================
--  END OF 02_rls.sql  --  next: run 03_storage.sql
-- =============================================================================
