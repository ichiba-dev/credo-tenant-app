// LOCAL TEST ONLY: exact 15 MiB signed upload to 127.0.0.1:54321.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const inspect=(name)=>JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}))[0];
const container=inspect('supabase_storage_credo-tenant-app');
const kong=inspect('supabase_kong_credo-tenant-app');
if(container.Config.Labels['com.supabase.cli.project']!=='credo-tenant-app'
  || container.Config.Labels['com.supabase.cli.workdir'].toLowerCase()!==process.cwd().toLowerCase()
  || kong.HostConfig.PortBindings['8000/tcp']?.[0]?.HostPort!=='54321')throw Error('Not local Supabase');
const getKey=(name)=>container.Config.Env.find(x=>x.startsWith(`${name}=`))?.slice(name.length+1);
const service=createClient('http://127.0.0.1:54321',getKey('SERVICE_KEY'),
  {auth:{persistSession:false}}).storage.from('vendor-quotes');
const browser=createClient('http://127.0.0.1:54321',getKey('ANON_KEY'),
  {auth:{persistSession:false}}).storage.from('vendor-quotes');
const bytes=Buffer.alloc(15*1024*1024,0x20);bytes.write('%PDF-1.4\n');
const sha=createHash('sha256').update(bytes).digest('hex');
const path=`local-15m-test/${randomUUID()}.pdf`;
const oversizedPath=`local-15m-test/${randomUUID()}.pdf`;
const directPath=`local-15m-test/${randomUUID()}.pdf`;
try{
  const direct=await browser.upload(directPath,new Blob([Buffer.from('%PDF-1.4\n')],
    {type:'application/pdf'}),{contentType:'application/pdf'});
  if(!direct.error)throw Error('Anonymous direct browser upload was accepted');
  process.stdout.write('PASS anonymous direct browser upload denied\n');
  const signed=await service.createSignedUploadUrl(path,{upsert:false});
  if(signed.error || !signed.data)throw signed.error ?? Error('No signed token');
  const upload=await browser.uploadToSignedUrl(path,signed.data.token,
    new Blob([bytes],{type:'application/pdf'}),
    {contentType:'application/pdf',metadata:{sha256:sha},upsert:false});
  if(upload.error)throw upload.error;
  const info=await service.info(path);
  if(info.error || info.data.size!==bytes.length || info.data.contentType!=='application/pdf'
    || info.data.metadata?.sha256!==sha)throw Error('Metadata mismatch');
  const download=await service.download(path);
  if(download.error || !download.data)throw download.error ?? Error('Missing download');
  const actual=Buffer.from(await download.data.arrayBuffer());
  if(actual.length!==bytes.length || createHash('sha256').update(actual).digest('hex')!==sha)
    throw Error('Byte mismatch');
  process.stdout.write('PASS signed 15 MiB PDF upload, metadata and downloaded SHA256\n');
  const oversizedSigned=await service.createSignedUploadUrl(oversizedPath,{upsert:false});
  if(oversizedSigned.error || !oversizedSigned.data)throw oversizedSigned.error ?? Error('No oversized token');
  const oversized=await browser.uploadToSignedUrl(oversizedPath,oversizedSigned.data.token,
    new Blob([Buffer.concat([bytes,Buffer.from([0])])],{type:'application/pdf'}),
    {contentType:'application/pdf',metadata:{sha256:sha},upsert:false});
  if(!oversized.error)throw Error('Bucket accepted PDF over 15 MiB');
  process.stdout.write('PASS signed 15 MiB plus one byte rejected by bucket\n');
}finally{
  const removed=await service.remove([path,oversizedPath,directPath]);if(removed.error)throw removed.error;
}
