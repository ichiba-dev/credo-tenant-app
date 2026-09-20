import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
const exports={};
const env={OUTBOUND_TOKEN_SECRET:Buffer.alloc(32,1).toString('base64'),OUTBOUND_PAYLOAD_KEY_V1:Buffer.alloc(32,2).toString('base64')};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./outbound-crypto.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports,Buffer,process:{env},require(name){if(name==='server-only')return {};if(name==='node:crypto')return crypto;throw Error(name)}});
const {derivePdfToken,encryptPayload,decryptPayload,digestMatches,shaBytea}=exports;
test('PDF token is reproducible for retry and DB digest does not reveal it',()=>{
  const a=derivePdfToken('attachment','request'),b=derivePdfToken('attachment','request');
  assert.equal(a,b);assert.notEqual(a,derivePdfToken('attachment','other'));
  const digest=shaBytea(a);assert(!digest.includes(a));assert(digestMatches(digest,a));
});
test('payload is encrypted with fresh nonce and authenticates on decrypt',()=>{
  const payload={to:'Utest',messages:[{type:'image',originalContentUrl:'https://cdn.example/a',previewImageUrl:'https://cdn.example/b'}]};
  const first=encryptPayload(payload),second=encryptPayload(payload);
  assert.notEqual(first.ciphertext,second.ciphertext);
  assert.equal(first.sha,second.sha);
  assert.equal(JSON.stringify(decryptPayload(first.ciphertext)),JSON.stringify(payload));
  const altered=first.ciphertext.slice(0,-2)+'00';
  assert.throws(()=>decryptPayload(altered));
});
