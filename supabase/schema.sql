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
alter table profiles add column if not exists platform_role text not null default 'owner' check(platform_role in('owner','admin','support'));
create unique index if not exists one_platform_owner on profiles(is_master) where is_master and platform_role='owner';
create unique index if not exists profile_email_unique on profiles(lower(email));
create unique index if not exists one_admin_per_workspace on profiles(workspace_id) where account_type='admin' and status='active';
create index if not exists profiles_workspace on profiles(workspace_id);

alter table workspaces add column if not exists business_details jsonb not null default '{}';
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
 if auth.uid() is not null and not exists(select 1 from profiles where id=auth.uid() and is_master and status='active') then
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
 return jsonb_build_object('profile',to_jsonb(p),'workspace',jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug,'logo_url',w.logo_url,'status',w.status,'type',w.type,'short_code',w.short_code,'public_form_token',case when p.account_type='admin' then w.public_form_token end),'settings',to_jsonb(settings),'roles',coalesce(roles,'[]'),'permissions',coalesce(permissions,'[]'));
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
 select file_path ~ '^w[0-9a-f-]{36}/(logo|[0-9a-f-]{36})\.(png|jpg|jpeg|webp|svg)$' and
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
 perform validate_business_details(payload);
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
 update profiles set phone=case when id=a.id then payload->>'admin_phone' else payload->>'manager_phone' end where id in(a.id,m.id);
 update workspaces set business_details=jsonb_strip_nulls(jsonb_build_object('legal_name',payload->>'legal_name','industry',payload->>'industry','website',payload->>'website','business_email',payload->>'business_email','business_phone',payload->>'business_phone','address',payload->>'address','city',payload->>'city','region',payload->>'region','postal_code',payload->>'postal_code','tax_id',payload->>'tax_id','description',payload->>'description')) where id=w.id;
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
 select workspace,x.role_key,case when x.role_key='finance' then 'finance' when x.role_key='project_manager' then 'projects' else 'leads' end,true,true,x.role_key='finance' from unnest(roles) x(role_key) on conflict do nothing;
 insert into role_permissions(workspace_id,role_key,module,view) select workspace,x.role_key,'clients',true from unnest(roles) x(role_key) where x.role_key in('sales_rep','finance') on conflict do nothing;
 perform master_audit(workspace,'role_changed',jsonb_build_object('roles',roles));
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

-- PART 3: Tasks, review and comments. Project links are added in Part 8.
create table if not exists tasks(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),
 title text not null check(length(trim(title)) between 1 and 240),description text not null default '',
 status text not null default 'todo' check(status in('todo','in_progress','in_review','completed')),
 priority text not null default 'medium' check(priority in('low','medium','high','urgent')),
 assignee_id uuid not null,created_by uuid not null,due_date date,project_id uuid,client_id uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,archived_at timestamptz,
 unique(workspace_id,id),foreign key(workspace_id,assignee_id) references profiles(workspace_id,id),foreign key(workspace_id,created_by) references profiles(workspace_id,id)
);
create table if not exists task_comments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),task_id uuid not null,user_id uuid not null,
 body text not null check(length(trim(body)) between 1 and 10000),created_at timestamptz not null default now(),
 foreign key(workspace_id,task_id) references tasks(workspace_id,id),foreign key(workspace_id,user_id) references profiles(workspace_id,id)
);
create index if not exists tasks_workspace on tasks(workspace_id,status,due_date);
create index if not exists task_comments_workspace on task_comments(workspace_id,task_id,created_at);
create or replace function can_task(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from tasks where id=target and workspace_id=current_workspace() and (is_manager() or assignee_id=auth.uid() or created_by=auth.uid()))
$$;
create or replace function task_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;assignee uuid;project uuid;begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 assignee:=coalesce(nullif(payload->>'assignee_id','')::uuid,auth.uid());
 project:=nullif(payload->>'project_id','')::uuid;
 if nullif(payload->>'id','') is not null then select * into t from tasks where id=(payload->>'id')::uuid and workspace_id=current_workspace();project:=coalesce(project,t.project_id);end if;
 if project is not null and not pm_perm(project,'edit') then raise exception 'Project not found or not permitted';end if;
 if not is_manager() and assignee<>auth.uid() and not (project is not null and pm_perm(project,'edit') and exists(select 1 from project_members where project_id=project and user_id=assignee and status='approved')) then raise exception 'Only a manager can assign another person';end if;
 if not exists(select 1 from profiles where id=assignee and workspace_id=current_workspace() and status='active' and not is_master) then raise exception 'Choose an active assignee in the same workspace';end if;
 if nullif(payload->>'id','') is null then
  insert into tasks(workspace_id,title,description,priority,assignee_id,created_by,due_date,project_id) values(current_workspace(),trim(payload->>'title'),coalesce(payload->>'description',''),coalesce(payload->>'priority','medium'),assignee,auth.uid(),nullif(payload->>'due_date','')::date,project) returning * into t;
  perform log_activity('task_created','task',t.id);
 else
  select * into t from tasks where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;
  if t.id is null or not(is_manager() or t.created_by=auth.uid() or pm_perm(t.project_id,'edit')) then raise exception 'Task not found or not permitted';end if;
  update tasks set title=trim(payload->>'title'),description=coalesce(payload->>'description',''),priority=coalesce(payload->>'priority','medium'),assignee_id=assignee,due_date=nullif(payload->>'due_date','')::date,project_id=project,updated_at=now() where id=t.id returning * into t;
  perform log_activity('task_updated','task',t.id);
 end if;return to_jsonb(t);
end $$;
create or replace function task_set_status(target uuid,new_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;begin
 select * into t from tasks where id=target and workspace_id=current_workspace() for update;
 if t.id is null or not(t.assignee_id=auth.uid() or is_manager() or pm_perm(t.project_id,'edit')) then raise exception 'Task not found or not permitted';end if;
 if new_status='completed' then raise exception 'Submit this task for review first';end if;
 if new_status not in('todo','in_progress','in_review') then raise exception 'Choose a valid status';end if;
 if t.status='completed' and not (is_manager() or pm_perm(t.project_id,'edit')) then raise exception 'Ask a manager to reopen this task';end if;
 update tasks set status=new_status,updated_at=now(),completed_at=null where id=t.id;
 perform log_activity('task_status_changed','task',t.id,jsonb_build_object('from',t.status,'to',new_status));
end $$;
create or replace function task_review(target uuid,approve boolean,reason text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;begin
 select * into t from tasks where id=target and workspace_id=current_workspace() for update;
 if t.id is null or not(is_manager() or pm_perm(t.project_id,'edit')) then raise exception 'Not permitted';end if;
 if t.status<>'in_review' then raise exception 'This task is not awaiting review';end if;
 if not approve and length(trim(reason))=0 then raise exception 'Describe the changes needed';end if;
 update tasks set status=case when approve then 'completed' else 'in_progress' end,completed_at=case when approve then now() end,updated_at=now() where id=t.id;
 if length(trim(reason))>0 then insert into task_comments(workspace_id,task_id,user_id,body) values(t.workspace_id,t.id,auth.uid(),reason);end if;
 perform log_activity(case when approve then 'task_approved' else 'task_changes_requested' end,'task',t.id);
end $$;
create or replace function task_comment(target uuid,message text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not can_task(target) then raise exception 'Not permitted';end if;
 insert into task_comments(workspace_id,task_id,user_id,body) values(current_workspace(),target,auth.uid(),trim(message));
 perform log_activity('task_comment_added','task',target);end $$;
do $$declare tab text;begin foreach tab in array array['tasks','task_comments'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop trigger if exists tenant_insert on %I',tab);execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(master_can_read(workspace_id))',tab);
end loop;end $$;
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated using(workspace_id=current_workspace() and can_task(id));
drop policy if exists comments_read on task_comments;
create policy comments_read on task_comments for select to authenticated using(workspace_id=current_workspace() and can_task(task_id));
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname=any(array['can_task','task_save','task_set_status','task_review','task_comment']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;

-- PART 4: Presence and timers. All timestamps and durations are server-owned.
create table if not exists user_sessions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),user_id uuid not null,
 started_at timestamptz not null default now(),last_heartbeat_at timestamptz not null default now(),ended_at timestamptz,
 presence text not null default 'active' check(presence in('active','idle')),end_reason text check(end_reason in('sign_out','stale','revoked')),
 unique(workspace_id,id),foreign key(workspace_id,user_id) references profiles(workspace_id,id),check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists one_open_session on user_sessions(user_id) where ended_at is null;
create index if not exists sessions_workspace on user_sessions(workspace_id,user_id,started_at);
create table if not exists activity_intervals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),user_id uuid not null,session_id uuid not null,
 state text not null check(state in('active','idle')),started_at timestamptz not null default now(),ended_at timestamptz not null default now(),
 foreign key(workspace_id,user_id) references profiles(workspace_id,id),foreign key(workspace_id,session_id) references user_sessions(workspace_id,id),check(ended_at>=started_at)
);
create index if not exists activity_intervals_scope on activity_intervals(workspace_id,user_id,started_at);
create table if not exists task_time_entries(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),user_id uuid not null,task_id uuid not null,
 started_at timestamptz not null default now(),last_heartbeat_at timestamptz not null default now(),ended_at timestamptz,
 end_reason text check(end_reason in('paused','stopped','auto_paused','review','sign_out','revoked')),
 foreign key(workspace_id,user_id) references profiles(workspace_id,id),foreign key(workspace_id,task_id) references tasks(workspace_id,id),check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists one_running_timer on task_time_entries(user_id) where ended_at is null;
create index if not exists task_time_scope on task_time_entries(workspace_id,task_id,user_id,started_at);

create or replace function sweep_stale_sessions() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null and not is_master() then raise exception 'Not permitted';end if;
 update user_sessions s set ended_at=last_heartbeat_at,end_reason='stale' where ended_at is null and last_heartbeat_at<now()-interval '3 minutes' and (workspace_id=current_workspace() or is_master());
 update task_time_entries set ended_at=last_heartbeat_at,end_reason='auto_paused' where ended_at is null and last_heartbeat_at<now()-interval '20 minutes' and (workspace_id=current_workspace() or is_master());
end $$;
create or replace function session_start() returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s user_sessions;begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform 1 from profiles where id=auth.uid() for update;
 perform sweep_stale_sessions();
 select * into s from user_sessions where user_id=auth.uid() and workspace_id=current_workspace() and ended_at is null;
 if s.id is null then
  insert into user_sessions(workspace_id,user_id) values(current_workspace(),auth.uid()) returning * into s;
  insert into activity_intervals(workspace_id,user_id,session_id,state) values(s.workspace_id,s.user_id,s.id,'active');
  update profiles set joined_at=coalesce(joined_at,now()),last_seen_at=now() where id=auth.uid();
 end if;return s.id;
end $$;
create or replace function session_heartbeat(target uuid,active boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s user_sessions;i activity_intervals;next_state text;begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform 1 from profiles where id=auth.uid() for update;
 perform sweep_stale_sessions();
 select * into s from user_sessions where id=target and user_id=auth.uid() and workspace_id=current_workspace() and ended_at is null for update;
 if s.id is null then return jsonb_build_object('expired',true);end if;
 next_state:=case when active then 'active' else 'idle' end;
 select * into i from activity_intervals where session_id=s.id order by started_at desc,id desc limit 1 for update;
 update activity_intervals set ended_at=now() where id=i.id;
 if i.state<>next_state then insert into activity_intervals(workspace_id,user_id,session_id,state) values(s.workspace_id,s.user_id,s.id,next_state);end if;
 update user_sessions set last_heartbeat_at=now(),presence=next_state where id=s.id;
 update profiles set last_seen_at=now() where id=auth.uid();
 if active then update task_time_entries set last_heartbeat_at=now() where user_id=auth.uid() and workspace_id=s.workspace_id and ended_at is null;end if;
 return jsonb_build_object('expired',false,'presence',next_state,'server_time',now());
end $$;
create or replace function session_end() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s user_sessions;begin
 perform 1 from profiles where id=auth.uid() for update;
 for s in select * from user_sessions where user_id=auth.uid() and ended_at is null for update loop
  update user_sessions set ended_at=case when last_heartbeat_at<now()-interval '3 minutes' then last_heartbeat_at else now() end,end_reason='sign_out' where id=s.id;
  update activity_intervals set ended_at=case when s.last_heartbeat_at<now()-interval '3 minutes' then s.last_heartbeat_at else now() end where id=(select id from activity_intervals where session_id=s.id order by started_at desc,id desc limit 1);
 end loop;
 update task_time_entries set ended_at=case when last_heartbeat_at<now()-interval '20 minutes' then last_heartbeat_at else now() end,end_reason='sign_out' where user_id=auth.uid() and ended_at is null;
end $$;
create or replace function timer_start(target uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;e task_time_entries;begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform 1 from profiles where id=auth.uid() for update;
 perform sweep_stale_sessions();
 select * into t from tasks where id=target and workspace_id=current_workspace() and assignee_id=auth.uid() and archived_at is null for update;
 if t.id is null then raise exception 'Start a timer on a task assigned to you';end if;
 if t.status not in('todo','in_progress') then raise exception 'This task is awaiting review or completed';end if;
 select * into e from task_time_entries where user_id=auth.uid() and ended_at is null;
 if e.id is not null then
  if e.task_id=target then return to_jsonb(e);end if;
  update task_time_entries set ended_at=now(),end_reason='paused' where id=e.id;
 end if;
 insert into task_time_entries(workspace_id,user_id,task_id) values(t.workspace_id,auth.uid(),t.id) returning * into e;
 update tasks set status='in_progress',updated_at=now() where id=t.id;
 perform log_activity('timer_started','task',t.id);return to_jsonb(e);
end $$;
create or replace function timer_pause() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform 1 from profiles where id=auth.uid() for update;
 perform sweep_stale_sessions();
 update task_time_entries set ended_at=now(),end_reason='paused' where user_id=auth.uid() and workspace_id=current_workspace() and ended_at is null;
end $$;
create or replace function timer_stop() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform 1 from profiles where id=auth.uid() for update;
 perform sweep_stale_sessions();
 update task_time_entries set ended_at=now(),end_reason='stopped' where user_id=auth.uid() and workspace_id=current_workspace() and ended_at is null;
end $$;
create or replace function my_timer() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform sweep_stale_sessions();
 return(select to_jsonb(e)||jsonb_build_object('title',t.title,'server_time',now(),'prior_seconds',coalesce((select sum(extract(epoch from ended_at-started_at)) from task_time_entries p where p.user_id=e.user_id and p.task_id=e.task_id and p.ended_at is not null),0)) from task_time_entries e join tasks t on t.id=e.task_id where e.user_id=auth.uid() and e.workspace_id=current_workspace() and e.ended_at is null);
end $$;
-- Closing/reassigning a task must not leave somebody's old timer running.
create or replace function task_timer_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in('in_review','completed') or new.assignee_id<>old.assignee_id or new.archived_at is not null then
  update task_time_entries set ended_at=case when last_heartbeat_at<now()-interval '20 minutes' then last_heartbeat_at else now() end,end_reason='review' where task_id=new.id and ended_at is null;
 end if;return new;
end $$;
drop trigger if exists task_timer_guard on tasks;
create trigger task_timer_guard after update of status,assignee_id,archived_at on tasks for each row execute function task_timer_guard();
create or replace function revoke_tracking() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='profiles' then
  if new.status<>'active' then
   update user_sessions set ended_at=last_heartbeat_at,end_reason='revoked' where user_id=new.id and ended_at is null;
   update task_time_entries set ended_at=last_heartbeat_at,end_reason='revoked' where user_id=new.id and ended_at is null;
  end if;
 else
  if new.status not in('active','trial') then
   update user_sessions set ended_at=last_heartbeat_at,end_reason='revoked' where workspace_id=new.id and ended_at is null;
   update task_time_entries set ended_at=last_heartbeat_at,end_reason='revoked' where workspace_id=new.id and ended_at is null;
  end if;
 end if;return new;
end $$;
drop trigger if exists profile_tracking_guard on profiles;
create trigger profile_tracking_guard after update of status on profiles for each row execute function revoke_tracking();
drop trigger if exists workspace_tracking_guard on workspaces;
create trigger workspace_tracking_guard after update of status on workspaces for each row execute function revoke_tracking();
do $$declare tab text;begin foreach tab in array array['user_sessions','activity_intervals','task_time_entries'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop trigger if exists tenant_insert on %I',tab);execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',tab);
 execute format('drop policy if exists tracking_read on %I',tab);execute format('create policy tracking_read on %I for select to authenticated using(workspace_id=current_workspace() and (user_id=auth.uid() or is_manager()))',tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(master_can_read(workspace_id))',tab);
end loop;end $$;
drop policy if exists master_presence on user_sessions;
create policy master_presence on user_sessions for select to authenticated using(is_master());
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['sweep_stale_sessions','session_start','session_heartbeat','session_end','timer_start','timer_pause','timer_stop','my_timer','task_timer_guard','revoke_tracking']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname not in('task_timer_guard','revoke_tracking') then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;

-- PART 5: Reports split each interval at the workspace's local midnight.
create or replace function report_guard(from_day date,to_day date,member uuid default null) returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 if from_day is null or to_day is null or to_day<from_day or to_day-from_day>365 then raise exception 'Choose a date range of at most 366 days';end if;
 if not is_manager() and member is distinct from auth.uid() then raise exception 'Not permitted';end if;
 if member is not null and not exists(select 1 from profiles where id=member and workspace_id=current_workspace()) then raise exception 'Member not found';end if;
end $$;
create or replace function report_daily(from_day date,to_day date,member uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tz text;begin
 perform report_guard(from_day,to_day,member);
 select timezone into tz from app_settings where workspace_id=current_workspace();
 return(with days as(select from_day+n as day,(from_day+n)::timestamp at time zone tz as lo,(from_day+n+1)::timestamp at time zone tz as hi from generate_series(0,to_day-from_day) n),
 people as(select id,name from profiles where workspace_id=current_workspace() and (member is null or id=member)),
 spans as(
 select user_id,'signed_in' kind,started_at,coalesce(ended_at,last_heartbeat_at) ended_at from user_sessions where workspace_id=current_workspace() and (member is null or user_id=member)
 union all select user_id,state,started_at,ended_at from activity_intervals where workspace_id=current_workspace() and (member is null or user_id=member)
 union all select user_id,'task',started_at,coalesce(ended_at,least(now(),last_heartbeat_at)) from task_time_entries where workspace_id=current_workspace() and (member is null or user_id=member)),
 totals as(select d.day,p.id user_id,p.name,
 coalesce(sum(extract(epoch from least(s.ended_at,d.hi)-greatest(s.started_at,d.lo))) filter(where s.kind='signed_in'),0)::bigint signed_in_seconds,
 coalesce(sum(extract(epoch from least(s.ended_at,d.hi)-greatest(s.started_at,d.lo))) filter(where s.kind='active'),0)::bigint active_seconds,
 coalesce(sum(extract(epoch from least(s.ended_at,d.hi)-greatest(s.started_at,d.lo))) filter(where s.kind='idle'),0)::bigint idle_seconds,
 coalesce(sum(extract(epoch from least(s.ended_at,d.hi)-greatest(s.started_at,d.lo))) filter(where s.kind='task'),0)::bigint task_seconds
 from days d cross join people p left join spans s on s.user_id=p.id and s.started_at<d.hi and s.ended_at>d.lo group by d.day,p.id,p.name)
 select coalesce(jsonb_agg(to_jsonb(t) order by day desc,name),'[]') from totals t);
end $$;
create or replace function report_tasks(from_day date,to_day date,member uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare lo timestamptz;hi timestamptz;tz text;begin
 perform report_guard(from_day,to_day,member);select timezone into tz from app_settings where workspace_id=current_workspace();
 lo:=from_day::timestamp at time zone tz;hi:=(to_day+1)::timestamp at time zone tz;
 return(select coalesce(jsonb_agg(to_jsonb(r) order by r.seconds desc),'[]') from (
 select t.id task_id,t.title,e.user_id,p.name,sum(extract(epoch from least(coalesce(e.ended_at,e.last_heartbeat_at),hi)-greatest(e.started_at,lo)))::bigint seconds
 from task_time_entries e join tasks t on t.id=e.task_id join profiles p on p.id=e.user_id
 where e.workspace_id=current_workspace() and (member is null or e.user_id=member) and e.started_at<hi and coalesce(e.ended_at,e.last_heartbeat_at)>lo group by t.id,t.title,e.user_id,p.name) r);
end $$;
create or replace function day_timeline(on_day date,member uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare lo timestamptz;hi timestamptz;tz text;begin
 perform report_guard(on_day,on_day,member);select timezone into tz from app_settings where workspace_id=current_workspace();
 lo:=on_day::timestamp at time zone tz;hi:=(on_day+1)::timestamp at time zone tz;
 return(with spans as(
 select id,'presence' kind,state label,started_at,ended_at from activity_intervals where workspace_id=current_workspace() and user_id=member
 union all select e.id,'task',t.title,e.started_at,coalesce(e.ended_at,e.last_heartbeat_at) from task_time_entries e join tasks t on t.id=e.task_id where e.workspace_id=current_workspace() and e.user_id=member)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'label',label,'started_at',greatest(started_at,lo),'ended_at',least(ended_at,hi)) order by started_at),'[]') from spans where started_at<hi and ended_at>lo);
end $$;
create or replace function list_sessions(from_day date,to_day date,member uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tz text;begin
 perform report_guard(from_day,to_day,member);select timezone into tz from app_settings where workspace_id=current_workspace();
 return(select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc),'[]') from (select s.*,p.name from user_sessions s join profiles p on p.id=s.user_id where s.workspace_id=current_workspace() and (member is null or s.user_id=member) and s.started_at<(to_day+1)::timestamp at time zone tz and coalesce(s.ended_at,s.last_heartbeat_at)>=from_day::timestamp at time zone tz order by s.started_at desc limit 2000) r);
end $$;
create or replace function team_presence() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 perform sweep_stale_sessions();
 return(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.name,'presence',coalesce(s.presence,'offline'),'last_seen_at',p.last_seen_at,'joined_at',p.joined_at)),'[]') from profiles p left join user_sessions s on s.user_id=p.id and s.ended_at is null where p.workspace_id=current_workspace() and (is_manager() or p.id=auth.uid()));
