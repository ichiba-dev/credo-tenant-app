import assert from "node:assert/strict";

// Independent catalog contract for every constraint/index added by this migration.
// Preflight checks existing prerequisites; new objects can only be checked after apply.
export async function checkPhotoSelectionConstraints(q) {
  const table = "repair_vendor_dispatch_message_attachments";
  const types = (await q(`select attname,format_type(atttypid,atttypmod) type from pg_attribute
    where attrelid='public.repair_vendor_dispatch_message_attachments'::regclass
    and attname in ('repair_photo_id','tenant_line_attachment_id') order by attname`)).rows;
  assert.deepEqual(types,[{attname:"repair_photo_id",type:"bigint"},
    {attname:"tenant_line_attachment_id",type:"uuid"}]);
  const expected = [
    ["repair_photos", "vendor_dispatch_repair_photos_org_id_uq", "u", ["organization_id", "repair_id", "id"]],
    ["tenant_line_attachments", "vendor_dispatch_line_attachments_org_id_uq", "u", ["organization_id", "repair_request_id", "id"]],
    ["repair_vendor_dispatches", "vendor_dispatch_repair_scope_uq", "u", ["organization_id", "repair_request_id", "id"]],
    ["repair_vendor_dispatch_messages", "vendor_dispatch_message_scope_uq", "u", ["organization_id", "id", "dispatch_id"]],
    [table, `${table}_pkey`, "p", ["id"]],
    [table, "vendor_dispatch_message_attachment_order_uq", "u", ["organization_id", "message_id", "sort_order"]],
    [table, "vendor_dispatch_message_attachment_message_fk", "f", ["organization_id", "message_id", "dispatch_id"], "repair_vendor_dispatch_messages", ["organization_id", "id", "dispatch_id"]],
    [table, "vendor_dispatch_message_attachment_dispatch_fk", "f", ["organization_id", "repair_request_id", "dispatch_id"], "repair_vendor_dispatches", ["organization_id", "repair_request_id", "id"]],
    [table, "vendor_dispatch_message_attachment_photo_fk", "f", ["organization_id", "repair_request_id", "repair_photo_id"], "repair_photos", ["organization_id", "repair_id", "id"]],
    [table, "vendor_dispatch_message_attachment_line_fk", "f", ["organization_id", "repair_request_id", "tenant_line_attachment_id"], "tenant_line_attachments", ["organization_id", "repair_request_id", "id"]],
    [table, `${table}_sort_order_check`, "c", ["sort_order"], null, null,
      "((sort_order >= 0) AND (sort_order <= 29))"],
    [table, "vendor_dispatch_message_attachment_source_ck", "c", ["source_type", "repair_photo_id", "tenant_line_attachment_id", "legacy_source_key"], null, null,
      "(((source_type = 'repair_photo'::text) AND (repair_photo_id IS NOT NULL) AND (tenant_line_attachment_id IS NULL) AND (legacy_source_key IS NULL)) OR ((source_type = 'tenant_line_attachment'::text) AND (repair_photo_id IS NULL) AND (tenant_line_attachment_id IS NOT NULL) AND (legacy_source_key IS NULL)) OR ((source_type = 'legacy_photo'::text) AND (repair_photo_id IS NULL) AND (tenant_line_attachment_id IS NULL) AND (legacy_source_key IS NOT NULL)))"],
    ...[["legacy_key", "legacy_source_key", 100], ["file_name", "file_name", 300], ["mime", "mime_type", 100]].map(([name, column, limit]) =>
      [table, `vendor_dispatch_message_attachment_${name}_ck`, "c", [column], null, null,
        `((${column} IS NULL) OR ((length(${column}) >= 1) AND (length(${column}) <= ${limit})))`]),
  ];
  const { rows } = await q(`select c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,
    c.connoinherit,t.relname table_name,rt.relname referenced_table,
    array(select a.attname::text from unnest(c.conkey) with ordinality u(n,o)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.n order by u.o) columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality u(n,o)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.n order by u.o) referenced_columns,
    c.confupdtype,c.confdeltype,c.confmatchtype,pg_get_expr(c.conbin,c.conrelid) expression,
    i.indisvalid,i.indisready,i.indisunique,i.indimmediate
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    left join pg_class rt on rt.oid=c.confrelid left join pg_index i on i.indexrelid=c.conindid
    where c.connamespace='public'::regnamespace`);
  for (const [relation, name, type, columns, referencedTable, referencedColumns, expression] of expected) {
    const c = rows.find((r) => r.table_name === relation && r.conname === name);
    assert.ok(c, name);
    assert.equal(c.contype, type, name);
    assert.deepEqual(c.columns, columns, name);
    assert.equal(c.convalidated, true, name);
    assert.equal(c.condeferrable, false, name);
    assert.equal(c.condeferred, false, name);
    if (type === "f") {
      assert.equal(c.referenced_table, referencedTable, name);
      assert.deepEqual(c.referenced_columns, referencedColumns, name);
      assert.equal(c.confupdtype, "a", name);
      assert.equal(c.confdeltype, "a", name);
      assert.equal(c.confmatchtype, "s", name);
    } else if (type === "c") {
      assert.equal(c.connoinherit, false, name);
      assert.equal(c.expression, expression, name);
    } else {
      for (const flag of ["indisvalid", "indisready", "indisunique", "indimmediate"])
        assert.equal(c[flag], true, `${name}: ${flag}`);
    }
  }
  for (const [suffix, column] of [["photo", "repair_photo_id"], ["line", "tenant_line_attachment_id"], ["legacy", "legacy_source_key"]]) {
    const { rows: [index] } = await q(`select i.indisvalid,i.indisready,i.indisunique,i.indimmediate,
      pg_get_expr(i.indpred,i.indrelid) predicate,
      array(select a.attname::text from unnest(i.indkey) with ordinality u(n,o)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.n order by u.o) columns
      from pg_index i where i.indexrelid=to_regclass($1) and i.indrelid=to_regclass($2)`,
    [`public.vendor_dispatch_message_attachment_${suffix}_uq`, `public.${table}`]);
    assert.deepEqual(index, { indisvalid: true, indisready: true, indisunique: true, indimmediate: true,
      predicate: `(${column} IS NOT NULL)`, columns: ["organization_id", "message_id", column] });
  }
}
