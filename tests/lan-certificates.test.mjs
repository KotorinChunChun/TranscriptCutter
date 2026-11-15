import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {X509Certificate,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {request as httpRequest} from 'node:http';
import {createClientTrustGuide,trustGuideHtml} from '../scripts/client-trust-guide.mjs';
import {startUnified,launchNetwork} from '../scripts/unified-launcher.mjs';
import {inspectLanCertificate,saveServerRequest,ipStatus,lanUrl,currentLanAddresses} from '../scripts/lan-certificates.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../runtime/lan-certificate-tests'),openssl='C:/Program Files/Git/usr/bin/openssl.exe';
await mkdir(root,{recursive:true});
const work=await mkdtemp(join(root,'fixture-')),request=await saveServerRequest(work,[...new Set(['192.168.49.13','192.168.49.12',...currentLanAddresses()])]);
const directory=dirname(request.keyPath),rootKey=join(directory,'test-root.key'),ca=join(directory,'test-root.crt'),cert=join(directory,'server.crt');
const run=args=>execFileSync(openssl,args,{stdio:'ignore',windowsHide:true});
run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',rootKey,'-out',ca,'-subj','/CN=TC Synthetic Root','-days','7','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
run(['x509','-req','-in',request.csrPath,'-CA',ca,'-CAkey',rootKey,'-CAcreateserial','-out',cert,'-days','2','-copy_extensions','copy']);
const config={publicUrl:'https://192.168.49.13:19120/',certPath:cert,keyPath:request.keyPath,rootCaPath:ca};
test('PKCS#10 signature and all requested IP SANs are verified by independent OpenSSL',async()=>{
 run(['req','-in',request.csrPath,'-verify','-noout']);const text=execFileSync(openssl,['req','-in',request.csrPath,'-noout','-text'],{encoding:'utf8',windowsHide:true});assert.match(text,/IP Address:192\.168\.49\.13/);assert.match(text,/IP Address:192\.168\.49\.12/);assert.match(text,/TLS Web Server Authentication/);assert.equal(JSON.stringify(request).includes('PRIVATE KEY'),false);assert.match(await readFile(request.keyPath,'utf8'),/BEGIN PRIVATE KEY/);
});
test('issued leaf, matching key, common root and DER root for Intune are validated without OS trust changes',async()=>{
 const checked=await inspectLanCertificate(config);assert.equal(checked.details.ip,'192.168.49.13');assert.equal(new X509Certificate(checked.rootDer).ca,true);assert.equal(checked.details.rootSha256,new X509Certificate(await readFile(ca)).fingerprint256);assert.equal(Object.keys(checked.details).some(k=>/key/i.test(k)),false);
 const der=join(directory,'root.cer');await writeFile(der,checked.rootDer);assert.equal((await inspectLanCertificate({...config,rootCaPath:der})).details.rootSha256,checked.details.rootSha256);
});
test('TLS diagnostics distinguish missing files, key mismatch, wrong IP, expiry and wrong certificate role',async()=>{
 await assert.rejects(inspectLanCertificate({...config,certPath:join(directory,'missing.crt')}),/HTTPS証明書ファイルが見つかりません/);
 await assert.rejects(inspectLanCertificate({...config,keyPath:join(directory,'missing.key')}),/サーバー秘密鍵ファイルが見つかりません/);
 await assert.rejects(inspectLanCertificate({...config,keyPath:rootKey}),/秘密鍵が一致しません/);
 await assert.rejects(inspectLanCertificate({...config,publicUrl:'https://192.168.49.99:19120/'}),/対象IPに 192.168.49.99 がありません/);
 await assert.rejects(inspectLanCertificate(config,{now:Date.now()+10*86400000}),/有効期限が切れています/);
 await assert.rejects(inspectLanCertificate(config,{now:Date.now()-10*86400000}),/まだ有効になっていません/);
 await assert.rejects(inspectLanCertificate({...config,certPath:ca,keyPath:rootKey}),/CA証明書が指定されています/);
 const invalid=join(directory,'invalid.crt');await writeFile(invalid,'not a certificate');await assert.rejects(inspectLanCertificate({...config,certPath:invalid}),/形式を読み取れません/);
});
test('an unrelated root cannot be distributed as the trusted issuer',async()=>{
 const other=join(directory,'other-root.crt');run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'other.key'),'-out',other,'-subj','/CN=Different Synthetic Root','-days','7','-addext','basicConstraints=critical,CA:TRUE']);await assert.rejects(inspectLanCertificate({...config,rootCaPath:other}),/指定の発行元CAへ検証できません/);
});
test('IP changes are detected without replacing saved settings or inventing a name-based URL',()=>{
 const saved={mode:'lan',publicUrl:config.publicUrl};assert.equal(ipStatus(saved,['192.168.49.13']).changed,false);const changed=ipStatus(saved,['192.168.49.99']);assert.equal(changed.changed,true);assert.equal(changed.suggested,'https://192.168.49.99:19120/');assert.equal(saved.publicUrl,config.publicUrl);assert.equal(ipStatus(saved,['192.168.49.98','192.168.49.99']).suggested,'');assert.throws(()=>lanUrl(config.publicUrl,['192.168.49.99']),/現在このPCにありません/);
});
const stop=async server=>{server.closeAllConnections();await new Promise(r=>server.close(r));await server.cleanup?.();};
const hostStatus=(base,host)=>new Promise((resolve,reject)=>{const req=httpRequest(base,{headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
test('public trust guide serves only verified CA DER and manual instructions on a loopback fixture',async()=>{
 const checked=await inspectLanCertificate(config),info={...config,rootDer:checked.rootDer,certificate:checked.details};let hosts=['192.168.49.13:19121'];
 const guide=createClientTrustGuide({getHosts:()=>hosts,getInfo:()=>info});await new Promise(r=>guide.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${guide.address().port}/`;
 try{const page=await fetch(base),html=await page.text();assert.equal(page.status,200);for(const text of ['Intune','現在のユーザー','別の信頼できる経路','再発行'])assert.ok(html.includes(text));assert.ok(page.headers.get('content-security-policy').includes("default-src 'none'"));
  const download=await fetch(base+'root-ca.cer'),der=Buffer.from(await download.arrayBuffer());assert.deepEqual(der,checked.rootDer);assert.equal(createHash('sha256').update(der).digest('hex'),checked.details.rootSha256.replaceAll(':','').toLowerCase());assert.ok(download.headers.get('content-disposition').includes('.cer'));
  for(const path of ['server.key','setup/state','setup/certificate-request.csr','../mode.json'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base,{method:'POST',body:'{}'})).status,405);assert.equal(await hostStatus(base,'foreign.test'),403);assert.equal((await fetch(base+'root-ca.cer',{method:'HEAD'})).headers.get('content-type'),'application/pkix-cert');
  assert.equal(await hostStatus(base,hosts[0]),200);hosts=['192.168.49.99:19121'];assert.equal(await hostStatus(base,'192.168.49.13:19121'),403);assert.equal(await hostStatus(base,hosts[0]),200);
  const malicious=trustGuideHtml({...info,certificate:{...info.certificate,rootSubject:'<script>secret</script>'}});assert.ok(!malicious.includes('<script>secret'));assert.ok(malicious.includes('&lt;script&gt;'));
 }finally{await stop(guide);}
});
test('setup APIs expose public certificate and CSR only; checks do not activate or save LAN settings',async t=>{
 const ip=currentLanAddresses()[0];if(!ip){t.skip('private IPv4 unavailable');return;}
 const stateDir=await mkdtemp(join(root,'setup-')),hash=v=>createHash('sha256').update(v).digest('hex'),gzip=gzipSync(JSON.stringify([{path:'program.txt',body:Buffer.from('test').toString('base64'),sha256:hash('test')}]));
 let starts=0;const server=await startUnified({version:'0.1.1',payload:{version:'0.1.1',serverVersion:'0.1.15',gzip:gzip.toString('base64'),sha256:hash(gzip)},assets:new Map(),args:['--setup','--no-open'],env:{TC_UNIFIED_STATE_DIR:stateDir},registryPath:join(stateDir,'no-registry'),startService:async()=>{starts++;throw Error('unexpected start');}}),base=`http://127.0.0.1:${server.address().port}/`;
 try{const initial=await(await fetch(base+'setup/state')).json(),headers={Origin:base.slice(0,-1),'Content-Type':'application/json','X-TC-Setup':initial.nonce},value={...config,mode:'lan',publicUrl:`https://${ip}:19120/`};
  const response=await fetch(base+'setup/certificate-check',{method:'POST',headers,body:JSON.stringify(value)});assert.equal(response.status,200);const result=await response.json();assert.equal(result.certificate.ip,ip);assert.ok(!JSON.stringify(result).includes('PRIVATE KEY'));assert.deepEqual(Buffer.from(await(await fetch(base+'setup/root-ca.cer')).arrayBuffer()),(await inspectLanCertificate(value)).rootDer);
  const requested=await fetch(base+'setup/certificate-request',{method:'POST',headers,body:JSON.stringify(value)});assert.equal(requested.status,200);assert.ok((await requested.json()).request.ips.includes(ip));const csr=await(await fetch(base+'setup/certificate-request.csr')).text();assert.match(csr,/BEGIN CERTIFICATE REQUEST/);assert.ok(!csr.includes('PRIVATE KEY'));
  const after=await(await fetch(base+'setup/state')).json();assert.equal(after.appUrl,'');assert.deepEqual(after.config,initial.config);assert.equal(starts,0);await assert.rejects(readFile(join(stateDir,'mode.json')),e=>e.code==='ENOENT');
  await assert.rejects(launchNetwork({...value,clientGuidePort:'19120'},join(stateDir,'no-registry')),/別のポート/);await assert.rejects(launchNetwork({...value,clientGuidePort:'0'},join(stateDir,'no-registry')),/1024/);await assert.rejects(launchNetwork({...value,rootCaPath:'',clientGuidePort:'19121'},join(stateDir,'no-registry')),/公開証明書を指定/);
 }finally{await stop(server);}
});
await writeFile(join(root,'fixture.json'),JSON.stringify({work,request,config},null,2));
