import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./outbound-line-payload.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports,URL});
const {imageLinePayload,pdfLinePayload,classifyLinePush}=exports;

test('LINE image and PDF messages contain only HTTPS content URLs',()=>{
  const image=imageLinePayload('Utest','https://cdn.example/original','https://cdn.example/preview');
  assert.equal(image.to,'Utest');assert.equal(image.messages[0].type,'image');
  assert.equal(image.messages[0].originalContentUrl,'https://cdn.example/original');
  assert.equal(image.messages[0].previewImageUrl,'https://cdn.example/preview');
  const pdf=pdfLinePayload('Utest','https://credo.example/api/line-outbound/pdf/token');
  assert.equal(pdf.messages[0].type,'text');
  assert.equal(pdf.messages[0].text,'PDF: https://credo.example/api/line-outbound/pdf/token');
  assert.throws(()=>imageLinePayload('Utest','http://localhost/x','https://cdn.example/y'));
  assert.throws(()=>pdfLinePayload('Utest','http://localhost/pdf'));
});
test('LINE 2xx/accepted 409 and unknown/failure responses follow retry policy',()=>{
  assert.equal(classifyLinePush(200,false),'accepted');
  assert.equal(classifyLinePush(409,true),'accepted');
  assert.equal(classifyLinePush(409,false),'failed');
  assert.equal(classifyLinePush(429,false),'unknown');
  assert.equal(classifyLinePush(500,false),'unknown');
  for(const code of [400,401,403])assert.equal(classifyLinePush(code,false),'failed');
});
