import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {networkInterfaces,hostname} from 'node:os';
import {isIP} from 'node:net';
import {X509Certificate,createPrivateKey,generateKeyPair,sign,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createSecureContext} from 'node:tls';

export const privateIPv4=ip=>isIP(ip)===4&&/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip);
export function currentLanAddresses(){return [...new Set(Object.values(networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal&&privateIPv4(x.address)).map(x=>x.address))].sort();}
export function ipStatus(config,addresses=currentLanAddresses()){
 let previous='';try{previous=new URL(config.publicUrl).hostname;}catch{}
 const changed=config.mode==='lan'&&!!previous&&!addresses.includes(previous);
 return {addresses,changed,previous,suggested:changed&&addresses.length===1?new URL(config.publicUrl).href.replace(previous,addresses[0]):'',message:changed?`保存済み公開URLのIP ${previous} は現在このPCにありません。現在のIPで証明書を申請し直し、管理者による再発行後に公開URLを変更してください。`:''};
}
export async function requireAllocatedPort(port,registryPath){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('ポートは1024～65535で指定してください。');
 if(!registryPath)return;
 let registry;try{registry=JSON.parse(await readFile(registryPath,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(!registry.servers.some(s=>s.port===port&&s.protocol==='TCP'&&s.visibility==='lan'&&s.allocation_status==='allocated'&&s.application_id?.startsWith('transcript-cutter')))throw Error(`このPCのDevServerにTranscriptCutter用のLANポート ${port} を予約してください。`);
}
export function lanUrl(value,addresses=currentLanAddresses()){
 let url;try{url=new URL(value);}catch{throw Error('公開URLを入力してください。');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!privateIPv4(url.hostname))throw Error('このPCの私設IPv4アドレスを使ったHTTPS URLを指定してください。');
 if(!addresses.includes(url.hostname))throw Error(`公開URLのIP ${url.hostname} は現在このPCにありません。現在のIP：${addresses.join('、')||'未検出'}。IP変更時は証明書を再申請してください。`);
 return url;
}
async function readInput(path,label){
 if(!isAbsolute(path||''))throw Error(`${label}の絶対パスを指定してください。`);
 try{return await readFile(path);}catch(error){if(error.code==='ENOENT')throw Error(`${label}ファイルが見つかりません。サーバーPC上の実際のパスを指定してください。`);if(['EACCES','EPERM'].includes(error.code))throw Error(`${label}を読み取れません。TCを起動しているユーザーの読取権限を管理者に確認してください。`);throw Error(`${label}を読み込めません。ファイルとアクセス権を確認してください。`);}
}
const validAt=(cert,now)=>Date.parse(cert.validFrom)<=now&&Date.parse(cert.validTo)>now;
function certificates(buffer){const pem=buffer.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);return pem?pem.map(v=>new X509Certificate(v)):[new X509Certificate(buffer)];}
function reachesRoot(leaf,issuers,root,seen=new Set()){
 if(leaf.fingerprint256===root.fingerprint256)return true;
 if(seen.has(leaf.fingerprint256)||seen.size>=16)return false;
 const next=new Set(seen).add(leaf.fingerprint256);
 return issuers.some(issuer=>issuer.ca&&issuer.fingerprint256!==leaf.fingerprint256&&leaf.checkIssued(issuer)&&leaf.verify(issuer.publicKey)&&reachesRoot(issuer,issuers,root,next));
}
/** Keys remain in this process. Only `details` and public CA DER may be returned to UI. */
export async function inspectLanCertificate(config,{now=Date.now()}={}){
 const certBytes=await readInput(config.certPath,'HTTPS証明書'),keyBytes=await readInput(config.keyPath,'サーバー秘密鍵');
 let chain;try{chain=certificates(certBytes);}catch{throw Error('HTTPS証明書の形式を読み取れません。PEM形式のサーバー証明書または証明書チェーンを指定してください。');}
 const leaf=chain[0];let key;
 try{key=createPrivateKey(keyBytes);}catch{throw Error('サーバー秘密鍵の形式を読み取れません。暗号化された鍵は未対応です。管理者にサーバー用PEM鍵を確認してください。');}
 if(leaf.ca)throw Error('HTTPS証明書にCA証明書が指定されています。管理者が発行したサーバー証明書を指定してください。');
 if(!leaf.checkPrivateKey(key))throw Error('HTTPS証明書とサーバー秘密鍵が一致しません。証明書申請を作った同じサーバーの鍵を指定してください。');
 if(!validAt(leaf,now))throw Error(Date.parse(leaf.validFrom)>now?'HTTPS証明書はまだ有効になっていません。証明書の開始日時とPCの時計を確認してください。':'HTTPS証明書の有効期限が切れています。管理者へ再発行を依頼してください。');
 const ip=new URL(config.publicUrl).hostname;
 if(!leaf.checkIP(ip))throw Error(`証明書の対象IPに ${ip} がありません。IPを変更した場合は、このPCで新しい証明書申請を作成し、管理者に再発行してもらってください。`);
 let root=null;
 if(config.rootCaPath){
  try{root=new X509Certificate(await readInput(config.rootCaPath,'発行元CA公開証明書'));}catch(error){if(error.message.includes('公開証明書'))throw error;throw Error('発行元CA公開証明書の形式が不正です。公開.cerまたは.crtを指定してください。');}
  if(!root.ca||!root.checkIssued(root)||!root.verify(root.publicKey))throw Error('発行元CAには、社内共通ルートCAの公開証明書を指定してください。');
  if(!validAt(root,now))throw Error('発行元CA公開証明書が有効期間外です。管理者に確認してください。');
  const issuers=[...chain.slice(1),root];
  if(!issuers.every(c=>validAt(c,now))||!reachesRoot(leaf,issuers,root))throw Error('サーバー証明書から指定の発行元CAへ検証できません。正しい共通CAと、必要な中間証明書を含むチェーンを指定してください。');
 }
 const tls={cert:chain.map(c=>c.toString()).join('\n'),key:keyBytes};
 try{createSecureContext(tls);}catch{throw Error('HTTPSの証明書チェーンまたは秘密鍵を利用できません。管理者に証明書の形式と用途を確認してください。');}
 return {tls,rootDer:root?.raw??null,details:{ip,subject:leaf.subject,issuer:leaf.issuer,expires:leaf.validTo,certificateSha256:leaf.fingerprint256,rootSubject:root?.subject??'',rootSha256:root?.fingerprint256??'',rootExpires:root?.validTo??''}};
}

// Minimal PKCS#10 DER encoder. No CA is created; only the server key signs the request.
const der=(tag,...parts)=>{const body=Buffer.concat(parts),n=body.length;let length;if(n<128)length=Buffer.from([n]);else{let h=n.toString(16);if(h.length%2)h='0'+h;const bytes=Buffer.from(h,'hex');length=Buffer.concat([Buffer.from([128+bytes.length]),bytes]);}return Buffer.concat([Buffer.from([tag]),length,body]);};
const seq=(...v)=>der(0x30,...v),set=(...v)=>der(0x31,...v),oid=hex=>der(6,Buffer.from(hex,'hex'));
export async function generateServerRequest(addresses){
 if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(ip=>!privateIPv4(ip)))throw Error('申請する現在の私設IPv4アドレスを確認してください。');
 const ips=[...new Set(addresses)].sort(),pair=await promisify(generateKeyPair)('rsa',{modulusLength:3072});
 const name=`TranscriptCutter-${hostname().slice(0,32)}`;
 const subject=seq(set(seq(oid('550403'),der(12,Buffer.from(name)))));
 const san=seq(...ips.map(ip=>der(0x87,Buffer.from(ip.split('.').map(Number)))));
 const extensions=seq(seq(oid('551d11'),der(4,san)),seq(oid('551d25'),der(4,seq(oid('2b06010505070301')))));
 const attrs=der(0xa0,seq(oid('2a864886f70d01090e'),set(extensions)));
 const info=seq(der(2,Buffer.from([0])),subject,pair.publicKey.export({type:'spki',format:'der'}),attrs);
 const csr=seq(info,seq(oid('2a864886f70d01010b'),der(5)),der(3,Buffer.from([0]),sign('sha256',info,pair.privateKey)));
 const body=csr.toString('base64').match(/.{1,64}/g).join('\n');
 return {csr:`-----BEGIN CERTIFICATE REQUEST-----\n${body}\n-----END CERTIFICATE REQUEST-----\n`,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),ips};
}
async function protectNewDirectory(path){
 await mkdir(path,{mode:0o700});
 if(process.platform==='win32'){
  const sid=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-5-[0-9-]+/)?.[0];if(!sid)throw Error('実行ユーザーの識別情報を確認できません。');
  execFileSync('icacls.exe',[path,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
 }
}
export async function saveServerRequest(stateDir,addresses){
 const parent=join(stateDir,'certificate-requests');await mkdir(parent,{recursive:true});const id=randomUUID(),directory=join(parent,id);await protectNewDirectory(directory);
 const {csr,privateKey,ips}=await generateServerRequest(addresses),keyPath=join(directory,'server.key'),csrPath=join(directory,'server.csr');
 await writeFile(keyPath,privateKey,{flag:'wx',mode:0o600});await writeFile(csrPath,csr,{flag:'wx',mode:0o600});
 const result={id,ips,keyPath,csrPath,createdAt:new Date().toISOString()};await writeFile(join(stateDir,'certificate-request.json'),JSON.stringify(result,null,2)+'\n');
 return {...result,csr};
}
