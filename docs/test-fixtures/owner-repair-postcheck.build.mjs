// Offline SQL artifact builder. No database, environment variables or network.
// Run with --write only when intentionally updating the reviewed SQL artifact.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const pre=readFileSync(new URL('../owner-repair-phase1.production-preflight.readonly.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=readFileSync(new URL('../owner-repair-phase1.migration.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const funcs=[...migration.matchAll(/create function public\.(\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];
assert.equal(funcs.length,2);
const functionRows=funcs.map(([,name,body])=>`(${quote(name)},${quote(createHash('md5').update(body.trim()).digest('hex'))})`).join(',\n');
const sourceCheck="CHECK ((((length(source_type) >= 1) AND (length(source_type) <= 64)) AND ((length(source_channel) >= 1) AND (length(source_channel) <= 64))))";
const constraints=[
 ['owners','owner_repair_owner_org_key','UNIQUE (organization_id, id)'],
 ['properties','owner_repair_property_org_key','UNIQUE (organization_id, id)'],
 ['repair_requests','owner_repair_source_owner_fk','FOREIGN KEY (organization_id, source_owner_id) REFERENCES owners(organization_id, id)'],
 ['repair_requests','owner_repair_property_fk','FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)'],
 ['repair_requests','owner_repair_source_text_check',sourceCheck],
 ['repair_photos','owner_repair_photo_source_check',sourceCheck],
 ['repair_requests','owner_repair_owner_fields_check',"CHECK (((source_type <> 'owner'::text) OR ((source_owner_id IS NOT NULL) AND (property_id IS NOT NULL) AND (tenant_account_id IS NULL) AND (tenant_name IS NULL) AND (source_label IS NOT NULL) AND (length(source_label) > 0) AND (location_type = ANY (ARRAY['room'::text, 'common_area'::text])) AND (((location_type = 'common_area'::text) AND (room_number IS NULL)) OR ((location_type = 'room'::text) AND (length(btrim(room_number)) > 0) AND (room_number IS NOT NULL))))))"]
];
let prefix=pre.slice(pre.indexOf('with targets'),pre.indexOf('), sections(seq,'));
const added=`), expected_columns(table_name,column_name,type_name,not_null,default_value) as (values
 ('repair_requests','source_type','text',true,'''tenant''::text'),
 ('repair_requests','source_channel','text',true,'''web''::text'),
 ('repair_requests','source_owner_id','uuid',false,null),('repair_requests','source_label','text',false,null),
 ('repair_requests','location_type','text',true,'''room''::text'),('repair_requests','contact_notes','text',false,null),
 ('repair_photos','source_type','text',true,'''tenant''::text'),('repair_photos','source_channel','text',true,'''web''::text')
), added_columns as (
 select e.*,c.type_name actual_type,c.not_null actual_not_null,c.default_value actual_default,
 coalesce(c.type_name=e.type_name and c.not_null=e.not_null and c.default_value is not distinct from e.default_value
 and c.identity='' and c.generated='',false) matches from expected_columns e left join columns c using(table_name,column_name)
), expected_constraints(table_name,conname,definition) as (values
 ${constraints.map(row=>'('+row.map(quote).join(',')+')').join(',\n ')}
), added_constraints as (
 select e.table_name,e.conname,e.definition expected_definition,c.definition actual_definition,
 coalesce(c.convalidated and not c.condeferrable and
 regexp_replace(c.definition,'\\s','','g')=regexp_replace(e.definition,'\\s','','g'),false) matches
 from expected_constraints e left join constraints c using(table_name,conname)
), expected_functions(name,body_md5) as (values ${functionRows}
), function_checks as (
 select e.name,p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,p.proacl::text acl,
 coalesce(p.prokind='f' and p.prolang=(select oid from pg_language where lanname='plpgsql')
 and p.provolatile='v' and not p.proisstrict and p.prosecdef=(e.name='create_owner_repair')
 and p.proconfig=array['search_path=""'] and md5(btrim(replace(p.prosrc,E'\\r\\n',E'\\n'),E' \\t\\r\\n'))=e.body_md5
 and p.prorettype=case when e.name='create_owner_repair' then 'bigint'::regtype else 'trigger'::regtype end
 and (e.name<>'create_owner_repair' or (
 p.proargnames=array['p_property','p_location','p_room','p_category','p_description','p_contact_notes']
 and p.pronargdefaults=0
 and exists(select 1 from pg_roles o where o.oid=p.proowner and (o.rolsuper or o.rolbypassrls))
 and has_function_privilege((select oid from roles where name='authenticated'),p.oid,'EXECUTE')
 and not has_function_privilege((select oid from roles where name='anon'),p.oid,'EXECUTE')
 and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
 and not exists(select 1 from roles r where r.name in ('anon','authenticated') and pg_has_role(r.oid,p.proowner,'MEMBER'))
 )) ,false) matches
 from expected_functions e left join pg_proc p on p.oid=to_regprocedure(case when e.name='create_owner_repair'
 then 'public.create_owner_repair(uuid,text,text,text,text,text)' else 'public.guard_repair_provenance()' end)
), guard_check as (
 select exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.repair_requests')
 and t.tgname='guard_repair_provenance' and t.tgfoid=to_regprocedure('public.guard_repair_provenance()')
 and t.tgenabled='O' and t.tgtype=23 and not t.tgisinternal and t.tgqual is null and t.tgnargs=0 and t.tgattr=''::int2vector) matches
), post_data as (
 select
 (select count(*) from rr where j->>'source_type'='tenant' and j->>'source_channel'='legacy') legacy_tenant_rows,
 (select count(*) from rr where j->>'source_type'='tenant' and j->>'source_channel'='legacy' and j->>'room_number' is null) legacy_null_rooms,
 (select count(*) from rr where j->>'source_type'='owner') owner_rows,
 (select count(*) from rr where j->>'source_type' is null or j->>'source_channel' is null or
 not ((j->>'source_type'='tenant' and j->>'source_channel' in ('legacy','web') and j->>'source_owner_id' is null and j->>'location_type'='room')
 or (j->>'source_type'='owner' and j->>'source_channel'='web' and exists(select 1 from ow
 where ow.j->>'id'=rr.j->>'source_owner_id' and ow.j->>'organization_id'=rr.j->>'organization_id')))) invalid_repair_provenance,
 (select count(*) from rp where j->>'source_type' is null or j->>'source_channel' is distinct from 'web'
 or not exists(select 1 from rr where rr.j->>'id'=rp.j->>'repair_id' and rr.j->>'organization_id'=rp.j->>'organization_id'
 and rr.j->>'source_type'=rp.j->>'source_type' and rp.j->>'source_type' in ('tenant','owner'))) invalid_photo_provenance
`;
let sections=pre.slice(pre.indexOf('), sections(seq,'));
sections=sections.replace("and not exists(select 1 from unfilled_required),","and not exists(select 1 from unfilled_required) and (select bool_and(matches) from added_columns),");
sections=sections.replace("jsonb_build_object('checks',","jsonb_build_object('added_columns',(select jsonb_agg(to_jsonb(c)) from added_columns c),'checks',");
sections=sections.replace("and (contype='c' or confmatchtype='f'))","and (contype='c' or confmatchtype='f') and conname not in (select conname from expected_constraints)) and (select bool_and(matches) from added_constraints)");
sections=sections.replace("jsonb_build_object('keys',","jsonb_build_object('added_constraints',(select jsonb_agg(to_jsonb(c)) from added_constraints c),'keys',");
sections=sections.replace("'planned_objects',not exists(select 1 from collisions where collision)","'installed_objects',not exists(select 1 from collisions where not collision) and (select matches from guard_check) and (select bool_and(matches) from function_checks) and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('owner_repair_owner_org_key','owner_repair_property_org_key') and (not i.indisvalid or not i.indisready))");
sections=sections.replace("jsonb_build_object('inventory',","jsonb_build_object('functions',(select jsonb_agg(to_jsonb(f)) from function_checks f),'guard_matches',(select matches from guard_check),'inventory',");
sections=sections.replace("'create_owner_repair_overloads',not exists(select 1 from rpc_overloads)","'create_owner_repair_overloads',(select count(*)=1 and bool_and(planned_signature_collision) from rpc_overloads)");
sections=sections.replace("'any_overload_requires_review',true","'extra_overload_requires_review',true");
const dataStart=sections.indexOf(" union all select 5,'repair_requests_data'");
const dataEnd=sections.indexOf(" union all select 7,'owner_property_scope'");
sections=sections.slice(0,dataStart)+` union all select 5,'repair_requests_data',r.invalid_organization=0 and r.invalid_property_scope=0 and d.invalid_repair_provenance=0,
 (to_jsonb(r)-'conflicting_provenance')||to_jsonb(d)||jsonb_build_object('historical_identity_comparison_performed',false,
 'reason','Immediate post-migration contract: legacy tenant/legacy/room and NULL rooms preserved; new tenant/web and owner/web permitted. Compare legacy_tenant_rows with preflight total before reopening intake. SQL alone cannot reconstruct historical row identities.') from repair_counts r cross join post_data d
 union all select 6,'repair_photos_data',p.repair_id_null=0 and p.orphan_repair=0 and p.cross_org_repair=0 and p.invalid_organization=0 and d.invalid_photo_provenance=0,
 (to_jsonb(p)-'conflicting_provenance')||jsonb_build_object('invalid_photo_provenance',d.invalid_photo_provenance,'reason','Photo provenance must match parent repair; legacy tenant/web preserved.') from photo_counts p cross join post_data d
`+sections.slice(dataEnd);
sections=sections.replace("rolbypassrls and can_select and can_insert and can_update","rolbypassrls and can_select and can_insert and can_update and can_delete and can_truncate and can_reference and can_trigger");
sections=sections.replace("and tgenabled<>'D')","and tgenabled<>'D' and not (table_name='repair_requests' and tgname='guard_repair_provenance'))");
sections=sections.replace("Review ACL diagnostic, then separately approve the guarded migration. Unchanged broad production ACLs must remain false.","Post-migration: exact browser ACL contract required. All seven confirmed production service_role table rights must remain available.");
sections=sections.replace('Other policies and enabled repair/photo triggers require review.','Other policies and enabled repair/photo triggers except the verified provenance guard require review.');
const sql=`-- AFTER migration only. One SELECT, read-only catalogs/aggregates; run as postgres/BYPASSRLS.
-- Generated from the reviewed preflight and migration by test-fixtures/owner-repair-postcheck.build.mjs.
-- No application helper/RPC execution, writes, credentials or individual application rows.
-- Compare backfill counts with saved preflight before reopening intake; historical identities need a saved baseline.
-- Unknown future source types/channels fail conservatively and require review.
${prefix}${added}${sections}`;
const output=new URL('../owner-repair-phase1.production-postcheck.readonly.sql',import.meta.url);
if(process.argv.includes('--write'))writeFileSync(output,sql);
else assert.equal(readFileSync(output,'utf8').replaceAll('\r\n','\n'),sql,'Post-check artifact drift: review and regenerate');
console.log('PASS: post-check artifact matches reviewed preflight/migration sources');
