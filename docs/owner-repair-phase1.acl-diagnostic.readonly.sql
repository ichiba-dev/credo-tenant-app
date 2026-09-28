-- One SELECT; catalog reads only. Run as postgres. No production changes or application data.
-- Current ACL/default ACL cannot prove the historical migration that issued a GRANT.
-- PUBLIC/inherited excess requires separate review; proposed migration only revokes direct grants.
with targets(name) as (values('repair_requests'),('repair_photos'),('owners'),('properties'),('property_owners')),
relations as (
 select t.name,c.oid,c.relowner,c.relrowsecurity from targets t
 left join pg_class c on c.oid=to_regclass('public.'||t.name)
), roles as (
 select r.oid,r.rolname,r.rolsuper,r.rolbypassrls from pg_roles r
 where r.rolname in ('anon','authenticated','service_role')
), grants as (
 select c.oid table_oid,c.relname table_name,null::text column_name,x.*
 from pg_class c join relations t on t.oid=c.oid cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 union all
 select t.oid,t.name,a.attname,x.* from relations t join pg_attribute a on a.attrelid=t.oid
 cross join lateral aclexplode(a.attacl) x where a.attnum>0 and not a.attisdropped
), effective as (
 select t.name table_name,r.rolname role,p.privilege,
 case when r.rolname='service_role' then null else r.rolname='authenticated'
 and ((t.name in ('repair_requests','repair_photos') and p.privilege='SELECT') or (t.name='repair_requests' and p.privilege='UPDATE')) end required,
 has_table_privilege(r.oid,t.oid,p.privilege) table_granted,
 has_table_privilege(r.oid,t.oid,p.privilege||' WITH GRANT OPTION') grant_option,
 case when p.privilege in ('SELECT','INSERT','UPDATE','REFERENCES') then exists(
 select 1 from pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 and has_column_privilege(r.oid,t.oid,a.attnum,p.privilege)) else false end any_column_granted
 from relations t cross join roles r
 cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
), origins as (
 select g.table_name,g.column_name,r.rolname inspected_role,
 case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end grantee,
 pg_get_userbyid(g.grantor) grantor,g.privilege_type,g.is_grantable,
 case when g.grantee=0 then 'PUBLIC' when g.grantee=r.oid then 'DIRECT' else 'ROLE_MEMBERSHIP_REVIEW' end origin,
 case when g.grantee=0 then true else pg_has_role(r.oid,g.grantee,'USAGE') end available_without_set_role
 from grants g cross join roles r
 where g.grantee=0 or g.grantee=r.oid or case when g.grantee<>0 then pg_has_role(r.oid,g.grantee,'MEMBER') else false end
), defaults as (
 select pg_get_userbyid(d.defaclrole) creator,coalesce(n.nspname,'ALL_SCHEMAS') schema_name,
 d.defaclobjtype object_type,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee,
 pg_get_userbyid(x.grantor) grantor,x.privilege_type,x.is_grantable
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 cross join lateral aclexplode(d.defaclacl) x
 where d.defaclnamespace=0 or n.nspname='public'
)
select t.name table_name,
 jsonb_build_object('exists',t.oid is not null,'rls_enabled',t.relrowsecurity,'owner',pg_get_userbyid(t.relowner),
 'effective_acl',coalesce((select jsonb_agg(to_jsonb(e) order by role,privilege) from effective e where e.table_name=t.name),'[]'::jsonb),
 'grant_origins',coalesce((select jsonb_agg(to_jsonb(o) order by inspected_role,origin,column_name,privilege_type) from origins o where o.table_name=t.name),'[]'::jsonb),
 'role_safety',(select jsonb_agg(jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,
 'can_assume_owner',pg_has_role(r.oid,t.relowner,'MEMBER'),
 'can_assume_service_role',pg_has_role(r.oid,(select oid from roles where rolname='service_role'),'MEMBER'))) from roles r),
 'policies',coalesce((select jsonb_agg(to_jsonb(p)) from pg_policies p where p.schemaname='public' and p.tablename=t.name),'[]'::jsonb),
 'current_default_acl',coalesce((select jsonb_agg(to_jsonb(d)) from defaults d),'[]'::jsonb),
 'catalog_dependents',coalesce((select jsonb_agg(distinct pg_describe_object(d.classid,d.objid,d.objsubid)) from pg_depend d
 where d.refclassid='pg_class'::regclass and d.refobjid=t.oid),'[]'::jsonb),
 'review_note','Defaults are not historical proof. Inspect PUBLIC/membership/column grant sources and external consumers. Catalog dependencies do not include every dynamic SQL/function consumer. No automatic migration GO.') details
from relations t order by t.name;
