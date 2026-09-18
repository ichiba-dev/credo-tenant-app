import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./staff-reply-operation.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports });
test('request ID survives retry/reload and protects pending body; new ID only after completion', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  let count = 0;
  const random = () => `${++count}1111111-1111-4111-8111-111111111111`;
  const key = 'staff-org-repair';
  const first = exports.prepareReplyOperation(storage, key, ' reply ', random);
  assert.equal(exports.loadReplyOperation(storage, key).requestId, first.requestId);
  assert.equal(exports.prepareReplyOperation(storage, key, 'reply', random).requestId, first.requestId);
  assert.throws(() => exports.prepareReplyOperation(storage, key, 'changed', random));
  assert.equal(count, 1);
  storage.removeItem(key);
  assert.notEqual(exports.prepareReplyOperation(storage, key, 'reply', random).requestId, first.requestId);
  assert.equal(exports.loadReplyOperation(storage, 'other-staff-org-repair'), null);
});
test('corrupt/unavailable session storage fails closed before sending', () => {
  assert.throws(() => exports.loadReplyOperation({ getItem: () => '{}' }, 'key'));
  assert.throws(() => exports.prepareReplyOperation({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, 'key', 'reply', () => 'uuid'));
});
