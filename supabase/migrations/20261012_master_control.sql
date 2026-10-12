-- Master control center. Idempotent, additive migration; no tenant records are seeded.
begin;
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