end $$;
create or replace function report_activity(from_day date,to_day date,member uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tz text;begin
 perform report_guard(from_day,to_day,member);select timezone into tz from app_settings where workspace_id=current_workspace();
 return(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select l.*,coalesce(p.name,'System') name from activity_logs l left join profiles p on p.id=l.actor_id where l.workspace_id=current_workspace() and (member is null or l.actor_id=member) and l.created_at>=from_day::timestamp at time zone tz and l.created_at<(to_day+1)::timestamp at time zone tz order by l.created_at desc limit 2000) r);
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['report_guard','report_daily','report_tasks','day_timeline','list_sessions','team_presence','report_activity']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname<>'report_guard' then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;

-- PART 6: Admin-managed role permissions. Workspace role activation stays with Master.
create or replace function save_permissions(entries jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb;r text;m text;begin
 if not is_admin() then raise exception 'Not permitted';end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>100 then raise exception 'Invalid permissions';end if;
 perform 1 from workspaces where id=current_workspace() for update;
 for e in select * from jsonb_array_elements(entries) loop
  r:=e->>'role_key';m:=e->>'module';
  if r is null or r not in('sales_rep','lead_gen','cold_caller','finance','project_manager') or not workspace_has_role(r) then raise exception 'Role is not available';end if;
  if m is null or m not in('leads','clients','projects','finance') then raise exception 'Module is not configurable';end if;
  if not coalesce((e->>'view')::boolean,false) and (coalesce((e->>'edit')::boolean,false) or coalesce((e->>'delete')::boolean,false)) then raise exception 'View permission is required before edit or archive';end if;
  insert into role_permissions(workspace_id,role_key,module,view,edit,delete) values(current_workspace(),r,m,coalesce((e->>'view')::boolean,false),coalesce((e->>'edit')::boolean,false),coalesce((e->>'delete')::boolean,false)) on conflict(workspace_id,role_key,module) do update set view=excluded.view,edit=excluded.edit,delete=excluded.delete;
 end loop;perform log_activity('permissions_updated');
end $$;
create or replace function save_brand(logo_path text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_admin() then raise exception 'Not permitted';end if;
 if logo_path not like 'w'||current_workspace()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='brand' and name=logo_path) then raise exception 'Upload a logo for this workspace';end if;
 update workspaces set logo_url=logo_path where id=current_workspace();perform log_activity('brand_updated');
end $$;
revoke all on function save_permissions(jsonb),save_brand(text) from public,anon,authenticated;
grant execute on function save_permissions(jsonb),save_brand(text) to authenticated;

-- PART 7: Leads and clients. Conversion and identifiers are database transactions.
create table if not exists clients(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),buid text not null,invoice_code text not null,
 name text not null check(length(trim(name)) between 1 and 160),company text not null check(length(trim(company)) between 1 and 160),email text,phone text,website text,country text,address text,services text,
 status text not null default 'active' check(status in('active','paused','archived')),onboarding_date date not null default current_date,
 currency text not null default 'PKR' check(currency~'^[A-Z]{3}$'),monthly_retainer numeric(14,2) not null default 0 check(monthly_retainer>=0),notes text,
 created_by uuid references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,buid),unique(workspace_id,invoice_code)
);
create table if not exists leads(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null default '',company text not null check(length(trim(company)) between 1 and 160),
 email text,phone text,website text,country text,niche text,service text,currency text not null default 'PKR' check(currency~'^[A-Z]{3}$'),budget numeric(14,2) not null default 0 check(budget>=0),source text,
 stage text not null default 'new' check(stage in('new','contacted','qualified','meeting','proposal','negotiation','won','lost')),
 priority text not null default 'medium' check(priority in('low','medium','high','urgent')),agent_id uuid,follow_up_date date,notes text,
 client_id uuid,created_by uuid references profiles(id),archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),foreign key(workspace_id,agent_id) references profiles(workspace_id,id),foreign key(workspace_id,client_id) references clients(workspace_id,id)
);
create index if not exists leads_workspace on leads(workspace_id,stage,agent_id);
create index if not exists clients_workspace on clients(workspace_id,status);
create or replace function clients_codes_before() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;base text;candidate text;offset_n integer;begin
 if tg_op='UPDATE' then
  if new.workspace_id<>old.workspace_id or new.buid<>old.buid or new.invoice_code<>old.invoice_code then raise exception 'Client identity cannot change';end if;
  return new;
 end if;
 perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
 select coalesce(max(substring(buid from 6)::integer),1000)+1 into n from clients where workspace_id=new.workspace_id;
 new.buid:='BUID-'||n;
 base:=upper(regexp_replace(trim(new.name),'[^A-Za-z ]','','g'));
 if position(' ' in base)>0 then base:=left(base,1)||left(regexp_replace(base,'^.* ','','g'),1);else base:=rpad(left(base,2),2,'X');end if;
 if length(base)<>2 then base:='XX';end if;
 offset_n:=(ascii(left(base,1))-65)*26+ascii(right(base,1))-65;
 for n in 0..675 loop
  candidate:=chr(65+((offset_n+n)%676)/26)||chr(65+((offset_n+n)%26));
  if not exists(select 1 from clients where workspace_id=new.workspace_id and invoice_code=candidate) then new.invoice_code:=candidate;return new;end if;
 end loop;raise exception 'All two-letter client codes are in use';
end $$;
drop trigger if exists clients_codes_before on clients;
create trigger clients_codes_before before insert or update on clients for each row execute function clients_codes_before();
create or replace function lead_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads;agent uuid;begin
 if not perm('leads','edit') then raise exception 'Not permitted';end if;
 if payload?'workspace_id' and (payload->>'workspace_id')::uuid is distinct from current_workspace() then raise exception 'Workspace mismatch';end if;
 if nullif(payload->>'id','') is not null then
  select * into l from leads where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;
  if l.id is null then raise exception 'Lead not found';end if;
  if l.client_id is not null then raise exception 'Edit this record in Clients';end if;
 end if;
 agent:=case when payload?'agent_id' then nullif(payload->>'agent_id','')::uuid else l.agent_id end;
 if agent is distinct from l.agent_id and not(is_manager() or has_role('sales_rep')) then raise exception 'Only Sales Representatives or Managers can assign leads';end if;
 if agent is not null and not exists(select 1 from profiles p join member_roles r on r.user_id=p.id and r.workspace_id=p.workspace_id join workspace_roles wr on wr.workspace_id=r.workspace_id and wr.role_key=r.role_key and wr.active where p.id=agent and p.workspace_id=current_workspace() and p.status='active' and r.role_key='sales_rep') then raise exception 'Choose an active Sales Representative';end if;
 if l.id is null then insert into leads(workspace_id,company,created_by) values(current_workspace(),payload->>'company',auth.uid()) returning * into l;end if;
 update leads set name=coalesce(payload->>'name',name),company=coalesce(payload->>'company',company),email=coalesce(payload->>'email',email),phone=coalesce(payload->>'phone',phone),website=coalesce(payload->>'website',website),country=coalesce(payload->>'country',country),niche=coalesce(payload->>'niche',niche),service=coalesce(payload->>'service',service),currency=coalesce(payload->>'currency',currency),budget=coalesce((payload->>'budget')::numeric,budget),source=coalesce(payload->>'source',source),stage=coalesce(payload->>'stage',stage),priority=coalesce(payload->>'priority',priority),agent_id=agent,follow_up_date=case when payload?'follow_up_date' then nullif(payload->>'follow_up_date','')::date else follow_up_date end,notes=coalesce(payload->>'notes',notes),updated_at=now() where id=l.id returning * into l;
 perform log_activity('lead_saved','lead',l.id);return to_jsonb(l);
