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
