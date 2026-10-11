-- Webnox OS. Run the complete file; it is safe to repeat.
begin;

-- PART 1: Tenancy. Public registration is disabled separately in Auth settings.
do $$ begin create type workspace_type as enum('master_project','rented'); exception when duplicate_object then null; end $$;
do $$ begin create type workspace_status as enum('setup','trial','active','suspended','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type billing_cycle as enum('trial_7','trial_14','monthly','quarterly','yearly'); exception when duplicate_object then null; end $$;
do $$ begin create type billing_status as enum('trial','active','due_soon','due_today','overdue','suspended','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_method as enum('bank_transfer','other'); exception when duplicate_object then null; end $$;

create table if not exists workspaces(
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 64),
 short_code text not null unique check(short_code ~ '^[A-Z]{2,4}$'),
 type workspace_type not null default 'rented', status workspace_status not null default 'setup',
 logo_url text, country text, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 archived_at timestamptz, manual_suspension boolean not null default false,
 full_access boolean not null default false, full_access_at timestamptz,
 public_form_token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')
);
create table if not exists workspace_roles(
 workspace_id uuid not null references workspaces(id),
 role_key text not null check(role_key in('sales_rep','lead_gen','cold_caller','finance','project_manager')),
 active boolean not null default true,primary key(workspace_id,role_key)
);
create table if not exists profiles(
 id uuid primary key references auth.users(id),workspace_id uuid references workspaces(id),
 is_master boolean not null default false,name text not null check(length(trim(name)) between 1 and 120),
 email text not null,phone text,job_title text,department text,employee_id text,
 account_type text not null default 'member' check(account_type in('master','admin','member')),
 status text not null default 'active' check(status in('active','inactive')),
 joined_at timestamptz,last_seen_at timestamptz,created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,employee_id),
 constraint master_has_no_workspace check((is_master and workspace_id is null and account_type='master') or (not is_master and workspace_id is not null and account_type<>'master'))
);
create unique index if not exists one_master on profiles(is_master) where is_master;
create unique index if not exists profile_email_unique on profiles(lower(email));
create unique index if not exists one_admin_per_workspace on profiles(workspace_id) where account_type='admin' and status='active';
create index if not exists profiles_workspace on profiles(workspace_id);

