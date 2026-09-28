-- One SELECT, catalog/aggregate reads only. Run as postgres (RLS bypass), BEFORE migration.
-- Requires existing application tables, organizations and storage.buckets. No application rows are output.
-- Unrecognized policies/triggers require review; all_match is not a proof of arbitrary helper semantics.
-- Confirmed production baseline: postgres directly granted all seven table privileges to the three API roles.
-- Before migration rls_acl=false is expected; review that section explicitly with the ACL diagnostic.
-- Use production-postcheck.readonly.sql AFTER migration; preflight collision checks must then fail.
-- No nextval(), helper execution, credentials, or mutations. Inventory is tested against the migration.
with targets(name) as (values ('repair_requests'),('repair_photos'),('owners'),('property_owners'),('properties')),
relations as (
 select t.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relowner from targets t
 left join pg_class c on c.oid=to_regclass('public.'||t.name)
), columns as (
 select c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) type_name,
 a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid) default_value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
 left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
 where n.nspname='public' and c.relname in ('repair_requests','repair_photos','owners','property_owners','properties','units','owner_reports','owner_report_recipients')
 and a.attnum>0 and not a.attisdropped
), required_columns(table_name,column_name,type_name,not_null) as (values
 ('repair_requests','id','bigint',true),('repair_requests','organization_id','uuid',true),('repair_requests','created_at','timestamp with time zone',true),
 ('repair_requests','property_id','uuid',false),('repair_requests','property_name','text',false),('repair_requests','room_number','text',false),
 ('repair_requests','tenant_name','text',false),('repair_requests','tenant_account_id','uuid',false),('repair_requests','category','text',false),
 ('repair_requests','description','text',false),('repair_requests','status','text',false),('repair_requests','photo_url','text',false),('repair_requests','storage_path','text',false),
 ('repair_photos','id','bigint',true),('repair_photos','created_at','timestamp with time zone',true),('repair_photos','organization_id','uuid',true),
 ('repair_photos','repair_id','bigint',false),('repair_photos','photo_url','text',false),('repair_photos','storage_path','text',false),('repair_photos','sort_order','integer',false),
 ('owners','id','uuid',true),('owners','organization_id','uuid',true),('owners','auth_user_id','uuid',false),('owners','is_active','boolean',true),('owners','name','text',true),
 ('properties','id','uuid',true),('properties','organization_id','uuid',true),('properties','name','text',true),('properties','is_active','boolean',true),
 ('property_owners','id','uuid',true),('property_owners','organization_id','uuid',true),('property_owners','owner_id','uuid',true),
 ('property_owners','property_id','uuid',true),('property_owners','is_active','boolean',true),('property_owners','valid_from','date',false),('property_owners','valid_to','date',false)
), column_checks as (
 select e.*,c.type_name actual_type,c.not_null actual_not_null,
 coalesce(c.type_name=e.type_name and c.not_null=e.not_null,false) matches
 from required_columns e left join columns c using(table_name,column_name)
), unfilled_required as (
 select * from columns c where c.table_name in ('repair_requests','repair_photos') and c.not_null
 and c.default_value is null and c.identity='' and c.generated=''
 and not (c.table_name='repair_requests' and c.column_name in ('organization_id','property_id','property_name','category','description','status'))
 and not (c.table_name='repair_photos' and c.column_name in ('organization_id','repair_id','storage_path','sort_order'))
), constraints as (
 select (select relname from pg_class where oid=c.conrelid) table_name,c.conname,c.contype,c.convalidated,c.condeferrable,c.confmatchtype,
 pg_get_constraintdef(c.oid) definition,c.conrelid,c.confrelid,
 array(select a.attname::text from unnest(c.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by k.o) names,
 array(select a.attname::text from unnest(c.confkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n order by k.o) referenced_names
 from pg_constraint c where c.conrelid in (select oid from relations) or c.conrelid=to_regclass('public.units')
), required_fks(table_name,names,target,referenced_names) as (values
 ('repair_requests',array['property_id'],'properties',array['id']),('repair_requests',array['organization_id'],'organizations',array['id']),
 ('repair_photos',array['organization_id'],'organizations',array['id']),('owners',array['organization_id'],'organizations',array['id']),
 ('properties',array['organization_id'],'organizations',array['id']),('property_owners',array['organization_id'],'organizations',array['id']),
 ('property_owners',array['owner_id'],'owners',array['id']),('property_owners',array['property_id'],'properties',array['id'])
), fk_checks as (
 select e.*,exists(select 1 from constraints c where c.conrelid=to_regclass('public.'||e.table_name)
 and c.contype='f' and c.convalidated and c.confrelid=to_regclass('public.'||e.target)
 and ((c.names=e.names and c.referenced_names=e.referenced_names)
 or (c.names=array['organization_id']||e.names and c.referenced_names=array['organization_id']||e.referenced_names))) matches
 from required_fks e
), key_checks as (
 select t.name,exists(select 1 from pg_index i where i.indrelid=to_regclass('public.'||t.name)
 and i.indisunique and i.indisvalid and i.indisready and i.indimmediate and i.indpred is null and i.indexprs is null
 and array(select a.attname::text from unnest(i.indkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.n where k.o<=i.indnkeyatts order by k.o)=array['id']) matches
 from (select name from targets union all select 'organizations') t
), planned(kind,table_name,name,signature) as (values
 ('column','repair_requests','source_type',null),('column','repair_requests','source_channel',null),
 ('column','repair_requests','source_owner_id',null),('column','repair_requests','source_label',null),
 ('column','repair_requests','location_type',null),('column','repair_requests','contact_notes',null),
 ('column','repair_photos','source_type',null),('column','repair_photos','source_channel',null),
 ('constraint','owners','owner_repair_owner_org_key',null),('constraint','properties','owner_repair_property_org_key',null),
 ('index','owners','owner_repair_owner_org_key',null),('index','properties','owner_repair_property_org_key',null),
 ('constraint','repair_requests','owner_repair_source_owner_fk',null),('constraint','repair_requests','owner_repair_property_fk',null),
 ('constraint','repair_requests','owner_repair_source_text_check',null),('constraint','repair_requests','owner_repair_owner_fields_check',null),
 ('constraint','repair_photos','owner_repair_photo_source_check',null),('trigger','repair_requests','guard_repair_provenance',null),
 ('function',null,'guard_repair_provenance','public.guard_repair_provenance()'),
 ('function',null,'create_owner_repair','public.create_owner_repair(uuid,text,text,text,text,text)')
 -- No CREATE POLICY or explicit CREATE INDEX; two UNIQUE constraints create backing indexes.
), collisions as (
 select p.*,case kind
 when 'column' then exists(select 1 from columns c where c.table_name=p.table_name and c.column_name=p.name)
 when 'constraint' then exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.'||p.table_name) and c.conname=p.name)
 when 'index' then to_regclass('public.'||p.name) is not null
 when 'trigger' then exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||p.table_name) and t.tgname=p.name)
 when 'policy' then exists(select 1 from pg_policy x where x.polrelid=to_regclass('public.'||p.table_name) and x.polname=p.name)
 when 'function' then exists(select 1 from pg_proc f where f.pronamespace='public'::regnamespace and f.proname=p.name)
 else true end collision,
 case when kind='function' then to_regprocedure(signature) is not null else null end signature_collision from planned p
), rpc_overloads as (
 select p.oid::regprocedure::text signature,pg_get_function_identity_arguments(p.oid) arguments,
 pg_get_function_result(p.oid) returns,p.prokind,p.prosecdef,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,
 coalesce(p.oid=to_regprocedure('public.create_owner_repair(uuid,text,text,text,text,text)'),false) planned_signature_collision
 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='create_owner_repair'
),
-- JSON projection keeps missing/changed columns reportable without dynamic SQL.
rr as (select to_jsonb(r) j from public.repair_requests r), rp as (select to_jsonb(p) j from public.repair_photos p),
ow as (select to_jsonb(o) j from public.owners o), po as (select to_jsonb(p) j from public.property_owners p),
pr as (select to_jsonb(p) j from public.properties p), org as (select to_jsonb(o) j from public.organizations o),
repair_counts as (
 select count(*) total,count(*) filter(where j->>'tenant_account_id' is null) tenant_account_id_null,
 count(*) filter(where j->>'room_number' is null) room_number_null,count(*) filter(where j->>'tenant_name' is null) tenant_name_null,
 count(*) filter(where j->>'property_id' is null) property_id_null,
 count(*) filter(where not exists(select 1 from org where org.j->>'id'=rr.j->>'organization_id')) invalid_organization,
 count(*) filter(where j->>'property_id' is not null and not exists(select 1 from pr where pr.j->>'id'=rr.j->>'property_id' and pr.j->>'organization_id'=rr.j->>'organization_id')) invalid_property_scope,
 count(*) filter(where (j->>'source_type' is not null and j->>'source_type'<>'tenant') or (j->>'source_channel' is not null and j->>'source_channel'<>'legacy')
 or j->>'source_owner_id' is not null or (j->>'location_type' is not null and j->>'location_type'<>'room')) conflicting_provenance from rr
), photo_counts as (
 select count(*) total,count(*) filter(where j->>'repair_id' is null) repair_id_null,
 count(*) filter(where j->>'repair_id' is not null and not exists(select 1 from rr where rr.j->>'id'=rp.j->>'repair_id')) orphan_repair,
 count(*) filter(where exists(select 1 from rr where rr.j->>'id'=rp.j->>'repair_id') and not exists(select 1 from rr where rr.j->>'id'=rp.j->>'repair_id' and rr.j->>'organization_id'=rp.j->>'organization_id')) cross_org_repair,
 count(*) filter(where not exists(select 1 from org where org.j->>'id'=rp.j->>'organization_id')) invalid_organization,
 count(*) filter(where (j->>'source_type' is not null and j->>'source_type'<>'tenant') or (j->>'source_channel' is not null and j->>'source_channel'<>'web')) conflicting_provenance from rp
), ownership_counts as (
 select
 (select count(*) from ow where not exists(select 1 from org where org.j->>'id'=ow.j->>'organization_id')) invalid_owner_org,
 (select count(*) from pr where not exists(select 1 from org where org.j->>'id'=pr.j->>'organization_id')) invalid_property_org,
 (select count(*) from po where not exists(select 1 from ow where ow.j->>'id'=po.j->>'owner_id' and ow.j->>'organization_id'=po.j->>'organization_id')
 or not exists(select 1 from pr where pr.j->>'id'=po.j->>'property_id' and pr.j->>'organization_id'=po.j->>'organization_id')) invalid_owner_property_scope,
 (select count(*) from ow where j->>'auth_user_id' is null) unlinked_auth,
 (select count(*) from (select j->>'auth_user_id' from ow where j->>'is_active'='true' and j->>'auth_user_id' is not null group by j->>'auth_user_id' having count(*)>1) x) ambiguous_active_auth,
 (select count(*) from ow where j->>'is_active'='true' and nullif(btrim(j->>'name'),'') is null) empty_active_owner_name,
 (select count(*) from po where j->>'valid_from' is not null and j->>'valid_to' is not null and j->>'valid_from'>j->>'valid_to') inverted_validity,
 (select count(*) from po a join po b on a.j->>'id'<b.j->>'id' and a.j->>'owner_id'=b.j->>'owner_id' and a.j->>'property_id'=b.j->>'property_id'
 and a.j->>'organization_id'=b.j->>'organization_id' where a.j->>'is_active'='true' and b.j->>'is_active'='true'
 and coalesce(a.j->>'valid_from','0001-01-01')<=coalesce(b.j->>'valid_to','9999-12-31')
 and coalesce(b.j->>'valid_from','0001-01-01')<=coalesce(a.j->>'valid_to','9999-12-31')) overlapping_active_pairs,
 (select count(*) from po where j->>'is_active'='true' and (j->>'valid_from' is null or j->>'valid_from'<=(now() at time zone 'UTC')::date::text)
 and (j->>'valid_to' is null or j->>'valid_to'>=(now() at time zone 'UTC')::date::text)) effective_links
), roles as (
 select e.name,r.oid,r.rolsuper,r.rolbypassrls from (values('anon'),('authenticated'),('service_role')) e(name) left join pg_roles r on r.rolname=e.name
), acl as (
 select t.name table_name,r.name role,r.oid is not null role_exists,r.rolsuper,r.rolbypassrls,
 coalesce(pg_has_role(r.oid,t.relowner,'MEMBER'),false) can_assume_table_owner,
 coalesce(pg_has_role(r.oid,(select oid from roles where name='service_role'),'MEMBER'),false) can_assume_service_role,
 coalesce(has_schema_privilege(r.oid,'public'::regnamespace,'USAGE'),false) schema_usage,
 coalesce(has_table_privilege(r.oid,t.oid,'SELECT'),false) can_select,coalesce(has_table_privilege(r.oid,t.oid,'INSERT'),false) can_insert,
 coalesce(has_table_privilege(r.oid,t.oid,'UPDATE'),false) can_update,coalesce(has_table_privilege(r.oid,t.oid,'DELETE'),false) can_delete,
 coalesce(has_table_privilege(r.oid,t.oid,'TRUNCATE'),false) can_truncate,coalesce(has_table_privilege(r.oid,t.oid,'REFERENCES'),false) can_reference,
 coalesce(has_table_privilege(r.oid,t.oid,'TRIGGER'),false) can_trigger from relations t cross join roles r
), browser_acl_checks as (
 select t.name table_name,r.name role,p.privilege,
 r.name='authenticated' and ((t.name in ('repair_requests','repair_photos') and p.privilege='SELECT')
 or (t.name='repair_requests' and p.privilege='UPDATE')) required,
 coalesce(has_table_privilege(r.oid,t.oid,p.privilege),false) table_granted,
 coalesce(has_table_privilege(r.oid,t.oid,p.privilege||' WITH GRANT OPTION'),false) grant_option,
 case when p.privilege in ('SELECT','INSERT','UPDATE','REFERENCES') then
 exists(select 1 from pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 and has_column_privilege(r.oid,t.oid,a.attnum,p.privilege)) else false end any_column_granted,
 case when p.privilege in ('SELECT','INSERT','UPDATE','REFERENCES') then
 exists(select 1 from pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 and has_column_privilege(r.oid,t.oid,a.attnum,p.privilege||' WITH GRANT OPTION')) else false end column_grant_option
 from relations t cross join roles r
 cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
 where r.name in ('anon','authenticated')
), browser_acl_failures as (
 select * from browser_acl_checks where table_granted<>required or (not required and any_column_granted)
 or grant_option or column_grant_option
), policy_details as (
 select p.*,regexp_replace(coalesce(qual,''),'\s','','g') normalized_using,regexp_replace(coalesce(with_check,''),'\s','','g') normalized_check
 from pg_policies p where p.schemaname='public' and (p.tablename in (select name from targets) or p.tablename='units')
), policy_checks as (
 select p.*,case
 -- Conservative known shape only. Other safe policies also require review instead of a false GO.
 when p.roles=array['authenticated']::name[] and p.permissive='PERMISSIVE' then case p.cmd
 when 'SELECT' then p.normalized_using=$read$private.has_org_role(organization_id,ARRAY['admin'::text,'manager'::text,'staff'::text,'viewer'::text])$read$ and p.with_check is null
 when 'INSERT' then p.qual is null and p.normalized_check=$write$private.has_org_role(organization_id,ARRAY['admin'::text,'manager'::text,'staff'::text])$write$
 when 'UPDATE' then p.normalized_using=$write$private.has_org_role(organization_id,ARRAY['admin'::text,'manager'::text,'staff'::text])$write$
 and p.normalized_check=$write$private.has_org_role(organization_id,ARRAY['admin'::text,'manager'::text,'staff'::text])$write$
 else false end
 when p.roles=array['service_role']::name[] then true
 else false end matches from policy_details p where tablename in (select name from targets)
), triggers as (
 select r.name table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,t.tgfoid::regprocedure::text function_name
 from relations r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
), helper_specs(signature,required) as (
 values ('auth.uid()',true),('gen_random_uuid()',exists(select 1 from columns where default_value like '%gen_random_uuid%')),
 ('private.has_org_role(uuid,text[])',exists(select 1 from policy_details where coalesce(qual,'')||coalesce(with_check,'') like '%has_org_role%'))
), helpers as (
 select h.*,p.oid is not null exists,p.oid::regprocedure::text resolved_signature,pg_get_function_result(p.oid) returns,
 p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl,pg_get_userbyid(p.proowner) owner,
 (select jsonb_agg(jsonb_build_object('role',r.name,'execute',coalesce(has_function_privilege(r.oid,p.oid,'EXECUTE'),false),
 'schema_usage',coalesce(has_schema_privilege(r.oid,p.pronamespace,'USAGE'),false)) order by r.name) from roles r) role_acl,
 not h.required or (p.oid is not null and p.pronargs=case when h.signature like 'private.%' then 2 else 0 end
 and p.prorettype=case when h.signature like 'private.%' then 'boolean'::regtype else 'uuid'::regtype end
 and coalesce(has_function_privilege((select oid from roles where name='authenticated'),p.oid,'EXECUTE'),false)
 and coalesce(has_schema_privilege((select oid from roles where name='authenticated'),p.pronamespace,'USAGE'),false)) matches
 from helper_specs h left join pg_proc p on p.oid=to_regprocedure(h.signature)
), generators as (
 select r.name,c.identity,c.default_value,pg_get_serial_sequence('public.'||r.name,'id') sequence_name,s.seqincrement,s.seqmin,s.seqmax,s.seqcycle,
 (select jsonb_agg(jsonb_build_object('role',roles.name,'usage',coalesce(has_sequence_privilege(roles.oid,s.seqrelid,'USAGE'),false))) from roles) role_acl,
 (c.identity in ('a','d') or coalesce(c.default_value like 'nextval(%',false)) and s.seqrelid is not null
 and s.seqincrement>0 and not s.seqcycle and has_sequence_privilege(current_user,s.seqrelid,'USAGE')
 and coalesce(has_sequence_privilege((select oid from roles where name='service_role'),s.seqrelid,'USAGE'),false) matches
 from relations r left join columns c on c.table_name=r.name and c.column_name='id'
 left join pg_sequence s on s.seqrelid=to_regclass(pg_get_serial_sequence('public.'||r.name,'id')) where r.name in ('repair_requests','repair_photos')
), bucket as (
 select id,public,file_size_limit,allowed_mime_types,
 public is false and (file_size_limit is null or file_size_limit>=5242880)
 and (allowed_mime_types is null or (('image/jpeg'=any(allowed_mime_types) or 'image/*'=any(allowed_mime_types))
 and ('image/png'=any(allowed_mime_types) or 'image/*'=any(allowed_mime_types)))) matches from storage.buckets where id='repair-images'
), sections(seq,section,all_match,details) as (
 select 1,'schema',(select bool_and(matches) from column_checks) and not exists(select 1 from unfilled_required),
 jsonb_build_object('checks',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from column_checks c),
 'all_columns',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from columns c),
 'unfilled_required_columns',coalesce((select jsonb_agg(to_jsonb(c)) from unfilled_required c),'[]'::jsonb))
 union all select 2,'keys_and_constraints',(select bool_and(matches) from key_checks) and (select bool_and(matches) from fk_checks)
 and not exists(select 1 from constraints where table_name in ('repair_requests','repair_photos') and (contype='c' or confmatchtype='f')),
 jsonb_build_object('keys',(select jsonb_agg(to_jsonb(k)) from key_checks k),'foreign_keys',(select jsonb_agg(to_jsonb(k)) from fk_checks k),
 'all_constraints',coalesce((select jsonb_agg(to_jsonb(c)-'conrelid'-'confrelid' order by table_name,conname) from constraints c),'[]'::jsonb),
 'review_rule','Existing repair/photo CHECK constraints or MATCH FULL FKs need review for owner NULL tenant/room fields and private photo paths.')
 union all select 3,'planned_objects',not exists(select 1 from collisions where collision),
 jsonb_build_object('inventory',(select jsonb_agg(to_jsonb(c) order by kind,table_name,name) from collisions c),'planned_policy_count',0,'explicit_index_count',0,'implicit_unique_index_count',2)
 union all select 4,'create_owner_repair_overloads',not exists(select 1 from rpc_overloads),
 jsonb_build_object('planned_signature','public.create_owner_repair(uuid,text,text,text,text,text)',
 'signature_collision',to_regprocedure('public.create_owner_repair(uuid,text,text,text,text,text)') is not null,
 'overloads',coalesce((select jsonb_agg(to_jsonb(r) order by signature) from rpc_overloads r),'[]'::jsonb),'any_overload_requires_review',true)
 union all select 5,'repair_requests_data',invalid_organization=0 and invalid_property_scope=0 and conflicting_provenance=0,
 to_jsonb(r)||jsonb_build_object('backfill',jsonb_build_object('source_type','tenant','source_channel','legacy','location_type','room'),
 'backfill_matches_legacy_intake_contract',conflicting_provenance=0,'anonymous_is_not_evidence_of_owner',true,
 'null_room_preserved',true,'null_room_migration_safe',true,
 'reason','New owner-only CHECK permits legacy tenant NULL rooms. No common-area inference. Historical tenant origin is the existing intake contract, not inferred from names/account NULLs.') from repair_counts r
 union all select 6,'repair_photos_data',repair_id_null=0 and orphan_repair=0 and cross_org_repair=0 and invalid_organization=0 and conflicting_provenance=0,
 to_jsonb(p)||jsonb_build_object('backfill',jsonb_build_object('source_type','tenant','source_channel','web'),
 'backfill_safe',repair_id_null=0 and orphan_repair=0 and cross_org_repair=0 and invalid_organization=0 and conflicting_provenance=0,
 'reason','Preserve existing image rows/paths. Legacy repair_photos are tenant form uploads; conflicting provenance or unlinked photos require review.') from photo_counts p
 union all select 7,'owner_property_scope',invalid_owner_org=0 and invalid_property_org=0 and invalid_owner_property_scope=0 and ambiguous_active_auth=0 and empty_active_owner_name=0 and inverted_validity=0 and overlapping_active_pairs=0,
 to_jsonb(o)||jsonb_build_object('validity_timezone','UTC','inclusive_endpoints',true,'null_validity_is_unbounded',true,'null_auth_is_allowed_but_cannot_submit',true) from ownership_counts o
 union all select 8,'rls_acl',
 (select bool_and(oid is not null and relkind='r' and relrowsecurity) from relations)
 and (select bool_and(role_exists and schema_usage and case when role='service_role' then rolbypassrls and can_select and can_insert and can_update
 else not rolsuper and not rolbypassrls and not can_assume_table_owner and not can_assume_service_role
 and not can_truncate and not can_trigger and not can_reference end) from acl)
 and (select bool_and(can_select and can_update) from acl where role='authenticated' and table_name='repair_requests')
 and (select bool_and(can_select) from acl where role='authenticated' and table_name='repair_photos')
 and not exists(select 1 from browser_acl_failures)
 and not exists(select 1 from policy_checks where not coalesce(matches,false))
 and not exists(select 1 from triggers where table_name in ('repair_requests','repair_photos') and tgenabled<>'D')
 and exists(select 1 from policy_checks where tablename='repair_requests' and cmd='SELECT' and matches)
 and exists(select 1 from policy_checks where tablename='repair_requests' and cmd='UPDATE' and matches)
 and exists(select 1 from policy_checks where tablename='repair_photos' and cmd='SELECT' and matches)
 and (select rolsuper or rolbypassrls from pg_roles where rolname=current_user),
 jsonb_build_object('tables',(select jsonb_agg(to_jsonb(r)) from relations r),
 'effective_role_acl',(select jsonb_agg(to_jsonb(a) order by table_name,role) from acl a),
 'browser_privilege_contract',(select jsonb_agg(to_jsonb(a) order by table_name,role,privilege) from browser_acl_checks a),
 'unexpected_or_missing_privileges',coalesce((select jsonb_agg(to_jsonb(a) order by table_name,role,privilege) from browser_acl_failures a),'[]'::jsonb),
 'acl_remediation','Do not override all_match. Review ACL diagnostic, then separately approve the guarded migration. Unchanged broad production ACLs must remain false.',
 'table_grants',coalesce((select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema='public' and table_name in (select name from targets)),'[]'::jsonb),
 'column_grants',coalesce((select jsonb_agg(to_jsonb(g)) from information_schema.column_privileges g where table_schema='public' and table_name in (select name from targets)),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by tablename,policyname) from policy_checks p),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(to_jsonb(t)) from triggers t),'[]'::jsonb),
 'review_rule','Only exact staff organization-helper policy shapes auto-match. Other policies and enabled repair/photo triggers require review. Helper semantics are not proved by its signature. Counts require superuser/BYPASSRLS.')
 union all select 9,'helpers_and_generators',(select bool_and(coalesce(matches,false)) from helpers) and (select bool_and(coalesce(matches,false)) from generators),
 jsonb_build_object('helpers',(select jsonb_agg(to_jsonb(h)) from helpers h),'id_generators',(select jsonb_agg(to_jsonb(g)) from generators g),
 'sequence_values_not_advanced',true,'role_helper_used_by_rpc',false,'role_helper_may_be_used_by_existing_policies',true)
 union all select 10,'storage',(select count(*)=1 and coalesce(bool_and(matches),false) from bucket),
 jsonb_build_object('exists',exists(select 1 from bucket),'buckets',coalesce((select jsonb_agg(to_jsonb(b)) from bucket b),'[]'::jsonb),'required_photo_bytes',5242880)
 union all select 11,'units',to_regclass('public.units') is null,
 jsonb_build_object('exists',to_regclass('public.units') is not null,'rpc_uses_units',false,'migration_uses_units_data',false,
 'migration_aborts_if_units_exists',true,'safe_to_ignore_existing_units',to_regclass('public.units') is null,
 'relation',(select jsonb_build_object('relkind',relkind,'rls_enabled',relrowsecurity,'rls_forced',relforcerowsecurity) from pg_class where oid=to_regclass('public.units')),
 'policies',coalesce((select jsonb_agg(to_jsonb(p)) from policy_details p where tablename='units'),'[]'::jsonb),
 'reason','Migration explicitly aborts when public.units exists. No RPC dependency does not authorize bypassing an existing unit ownership model.')
), report as (
 select seq,section,jsonb_build_object('all_match',coalesce(all_match,false),'details',details) result from sections
 union all select 12,'overall',jsonb_build_object('overall_ready',bool_and(coalesce(all_match,false)),
 'failed_sections',coalesce(jsonb_agg(section order by seq) filter(where not coalesce(all_match,false)),'[]'::jsonb)) from sections
)
select section,result from report order by seq;
