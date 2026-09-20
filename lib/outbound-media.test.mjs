import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./outbound-media.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports, Buffer, require(name) { if (name === 'server-only') return {}; if (name === 'sharp') return sharp; throw Error(name); } });
const { hasMediaMagic, prepareOutboundMedia } = exports;

test('JPEG, PNG and PDF magic accepts real signatures and rejects forged content', async () => {
  const jpeg = await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).jpeg().toBuffer();
  const png = await sharp(jpeg).png().toBuffer();
  for (const [bytes, mime] of [[jpeg,'image/jpeg'],[png,'image/png'],[Buffer.from('%PDF-1.7\n'),'application/pdf']]) {
    assert.equal(hasMediaMagic(bytes,mime),true);
    assert.equal(hasMediaMagic(Buffer.from('wrong'),mime),false);
  }
  assert.equal(hasMediaMagic(jpeg,'image/png'),false);
  assert.equal(hasMediaMagic(png,'application/pdf'),false);
  await assert.rejects(prepareOutboundMedia(jpeg,'image/png'),/INVALID_FILE_MAGIC/);
  await assert.rejects(prepareOutboundMedia(Buffer.from('%PDF-1.7'),'image/jpeg'),/INVALID_FILE_MAGIC/);
  await assert.rejects(prepareOutboundMedia(Buffer.alloc(15_728_641,1),'application/pdf'),/INVALID_FILE_MAGIC|INVALID_FILE_SIZE/);
});

test('images are decoded, metadata stripped and final/preview stay within limits', async () => {
  const pixels=randomBytes(1900*1800*3);
  const source=await sharp(pixels,{raw:{width:1900,height:1800,channels:3}}).png({compressionLevel:0}).toBuffer();
  assert(source.length>10_000_000 && source.length<=10_485_760);
  const prepared=await prepareOutboundMedia(source,'image/png');
  assert(prepared.final.length<=10_000_000);
  assert(prepared.preview.length<=1_000_000);
  assert.equal((await sharp(prepared.final).metadata()).format,'png');
  assert.equal((await sharp(prepared.preview).metadata()).format,'jpeg');
});

test('PDF over 15MiB is rejected', async () => {
  const bytes=Buffer.alloc(15_728_641);bytes.write('%PDF-1.7');
  await assert.rejects(prepareOutboundMedia(bytes,'application/pdf'),/INVALID_FILE_SIZE/);
});