create or replace function current_workspace() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select p.workspace_id from profiles p join workspaces w on w.id=p.workspace_id where p.id=auth.uid() and p.status='active' and not p.is_master and w.status in('active','trial')
$$;
create or replace function is_master() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select is_master and status='active' from profiles where id=auth.uid()),false)
$$;
create or replace function own_profile(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select target=auth.uid()$$;
create or replace function is_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from profiles where id=auth.uid() and workspace_id=current_workspace() and account_type='admin' and status='active')
$$;
create or replace function billing_workspace() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select p.workspace_id from profiles p join workspaces w on w.id=p.workspace_id where p.id=auth.uid() and p.status='active' and p.account_type='admin' and w.status not in('setup','archived')
$$;
create or replace function master_can_read(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select is_master() and exists(select 1 from workspaces where id=target and full_access)
$$;
create or replace function workspace_has_role(target_role text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select current_workspace() is not null and (target_role in('admin','manager') or exists(select 1 from workspace_roles where workspace_id=current_workspace() and role_key=target_role and active))
$$;
create or replace function set_workspace_id() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare expected uuid; begin
 if auth.uid() is not null and not is_master() then
  expected:=current_workspace();
  if expected is null then raise exception 'Workspace access is not permitted'; end if;
  if new.workspace_id is not null and new.workspace_id<>expected then raise exception 'Workspace mismatch'; end if;
  new.workspace_id:=expected;
 end if;
 return new;
end $$;
create or replace function slug_normalise() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.slug:=trim(both '-' from regexp_replace(lower(trim(new.slug)),'[^a-z0-9]+','-','g'));new.short_code:=upper(trim(new.short_code));return new;end $$;
drop trigger if exists slug_normalise on workspaces;
create trigger slug_normalise before insert or update of slug,short_code on workspaces for each row execute function slug_normalise();

-- PART 2: Accounts, settings and append-only audit history.
create table if not exists member_roles(
 workspace_id uuid not null references workspaces(id),user_id uuid not null,role_key text not null check(role_key in('manager','sales_rep','lead_gen','cold_caller','finance','project_manager')),
 primary key(workspace_id,user_id,role_key),foreign key(workspace_id,user_id) references profiles(workspace_id,id)
);
create table if not exists app_settings(
 workspace_id uuid primary key references workspaces(id),company_name text not null,timezone text not null default 'Asia/Karachi',
 idle_minutes integer not null default 5 check(idle_minutes between 1 and 60),app_currency text not null default 'PKR' check(app_currency~'^[A-Z]{3}$'),
 invoice_details jsonb not null default '{}',due_days integer not null default 7 check(due_days>=0),pause_days integer not null default 14 check(pause_days>=0),
 departments jsonb not null default '[]',designations jsonb not null default '[]',updated_at timestamptz not null default now()
);
create table if not exists activity_logs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),actor_id uuid references profiles(id),
 action text not null,entity_type text,entity_id uuid,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create index if not exists activity_logs_workspace on activity_logs(workspace_id,created_at desc);
create table if not exists role_permissions(
 workspace_id uuid not null references workspaces(id),role_key text not null,module text not null,
 view boolean not null default false,edit boolean not null default false,delete boolean not null default false,
 primary key(workspace_id,role_key,module)
);
create or replace function is_manager_id(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from profiles p where p.id=target and p.workspace_id=current_workspace() and p.status='active' and (p.account_type='admin' or exists(select 1 from member_roles r where r.workspace_id=p.workspace_id and r.user_id=p.id and r.role_key='manager')))
$$;
create or replace function is_manager() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select is_manager_id(auth.uid())$$;
create or replace function has_role(target_role text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select workspace_has_role(target_role) and exists(select 1 from member_roles where workspace_id=current_workspace() and user_id=auth.uid() and role_key=target_role)
$$;
create or replace function perm(target_module text,target_action text default 'view') returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select current_workspace() is not null and target_action in('view','edit','delete') and (is_admin() or
 (is_manager() and target_module not in('settings','permissions','billing')) or
 exists(select 1 from role_permissions p join member_roles r using(workspace_id,role_key) where p.workspace_id=current_workspace() and r.user_id=auth.uid() and workspace_has_role(p.role_key) and p.module=target_module and case target_action when 'view' then p.view when 'edit' then p.edit when 'delete' then p.delete else false end))
$$;
create or replace function log_activity(p_action text,p_entity text default null,p_id uuid default null,p_detail jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into activity_logs(workspace_id,actor_id,action,entity_type,entity_id,detail) values(current_workspace(),auth.uid(),p_action,p_entity,p_id,p_detail);end $$;
create or replace function employee_code_before() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;begin
 if tg_op='UPDATE' then
  if new.workspace_id is distinct from old.workspace_id or new.id<>old.id or new.employee_id is distinct from old.employee_id or new.is_master<>old.is_master or new.email<>old.email then raise exception 'Account identity is immutable';end if;
 elsif not new.is_master then
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
  select coalesce(max(substring(employee_id from 5)::integer),0)+1 into n from profiles where workspace_id=new.workspace_id;
  new.employee_id:='EMP-'||lpad(n::text,greatest(4,length(n::text)), '0');
 end if;return new;
end $$;
drop trigger if exists employee_code_before on profiles;
create trigger employee_code_before before insert or update on profiles for each row execute function employee_code_before();
create or replace function workspace_people_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare wid uuid;begin
 if tg_table_name='workspaces' then wid:=coalesce(new.id,old.id);else wid:=coalesce(new.workspace_id,old.workspace_id);end if;
 if exists(select 1 from workspaces where id=wid and status in('active','trial')) then
  if (select count(*) from profiles where workspace_id=wid and account_type='admin' and status='active')<>1 then raise exception 'A workspace needs exactly one active admin';end if;
  if not exists(select 1 from profiles p join member_roles r on r.user_id=p.id and r.workspace_id=p.workspace_id where p.workspace_id=wid and p.status='active' and r.role_key='manager') then raise exception 'A workspace needs at least one active manager';end if;
 end if;return null;
end $$;
do $$declare t text;begin foreach t in array array['profiles','member_roles','workspaces'] loop
 execute format('drop trigger if exists people_guard on %I',t);
 execute format('create constraint trigger people_guard after insert or update or delete on %I deferrable initially deferred for each row execute function workspace_people_guard()',t);
end loop;end $$;
create or replace function workspace_seed_after() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into app_settings(workspace_id,company_name) values(new.id,new.name);
 insert into workspace_roles(workspace_id,role_key) select new.id,unnest(array['sales_rep','lead_gen','cold_caller','finance','project_manager']);
 insert into role_permissions(workspace_id,role_key,module,view,edit,delete) values
 (new.id,'lead_gen','leads',true,true,false),(new.id,'sales_rep','leads',true,true,false),(new.id,'sales_rep','clients',true,false,false),
 (new.id,'cold_caller','leads',true,true,false),(new.id,'finance','clients',true,false,false),(new.id,'finance','finance',true,true,true),
 (new.id,'project_manager','projects',true,true,false);
 return new;
end $$;
drop trigger if exists workspace_seed_after on workspaces;
create trigger workspace_seed_after after insert on workspaces for each row execute function workspace_seed_after();

-- New Auth identities remain unprovisioned until the trusted provisioning RPC commits.
-- Never turn user-editable user_metadata into authorization or workspace membership.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin return new;end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create or replace function promote_to_master(email text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u auth.users;begin
 select * into u from auth.users a where lower(a.email)=lower(promote_to_master.email);
 if u.id is null then raise exception 'Create the Auth user first';end if;
 if exists(select 1 from profiles where id=u.id and not is_master) then raise exception 'Use a separate email for the Master';end if;
 insert into profiles(id,is_master,name,email,account_type) values(u.id,true,'Haseeb Gul',u.email,'master') on conflict(id) do nothing;
end $$;
create or replace function boot_context() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p profiles;w workspaces;settings app_settings;roles jsonb;permissions jsonb;begin
 select * into p from profiles where id=auth.uid();if p.id is null then return null;end if;
 if p.is_master then return jsonb_build_object('profile',to_jsonb(p),'roles','[]'::jsonb,'permissions','[]'::jsonb);end if;
 select * into w from workspaces where id=p.workspace_id;
 if current_workspace() is not null then
 select * into settings from app_settings where workspace_id=p.workspace_id;
 select coalesce(jsonb_agg(role_key),'[]') into roles from member_roles where workspace_id=p.workspace_id and user_id=p.id and workspace_has_role(role_key);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into permissions from role_permissions r where workspace_id=p.workspace_id and workspace_has_role(role_key);
 end if;
 return jsonb_build_object('profile',to_jsonb(p),'workspace',jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug,'logo_url',w.logo_url,'status',w.status,'type',w.type,'short_code',w.short_code),'settings',to_jsonb(settings),'roles',coalesce(roles,'[]'),'permissions',coalesce(permissions,'[]'));
end $$;
create or replace function team_directory() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('roles',(select coalesce(jsonb_agg(r.role_key),'[]') from member_roles r where r.workspace_id=p.workspace_id and r.user_id=p.id and workspace_has_role(r.role_key))) order by p.created_at),'[]') from profiles p where p.workspace_id=current_workspace() and not p.is_master
$$;
create or replace function admin_save_member(target uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;r text;begin
 if not is_admin() then raise exception 'Not permitted';end if;
 perform 1 from workspaces where id=current_workspace() for update;
 select * into p from profiles where id=target and workspace_id=current_workspace() for update;
 if p.id is null then raise exception 'Member not found';end if;
 if payload?'roles' then
  if jsonb_typeof(payload->'roles')<>'array' then raise exception 'Choose valid roles';end if;
  for r in select jsonb_array_elements_text(payload->'roles') loop
   if r='admin' or not workspace_has_role(r) then raise exception 'Role is not available';end if;
  end loop;
  delete from member_roles where workspace_id=p.workspace_id and user_id=p.id;
  insert into member_roles(workspace_id,user_id,role_key) select p.workspace_id,p.id,jsonb_array_elements_text(payload->'roles');
 end if;
 update profiles set name=coalesce(nullif(trim(payload->>'name'),''),name),phone=coalesce(payload->>'phone',phone),job_title=coalesce(payload->>'job_title',job_title),department=coalesce(payload->>'department',department) where id=p.id returning * into p;
 perform log_activity('member_updated','profile',p.id);return to_jsonb(p);
end $$;
create or replace function admin_set_member_status(target uuid,new_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;begin
 if not is_admin() then raise exception 'Not permitted';end if;
 perform 1 from workspaces where id=current_workspace() for update;
 select * into p from profiles where id=target and workspace_id=current_workspace() for update;
 if p.id is null then raise exception 'Member not found';end if;
 if p.account_type='admin' then raise exception 'The workspace admin must remain active';end if;
 update profiles set status=new_status where id=p.id;
 perform log_activity('member_'||new_status,'profile',p.id);
end $$;
create or replace function save_profile(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if current_workspace() is null and not is_master() then raise exception 'Not permitted';end if;
update profiles set name=coalesce(nullif(trim(payload->>'name'),''),name),phone=coalesce(payload->>'phone',phone) where id=auth.uid();end $$;
create or replace function save_settings(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not is_admin() then raise exception 'Not permitted';end if;
 if payload?'timezone' and not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone';end if;
 update app_settings set company_name=coalesce(nullif(trim(payload->>'company_name'),''),company_name),timezone=coalesce(payload->>'timezone',timezone),app_currency=coalesce(payload->>'app_currency',app_currency),idle_minutes=coalesce((payload->>'idle_minutes')::integer,idle_minutes),invoice_details=coalesce(payload->'invoice_details',invoice_details),due_days=coalesce((payload->>'due_days')::integer,due_days),pause_days=coalesce((payload->>'pause_days')::integer,pause_days),updated_at=now() where workspace_id=current_workspace();
 perform log_activity('settings_updated');end $$;

-- RLS is paired with grants: business writes happen only in guarded RPCs.
do $$declare t text;begin foreach t in array array['workspaces','workspace_roles','profiles','member_roles','app_settings','role_permissions','activity_logs'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
 if t<>'workspaces' then
 execute format('drop trigger if exists tenant_insert on %I',t);
 execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',t);
 end if;
end loop;end $$;
drop policy if exists workspace_read on workspaces;
create policy workspace_read on workspaces for select to authenticated using(id=current_workspace() or id=billing_workspace());
drop policy if exists workspace_master on workspaces;
create policy workspace_master on workspaces for select to authenticated using(is_master());
drop policy if exists profile_read on profiles;
create policy profile_read on profiles for select to authenticated using(workspace_id=current_workspace() or own_profile(id));
do $$declare t text;begin foreach t in array array['workspace_roles','member_roles','app_settings','role_permissions','activity_logs'] loop
 execute format('drop policy if exists tenant_read on %I',t);
 execute format('create policy tenant_read on %I for select to authenticated using(workspace_id=current_workspace())',t);
end loop;end $$;
drop policy if exists master_activity on activity_logs;
create policy master_activity on activity_logs for select to authenticated using(is_master());
drop policy if exists master_roles on workspace_roles;
create policy master_roles on workspace_roles for select to authenticated using(is_master());
create or replace view master_member_list with(security_barrier=true) as select workspace_id,id,name,job_title,department,status,last_seen_at from profiles where not is_master and public.is_master();
revoke all on master_member_list from anon,authenticated;
grant select on master_member_list to authenticated;

-- Brand files are public assets; only the Admin or Master may upload a logo.
create or replace function can_brand_file(file_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select file_path ~ '^w[0-9a-f-]{36}/logo\.(png|jpg|jpeg|webp|svg)$' and
 ((split_part(file_path,'/',1)='w'||current_workspace()::text and is_admin()) or (is_master() and exists(select 1 from workspaces where 'w'||id::text=split_part(file_path,'/',1))))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('brand','brand',true,307200,array['image/png','image/jpeg','image/webp','image/svg+xml']) on conflict(id) do update set public=true,file_size_limit=307200,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists webnox_brand_read on storage.objects;
create policy webnox_brand_read on storage.objects for select to anon,authenticated using(bucket_id='brand');
drop policy if exists webnox_brand_insert on storage.objects;
create policy webnox_brand_insert on storage.objects for insert to authenticated with check(bucket_id='brand' and can_brand_file(name));
drop policy if exists webnox_brand_update on storage.objects;
create policy webnox_brand_update on storage.objects for update to authenticated using(bucket_id='brand' and can_brand_file(name)) with check(bucket_id='brand' and can_brand_file(name));

-- Workspace provisioning (Auth identities are created on the server first).
create table if not exists subscriptions(
 workspace_id uuid primary key references workspaces(id),plan_name text,cycle billing_cycle not null,next_cycle billing_cycle,
 amount_original numeric(14,2) not null check(amount_original>=0),currency text not null check(currency~'^[A-Z]{3}$'),fx_rate numeric(14,6) not null check(fx_rate>0),
 amount numeric(14,2) not null,start_date date not null,trial_ends_on date,next_due date,grace_days integer not null default 7 check(grace_days between 0 and 90),
 member_limit integer check(member_limit>0),status billing_status not null,suspended_at timestamptz,cancelled_at timestamptz,notes text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(next_cycle is null or next_cycle in('monthly','quarterly','yearly'))
);
alter table subscriptions enable row level security;
revoke all on subscriptions from anon,authenticated;
grant select on subscriptions to authenticated;
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select to authenticated using(workspace_id=billing_workspace());
drop policy if exists sub_master on subscriptions;
create policy sub_master on subscriptions for select to authenticated using(is_master());
create or replace function advance_due(from_date date,cycle billing_cycle) returns date language sql immutable set search_path=public,pg_temp as $$
select (from_date+case cycle when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' when 'trial_7' then interval '7 days' when 'trial_14' then interval '14 days' end)::date
$$;
create or replace function master_create_workspace(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;a auth.users;m auth.users;r text;c billing_cycle;start_on date;trial_end date;begin
 if not is_master() then raise exception 'Not permitted';end if;
 if (payload->>'admin_id')=(payload->>'manager_id') then raise exception 'Admin and manager need separate accounts';end if;
 select * into a from auth.users where id=(payload->>'admin_id')::uuid;
 select * into m from auth.users where id=(payload->>'manager_id')::uuid;
 if a.id is null or m.id is null or exists(select 1 from profiles where id in(a.id,m.id)) then raise exception 'Use two new email addresses';end if;
 if not exists(select 1 from pg_timezone_names where name=coalesce(payload->>'timezone','Asia/Karachi')) then raise exception 'Choose a valid timezone';end if;
 insert into workspaces(name,slug,short_code,type,country,created_by) values(trim(payload->>'name'),payload->>'slug',payload->>'short_code',(payload->>'type')::workspace_type,payload->>'country',auth.uid()) returning * into w;
 update workspace_roles set active=(payload->'roles')?role_key where workspace_id=w.id;
 delete from role_permissions where workspace_id=w.id and role_key not in(select role_key from workspace_roles where workspace_id=w.id and active);
 update app_settings set timezone=coalesce(payload->>'timezone','Asia/Karachi'),app_currency=coalesce(payload->>'app_currency','PKR') where workspace_id=w.id;
 insert into profiles(id,workspace_id,name,email,account_type,job_title,department) values(a.id,w.id,payload->>'admin_name',a.email,'admin',coalesce(payload->>'admin_title','Business owner'),'Management'),(m.id,w.id,payload->>'manager_name',m.email,'member',coalesce(payload->>'manager_title','Manager'),'Management');
 insert into member_roles(workspace_id,user_id,role_key) values(w.id,m.id,'manager');
 if w.type='rented' then
  c:=(payload->>'cycle')::billing_cycle;start_on:=coalesce((payload->>'start_date')::date,current_date);
  if c in('trial_7','trial_14') then trial_end:=advance_due(start_on,c);end if;
  insert into subscriptions(workspace_id,plan_name,cycle,next_cycle,amount_original,currency,fx_rate,amount,start_date,trial_ends_on,next_due,grace_days,member_limit,status)
  values(w.id,payload->>'plan_name',c,case when trial_end is not null then coalesce((payload->>'next_cycle')::billing_cycle,'monthly') end,(payload->>'amount')::numeric,payload->>'currency',(payload->>'fx_rate')::numeric,round((payload->>'amount')::numeric*(payload->>'fx_rate')::numeric,2),start_on,trial_end,case when trial_end is null then start_on end,coalesce((payload->>'grace_days')::integer,7),nullif(payload->>'member_limit','')::integer,case when trial_end is null then 'due_today'::billing_status else 'trial'::billing_status end);
 end if;
 update workspaces set status=case when trial_end is null then 'active'::workspace_status else 'trial'::workspace_status end where id=w.id returning * into w;
 insert into activity_logs(workspace_id,actor_id,action) values(w.id,auth.uid(),'workspace_created');
 return to_jsonb(w);
end $$;
create or replace function admin_add_member(target uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u auth.users;p profiles;r text;begin
 if not is_admin() then raise exception 'Not permitted';end if;
 select * into u from auth.users where id=target;
 if u.id is null or exists(select 1 from profiles where id=target) then raise exception 'Use a new email address';end if;
 if jsonb_typeof(payload->'roles') is distinct from 'array' then raise exception 'Choose at least one role';end if;
 if jsonb_array_length(payload->'roles')=0 then raise exception 'Choose at least one role';end if;
 for r in select jsonb_array_elements_text(payload->'roles') loop
  if r='admin' or not workspace_has_role(r) then raise exception 'Role is not available';end if;
 end loop;
 insert into profiles(id,workspace_id,name,email,job_title,department,phone) values(u.id,current_workspace(),payload->>'name',u.email,payload->>'job_title',payload->>'department',payload->>'phone') returning * into p;
 insert into member_roles(workspace_id,user_id,role_key) select p.workspace_id,p.id,jsonb_array_elements_text(payload->'roles');
 perform log_activity('member_created','profile',p.id);return to_jsonb(p);
end $$;
create or replace function master_workspace_list() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not is_master() then raise exception 'Not permitted';end if;
return(select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('member_count',(select count(*) from profiles p where p.workspace_id=w.id),'subscription',(select to_jsonb(s) from subscriptions s where s.workspace_id=w.id)) order by w.created_at desc),'[]') from workspaces w);end $$;
create or replace function master_set_roles(workspace uuid,roles text[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r text;begin
 if not is_master() then raise exception 'Not permitted';end if;
 if not exists(select 1 from workspaces where id=workspace) then raise exception 'Workspace not found';end if;
 foreach r in array roles loop if r not in('sales_rep','lead_gen','cold_caller','finance','project_manager') then raise exception 'Unknown role';end if;end loop;
 update workspace_roles set active=role_key=any(roles) where workspace_id=workspace;
 delete from role_permissions where workspace_id=workspace and role_key not in('manager') and not role_key=any(roles);
 insert into role_permissions(workspace_id,role_key,module,view,edit,delete)
 select workspace,r,case when r='finance' then 'finance' when r='project_manager' then 'projects' else 'leads' end,true,true,r='finance' from unnest(roles) r on conflict do nothing;
 insert into role_permissions(workspace_id,role_key,module,view) select workspace,r,'clients',true from unnest(roles) r where r in('sales_rep','finance') on conflict do nothing;
 insert into activity_logs(workspace_id,actor_id,action,detail) values(workspace,auth.uid(),'roles_changed',jsonb_build_object('roles',roles));
end $$;

-- Shared serverless rate limiting. Keys are HMAC IP digests, never raw addresses.
create table if not exists public_rate_limits(key text primary key,window_start timestamptz not null,hits integer not null);
alter table public_rate_limits enable row level security;
revoke all on public_rate_limits from anon,authenticated;
create or replace function check_public_rate_limit(bucket_key text,max_hits integer) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare count_now integer;begin
 insert into public_rate_limits(key,window_start,hits) values(bucket_key,clock_timestamp(),1)
 on conflict(key) do update set hits=case when public_rate_limits.window_start<clock_timestamp()-interval '1 minute' then 1 else public_rate_limits.hits+1 end,window_start=case when public_rate_limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else public_rate_limits.window_start end returning hits into count_now;
 delete from public_rate_limits where window_start<now()-interval '1 day';return count_now<=max_hits;
end $$;
revoke all on function check_public_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function check_public_rate_limit(text,integer) to service_role;

-- Grant only documented entry points. Trigger/internal functions remain private.
do $$declare f record;begin for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['current_workspace','is_master','own_profile','is_admin','billing_workspace','master_can_read','workspace_has_role','set_workspace_id','slug_normalise','is_manager_id','is_manager','has_role','perm','log_activity','employee_code_before','workspace_people_guard','workspace_seed_after','handle_new_user','promote_to_master','boot_context','team_directory','admin_save_member','admin_set_member_status','save_profile','save_settings','can_brand_file']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname=any(array['current_workspace','is_master','own_profile','is_admin','billing_workspace','master_can_read','workspace_has_role','is_manager_id','is_manager','has_role','perm','boot_context','team_directory','admin_save_member','admin_set_member_status','save_profile','save_settings','can_brand_file']) then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;
grant usage on schema public to authenticated,anon,service_role;
grant all on all tables in schema public to service_role;
grant execute on function promote_to_master(text) to service_role;
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname=any(array['advance_due','master_create_workspace','admin_add_member','master_workspace_list','master_set_roles']) loop
execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
commit;
-- Done. Next: create your Master user (see README, step 2).
