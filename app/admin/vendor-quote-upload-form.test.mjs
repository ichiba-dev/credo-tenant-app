import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function setup(selectedId = '') {
  let calls = 0;
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('./vendor-quote-upload-form.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    'react/jsx-runtime': jsx,
    react: {
      useState(initial) { return [calls++ === 0 ? selectedId : typeof initial === 'function' ? initial() : initial, () => {}]; },
      useRef(value) { return { current: value }; },
    },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@supabase/supabase-js': { createClient() { throw Error('No storage operations in rendering'); } },
    '@/lib/vendor-quote-input': (() => {
      const exports = {};
      vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../lib/vendor-quote-input.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
      return exports;
    })(),
  };
  vm.runInNewContext(source, { exports, require(name) { assert.ok(name in imports, name); return imports[name]; } });
  return exports.VendorQuoteUploadForm;
}

const dispatches = [
  { id: 'a', vendorName: '業者A', status: 'dispatched', selectedAt: '2026-10-13T01:00:00Z' },
  { id: 'b', vendorName: '業者B', status: 'completed', selectedAt: '2026-10-13T02:00:00Z' },
  { id: 'c', vendorName: '候補', status: 'candidate', selectedAt: '2026-10-13T03:00:00Z' },
  { id: 'd', vendorName: '取消業者', status: 'cancelled', selectedAt: '2026-10-13T04:00:00Z' },
];

test('multiple dispatches render one quote form and identifiable eligible choices', () => {
  const html = renderToStaticMarkup(setup()({ repairId: 27, dispatches }));
  assert.equal((html.match(/業者見積PDF・下代明細/g) ?? []).length, 1);
  assert.equal((html.match(/type="file"/g) ?? []).length, 1);
  assert.equal((html.match(/<option value="[ab]"/g) ?? []).length, 2);
  assert.match(html, /業者Aから受領した見積を管理会社が代理登録/);
  assert.doesNotMatch(html, /取消業者|value="c"/);
});

test('selection scopes the form to that dispatch and remounts upload state', () => {
  for (const id of ['a', 'b']) {
    const tree = setup(id)({ repairId: 27, dispatches });
    const form = tree.props.children[1];
    assert.equal(form.key, id);
    assert.equal(form.props.dispatchId, id);
    assert.equal(form.props.repairId, 27);
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(`${id === 'a' ? '業者A' : '業者B'}から受領した見積`));
  }
});

test('no eligible dispatch renders no form and stale selection falls back safely', () => {
  assert.equal(setup()({ repairId: 27, dispatches: dispatches.slice(2) }), null);
  const tree = setup('removed')({ repairId: 27, dispatches });
  assert.equal(tree.props.children[1].props.dispatchId, 'a');
});

test('duplicate dispatch IDs do not duplicate choices', () => {
  const html = renderToStaticMarkup(setup()({ repairId: 27, dispatches: [dispatches[0], dispatches[0]] }));
  assert.equal((html.match(/<option value="a"/g) ?? []).length, 1);
});

test('estimate tab mounts one selector rather than one form per dispatch and keeps update gating', () => {
  const source = readFileSync(new URL('./admin-repairs.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<VendorQuoteUploadForm /g) ?? []).length, 1);
  assert.match(source, /canUpdate && <VendorQuoteUploadForm repairId=\{repair.id\} dispatches=/);
});
