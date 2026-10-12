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
