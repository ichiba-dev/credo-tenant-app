-- LOCAL TEST RESET ONLY. Removes only objects from vendor-dispatch-phase1.migration.sql.
begin;
drop policy if exists vendor_quotes_no_browser_insert on storage.objects;
drop policy if exists vendor_quotes_no_browser_update on storage.objects;
drop policy if exists vendor_quotes_no_browser_delete on storage.objects;
drop function if exists public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,timestamptz,date,text,text,jsonb,text,bigint,bytea);
drop function if exists public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,date,text,text,jsonb,text,bigint,bytea);
drop function if exists public.record_vendor_quote_revision(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,date,text,text,jsonb,text,bigint,bytea);
drop function if exists public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,text,bigint,bytea);
drop function if exists public.prepare_vendor_quote_upload(uuid,bigint,uuid,uuid,uuid,timestamptz,text,bigint,bytea);
drop function public.transition_repair_vendor_dispatch(uuid,uuid,text,uuid,text);
drop function public.select_repair_vendor(uuid,bigint,uuid,text,uuid);
drop function public._vendor_phase1_assert_writer(uuid);
drop table if exists public.vendor_quote_files,public.vendor_quote_lines,
  public.repair_vendor_dispatch_events,public.vendor_quote_versions,
  public.vendor_quote_uploads,public.repair_vendor_dispatches,public.repair_vendor_categories,
  public.repair_vendor_areas,public.repair_vendors;
drop function public._vendor_dispatch_audit();
drop function public._vendor_dispatch_guard();
drop function public._vendor_master_identity_guard();
drop function public._vendor_phase1_no_change();
commit;
