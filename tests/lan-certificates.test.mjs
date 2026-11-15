import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {inspectLanCertificate,saveServerRequest,ipStatus,lanUrl} from '../scripts/lan-certificates.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../runtime/lan-certificate-tests'),openssl='C:/Program Files/Git/usr/bin/openssl.exe';
await mkdir(root,{recursive:true});
const work=await mkdtemp(join(root,'fixture-')),request=await saveServerRequest(work,['192.168.49.13','192.168.49.12']);
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
await writeFile(join(root,'fixture.json'),JSON.stringify({work,request,config},null,2));