end $$;
create or replace function lead_mark_won(target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform lead_save(jsonb_build_object('id',target,'stage','won'));end $$;
create or replace function lead_convert(target uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads;c clients;begin
 if not is_manager() then raise exception 'Only Admin or Manager can convert a lead';end if;
 select * into l from leads where id=target and workspace_id=current_workspace() for update;
 if l.id is null then raise exception 'Lead not found';end if;
 if l.client_id is not null then select * into c from clients where id=l.client_id;return to_jsonb(c);end if;
 if l.stage<>'won' then raise exception 'Mark the lead Won before conversion';end if;
 insert into clients(workspace_id,name,company,email,phone,website,country,services,currency,monthly_retainer,notes,created_by) values(l.workspace_id,coalesce(nullif(l.name,''),l.company),l.company,l.email,l.phone,l.website,l.country,l.service,l.currency,l.budget,l.notes,auth.uid()) returning * into c;
 update leads set client_id=c.id,updated_at=now() where id=l.id;
 perform log_activity('lead_converted','client',c.id);return to_jsonb(c);
end $$;
create or replace function client_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c clients;begin
 if not perm('clients','edit') then raise exception 'Not permitted';end if;
 if payload?'workspace_id' and (payload->>'workspace_id')::uuid is distinct from current_workspace() then raise exception 'Workspace mismatch';end if;
 if nullif(payload->>'id','') is not null then select * into c from clients where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;if c.id is null then raise exception 'Client not found';end if;
 else insert into clients(workspace_id,name,company,created_by) values(current_workspace(),payload->>'name',payload->>'company',auth.uid()) returning * into c;end if;
 update clients set name=coalesce(payload->>'name',name),company=coalesce(payload->>'company',company),email=coalesce(payload->>'email',email),phone=coalesce(payload->>'phone',phone),website=coalesce(payload->>'website',website),country=coalesce(payload->>'country',country),address=coalesce(payload->>'address',address),services=coalesce(payload->>'services',services),status=coalesce(payload->>'status',status),onboarding_date=coalesce(nullif(payload->>'onboarding_date','')::date,onboarding_date),currency=coalesce(payload->>'currency',currency),monthly_retainer=coalesce((payload->>'monthly_retainer')::numeric,monthly_retainer),notes=coalesce(payload->>'notes',notes),updated_at=now() where id=c.id returning * into c;
 perform log_activity('client_saved','client',c.id);return to_jsonb(c);
end $$;
create or replace function lead_archive(target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not perm('leads','delete') then raise exception 'Not permitted';end if;
 update leads set archived_at=now() where id=target and workspace_id=current_workspace();if not found then raise exception 'Lead not found';end if;perform log_activity('lead_archived','lead',target);
end $$;
create or replace function public_lead_submit(form_token text,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;begin
 select * into w from workspaces where public_form_token=form_token and status in('active','trial');
 if w.id is null then raise exception 'This form is unavailable';end if;
 insert into leads(workspace_id,name,company,email,phone,website,country,niche,service,currency,budget,source,notes) values(w.id,coalesce(payload->>'name',''),payload->>'company',payload->>'email',payload->>'phone',payload->>'website',payload->>'country',payload->>'niche',payload->>'service',coalesce(payload->>'currency','PKR'),coalesce((payload->>'budget')::numeric,0),'Public form',payload->>'notes');
end $$;
revoke all on function public_lead_submit(text,jsonb) from public,anon,authenticated;
grant execute on function public_lead_submit(text,jsonb) to service_role;
do $$declare tab text;begin foreach tab in array array['leads','clients'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop trigger if exists tenant_insert on %I',tab);execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',tab);
 execute format('drop policy if exists domain_read on %I',tab);execute format('create policy domain_read on %I for select to authenticated using(workspace_id=current_workspace() and perm(%L))',tab,tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(master_can_read(workspace_id))',tab);
end loop;end $$;
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['clients_codes_before','lead_save','lead_mark_won','lead_convert','client_save','lead_archive']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.proname<>'clients_codes_before' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;

-- PART 8: Projects, designation-based membership approval and private files.
create table if not exists projects(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),client_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 160),description text not null default '',pm_id uuid,
 status text not null default 'planning' check(status in('planning','active','on_hold','completed','archived')),
 start_date date,due_date date,live_url text,currency text not null default 'PKR' check(currency~'^[A-Z]{3}$'),budget numeric(14,2) not null default 0 check(budget>=0),
 created_by uuid references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),foreign key(workspace_id,client_id) references clients(workspace_id,id),foreign key(workspace_id,pm_id) references profiles(workspace_id,id)
);
create table if not exists project_members(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,user_id uuid not null,designation text not null,
 status text not null check(status in('pending','approved','rejected','cancelled','removed')),approval_side text not null check(approval_side in('manager','pm','direct')),
 requested_by uuid not null references profiles(id),requested_at timestamptz not null default now(),reviewed_by uuid references profiles(id),reviewed_at timestamptz,note text,
 foreign key(workspace_id,project_id) references projects(workspace_id,id),foreign key(workspace_id,user_id) references profiles(workspace_id,id)
);
create unique index if not exists active_project_membership on project_members(project_id,user_id) where status in('pending','approved');
create table if not exists project_requirements(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 240),description text not null default '',status text not null default 'open' check(status in('open','in_progress','done')),
 created_by uuid references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
create or replace function pm_perm(target uuid,action text default 'view') returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from projects p where p.id=target and p.workspace_id=current_workspace() and (is_manager() or (p.pm_id=auth.uid() and has_role('project_manager') and perm('projects',action))))
$$;
create or replace function can_task(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from tasks where id=target and workspace_id=current_workspace() and (is_manager() or assignee_id=auth.uid() or created_by=auth.uid() or pm_perm(project_id)))
$$;
create or replace function project_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;new_pm uuid;new_client uuid;begin
 if nullif(payload->>'id','') is null then
  if not is_manager() then raise exception 'Only Admin or Manager can create projects';end if;
 else
  select * into p from projects where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;
  if p.id is null or not pm_perm(p.id,'edit') then raise exception 'Project not found or not permitted';end if;
 end if;
 new_pm:=case when payload?'pm_id' then nullif(payload->>'pm_id','')::uuid else p.pm_id end;
 new_client:=coalesce(nullif(payload->>'client_id','')::uuid,p.client_id);
 if p.id is not null and (new_pm is distinct from p.pm_id or new_client is distinct from p.client_id) and not is_manager() then raise exception 'Only a Manager can change the client or Project Manager';end if;
 if not exists(select 1 from clients where id=new_client and workspace_id=current_workspace()) then raise exception 'Client not found';end if;
 if p.id is not null and new_client<>p.client_id then raise exception 'Project client cannot change once created';end if;
 if new_pm is not null and not(is_manager_id(new_pm) or exists(select 1 from profiles u join member_roles r on r.user_id=u.id and r.workspace_id=u.workspace_id where u.id=new_pm and u.workspace_id=current_workspace() and u.status='active' and r.role_key='project_manager' and workspace_has_role('project_manager'))) then raise exception 'Choose an active Project Manager';end if;
 if nullif(payload->>'live_url','') is not null and payload->>'live_url' !~ '^https://' then raise exception 'Live URL must use https';end if;
 if p.id is null then insert into projects(workspace_id,client_id,name,pm_id,created_by) values(current_workspace(),new_client,payload->>'name',new_pm,auth.uid()) returning * into p;end if;
 update projects set name=coalesce(payload->>'name',name),description=coalesce(payload->>'description',description),pm_id=new_pm,status=coalesce(payload->>'status',status),start_date=case when payload?'start_date' then nullif(payload->>'start_date','')::date else start_date end,due_date=case when payload?'due_date' then nullif(payload->>'due_date','')::date else due_date end,live_url=coalesce(payload->>'live_url',live_url),currency=coalesce(payload->>'currency',currency),budget=coalesce((payload->>'budget')::numeric,budget),updated_at=now() where id=p.id returning * into p;
 perform log_activity('project_saved','project',p.id);return to_jsonb(p);
end $$;
create or replace function project_add_member(target uuid,member uuid,designation text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;m project_members;side text;begin
 select * into p from projects where id=target and workspace_id=current_workspace() for update;
 if p.id is null or not pm_perm(target,'edit') then raise exception 'Not permitted';end if;
 if not exists(select 1 from profiles where id=member and workspace_id=p.workspace_id and status='active' and job_title=designation) then raise exception 'Choose an active person with this designation';end if;
 side:=case when p.pm_id is null or is_manager_id(p.pm_id) then 'direct' when p.pm_id=auth.uid() then 'manager' else 'pm' end;
 insert into project_members(workspace_id,project_id,user_id,designation,status,approval_side,requested_by,reviewed_by,reviewed_at) values(p.workspace_id,p.id,member,designation,case when side='direct' then 'approved' else 'pending' end,side,auth.uid(),case when side='direct' then auth.uid() end,case when side='direct' then now() end) returning * into m;
 perform log_activity('project_member_requested','project',p.id);return to_jsonb(m);
end $$;
create or replace function project_review_member(target uuid,approve boolean,reason text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m project_members;p projects;begin
 select * into m from project_members where id=target and workspace_id=current_workspace() for update;
 if m.id is null then raise exception 'Request not found';end if;
 select * into p from projects where id=m.project_id;
 if m.status<>'pending' then raise exception 'This request has already been reviewed';end if;
 if not ((m.approval_side='manager' and is_manager()) or (m.approval_side='pm' and p.pm_id=auth.uid() and pm_perm(p.id,'edit'))) then raise exception 'Not permitted to approve this request';end if;
 if m.requested_by=auth.uid() then raise exception 'The requester cannot approve their own request';end if;
 if not approve and length(trim(reason))=0 then raise exception 'Give a reason for rejection';end if;
 if approve and not exists(select 1 from profiles where id=m.user_id and workspace_id=m.workspace_id and status='active') then raise exception 'Member is inactive';end if;
 update project_members set status=case when approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),note=reason where id=m.id;
 perform log_activity('project_member_reviewed','project',p.id,jsonb_build_object('approved',approve,'member',m.user_id));
end $$;
create or replace function project_remove_member(target uuid,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m project_members;begin
 select * into m from project_members where id=target and workspace_id=current_workspace() for update;
 if m.id is null or not pm_perm(m.project_id,'edit') then raise exception 'Not permitted';end if;
 if m.status not in('pending','approved') then raise exception 'This membership is already closed';end if;
 if length(trim(reason))=0 then raise exception 'Give a reason';end if;
 update project_members set status=case when status='pending' then 'cancelled' else 'removed' end,reviewed_by=auth.uid(),reviewed_at=now(),note=reason where id=m.id;
 perform log_activity('project_member_removed','project',m.project_id);
end $$;
create or replace function requirement_save(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;r project_requirements;begin
 target:=(payload->>'project_id')::uuid;
 if not pm_perm(target,'edit') then raise exception 'Not permitted';end if;
 if nullif(payload->>'id','') is null then insert into project_requirements(workspace_id,project_id,title,description,created_by) values(current_workspace(),target,payload->>'title',coalesce(payload->>'description',''),auth.uid());
 else update project_requirements set title=coalesce(payload->>'title',title),description=coalesce(payload->>'description',description),status=coalesce(payload->>'status',status),updated_at=now() where id=(payload->>'id')::uuid and project_id=target and workspace_id=current_workspace();if not found then raise exception 'Requirement not found';end if;end if;
 perform log_activity('requirement_saved','project',target);
end $$;
create table if not exists client_files(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),client_id uuid not null,project_id uuid,
 name text not null,path text not null unique,mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 10485760),uploaded_by uuid not null references profiles(id),archived_at timestamptz,created_at timestamptz not null default now(),
 foreign key(workspace_id,client_id) references clients(workspace_id,id),foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
alter table client_files add column if not exists upload_status text not null default 'pending' check(upload_status in('pending','ready','failed'));
create or replace function project_link_before() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;begin
 if new.project_id is not null then select * into p from projects where id=new.project_id and workspace_id=new.workspace_id;if p.id is null then raise exception 'Project not found in workspace';end if;new.client_id:=p.client_id;end if;
 if new.client_id is not null and not exists(select 1 from clients where id=new.client_id and workspace_id=new.workspace_id) then raise exception 'Client not found in workspace';end if;return new;
end $$;
drop trigger if exists project_link_before on tasks;
create trigger project_link_before before insert or update on tasks for each row execute function project_link_before();
drop trigger if exists project_link_before on client_files;
create trigger project_link_before before insert or update on client_files for each row execute function project_link_before();
create or replace function can_client_file(file_path text,write_access boolean default false) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w uuid;c uuid;begin
 if file_path !~ '^w[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$' then return false;end if;
 w:=substring(split_part(file_path,'/',1) from 2)::uuid;c:=split_part(file_path,'/',2)::uuid;
 if w is distinct from current_workspace() then return not write_access and master_can_read(w);end if;
 return exists(select 1 from clients where id=c and workspace_id=w) and (perm('clients',case when write_access then 'edit' else 'view' end) or exists(select 1 from client_files f where f.path=file_path and f.workspace_id=w and f.project_id is not null and pm_perm(f.project_id,case when write_access then 'edit' else 'view' end)));
end $$;
create or replace function file_register(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid;p uuid;f client_files;begin
 c:=(payload->>'client_id')::uuid;p:=nullif(payload->>'project_id','')::uuid;
 if not (perm('clients','edit') or (p is not null and pm_perm(p,'edit'))) then raise exception 'Not permitted';end if;
 if not exists(select 1 from clients where id=c and workspace_id=current_workspace()) then raise exception 'Client not found';end if;
 if p is not null and not exists(select 1 from projects where id=p and client_id=c and workspace_id=current_workspace()) then raise exception 'Project not found';end if;
 if payload->>'path' not like 'w'||current_workspace()::text||'/'||c::text||'/%' then raise exception 'Invalid file path';end if;
 if payload->>'mime_type' not in('application/pdf','image/png','image/jpeg','image/webp') then raise exception 'Unsupported file type';end if;
 insert into client_files(workspace_id,client_id,project_id,name,path,mime_type,size_bytes,uploaded_by) values(current_workspace(),c,p,payload->>'name',payload->>'path',payload->>'mime_type',(payload->>'size_bytes')::bigint,auth.uid()) returning * into f;
 perform log_activity('file_registered','client',c);return to_jsonb(f);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('client-files','client-files',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create or replace function file_finish(target uuid,succeeded boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f client_files;begin
 select * into f from client_files where id=target and workspace_id=current_workspace() for update;
 if f.id is null or f.uploaded_by<>auth.uid() or not can_client_file(f.path,true) then raise exception 'Not permitted';end if;
 if f.upload_status='ready' then return;end if;
 if succeeded and not exists(select 1 from storage.objects where bucket_id='client-files' and name=f.path) then raise exception 'Upload is not complete';end if;
 update client_files set upload_status=case when succeeded then 'ready' else 'failed' end where id=f.id;
end $$;
revoke all on function file_finish(uuid,boolean) from public,anon;
grant execute on function file_finish(uuid,boolean) to authenticated;
drop policy if exists client_file_read on storage.objects;
create policy client_file_read on storage.objects for select to authenticated using(bucket_id='client-files' and can_client_file(name));
drop policy if exists client_file_insert on storage.objects;
create policy client_file_insert on storage.objects for insert to authenticated with check(bucket_id='client-files' and can_client_file(name,true));
do $$declare tab text;begin foreach tab in array array['projects','project_members','project_requirements','client_files'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop trigger if exists tenant_insert on %I',tab);execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(master_can_read(workspace_id))',tab);
end loop;end $$;
drop policy if exists project_read on projects;
create policy project_read on projects for select to authenticated using(workspace_id=current_workspace() and pm_perm(id));
drop policy if exists project_member_read on project_members;
create policy project_member_read on project_members for select to authenticated using(workspace_id=current_workspace() and (pm_perm(project_id) or user_id=auth.uid()));
drop policy if exists requirement_read on project_requirements;
create policy requirement_read on project_requirements for select to authenticated using(workspace_id=current_workspace() and pm_perm(project_id));
drop policy if exists client_file_read on client_files;
create policy client_file_read on client_files for select to authenticated using(workspace_id=current_workspace() and (perm('clients') or pm_perm(project_id)));
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['pm_perm','project_save','project_add_member','project_review_member','project_remove_member','requirement_save','project_link_before','can_client_file','file_register']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.proname not in('project_link_before') then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;

-- PART 9: In-app notices. Internal helpers cannot be called by a browser.
create table if not exists notifications(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),user_id uuid not null references profiles(id),
 title text not null,body text not null default '',link text,source text not null default 'workspace',read_at timestamptz,created_at timestamptz not null default now(),event_key text,
 unique(user_id,event_key)
);
create index if not exists notifications_user on notifications(workspace_id,user_id,created_at desc);
alter table notifications enable row level security;
revoke all on notifications from anon,authenticated;grant select on notifications to authenticated;
drop policy if exists own_notices on notifications;
create policy own_notices on notifications for select to authenticated using(user_id=auth.uid() and (workspace_id=current_workspace() or workspace_id=billing_workspace() or is_master()));
create or replace function notify(recipient uuid,workspace uuid,title text,body text default '',link text default null,event_key text default null,source text default 'workspace') returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if recipient is not distinct from auth.uid() then return;end if;
 if not exists(select 1 from profiles where id=recipient and status='active' and (workspace_id=workspace or is_master)) then return;end if;
 insert into notifications(workspace_id,user_id,title,body,link,event_key,source) values(workspace,recipient,title,body,link,event_key,source) on conflict on constraint notifications_user_id_event_key_key do nothing;
end $$;
create or replace function notify_managers(workspace uuid,title text,body text default '',link text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;begin
 for p in select * from profiles where workspace_id=workspace and status='active' and (account_type='admin' or exists(select 1 from member_roles where user_id=profiles.id and workspace_id=workspace and role_key='manager')) loop perform notify(p.id,workspace,title,body,link);end loop;
end $$;
create or replace function notify_role(workspace uuid,role_name text,title text,body text default '',link text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;begin
 for recipient in select p.id from profiles p join member_roles r on r.user_id=p.id and r.workspace_id=p.workspace_id join workspace_roles wr on wr.workspace_id=r.workspace_id and wr.role_key=r.role_key and wr.active where p.workspace_id=workspace and p.status='active' and r.role_key=role_name loop perform notify(recipient,workspace,title,body,link);end loop;
end $$;
create or replace function notifications_read(target uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and (workspace_id=current_workspace() or workspace_id=billing_workspace() or is_master()) and (target is null or id=target);
end $$;
create or replace function task_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare pm uuid;begin
 if tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id then perform notify(new.assignee_id,new.workspace_id,'Task assigned',new.title,'#/tasks');end if;
 if tg_op='UPDATE' and new.status<>old.status then
  if new.status='in_review' then
   perform notify_managers(new.workspace_id,'Task ready for review',new.title,'#/tasks');
   select pm_id into pm from projects where id=new.project_id;perform notify(pm,new.workspace_id,'Task ready for review',new.title,'#/project/'||new.project_id);
  elsif new.status='completed' then perform notify(new.assignee_id,new.workspace_id,'Task approved',new.title,'#/tasks');
  elsif old.status='in_review' then perform notify(new.assignee_id,new.workspace_id,'Changes requested',new.title,'#/tasks');end if;
 end if;return new;
end $$;
create or replace function lead_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
  perform notify_managers(new.workspace_id,'New lead',new.company,'#/leads');
  if new.agent_id is null then perform notify_role(new.workspace_id,'sales_rep','New unassigned lead',new.company,'#/leads');end if;
 end if;
 if tg_op='UPDATE' then
  if new.stage='won' and old.stage<>'won' then perform notify_managers(new.workspace_id,'Lead won',new.company,'#/leads');end if;
  if new.agent_id is distinct from old.agent_id then perform notify(new.agent_id,new.workspace_id,'Lead assigned',new.company,'#/leads');end if;
 end if;return new;
end $$;
create or replace function project_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;begin
 if tg_table_name='projects' then
  if tg_op='INSERT' or new.pm_id is distinct from old.pm_id then perform notify(new.pm_id,new.workspace_id,'Project assigned',new.name,'#/project/'||new.id);end if;
 else
  select * into p from projects where id=new.project_id;
  if new.status='pending' and tg_op='INSERT' then
   if new.approval_side='pm' then perform notify(p.pm_id,new.workspace_id,'Team request needs approval',p.name,'#/project/'||p.id);
   else perform notify_managers(new.workspace_id,'Team request needs approval',p.name,'#/project/'||p.id);end if;
  elsif new.status in('approved','rejected','removed') then perform notify(new.requested_by,new.workspace_id,'Project membership '||new.status,p.name,'#/project/'||p.id);perform notify(new.user_id,new.workspace_id,'Project membership '||new.status,p.name,'#/tasks');end if;
 end if;return new;
end $$;
drop trigger if exists task_notify on tasks;
create trigger task_notify after insert or update on tasks for each row execute function task_notify();
drop trigger if exists lead_notify on leads;
create trigger lead_notify after insert or update on leads for each row execute function lead_notify();
drop trigger if exists project_notify on projects;
create trigger project_notify after insert or update on projects for each row execute function project_notify();
drop trigger if exists membership_notify on project_members;
create trigger membership_notify after insert or update on project_members for each row execute function project_notify();
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['notify','notify_managers','notify_role','notifications_read','task_notify','lead_notify','project_notify']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.proname='notifications_read' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;

-- PART 10: Workspace finance. Salary details have no Finance or Master read path.
create table if not exists recurring_expenses(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),title text not null check(length(trim(title)) between 1 and 160),category text not null default 'other',employee_id uuid,
 frequency text not null check(frequency in('one_time','weekly','monthly','quarterly','yearly')),next_due date,automatic boolean not null default false,active boolean not null default true,
 currency text not null check(currency~'^[A-Z]{3}$'),amount_original numeric(14,2) not null check(amount_original>=0),fx_rate numeric(14,6) not null check(fx_rate>0),amount numeric(14,2) not null,
 notes text,created_by uuid references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),foreign key(workspace_id,employee_id) references profiles(workspace_id,id)
);
create table if not exists expenses(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),title text not null check(length(trim(title)) between 1 and 160),category text not null default 'other',employee_id uuid,
 paid_on date not null default current_date,currency text not null check(currency~'^[A-Z]{3}$'),amount_original numeric(14,2) not null check(amount_original>=0),fx_rate numeric(14,6) not null check(fx_rate>0),amount numeric(14,2) not null,
 bill_id uuid,for_date date,project_id uuid,client_id uuid,notes text,archived_at timestamptz,created_by uuid references profiles(id),created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(bill_id,for_date),foreign key(workspace_id,employee_id) references profiles(workspace_id,id),foreign key(workspace_id,bill_id) references recurring_expenses(workspace_id,id),foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
create table if not exists investments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),title text not null check(length(trim(title)) between 1 and 160),kind text not null check(kind in('capital_in','capital_out','loan_in','loan_repayment')),
 occurred_on date not null default current_date,currency text not null check(currency~'^[A-Z]{3}$'),amount_original numeric(14,2) not null check(amount_original>=0),fx_rate numeric(14,6) not null check(fx_rate>0),amount numeric(14,2) not null,
 notes text,archived_at timestamptz,created_by uuid references profiles(id),created_at timestamptz not null default now(),unique(workspace_id,id)
);
create table if not exists bill_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),bill_id uuid not null,for_date date not null,
 action text not null check(action in('paid','skipped')),expense_id uuid,actor_id uuid references profiles(id),created_at timestamptz not null default now(),
 unique(bill_id,for_date),foreign key(workspace_id,bill_id) references recurring_expenses(workspace_id,id),foreign key(workspace_id,expense_id) references expenses(workspace_id,id)
);
create table if not exists finance_report_log(workspace_id uuid not null references workspaces(id),kind text not null,for_date date not null,entity_id uuid not null default '00000000-0000-0000-0000-000000000000',created_at timestamptz not null default now(),primary key(workspace_id,kind,for_date,entity_id));
create or replace function money_before_write() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare base text;begin
 select app_currency into base from app_settings where workspace_id=new.workspace_id;
 if new.currency=base then new.fx_rate:=1;end if;
 new.amount:=round(new.amount_original*new.fx_rate,2);return new;
end $$;
create or replace function finance_allowed(category text,action text default 'view') returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select perm('finance',action) and (category<>'salary' or is_manager())
$$;
create or replace function finance_save(kind text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;old_category text;new_category text;record jsonb;table_name text;begin
 table_name:=case kind when 'expense' then 'expenses' when 'bill' then 'recurring_expenses' when 'investment' then 'investments' end;
 if table_name is null or not perm('finance','edit') then raise exception 'Not permitted';end if;
 target:=nullif(payload->>'id','')::uuid;new_category:=coalesce(payload->>'category','other');
 if new_category='salary' and not is_manager() then raise exception 'Not permitted';end if;
 if target is not null then
  execute format('select to_jsonb(t) from %I t where id=$1 and workspace_id=$2 for update',table_name) into record using target,current_workspace();
  if record is null or (record->>'category'='salary' and not is_manager()) then raise exception 'Record not found';end if;
  if kind='expense' and record->>'bill_id' is not null then raise exception 'A bill payment cannot be edited';end if;
 end if;
 if kind='expense' then
  if target is null then insert into expenses(workspace_id,title,category,paid_on,currency,amount_original,fx_rate,amount,employee_id,project_id,notes,created_by) values(current_workspace(),payload->>'title',new_category,coalesce(nullif(payload->>'paid_on','')::date,current_date),payload->>'currency',(payload->>'amount_original')::numeric,(payload->>'fx_rate')::numeric,0,nullif(payload->>'employee_id','')::uuid,nullif(payload->>'project_id','')::uuid,payload->>'notes',auth.uid()) returning id into target;
  else update expenses set title=payload->>'title',category=new_category,paid_on=coalesce(nullif(payload->>'paid_on','')::date,paid_on),currency=payload->>'currency',amount_original=(payload->>'amount_original')::numeric,fx_rate=(payload->>'fx_rate')::numeric,employee_id=nullif(payload->>'employee_id','')::uuid,notes=payload->>'notes' where id=target;end if;
 elsif kind='bill' then
  if target is null then insert into recurring_expenses(workspace_id,title,category,employee_id,frequency,next_due,automatic,currency,amount_original,fx_rate,amount,notes,created_by) values(current_workspace(),payload->>'title',new_category,nullif(payload->>'employee_id','')::uuid,payload->>'frequency',(payload->>'next_due')::date,coalesce((payload->>'automatic')::boolean,false),payload->>'currency',(payload->>'amount_original')::numeric,(payload->>'fx_rate')::numeric,0,payload->>'notes',auth.uid()) returning id into target;
  else update recurring_expenses set title=payload->>'title',category=new_category,employee_id=nullif(payload->>'employee_id','')::uuid,frequency=payload->>'frequency',next_due=(payload->>'next_due')::date,automatic=coalesce((payload->>'automatic')::boolean,false),currency=payload->>'currency',amount_original=(payload->>'amount_original')::numeric,fx_rate=(payload->>'fx_rate')::numeric,notes=payload->>'notes',updated_at=now() where id=target;end if;
 else
  if target is null then insert into investments(workspace_id,title,kind,occurred_on,currency,amount_original,fx_rate,amount,notes,created_by) values(current_workspace(),payload->>'title',payload->>'kind',coalesce(nullif(payload->>'occurred_on','')::date,current_date),payload->>'currency',(payload->>'amount_original')::numeric,(payload->>'fx_rate')::numeric,0,payload->>'notes',auth.uid()) returning id into target;
  else update investments set title=payload->>'title',kind=payload->>'kind',occurred_on=(payload->>'occurred_on')::date,currency=payload->>'currency',amount_original=(payload->>'amount_original')::numeric,fx_rate=(payload->>'fx_rate')::numeric,notes=payload->>'notes' where id=target;end if;
 end if;
 perform log_activity('finance_record_saved',kind,target);
 execute format('select to_jsonb(t) from %I t where id=$1',table_name) into record using target;return record;
end $$;
create or replace function advance_frequency(day date,frequency text) returns date language sql immutable set search_path=public,pg_temp as $$
 select case frequency when 'one_time' then null when 'weekly' then day+7 when 'monthly' then (day+interval '1 month')::date when 'quarterly' then (day+interval '3 months')::date when 'yearly' then (day+interval '1 year')::date end
$$;
create or replace function bill_settle_internal(target uuid,expected_due date,skip boolean,paid_on date) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b recurring_expenses;e uuid;begin
 select * into b from recurring_expenses where id=target for update;
 select expense_id into e from bill_events where bill_id=target and for_date=expected_due;
 if found then return e;end if;
 if not b.active or b.next_due is distinct from expected_due then raise exception 'This bill has changed. Refresh and try again';end if;
 if not skip then insert into expenses(workspace_id,title,category,employee_id,paid_on,currency,amount_original,fx_rate,amount,bill_id,for_date,notes,created_by) values(b.workspace_id,b.title,b.category,b.employee_id,paid_on,b.currency,b.amount_original,b.fx_rate,b.amount,b.id,b.next_due,b.notes,auth.uid()) returning id into e;end if;
 insert into bill_events(workspace_id,bill_id,for_date,action,expense_id,actor_id) values(b.workspace_id,b.id,b.next_due,case when skip then 'skipped' else 'paid' end,e,auth.uid());
 update recurring_expenses set next_due=advance_frequency(b.next_due,b.frequency),active=b.frequency<>'one_time',updated_at=now() where id=b.id;
 return e;
end $$;
create or replace function bill_settle(target uuid,expected_due date,skip boolean default false,paid_on date default current_date) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b recurring_expenses;result uuid;begin
 select * into b from recurring_expenses where id=target and workspace_id=current_workspace();
 if b.id is null or not finance_allowed(b.category,'edit') then raise exception 'Not permitted';end if;
 result:=bill_settle_internal(target,expected_due,skip,paid_on);perform log_activity(case when skip then 'bill_skipped' else 'bill_paid' end,'bill',target);return result;
end $$;
create or replace function finance_archive(kind text,target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare category text;begin
 if not perm('finance','delete') then raise exception 'Not permitted';end if;
 if kind='bill' then select b.category into category from recurring_expenses b where id=target and workspace_id=current_workspace();
 elsif kind='expense' then select e.category into category from expenses e where id=target and workspace_id=current_workspace();
 elsif kind='investment' then select 'other' into category from investments where id=target and workspace_id=current_workspace();end if;
 if category is null or not finance_allowed(category,'delete') then raise exception 'Record not found';end if;
 if kind='bill' then update recurring_expenses set active=false where id=target;elsif kind='expense' then update expenses set archived_at=now() where id=target;else update investments set archived_at=now() where id=target;end if;
 perform log_activity('finance_record_archived',kind,target);
end $$;
create or replace function notify_finance_people(workspace uuid,title text,body text,link text,salary boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform notify_managers(workspace,title,body,link);if not salary then perform notify_role(workspace,'finance',title,body,link);end if;end $$;
create or replace function finance_sweep() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b recurring_expenses;day date;kind text;month date;inserted integer;begin
 if not perm('finance') then raise exception 'Not permitted';end if;
 select (now() at time zone timezone)::date into day from app_settings where workspace_id=current_workspace();
 for b in select * from recurring_expenses where workspace_id=current_workspace() and active and finance_allowed(category) and next_due<=day+3 for update loop
  if b.automatic and b.next_due<=day then
   -- Catch up at most 120 periods per request; the next sweep resumes safely.
   for inserted in 1..120 loop
    exit when not b.active or b.next_due>day;
    perform bill_settle_internal(b.id,b.next_due,false,b.next_due);
    select * into b from recurring_expenses where id=b.id;
   end loop;
  else
   kind:=case when b.next_due<day then 'bill_overdue' when b.next_due=day then 'bill_due' else 'bill_soon' end;
   insert into finance_report_log(workspace_id,kind,for_date,entity_id) values(b.workspace_id,kind,day,b.id) on conflict do nothing;get diagnostics inserted=row_count;
   if inserted=1 then perform notify_finance_people(b.workspace_id,replace(kind,'_',' '),b.title||' · Due '||b.next_due,'#/finance/bills',b.category='salary');end if;
  end if;
 end loop;
 month:=date_trunc('month',day)::date;
 if is_manager() then
  insert into finance_report_log(workspace_id,kind,for_date) values(current_workspace(),'monthly_report',month) on conflict do nothing;get diagnostics inserted=row_count;
  if inserted=1 then perform notify_managers(current_workspace(),'Monthly finance report ready',to_char(month-interval '1 month','Month YYYY'),'#/finance/report');end if;
 end if;
end $$;
create or replace function finance_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='investments' then perform notify_finance_people(new.workspace_id,'Investment recorded',new.title,'#/finance/investments');
 else perform notify_finance_people(new.workspace_id,case when tg_table_name='expenses' then 'Expense recorded' else 'Bill created' end,new.title,'#/finance',new.category='salary');end if;return new;
end $$;
do $$declare tab text;begin foreach tab in array array['expenses','recurring_expenses','investments'] loop
 execute format('drop trigger if exists money_before_write on %I',tab);execute format('create trigger money_before_write before insert or update on %I for each row execute function money_before_write()',tab);
 execute format('drop trigger if exists finance_notify on %I',tab);execute format('create trigger finance_notify after insert on %I for each row execute function finance_notify()',tab);
end loop;end $$;
drop trigger if exists project_link_before on expenses;
create trigger project_link_before before insert or update on expenses for each row execute function project_link_before();
do $$declare tab text;begin foreach tab in array array['expenses','recurring_expenses','investments','bill_events','finance_report_log'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop trigger if exists tenant_insert on %I',tab);execute format('create trigger tenant_insert before insert on %I for each row execute function set_workspace_id()',tab);
end loop;end $$;
do $$declare tab text;begin foreach tab in array array['expenses','recurring_expenses'] loop
 execute format('drop policy if exists finance_read on %I',tab);execute format('create policy finance_read on %I for select to authenticated using(workspace_id=current_workspace() and finance_allowed(category))',tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(category<>''salary'' and master_can_read(workspace_id))',tab);
end loop;end $$;
drop policy if exists finance_read on investments;
create policy finance_read on investments for select to authenticated using(workspace_id=current_workspace() and perm('finance'));
drop policy if exists master_read on investments;
create policy master_read on investments for select to authenticated using(master_can_read(workspace_id));
drop policy if exists bill_events_read on bill_events;
create policy bill_events_read on bill_events for select to authenticated using(workspace_id=current_workspace() and exists(select 1 from recurring_expenses b where b.id=bill_id));
drop policy if exists finance_log_read on finance_report_log;
create policy finance_log_read on finance_report_log for select to authenticated using(workspace_id=current_workspace() and is_manager());
create or replace function finance_summary(from_day date,to_day date) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not perm('finance') or from_day is null or to_day is null or to_day<from_day or to_day-from_day>365 then raise exception 'Not permitted or invalid date range';end if;
 return jsonb_build_object('revenue',(select coalesce(sum(amount),0) from invoices where workspace_id=current_workspace() and kind<>'rent' and status='paid' and paid_on between from_day and to_day),'expense_total',(select coalesce(sum(amount),0) from expenses where workspace_id=current_workspace() and paid_on between from_day and to_day and archived_at is null),'salary_total',(select coalesce(sum(amount),0) from expenses where workspace_id=current_workspace() and paid_on between from_day and to_day and archived_at is null and category='salary'),'investment_net',(select coalesce(sum(case when kind in('capital_in','loan_in') then amount else -amount end),0) from investments where workspace_id=current_workspace() and occurred_on between from_day and to_day and archived_at is null));
end $$;
create or replace function finance_currency_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.app_currency<>old.app_currency and (exists(select 1 from expenses where workspace_id=new.workspace_id) or exists(select 1 from recurring_expenses where workspace_id=new.workspace_id) or exists(select 1 from investments where workspace_id=new.workspace_id) or exists(select 1 from invoices where workspace_id=new.workspace_id)) then raise exception 'Reporting currency is fixed after financial records exist';end if;return new;end $$;
drop trigger if exists finance_currency_guard on app_settings;
create trigger finance_currency_guard before update on app_settings for each row execute function finance_currency_guard();
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['money_before_write','finance_allowed','finance_save','advance_frequency','bill_settle_internal','bill_settle','finance_archive','notify_finance_people','finance_sweep','finance_notify','finance_summary','finance_currency_guard']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname=any(array['finance_allowed','finance_save','advance_frequency','bill_settle','finance_archive','finance_sweep','finance_summary']) then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;

-- PART 11: Invoices. Counters, issuer snapshots and money are owned by PostgreSQL.
create table if not exists invoice_counters(id uuid primary key default gen_random_uuid(),workspace_id uuid references workspaces(id),kind text not null,client_id uuid,next_value integer not null default 1 check(next_value>0),foreign key(workspace_id,client_id) references clients(workspace_id,id));
create unique index if not exists invoice_counter_scope on invoice_counters(coalesce(workspace_id,'00000000-0000-0000-0000-000000000000'::uuid),kind,coalesce(client_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists invoices(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),kind text not null check(kind in('client','business','rent')),client_id uuid,project_id uuid,
 number text not null,reference text not null,issued_by jsonb not null,issuer_details jsonb not null,billed_to jsonb not null,
 issue_date date not null default current_date,due_date date not null,period_from date,period_to date,
 currency text not null check(currency~'^[A-Z]{3}$'),fx_rate numeric(14,6) not null check(fx_rate>0),line_items jsonb not null check(jsonb_typeof(line_items)='array'),
 discount_percent numeric(6,3) not null default 0 check(discount_percent between 0 and 100),tax_percent numeric(6,3) not null default 0 check(tax_percent between 0 and 100),
 subtotal numeric(14,2) not null,discount_amount numeric(14,2) not null,tax_amount numeric(14,2) not null,amount_original numeric(14,2) not null,amount numeric(14,2) not null,
 status text not null default 'unpaid' check(status in('unpaid','paid','void')),paid_on date,notes text,terms text,
 created_by uuid not null references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,number),foreign key(workspace_id,client_id) references clients(workspace_id,id),foreign key(workspace_id,project_id) references projects(workspace_id,id),
 check((kind='client' and client_id is not null) or kind<>'client')
);
create or replace function invoice_next_number(workspace uuid,invoice_kind text,client uuid default null) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare counter invoice_counters;prefix text;c clients;begin
 perform pg_advisory_xact_lock(hashtext(coalesce(workspace::text,'master-invoices')));
 select * into counter from invoice_counters where workspace_id is not distinct from workspace and kind=invoice_kind and client_id is not distinct from client for update;
 if counter.id is null then insert into invoice_counters(workspace_id,kind,client_id) values(workspace,invoice_kind,client) returning * into counter;end if;
 update invoice_counters set next_value=next_value+1 where id=counter.id;
 if invoice_kind='rent' then prefix:='INV-WX';
 elsif invoice_kind='client' then select * into c from clients where id=client and workspace_id=workspace;if c.id is null then raise exception 'Client not found';end if;prefix:='INV-'||c.buid||'-'||c.invoice_code;
 else select 'INV-'||short_code into prefix from workspaces where id=workspace;end if;
 return prefix||lpad(counter.next_value::text,greatest(3,length(counter.next_value::text)),'0');
end $$;
create or replace function invoices_details_before() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb;qty numeric;price numeric;p profiles;s app_settings;c clients;begin
 if tg_op='INSERT' then
  new.number:=invoice_next_number(case when new.kind='rent' then null else new.workspace_id end,new.kind,new.client_id);
  new.reference:=upper(replace(gen_random_uuid()::text,'-',''));
  select * into p from profiles where id=new.created_by;
  new.issued_by:=jsonb_build_object('id',p.id,'name',p.name,'designation',p.job_title);
  select * into s from app_settings where workspace_id=new.workspace_id;
  if new.kind<>'rent' then
   new.issuer_details:=s.invoice_details||jsonb_build_object('company_name',s.company_name,'due_days',s.due_days,'pause_days',s.pause_days,'logo_path',(select logo_url from workspaces where id=new.workspace_id));
   if new.kind='client' then select * into c from clients where id=new.client_id and workspace_id=new.workspace_id;new.billed_to:=jsonb_build_object('name',c.name,'company',c.company,'buid',c.buid,'address',c.address,'email',c.email,'phone',c.phone);end if;
  end if;
 else
  if new.number<>old.number or new.reference<>old.reference or new.issued_by<>old.issued_by or new.issuer_details<>old.issuer_details or new.kind<>old.kind or new.workspace_id<>old.workspace_id or new.created_by<>old.created_by or new.client_id is distinct from old.client_id then raise exception 'Invoice identity is locked';end if;
  if old.status in('paid','void') and (new.line_items<>old.line_items or new.currency<>old.currency or new.fx_rate<>old.fx_rate or new.tax_percent<>old.tax_percent or new.discount_percent<>old.discount_percent) then raise exception 'Paid or void invoice amounts are locked';end if;
 end if;
 if jsonb_array_length(new.line_items) not between 1 and 100 then raise exception 'Add between 1 and 100 line items';end if;
 new.subtotal:=0;
 for item in select * from jsonb_array_elements(new.line_items) loop
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if qty is null or qty<=0 or qty>1000000 or price is null or price<0 or length(trim(coalesce(item->>'description','')))=0 then raise exception 'Check line item description, quantity and price';end if;
  new.subtotal:=new.subtotal+round(qty*price,2);
 end loop;
 new.discount_amount:=round(new.subtotal*new.discount_percent/100,2);new.tax_amount:=round((new.subtotal-new.discount_amount)*new.tax_percent/100,2);
 new.amount_original:=new.subtotal-new.discount_amount+new.tax_amount;
 if new.currency=(select app_currency from app_settings where workspace_id=new.workspace_id) then new.fx_rate:=1;end if;
 new.amount:=round(new.amount_original*new.fx_rate,2);new.updated_at:=now();return new;
end $$;
drop trigger if exists invoices_details_before on invoices;
create trigger invoices_details_before before insert or update on invoices for each row execute function invoices_details_before();
drop trigger if exists project_link_before on invoices;
create trigger project_link_before before insert or update on invoices for each row execute function project_link_before();
create or replace function invoice_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i invoices;c uuid;p uuid;begin
 if not perm('finance','edit') then raise exception 'Not permitted';end if;
 if nullif(payload->>'id','') is null then
  if payload->>'kind' not in('client','business') then raise exception 'Choose a client or business invoice';end if;
  c:=nullif(payload->>'client_id','')::uuid;p:=nullif(payload->>'project_id','')::uuid;
  if c is not null and not exists(select 1 from clients where id=c and workspace_id=current_workspace()) then raise exception 'Client not found';end if;
  if p is not null and not exists(select 1 from projects where id=p and client_id=c and workspace_id=current_workspace()) then raise exception 'Project not found';end if;
  insert into invoices(workspace_id,kind,client_id,project_id,number,reference,issued_by,issuer_details,billed_to,issue_date,due_date,period_from,period_to,currency,fx_rate,line_items,discount_percent,tax_percent,subtotal,discount_amount,tax_amount,amount_original,amount,notes,terms,created_by)
  values(current_workspace(),payload->>'kind',c,p,'','', '{}','{}',coalesce(payload->'billed_to','{}'),coalesce(nullif(payload->>'issue_date','')::date,current_date),(payload->>'due_date')::date,nullif(payload->>'period_from','')::date,nullif(payload->>'period_to','')::date,payload->>'currency',(payload->>'fx_rate')::numeric,payload->'line_items',coalesce((payload->>'discount_percent')::numeric,0),coalesce((payload->>'tax_percent')::numeric,0),0,0,0,0,0,payload->>'notes',payload->>'terms',auth.uid()) returning * into i;
 else
  select * into i from invoices where id=(payload->>'id')::uuid and workspace_id=current_workspace() and kind<>'rent' for update;
  if i.id is null then raise exception 'Invoice not found';end if;
  if i.status<>'unpaid' then raise exception 'Only unpaid invoices can be edited';end if;
  update invoices set due_date=coalesce(nullif(payload->>'due_date','')::date,due_date),line_items=coalesce(payload->'line_items',line_items),discount_percent=coalesce((payload->>'discount_percent')::numeric,discount_percent),tax_percent=coalesce((payload->>'tax_percent')::numeric,tax_percent),currency=coalesce(payload->>'currency',currency),fx_rate=coalesce((payload->>'fx_rate')::numeric,fx_rate),notes=coalesce(payload->>'notes',notes),terms=coalesce(payload->>'terms',terms) where id=i.id returning * into i;
 end if;
 perform log_activity('invoice_saved','invoice',i.id);return to_jsonb(i);
end $$;
create or replace function invoice_set_status(target uuid,new_status text,paid_on date default current_date) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare i invoices;begin
 if not perm('finance',case when new_status='void' then 'delete' else 'edit' end) or new_status not in('paid','void') then raise exception 'Not permitted';end if;
 select * into i from invoices where id=target and workspace_id=current_workspace() and kind<>'rent' for update;
 if i.id is null then raise exception 'Invoice not found';end if;if i.status<>'unpaid' then raise exception 'This invoice is already closed';end if;
 update invoices set status=new_status,paid_on=case when new_status='paid' then invoice_set_status.paid_on end where id=i.id;perform log_activity('invoice_'||new_status,'invoice',i.id);
end $$;
create or replace function invoice_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.kind<>'rent' then perform notify_finance_people(new.workspace_id,'Invoice created',new.number,'#/invoice/'||new.id);end if;return new;end $$;
drop trigger if exists invoice_notify on invoices;
create trigger invoice_notify after insert on invoices for each row execute function invoice_notify();
alter table invoices enable row level security;alter table invoice_counters enable row level security;
revoke all on invoices,invoice_counters from anon,authenticated;grant select on invoices,invoice_counters to authenticated;
drop trigger if exists tenant_insert on invoices;
create trigger tenant_insert before insert on invoices for each row execute function set_workspace_id();
drop policy if exists invoice_read on invoices;
create policy invoice_read on invoices for select to authenticated using((workspace_id=current_workspace() and kind<>'rent' and (perm('finance') or (kind='client' and (perm('clients') or pm_perm(project_id))))) or (workspace_id=billing_workspace() and kind='rent'));
drop policy if exists master_read on invoices;
create policy master_read on invoices for select to authenticated using((kind='rent' and is_master()) or master_can_read(workspace_id));
drop policy if exists counter_read on invoice_counters;
create policy counter_read on invoice_counters for select to authenticated using((workspace_id=current_workspace() and perm('finance')) or (workspace_id is null and is_master()));
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['invoice_next_number','invoices_details_before','invoice_save','invoice_set_status','invoice_notify']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.proname in('invoice_save','invoice_set_status') then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;

-- Private finance attachments inherit the parent record's salary restriction.
create table if not exists finance_files(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),kind text not null check(kind in('expense','bill','rent')),record_id uuid not null,
 name text not null,path text not null unique,mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 10485760),
 status text not null default 'pending' check(status in('pending','ready','failed')),uploaded_by uuid not null references profiles(id),created_at timestamptz not null default now()
);
create or replace function can_finance_file(file_path text,write_access boolean default false) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w uuid;target uuid;category text;begin
 if file_path !~ '^w[0-9a-f-]{36}/(expense|bill|rent)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$' then return false;end if;
 w:=substring(split_part(file_path,'/',1) from 2)::uuid;target:=split_part(file_path,'/',3)::uuid;
 if split_part(file_path,'/',2)='rent' then return exists(select 1 from subscription_payments where id=target and workspace_id=w) and (is_master() or (not write_access and coalesce(w=billing_workspace(),false)));end if;
 if split_part(file_path,'/',2)='expense' then select e.category into category from expenses e where id=target and workspace_id=w;
 else select b.category into category from recurring_expenses b where id=target and workspace_id=w;end if;
 if category is null then return false;end if;
 if w=current_workspace() then return finance_allowed(category,case when write_access then 'edit' else 'view' end);end if;
 return not write_access and category<>'salary' and master_can_read(w);
end $$;
create or replace function finance_file_register(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare f uuid;target uuid;kind text;allowed_workspace uuid;begin
 target:=(payload->>'record_id')::uuid;kind:=payload->>'kind';
 allowed_workspace:=case when kind='rent' and is_master() then (select workspace_id from subscription_payments where id=target) else current_workspace() end;
 if allowed_workspace is null or not can_finance_file(payload->>'path',true) or payload->>'path' not like 'w'||allowed_workspace::text||'/'||kind||'/'||target::text||'/%' then raise exception 'Not permitted';end if;
 perform pg_advisory_xact_lock(hashtext(target::text));
 if (select count(*) from finance_files where record_id=target and status in('pending','ready'))>=10 then raise exception 'A record can have at most 10 attachments';end if;
 if payload->>'mime_type' not in('application/pdf','image/png','image/jpeg','image/webp') then raise exception 'Unsupported file type';end if;
 insert into finance_files(workspace_id,kind,record_id,name,path,mime_type,size_bytes,uploaded_by) values(allowed_workspace,kind,target,payload->>'name',payload->>'path',payload->>'mime_type',(payload->>'size_bytes')::bigint,auth.uid()) returning id into f;return f;
end $$;
create or replace function finance_file_finish(target uuid,success boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f finance_files;begin
 select * into f from finance_files where id=target and (workspace_id=current_workspace() or is_master()) and uploaded_by=auth.uid() for update;
 if f.id is null or not can_finance_file(f.path,true) then raise exception 'Not permitted';end if;
 if f.status<>'pending' then return;end if;
 if success and not exists(select 1 from storage.objects where bucket_id='finance-files' and name=f.path) then raise exception 'Upload has not completed';end if;
 update finance_files set status=case when success then 'ready' else 'failed' end where id=f.id;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('finance-files','finance-files',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists finance_file_read on storage.objects;
create policy finance_file_read on storage.objects for select to authenticated using(bucket_id='finance-files' and can_finance_file(name));
drop policy if exists finance_file_insert on storage.objects;
create policy finance_file_insert on storage.objects for insert to authenticated with check(bucket_id='finance-files' and can_finance_file(name,true));
alter table finance_files enable row level security;revoke all on finance_files from anon,authenticated;grant select on finance_files to authenticated;
drop trigger if exists tenant_insert on finance_files;
create trigger tenant_insert before insert on finance_files for each row execute function set_workspace_id();
drop policy if exists finance_files_read on finance_files;
create policy finance_files_read on finance_files for select to authenticated using((workspace_id=current_workspace() or workspace_id=billing_workspace() or is_master()) and can_finance_file(path));
revoke all on function can_finance_file(text,boolean),finance_file_register(jsonb),finance_file_finish(uuid,boolean) from public,anon,authenticated;
grant execute on function can_finance_file(text,boolean),finance_file_register(jsonb),finance_file_finish(uuid,boolean) to authenticated;

-- PART 12: Dashboards query real scoped records, including empty workspaces.
create or replace function dashboard() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare day date;month date;begin
 if current_workspace() is null then raise exception 'Not permitted';end if;
 select (now() at time zone timezone)::date into day from app_settings where workspace_id=current_workspace();month:=date_trunc('month',day)::date;
 return jsonb_build_object('today',day,'tasks',(select jsonb_build_object('open',count(*) filter(where status in('todo','in_progress')),'in_review',count(*) filter(where status='in_review'),'completed',count(*) filter(where status='completed'),'overdue',count(*) filter(where status<>'completed' and due_date<day)) from tasks where workspace_id=current_workspace() and archived_at is null and can_task(id)),
 'my_tasks',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from(select * from tasks where workspace_id=current_workspace() and assignee_id=auth.uid() and status<>'completed' and archived_at is null order by due_date nulls last,created_at limit 8)t),
 'reviews',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from(select * from tasks where workspace_id=current_workspace() and status='in_review' and (is_manager() or pm_perm(project_id,'edit')) order by updated_at limit 8)t),
 'presence',team_presence(),'activity',report_daily(day,day,auth.uid()),'finance',case when perm('finance') then finance_summary(month,day) end);
end $$;
revoke all on function dashboard() from public,anon,authenticated;grant execute on function dashboard() to authenticated;

-- PART 13: Platform billing and audited Master visibility.
create table if not exists platform_settings(id boolean primary key default true check(id),company_name text not null default 'Webnox OS',bank_details jsonb not null default '{}',invoice_details jsonb not null default '{}',updated_at timestamptz not null default now());
insert into platform_settings(id) values(true) on conflict do nothing;
create table if not exists master_access_log(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),actor_id uuid not null references profiles(id),action text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists billing_log(workspace_id uuid not null references workspaces(id),kind text not null,for_date date not null,created_at timestamptz not null default now(),primary key(workspace_id,kind,for_date));
create table if not exists subscription_payments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),request_id uuid not null unique,
 currency text not null check(currency~'^[A-Z]{3}$'),amount_original numeric(14,2) not null check(amount_original>0),fx_rate numeric(14,6) not null check(fx_rate>0),amount numeric(14,2) not null,
 paid_on date not null,reference text,period_from date not null,period_to date not null,notes text,invoice_id uuid not null,recorded_by uuid not null references profiles(id),created_at timestamptz not null default now(),
 foreign key(workspace_id,invoice_id) references invoices(workspace_id,id),check(period_to>=period_from)
);
create or replace function master_audit(workspace uuid,event text,detail jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into master_access_log(workspace_id,actor_id,action,detail) values(workspace,auth.uid(),event,detail);insert into activity_logs(workspace_id,actor_id,action,detail) values(workspace,auth.uid(),'master_'||event,detail);end $$;
create or replace function master_workspace_stats(workspace uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;begin
 if not is_master() then raise exception 'Not permitted';end if;
 select * into w from workspaces where id=workspace;if w.id is null then raise exception 'Workspace not found';end if;
 return jsonb_build_object('members',(select count(*) from profiles where workspace_id=w.id),'active',(select count(*) from user_sessions where workspace_id=w.id and ended_at is null and presence='active' and last_heartbeat_at>now()-interval '3 minutes'),'idle',(select count(*) from user_sessions where workspace_id=w.id and ended_at is null and presence='idle' and last_heartbeat_at>now()-interval '3 minutes'),'signed_in',(select count(*) from user_sessions where workspace_id=w.id and ended_at is null and last_heartbeat_at>now()-interval '3 minutes'),'never_joined',(select count(*) from profiles where workspace_id=w.id and joined_at is null),'tasks',(select count(*) from tasks where workspace_id=w.id),'leads',(select count(*) from leads where workspace_id=w.id),'clients',(select count(*) from clients where workspace_id=w.id),'projects',(select count(*) from projects where workspace_id=w.id));
end $$;
create or replace function master_open_workspace(workspace uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 result:=master_workspace_stats(workspace);perform master_audit(workspace,'opened');return result;
end $$;
create or replace function master_set_full_access(workspace uuid,on_off boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;admin uuid;begin
 if not is_master() then raise exception 'Not permitted';end if;
 select * into w from workspaces where id=workspace for update;if w.id is null then raise exception 'Workspace not found';end if;
 if w.full_access=on_off then return;end if;
 update workspaces set full_access=on_off,full_access_at=case when on_off then now() end where id=w.id;
 perform master_audit(w.id,case when on_off then 'full_access_on' else 'full_access_off' end);
 select id into admin from profiles where workspace_id=w.id and account_type='admin' and status='active';
 perform notify(admin,w.id,case when on_off then 'Full access enabled' else 'Full access disabled' end,'Webnox OS changed read-only access to business records. Salary details remain private.','#/activity',null,'master');
end $$;
create or replace function master_notify_admin(workspace uuid,title text,body text,include_managers boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;begin
 if not is_master() then raise exception 'Not permitted';end if;
 if length(trim(title)) not between 1 and 160 or length(trim(body)) not between 1 and 5000 then raise exception 'Add a title and message';end if;
 for p in select * from profiles where workspace_id=workspace and status='active' and (account_type='admin' or (include_managers and exists(select 1 from member_roles where user_id=profiles.id and role_key='manager'))) loop perform notify(p.id,workspace,title,body,null,null,'master');end loop;
 perform master_audit(workspace,'admin_notified');
end $$;
create or replace function master_set_status(workspace uuid,status workspace_status,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;begin
 if not is_master() then raise exception 'Not permitted';end if;
 if status not in('active','suspended','archived') or length(trim(reason))=0 then raise exception 'Choose a valid status and give a reason';end if;
 select * into w from workspaces where id=workspace for update;if w.id is null then raise exception 'Workspace not found';end if;
 update workspaces set status=master_set_status.status,manual_suspension=master_set_status.status='suspended',archived_at=case when master_set_status.status='archived' then now() end where id=w.id;
 perform master_audit(w.id,case status when 'active' then 'resumed' when 'suspended' then 'suspended' else 'archived' end,jsonb_build_object('reason',reason));
 perform notify_managers(w.id,'Workspace '||status::text,reason,'#/billing');
end $$;
create or replace function master_save_workspace(workspace uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_master() then raise exception 'Not permitted';end if;
 if payload?'timezone' and not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone';end if;
 update workspaces set name=coalesce(nullif(trim(payload->>'name'),''),name),country=coalesce(payload->>'country',country) where id=workspace;if not found then raise exception 'Workspace not found';end if;
 update app_settings set timezone=coalesce(payload->>'timezone',timezone),idle_minutes=coalesce((payload->>'idle_minutes')::integer,idle_minutes) where workspace_id=workspace;
 perform master_audit(workspace,'settings_changed');
end $$;
create or replace function master_save_settings(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not is_master() then raise exception 'Not permitted';end if;update platform_settings set company_name=coalesce(nullif(payload->>'company_name',''),company_name),bank_details=coalesce(payload->'bank_details',bank_details),invoice_details=coalesce(payload->'invoice_details',invoice_details),updated_at=now() where id;end $$;
create or replace function billing_details() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w uuid;begin
 w:=billing_workspace();if w is null then raise exception 'Only the workspace Admin can view billing';end if;
 return jsonb_build_object('subscription',(select to_jsonb(s) from subscriptions s where workspace_id=w),'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by created_at desc),'[]') from subscription_payments p where workspace_id=w),'bank_details',(select bank_details from platform_settings where id),'company_name',(select company_name from platform_settings where id));
end $$;
create or replace function master_set_plan(workspace uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;s subscriptions;new_cycle billing_cycle;start_on date;trial_end date;begin
 if not is_master() then raise exception 'Not permitted';end if;
 select * into w from workspaces where id=workspace for update;if w.id is null or w.type<>'rented' then raise exception 'Only rented workspaces have a plan';end if;
 select * into s from subscriptions where workspace_id=w.id for update;
 new_cycle:=(payload->>'cycle')::billing_cycle;start_on:=coalesce(nullif(payload->>'start_date','')::date,s.start_date);
 if new_cycle in('trial_7','trial_14') then trial_end:=advance_due(start_on,new_cycle);end if;
 update subscriptions set plan_name=coalesce(payload->>'plan_name',plan_name),cycle=new_cycle,next_cycle=case when trial_end is not null then coalesce((payload->>'next_cycle')::billing_cycle,'monthly') end,amount_original=(payload->>'amount_original')::numeric,currency=payload->>'currency',fx_rate=(payload->>'fx_rate')::numeric,amount=round((payload->>'amount_original')::numeric*(payload->>'fx_rate')::numeric,2),start_date=start_on,trial_ends_on=trial_end,next_due=case when trial_end is null then coalesce(nullif(payload->>'next_due','')::date,s.next_due,start_on) end,grace_days=coalesce((payload->>'grace_days')::integer,grace_days),member_limit=nullif(payload->>'member_limit','')::integer,updated_at=now() where workspace_id=w.id;
 perform master_audit(w.id,'plan_changed');
end $$;
create or replace function rent_notice(workspace uuid,title text,body text,event_key text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;begin
 for p in select * from profiles where status='active' and (is_master or (workspace_id=workspace and account_type='admin')) loop perform notify(p.id,workspace,title,body,case when p.is_master then '#/workspace/'||workspace else '#/billing' end,event_key,'master');end loop;
end $$;
create or replace function master_sweep() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s subscriptions;w workspaces;day date;next_status billing_status;notice_kind text;inserted integer;begin
 if not is_master() and billing_workspace() is null then raise exception 'Not permitted';end if;
 for w in select * from workspaces ws where ws.type='rented' and ws.status<>'archived' and (is_master() or ws.id=billing_workspace()) order by ws.id for update loop
  select * into s from subscriptions where workspace_id=w.id for update;
  if s.workspace_id is null then continue;end if;
  select (now() at time zone timezone)::date into day from app_settings where workspace_id=w.id;
  if s.cycle in('trial_7','trial_14') and s.trial_ends_on<=day then
   update subscriptions set cycle=next_cycle,next_cycle=null,next_due=trial_ends_on,updated_at=now() where workspace_id=w.id returning * into s;
  end if;
  next_status:=case when w.manual_suspension then 'suspended'::billing_status when s.cycle in('trial_7','trial_14') and s.trial_ends_on>day then 'trial'::billing_status when day-s.next_due>s.grace_days then 'suspended'::billing_status when day>s.next_due then 'overdue'::billing_status when day=s.next_due then 'due_today'::billing_status when s.next_due-day between 1 and 3 then 'due_soon'::billing_status else 'active'::billing_status end;
  update subscriptions set status=next_status,suspended_at=case when next_status='suspended' then coalesce(suspended_at,now()) end,updated_at=now() where workspace_id=w.id;
  update workspaces set status=case when next_status='suspended' then 'suspended'::workspace_status when next_status='trial' then 'trial'::workspace_status else 'active'::workspace_status end where id=w.id;
  notice_kind:=case when next_status in('trial','due_soon','due_today','overdue','suspended') then next_status::text end;
  if notice_kind is not null then
   insert into billing_log(workspace_id,kind,for_date) values(w.id,notice_kind,day) on conflict do nothing;get diagnostics inserted=row_count;
   if inserted=1 then perform rent_notice(w.id,case next_status when 'trial' then 'Trial ends in '||(s.trial_ends_on-day)||' days' when 'due_soon' then 'Rent due in '||(s.next_due-day)||' days' when 'due_today' then 'Rent due today' when 'overdue' then 'Rent overdue by '||(day-s.next_due)||' days' else 'Workspace suspended' end,w.name||' · '||s.currency||' '||s.amount_original||case when next_status='overdue' then ' · Suspension after '||greatest(0,s.grace_days-(day-s.next_due)+1)||' days' else '' end,'rent:'||w.id||':'||notice_kind||':'||day);end if;
  end if;
 end loop;
end $$;
create or replace function record_rent_payment(workspace uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;s subscriptions;p subscription_payments;i invoices;settings platform_settings;period_start date;period_end date;request uuid;begin
 if not is_master() then raise exception 'Not permitted';end if;
 request:=(payload->>'request_id')::uuid;if request is null then raise exception 'Payment request ID is required';end if;
 perform pg_advisory_xact_lock(hashtext(request::text));
 select * into p from subscription_payments where request_id=request;if p.id is not null then if p.workspace_id<>workspace then raise exception 'Request belongs to another workspace';end if;return to_jsonb(p);end if;
 select * into w from workspaces where id=workspace for update;if w.id is null or w.type<>'rented' or w.status='archived' then raise exception 'Workspace cannot receive rent payments';end if;
 select * into s from subscriptions where workspace_id=w.id for update;
 if s.cycle in('trial_7','trial_14') then update subscriptions set cycle=next_cycle,next_cycle=null,next_due=trial_ends_on where workspace_id=w.id returning * into s;end if;
 period_start:=coalesce(s.next_due,s.start_date);period_end:=advance_due(period_start,s.cycle)-1;
 select * into settings from platform_settings where id;
 insert into invoices(workspace_id,kind,number,reference,issued_by,issuer_details,billed_to,issue_date,due_date,period_from,period_to,currency,fx_rate,line_items,subtotal,discount_amount,tax_amount,amount_original,amount,status,paid_on,notes,created_by)
 values(w.id,'rent','','','{}',settings.invoice_details||jsonb_build_object('company_name',settings.company_name,'bank_details',settings.bank_details::text),jsonb_build_object('company',w.name,'name',w.name),(payload->>'paid_on')::date,(payload->>'paid_on')::date,period_start,period_end,payload->>'currency',(payload->>'fx_rate')::numeric,jsonb_build_array(jsonb_build_object('description',coalesce(s.plan_name,'Workspace rent')||' · '||period_start||' to '||period_end,'quantity',1,'unit_price',(payload->>'amount_original')::numeric)),0,0,0,0,0,'paid',(payload->>'paid_on')::date,payload->>'notes',auth.uid()) returning * into i;
 insert into subscription_payments(workspace_id,request_id,currency,amount_original,fx_rate,amount,paid_on,reference,period_from,period_to,notes,invoice_id,recorded_by) values(w.id,request,i.currency,i.amount_original,i.fx_rate,i.amount,i.paid_on,payload->>'reference',period_start,period_end,payload->>'notes',i.id,auth.uid()) returning * into p;
 update subscriptions set next_due=advance_due(period_start,s.cycle),status='active',suspended_at=null,updated_at=now() where workspace_id=w.id;
 update workspaces set status='active',manual_suspension=false where id=w.id;
 perform master_audit(w.id,'rent_payment_recorded',jsonb_build_object('payment_id',p.id));
 perform rent_notice(w.id,'Payment received','Next rent due '||advance_due(period_start,s.cycle),'rent-payment:'||p.id);return to_jsonb(p);
end $$;
create or replace function master_overview() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not is_master() then raise exception 'Not permitted';end if;return jsonb_build_object('workspaces',(select count(*) from workspaces),'active',(select count(*) from workspaces where status in('active','trial')),'trials',(select count(*) from subscriptions where status='trial'),'overdue',(select count(*) from subscriptions where status in('overdue','suspended')),'receipts',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'total',total)),'[]') from(select currency,sum(amount_original) total from subscription_payments group by currency)t),'due',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'total',total)),'[]') from(select currency,sum(amount_original) total from subscriptions where status in('due_today','overdue','suspended') group by currency)t));end $$;
do $$declare tab text;begin foreach tab in array array['platform_settings','master_access_log','billing_log','subscription_payments'] loop
 execute format('alter table %I enable row level security',tab);execute format('revoke all on %I from anon,authenticated',tab);execute format('grant select on %I to authenticated',tab);
 execute format('drop policy if exists master_read on %I',tab);execute format('create policy master_read on %I for select to authenticated using(is_master())',tab);
end loop;end $$;
drop policy if exists admin_payments on subscription_payments;
create policy admin_payments on subscription_payments for select to authenticated using(workspace_id=billing_workspace());
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['master_audit','master_workspace_stats','master_open_workspace','master_set_full_access','master_notify_admin','master_set_status','master_save_workspace','master_save_settings','billing_details','master_set_plan','rent_notice','master_sweep','record_rent_payment','master_overview']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.proname not in('master_audit','rent_notice') then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;

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
-- Master control center. Idempotent, additive migration; no tenant records are seeded.
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;
alter table profiles add column if not exists date_of_birth date;
alter table profiles add column if not exists avatar_path text;
alter table profiles add column if not exists platform_role text not null default 'owner' check(platform_role in('owner','admin','support'));
alter table profiles add column if not exists platform_permissions text[] not null default '{}';
drop index if exists one_master;
create unique index if not exists one_platform_owner on profiles(is_master) where is_master and platform_role='owner';
alter table workspaces add column if not exists business_details jsonb not null default '{}';

-- is_master retains owner-only authority for all existing finance and tenant-data policies.
create or replace function is_master() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select is_master and platform_role='owner' and status='active' from profiles where id=auth.uid()),false)
$$;
create or replace function platform_can(permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select is_master and status='active' and (platform_role='owner' or permission=any(platform_permissions)) from profiles where id=auth.uid()),false)
$$;
create table if not exists platform_activity(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references profiles(id),action text not null,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create or replace function platform_log(event text,detail jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into platform_activity(actor_id,action,detail) values(auth.uid(),event,detail);end $$;
alter table platform_activity enable row level security;
revoke all on platform_activity from anon,authenticated;
grant select on platform_activity to authenticated;
drop policy if exists platform_read on platform_activity;
create policy platform_read on platform_activity for select to authenticated using(platform_can('view_audit'));

create or replace function master_profile_save(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare dob date;image text;begin
 if not exists(select 1 from profiles where id=auth.uid() and is_master and status='active') then raise exception 'Not permitted';end if;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 120 or length(coalesce(payload->>'first_name',''))>80 or length(coalesce(payload->>'last_name',''))>80 or length(coalesce(payload->>'phone',''))>40 then raise exception 'Enter valid profile details';end if;
 dob:=nullif(payload->>'date_of_birth','')::date;
 if dob>current_date or dob<date '1900-01-01' then raise exception 'Enter a valid date of birth';end if;
 if payload?'avatar_path' then
  image:=nullif(payload->>'avatar_path','');
  if image is not null and (image !~ ('^'||auth.uid()::text||'/[a-f0-9-]+[.]webp$') or not exists(select 1 from storage.objects where bucket_id='avatars' and name=image)) then raise exception 'Upload your profile image first';end if;
 end if;
 update profiles set name=trim(payload->>'name'),first_name=trim(payload->>'first_name'),last_name=trim(payload->>'last_name'),phone=trim(payload->>'phone'),date_of_birth=dob,avatar_path=case when payload?'avatar_path' then image else avatar_path end where id=auth.uid();
 perform platform_log('profile_updated');
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avatars','avatars',false,1048576,array['image/webp']) on conflict(id) do nothing;
drop policy if exists avatar_owner on storage.objects;
create policy avatar_owner on storage.objects for all to authenticated using(bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text and exists(select 1 from profiles where id=auth.uid() and is_master and status='active')) with check(bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text and name ~ ('^'||auth.uid()::text||'/[a-f0-9-]+[.]webp$') and exists(select 1 from profiles where id=auth.uid() and is_master and status='active'));

create or replace function master_team_list() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not platform_can('view_team') then raise exception 'Not permitted';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,'platform_role',platform_role,'platform_permissions',platform_permissions,'status',status,'created_at',created_at) order by created_at),'[]') from profiles where is_master);
end $$;
create or replace function master_team_save(target uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;u auth.users;permissions text[];begin
 -- Delegating platform authority is reserved to the sole owner.
 if not is_master() then raise exception 'Only the platform owner can manage platform access';end if;
 select * into p from profiles where id=target for update;
 if p.id is not null and (not p.is_master or p.platform_role='owner') then raise exception 'Owner and business accounts cannot be changed here';end if;
 if coalesce(payload->>'platform_role','') not in('admin','support') or coalesce(payload->>'status','active') not in('active','inactive') then raise exception 'Choose a valid platform role and status';end if;
 select coalesce(array_agg(v),'{}') into permissions from jsonb_array_elements_text(coalesce(payload->'permissions','[]')) v;
 if not permissions <@ array['view_workspaces','create_workspaces','edit_workspaces','suspend_workspaces','view_team','view_audit','edit_settings','manage_catalog'] then raise exception 'Unknown platform permission';end if;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 120 or length(coalesce(payload->>'phone',''))>40 then raise exception 'Enter valid profile details';end if;
 if p.id is null then
  select * into u from auth.users where id=target;if u.id is null then raise exception 'Account not found';end if;
  insert into profiles(id,name,email,phone,is_master,account_type,platform_role,platform_permissions) values(target,trim(payload->>'name'),u.email,payload->>'phone',true,'master',payload->>'platform_role',permissions);
 else
  update profiles set name=trim(payload->>'name'),phone=payload->>'phone',platform_role=payload->>'platform_role',platform_permissions=permissions,status=coalesce(payload->>'status','active') where id=target;
 end if;
 perform platform_log('platform_member_saved',jsonb_build_object('member_id',target));
end $$;

create table if not exists business_role_catalog(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),
 department text not null check(length(trim(department)) between 1 and 80),description text not null default '',responsibilities text not null default '',
 active boolean not null default true,created_at timestamptz not null default now()
);
create table if not exists task_templates(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 160),department text not null,
 role_id uuid not null references business_role_catalog(id),description text not null default '',instructions text not null default '',
 required_module text not null default 'tasks' check(required_module in('tasks','leads','clients','projects','finance')),
 active boolean not null default true,created_at timestamptz not null default now()
);
do $$declare t text;begin foreach t in array array['business_role_catalog','task_templates'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
 execute format('drop policy if exists catalog_read on %I',t);
 execute format('create policy catalog_read on %I for select to authenticated using(platform_can(''manage_catalog'') or (active and current_workspace() is not null))',t);
end loop;end $$;
create or replace function master_catalog_save(kind text,payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;role business_role_catalog;begin
 if not platform_can('manage_catalog') then raise exception 'Not permitted';end if;
 target:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if length(coalesce(payload->>'description',''))>4000 or length(coalesce(payload->>'instructions',''))>20000 or length(coalesce(payload->>'responsibilities',''))>20000 then raise exception 'Description is too long';end if;
 if kind='role' then
  insert into business_role_catalog(id,name,department,description,responsibilities,active) values(target,trim(payload->>'name'),trim(payload->>'department'),coalesce(payload->>'description',''),coalesce(payload->>'responsibilities',''),coalesce((payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,department=excluded.department,description=excluded.description,responsibilities=excluded.responsibilities,active=excluded.active;
  update task_templates set department=trim(payload->>'department') where role_id=target;
 elsif kind='template' then
  select * into role from business_role_catalog where id=(payload->>'role_id')::uuid and active;
  if role.id is null then raise exception 'Choose an active business role';end if;
  insert into task_templates(id,name,department,role_id,description,instructions,required_module,active) values(target,trim(payload->>'name'),role.department,role.id,coalesce(payload->>'description',''),coalesce(payload->>'instructions',''),coalesce(payload->>'required_module','tasks'),coalesce((payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,department=excluded.department,role_id=excluded.role_id,description=excluded.description,instructions=excluded.instructions,required_module=excluded.required_module,active=excluded.active;
 else raise exception 'Unknown catalog';end if;
 perform platform_log('catalog_saved',jsonb_build_object('kind',kind,'id',target));return target;
end $$;

create or replace function master_save_workspace(workspace uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare details jsonb;begin
 if not platform_can('edit_workspaces') then raise exception 'Not permitted';end if;
 if payload?'timezone' and not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone';end if;
 perform validate_business_details(payload);
 details:=jsonb_build_object('legal_name',payload->>'legal_name','industry',payload->>'industry','website',payload->>'website','business_email',payload->>'business_email','business_phone',payload->>'business_phone','address',payload->>'address','city',payload->>'city','region',payload->>'region','postal_code',payload->>'postal_code','tax_id',payload->>'tax_id','description',payload->>'description');
 if length(details::text)>12000 then raise exception 'Business details are too long';end if;
 if coalesce(payload->>'website','')<>'' and payload->>'website' !~ '^https?://' then raise exception 'Website must start with https:// or http://';end if;
 update workspaces set name=coalesce(nullif(trim(payload->>'name'),''),name),country=coalesce(payload->>'country',country),business_details=business_details||jsonb_strip_nulls(details) where id=workspace;
 if not found then raise exception 'Workspace not found';end if;
 update app_settings set company_name=coalesce(nullif(trim(payload->>'name'),''),company_name),timezone=coalesce(payload->>'timezone',timezone),app_currency=coalesce(payload->>'app_currency',app_currency),idle_minutes=coalesce((payload->>'idle_minutes')::integer,idle_minutes) where workspace_id=workspace;
 perform master_audit(workspace,'settings_changed');
end $$;
create or replace function master_workspace_list() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not platform_can('view_workspaces') then raise exception 'Not permitted';end if;
 return(select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('member_count',(select count(*) from profiles p where p.workspace_id=w.id),'settings',(select jsonb_build_object('timezone',s.timezone,'app_currency',s.app_currency) from app_settings s where workspace_id=w.id),'subscription',case when is_master() then (select to_jsonb(s) from subscriptions s where s.workspace_id=w.id) end) order by w.created_at desc),'[]') from workspaces w);
end $$;

create or replace function validate_business_details(payload jsonb) returns void language plpgsql immutable set search_path=public,pg_temp as $$
declare key text;value text;begin
 foreach key in array array['legal_name','industry','website','business_email','business_phone','address','city','region','postal_code','tax_id','description','admin_phone','manager_phone'] loop
  value:=payload->>key;
  if length(value)>(case when key in('description','address') then 4000 else 254 end) then raise exception 'Business detail is too long: %',key;end if;
 end loop;
 if coalesce(payload->>'website','')<>'' and payload->>'website' !~ '^https?://[^[:space:]]+$' then raise exception 'Enter a valid website starting with https:// or http://';end if;
 if coalesce(payload->>'business_email','')<>'' and payload->>'business_email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid business email';end if;
end $$;
revoke all on function validate_business_details(jsonb) from public,anon,authenticated;

-- Built-in work profiles are configuration, never tenant users or demo records.
insert into business_role_catalog(id,name,department,description,responsibilities) values
('90000000-0000-0000-0000-000000000001','Graphic Designer','Design','Visual assets and brand design',E'Create brand assets\nPrepare production files\nReview visual consistency'),
('90000000-0000-0000-0000-000000000002','Accountant','Finance','Financial records and reporting',E'Maintain financial records\nReconcile transactions\nPrepare financial reports'),
('90000000-0000-0000-0000-000000000003','Business Admin','Operations','Business administration and team coordination',E'Maintain business settings\nCoordinate team operations\nReview access permissions'),
('90000000-0000-0000-0000-000000000004','Cold Caller','Sales','Outbound prospect outreach',E'Research assigned prospects\nLog call outcomes\nSchedule follow-ups'),
('90000000-0000-0000-0000-000000000005','Lead Generator','Marketing','Prospect research and lead qualification',E'Research target companies\nValidate contact details\nMaintain lead quality'),
('90000000-0000-0000-0000-000000000006','Sales Representative','Sales','Pipeline management and client conversion',E'Qualify opportunities\nMaintain the sales pipeline\nCoordinate client handover'),
('90000000-0000-0000-0000-000000000007','Web Developer','Development','Web development and technical delivery',E'Implement requirements\nVerify accessibility and responsiveness\nReview and maintain code'),
('90000000-0000-0000-0000-000000000008','Project Manager','Operations','Project planning and delivery coordination',E'Plan project milestones\nCoordinate approved team members\nReview delivery progress')
on conflict(id) do nothing;

-- Selected operational permissions never confer tenant finance or full-access authority.
do $$declare item text[];definition text;begin
 foreach item slice 1 in array array[['master_create_workspace','create_workspaces'],['master_workspace_stats','view_workspaces'],['master_open_workspace','view_workspaces'],['master_set_roles','edit_workspaces'],['master_set_status','suspend_workspaces'],['master_save_settings','edit_settings']] loop
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname=item[1];
  definition:=replace(definition,'if not is_master() then','if not platform_can('''||item[2]||''') then');
  execute definition;
 end loop;
end $$;
create or replace view master_member_list with(security_barrier=true) as select workspace_id,id,name,job_title,department,status,last_seen_at from profiles where not is_master and public.platform_can('view_workspaces');
drop policy if exists master_roles on workspace_roles;
create policy master_roles on workspace_roles for select to authenticated using(platform_can('view_workspaces'));
drop policy if exists master_activity on activity_logs;
create policy master_activity on activity_logs for select to authenticated using(platform_can('view_audit'));
drop policy if exists platform_settings_read on platform_settings;
create policy platform_settings_read on platform_settings for select to authenticated using(platform_can('edit_settings'));
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['platform_can','platform_log','master_profile_save','master_team_list','master_team_save','master_catalog_save']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname<>'platform_log' then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;

commit;
-- Done. Next: create your Master user (see README, step 2).

-- Universal profiles, separate archive permission, and validated lead contacts.
-- Additive migration; preserves existing accounts, permissions and records.
begin;
do $$begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='role_permissions' and column_name='archive') then
  alter table role_permissions add column archive boolean not null default false;
  update role_permissions set archive=delete;
 end if;
end $$;
create or replace function perm(target_module text,target_action text default 'view') returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select current_workspace() is not null and target_action in('view','edit','delete','archive') and (is_admin() or
 (is_manager() and target_module not in('settings','permissions','billing')) or
 exists(select 1 from role_permissions p join member_roles r using(workspace_id,role_key) where p.workspace_id=current_workspace() and r.user_id=auth.uid() and workspace_has_role(p.role_key) and p.module=target_module and case target_action when 'view' then p.view when 'edit' then p.edit when 'delete' then p.delete when 'archive' then p.archive else false end))
$$;
create or replace function save_profile(payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare dob date;image text;begin
 if not exists(select 1 from profiles where id=auth.uid() and status='active' and (is_master or workspace_id=current_workspace())) then raise exception 'Not permitted';end if;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 120 or length(coalesce(payload->>'first_name',''))>80 or length(coalesce(payload->>'last_name',''))>80 or length(coalesce(payload->>'phone',''))>40 then raise exception 'Enter valid profile details';end if;
 dob:=nullif(payload->>'date_of_birth','')::date;
 if dob>current_date or dob<date '1900-01-01' then raise exception 'Enter a valid date of birth';end if;
 if payload?'avatar_path' then
  image:=nullif(payload->>'avatar_path','');
  if image is not null and (image !~ ('^'||auth.uid()::text||'/[a-f0-9-]+[.]webp$') or not exists(select 1 from storage.objects where bucket_id='avatars' and name=image)) then raise exception 'Upload your profile image first';end if;
 end if;
 update profiles set name=trim(payload->>'name'),first_name=trim(payload->>'first_name'),last_name=trim(payload->>'last_name'),phone=trim(payload->>'phone'),date_of_birth=dob,avatar_path=case when payload?'avatar_path' then image else avatar_path end where id=auth.uid();
 if exists(select 1 from profiles where id=auth.uid() and is_master) then perform platform_log('profile_updated');else perform log_activity('profile_updated');end if;
end $$;
drop policy if exists avatar_owner on storage.objects;
create policy avatar_owner on storage.objects for all to authenticated using(bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text and exists(select 1 from profiles where id=auth.uid() and status='active' and (is_master or workspace_id=current_workspace()))) with check(bucket_id='avatars' and split_part(name,'/',1)=auth.uid()::text and name ~ ('^'||auth.uid()::text||'/[a-f0-9-]+[.]webp$') and exists(select 1 from profiles where id=auth.uid() and status='active' and (is_master or workspace_id=current_workspace())));
create or replace function permission_matrix(target uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not coalesce((target=current_workspace() and is_manager()) or platform_can('view_workspaces'),false) then raise exception 'Not permitted';end if;
 if not exists(select 1 from workspaces where id=target) then raise exception 'Workspace not found';end if;
 if platform_can('view_workspaces') then perform platform_log('workspace_permissions_viewed',jsonb_build_object('workspace_id',target));end if;
 return jsonb_build_object('roles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from workspace_roles r where workspace_id=target and active),'permissions',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from role_permissions p where workspace_id=target));
end $$;
create or replace function save_permissions(entries jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb;r text;m text;begin
 if not is_admin() then raise exception 'Not permitted';end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>100 then raise exception 'Invalid permissions';end if;
 perform 1 from workspaces where id=current_workspace() for update;
 for e in select * from jsonb_array_elements(entries) loop
  r:=e->>'role_key';m:=e->>'module';
  if r is null or r not in('sales_rep','lead_gen','cold_caller','finance','project_manager') or not workspace_has_role(r) then raise exception 'Role is not available';end if;
  if m is null or m not in('leads','clients','projects','finance') then raise exception 'Module is not configurable';end if;
  if not coalesce((e->>'view')::boolean,false) and (coalesce((e->>'edit')::boolean,false) or coalesce((e->>'delete')::boolean,false) or coalesce((e->>'archive')::boolean,false)) then raise exception 'View permission is required before edit, delete or archive';end if;
  insert into role_permissions(workspace_id,role_key,module,view,edit,delete,archive) values(current_workspace(),r,m,coalesce((e->>'view')::boolean,false),coalesce((e->>'edit')::boolean,false),coalesce((e->>'delete')::boolean,false),coalesce((e->>'archive')::boolean,false)) on conflict(workspace_id,role_key,module) do update set view=excluded.view,edit=excluded.edit,delete=excluded.delete,archive=excluded.archive;
 end loop;perform log_activity('permissions_updated');
end $$;
create or replace function lead_archive(target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not perm('leads','archive') then raise exception 'Not permitted';end if;
 update leads set archived_at=now() where id=target and workspace_id=current_workspace();if not found then raise exception 'Lead not found';end if;perform log_activity('lead_archived','lead',target);
end $$;
create or replace function finance_archive(kind text,target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare category text;begin
 if not perm('finance','archive') then raise exception 'Not permitted';end if;
 if kind='bill' then select b.category into category from recurring_expenses b where id=target and workspace_id=current_workspace();
 elsif kind='expense' then select e.category into category from expenses e where id=target and workspace_id=current_workspace();
 elsif kind='investment' then select 'other' into category from investments where id=target and workspace_id=current_workspace();end if;
 if category is null or not finance_allowed(category,'archive') then raise exception 'Record not found';end if;
 if kind='bill' then update recurring_expenses set active=false where id=target;elsif kind='expense' then update expenses set archived_at=now() where id=target;else update investments set archived_at=now() where id=target;end if;
 perform log_activity('finance_record_archived',kind,target);
end $$;
create or replace function client_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c clients;begin
 if not perm('clients','edit') then raise exception 'Not permitted';end if;
 if payload?'workspace_id' and (payload->>'workspace_id')::uuid is distinct from current_workspace() then raise exception 'Workspace mismatch';end if;
 if nullif(payload->>'id','') is not null then select * into c from clients where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;if c.id is null then raise exception 'Client not found';end if;
 else insert into clients(workspace_id,name,company,created_by) values(current_workspace(),payload->>'name',payload->>'company',auth.uid()) returning * into c;end if;
 if (payload->>'status'='archived' or c.status='archived') and payload->>'status' is distinct from c.status and not perm('clients','archive') then raise exception 'Archive permission required';end if;
 update clients set name=coalesce(payload->>'name',name),company=coalesce(payload->>'company',company),email=coalesce(payload->>'email',email),phone=coalesce(payload->>'phone',phone),website=coalesce(payload->>'website',website),country=coalesce(payload->>'country',country),address=coalesce(payload->>'address',address),services=coalesce(payload->>'services',services),status=coalesce(payload->>'status',status),onboarding_date=coalesce(nullif(payload->>'onboarding_date','')::date,onboarding_date),currency=coalesce(payload->>'currency',currency),monthly_retainer=coalesce((payload->>'monthly_retainer')::numeric,monthly_retainer),notes=coalesce(payload->>'notes',notes),updated_at=now() where id=c.id returning * into c;
 perform log_activity('client_saved','client',c.id);return to_jsonb(c);
end $$;
create or replace function project_save(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;new_pm uuid;new_client uuid;begin
 if nullif(payload->>'id','') is null then
  if not is_manager() then raise exception 'Only Admin or Manager can create projects';end if;
 else
  select * into p from projects where id=(payload->>'id')::uuid and workspace_id=current_workspace() for update;
  if p.id is null or not pm_perm(p.id,'edit') then raise exception 'Project not found or not permitted';end if;
 end if;
 new_pm:=case when payload?'pm_id' then nullif(payload->>'pm_id','')::uuid else p.pm_id end;
 new_client:=coalesce(nullif(payload->>'client_id','')::uuid,p.client_id);
 if p.id is not null and (new_pm is distinct from p.pm_id or new_client is distinct from p.client_id) and not is_manager() then raise exception 'Only a Manager can change the client or Project Manager';end if;
 if not exists(select 1 from clients where id=new_client and workspace_id=current_workspace()) then raise exception 'Client not found';end if;
 if p.id is not null and new_client<>p.client_id then raise exception 'Project client cannot change once created';end if;
 if new_pm is not null and not(is_manager_id(new_pm) or exists(select 1 from profiles u join member_roles r on r.user_id=u.id and r.workspace_id=u.workspace_id where u.id=new_pm and u.workspace_id=current_workspace() and u.status='active' and r.role_key='project_manager' and workspace_has_role('project_manager'))) then raise exception 'Choose an active Project Manager';end if;
 if nullif(payload->>'live_url','') is not null and payload->>'live_url' !~ '^https://' then raise exception 'Live URL must use https';end if;
 if p.id is null then insert into projects(workspace_id,client_id,name,pm_id,created_by) values(current_workspace(),new_client,payload->>'name',new_pm,auth.uid()) returning * into p;end if;
 if (payload->>'status'='archived' or p.status='archived') and payload->>'status' is distinct from p.status and not perm('projects','archive') then raise exception 'Archive permission required';end if;
 update projects set name=coalesce(payload->>'name',name),description=coalesce(payload->>'description',description),pm_id=new_pm,status=coalesce(payload->>'status',status),start_date=case when payload?'start_date' then nullif(payload->>'start_date','')::date else start_date end,due_date=case when payload?'due_date' then nullif(payload->>'due_date','')::date else due_date end,live_url=coalesce(payload->>'live_url',live_url),currency=coalesce(payload->>'currency',currency),budget=coalesce((payload->>'budget')::numeric,budget),updated_at=now() where id=p.id returning * into p;
 perform log_activity('project_saved','project',p.id);return to_jsonb(p);
end $$;

create or replace function validate_lead_contact() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='INSERT' or new.email is distinct from old.email then
  new.email:=trim(new.email);
  if coalesce(new.email,'')<>'' and (length(new.email)>254 or new.email !~ '^[^[:space:]@]+@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?[.])+[A-Za-z]{2,63}$') then raise exception 'Enter a valid email address, such as name@example.com';end if;
 end if;
 if TG_OP='INSERT' or new.phone is distinct from old.phone then
  new.phone:=trim(new.phone);
  if coalesce(new.phone,'')<>'' and new.phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Phone must include + and country code, followed by digits only (for example +923001234567)';end if;
 end if;
 if TG_OP='INSERT' and coalesce(trim(new.country),'')='' then new.country:='Pakistan';end if;
 return new;
end $$;
drop trigger if exists validate_contact on leads;
create trigger validate_contact before insert or update on leads for each row execute function validate_lead_contact();
revoke all on function validate_lead_contact() from public,anon,authenticated;
revoke all on function save_profile(jsonb),permission_matrix(uuid) from public,anon,authenticated;
grant execute on function save_profile(jsonb),permission_matrix(uuid) to authenticated;
commit;

-- Complete business/member profiles and server-verified Master actions.
begin;
alter table workspaces add column if not exists deleted_at timestamptz;
alter table profiles add column if not exists archived_at timestamptz;
alter table profiles add column if not exists deleted_at timestamptz;
alter table profiles add column if not exists employment_start date;
create or replace function require_business_identity(payload jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare k text;begin
 foreach k in array array['name','owner_name','industry','business_email','business_phone'] loop
  if length(trim(coalesce(payload->>k,''))) not between 1 and 254 then raise exception 'Required business detail: %',k;end if;
 end loop;
 if payload->>'business_email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][A-Za-z]{2,}$' then raise exception 'Enter a valid business email';end if;
 if payload->>'business_phone' !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Business phone must include + and country code, followed by digits';end if;
end $$;
create or replace function master_create_workspace(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare w workspaces;a auth.users;m auth.users;r text;c billing_cycle;start_on date;trial_end date;begin
 if not platform_can('create_workspaces') then raise exception 'Not permitted';end if;
 perform validate_business_details(payload);perform require_business_identity(payload);
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
 update profiles set phone=case when id=a.id then payload->>'admin_phone' else payload->>'manager_phone' end where id in(a.id,m.id);
 update workspaces set business_details=jsonb_strip_nulls(jsonb_build_object('owner_name',payload->>'owner_name','legal_name',payload->>'legal_name','industry',payload->>'industry','website',payload->>'website','business_email',payload->>'business_email','business_phone',payload->>'business_phone','address',payload->>'address','city',payload->>'city','region',payload->>'region','postal_code',payload->>'postal_code','tax_id',payload->>'tax_id','description',payload->>'description')) where id=w.id;
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
create or replace function master_save_workspace(workspace uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare details jsonb;begin
 if not platform_can('edit_workspaces') then raise exception 'Not permitted';end if;
 if payload?'timezone' and not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone';end if;
 perform validate_business_details(payload);
 details:=jsonb_build_object('owner_name',payload->>'owner_name','legal_name',payload->>'legal_name','industry',payload->>'industry','website',payload->>'website','business_email',payload->>'business_email','business_phone',payload->>'business_phone','address',payload->>'address','city',payload->>'city','region',payload->>'region','postal_code',payload->>'postal_code','tax_id',payload->>'tax_id','description',payload->>'description');
 if length(details::text)>12000 then raise exception 'Business details are too long';end if;
 if coalesce(payload->>'website','')<>'' and payload->>'website' !~ '^https?://' then raise exception 'Website must start with https:// or http://';end if;
 update workspaces set name=coalesce(nullif(trim(payload->>'name'),''),name),country=coalesce(payload->>'country',country),business_details=business_details||jsonb_strip_nulls(details) where id=workspace;
 if not found then raise exception 'Workspace not found';end if;
 update app_settings set company_name=coalesce(nullif(trim(payload->>'name'),''),company_name),timezone=coalesce(payload->>'timezone',timezone),app_currency=coalesce(payload->>'app_currency',app_currency),idle_minutes=coalesce((payload->>'idle_minutes')::integer,idle_minutes) where workspace_id=workspace;
 perform master_audit(workspace,'settings_changed');
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
 update profiles set first_name=coalesce(payload->>'first_name',first_name),last_name=coalesce(payload->>'last_name',last_name),employment_start=case when payload?'employment_start' then nullif(payload->>'employment_start','')::date else employment_start end where id=p.id returning * into p;
 perform log_activity('member_created','profile',p.id);return to_jsonb(p);
end $$;
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
 update profiles set first_name=coalesce(payload->>'first_name',first_name),last_name=coalesce(payload->>'last_name',last_name),employment_start=case when payload?'employment_start' then nullif(payload->>'employment_start','')::date else employment_start end where id=p.id returning * into p;
 perform log_activity('member_updated','profile',p.id);return to_jsonb(p);
end $$;

create or replace function master_profile_details(target uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;begin
 if not is_master() then raise exception 'Only the platform owner can view complete member profiles';end if;
 select * into p from profiles where id=target and not is_master;
 if p.id is null then raise exception 'Member not found';end if;
 perform master_audit(p.workspace_id,'member_profile_viewed',jsonb_build_object('member_id',target));
 return to_jsonb(p)||jsonb_build_object('roles',(select coalesce(jsonb_agg(role_key),'[]') from member_roles where user_id=p.id),'workspace',(select jsonb_build_object('id',id,'name',name,'country',country,'business_details',business_details) from workspaces where id=p.workspace_id));
end $$;
create or replace function master_workspace_list() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not platform_can('view_workspaces') then raise exception 'Not permitted';end if;
 return(select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('member_count',(select count(*) from profiles p where p.workspace_id=w.id and p.deleted_at is null),'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'phone',p.phone,'account_type',p.account_type,'job_title',p.job_title,'department',p.department,'status',p.status,'roles',(select coalesce(jsonb_agg(role_key),'[]') from member_roles where user_id=p.id))),'[]') from profiles p where p.workspace_id=w.id and (p.account_type='admin' or exists(select 1 from member_roles where user_id=p.id and role_key='manager'))),'settings',(select jsonb_build_object('timezone',s.timezone,'app_currency',s.app_currency) from app_settings s where workspace_id=w.id),'subscription',case when is_master() then (select to_jsonb(s) from subscriptions s where s.workspace_id=w.id) end) order by w.created_at desc),'[]') from workspaces w);
end $$;
-- This entry point is server-only. The API verifies the caller's current password
-- with Auth before passing the authenticated actor ID. No password enters SQL.
create or replace function master_secure_action(actor uuid,action text,target uuid,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p profiles;w workspaces;r text;begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if not exists(select 1 from profiles where id=actor and is_master and status='active') then raise exception 'Not permitted';end if;
 if action='workspace_edit' then
  if not platform_can('edit_workspaces') then raise exception 'Not permitted';end if;
  perform require_business_identity(payload);perform master_save_workspace(target,payload);
 elsif action='workspace_roles' then
  perform master_set_roles(target,array(select jsonb_array_elements_text(payload->'roles')));
 elsif action='workspace_access' then
  perform master_set_full_access(target,(payload->>'enabled')::boolean);
 elsif action in('workspace_inactive','workspace_archive','workspace_delete','workspace_restore') then
  perform master_set_status(target,case action when 'workspace_inactive' then 'suspended'::workspace_status when 'workspace_restore' then 'active'::workspace_status else 'archived'::workspace_status end,coalesce(nullif(trim(payload->>'reason'),''),'Master account action'));
  update workspaces set deleted_at=case when action='workspace_delete' then now() else null end where id=target;
  if action='workspace_delete' then perform master_audit(target,'workspace_deleted',jsonb_build_object('reason',payload->>'reason'));end if;
 elsif action='workspace_logo' then
  if not platform_can('edit_workspaces') then raise exception 'Not permitted';end if;
  if not exists(select 1 from storage.objects where bucket_id='brand' and name=payload->>'path' and name like 'w'||target::text||'/%') then raise exception 'Upload the workspace logo first';end if;
  update workspaces set logo_url=payload->>'path' where id=target;if not found then raise exception 'Workspace not found';end if;
  perform master_audit(target,'logo_updated');
 elsif action like 'member_%' then
  if not is_master() then raise exception 'Only the platform owner can change business profiles';end if;
  select * into p from profiles where id=target and not is_master for update;
  if p.id is null then raise exception 'Member not found';end if;
  if action='member_edit' then
   if length(trim(coalesce(payload->>'name',''))) not between 1 and 120 then raise exception 'Enter a valid name';end if;
   if nullif(payload->>'date_of_birth','')::date>current_date or nullif(payload->>'date_of_birth','')::date<date '1900-01-01' then raise exception 'Enter a valid date of birth';end if;
   if payload?'avatar_path' and not exists(select 1 from storage.objects where bucket_id='avatars' and name=payload->>'avatar_path' and split_part(name,'/',1)=p.id::text) then raise exception 'Upload the member picture first';end if;
   if payload?'roles' then
    for r in select jsonb_array_elements_text(payload->'roles') loop
     if r<>'manager' and not exists(select 1 from workspace_roles where workspace_id=p.workspace_id and role_key=r and active) then raise exception 'Role not available';end if;
    end loop;
    delete from member_roles where user_id=p.id;
    insert into member_roles(workspace_id,user_id,role_key) select p.workspace_id,p.id,jsonb_array_elements_text(payload->'roles');
   end if;
   update profiles set avatar_path=coalesce(payload->>'avatar_path',avatar_path),date_of_birth=case when payload?'date_of_birth' then nullif(payload->>'date_of_birth','')::date else date_of_birth end,name=trim(payload->>'name'),first_name=coalesce(payload->>'first_name',first_name),last_name=coalesce(payload->>'last_name',last_name),phone=coalesce(payload->>'phone',phone),job_title=coalesce(payload->>'job_title',job_title),department=coalesce(payload->>'department',department),employment_start=case when payload?'employment_start' then nullif(payload->>'employment_start','')::date else employment_start end where id=p.id;
  elsif action in('member_inactive','member_archive','member_delete','member_restore') then
   update profiles set status=case when action='member_restore' then 'active' else 'inactive' end,archived_at=case when action in('member_archive','member_delete') then now() end,deleted_at=case when action='member_delete' then now() end where id=p.id;
  else raise exception 'Unknown member action';end if;
  perform master_audit(p.workspace_id,action,jsonb_build_object('member_id',p.id));
 else raise exception 'Unknown action';end if;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function require_business_identity(jsonb),master_secure_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function master_secure_action(uuid,text,uuid,jsonb) to service_role;
revoke all on function master_profile_details(uuid) from public,anon,authenticated;
grant execute on function master_profile_details(uuid) to authenticated;
-- Prevent direct RPC calls from bypassing password confirmation.
revoke all on function master_save_workspace(uuid,jsonb),master_set_status(uuid,workspace_status,text),master_set_roles(uuid,text[]),master_set_full_access(uuid,boolean) from public,anon,authenticated;
commit;
