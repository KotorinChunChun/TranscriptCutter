import http from 'node:http';
import https from 'node:https';
export class ConnectionError extends Error {
 constructor(message,status=502,code='connection_failed'){super(message);this.status=status;this.code=code;}
}
export function serverUrl(value){
 let url;try{url=new URL(value);}catch{throw new ConnectionError('サーバーURLを確認してください。',400);}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new ConnectionError('サーバーURLはHTTP/HTTPSのオリジンで指定してください。',400);
 return url;
}
function healthRequest(target,headers={}){
 return new Promise((resolve,reject)=>{
  const transport=target.protocol==='https:'?https:http;
  const request=transport.get(new URL('/api/health',target),{headers},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){response.destroy();reject(new ConnectionError('サーバー応答が大きすぎます。'));}else chunks.push(chunk);});
   response.on('end',()=>{let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{body=null;}resolve({status:response.statusCode,body});});
   response.on('error',()=>reject(new ConnectionError('サーバー応答を取得できません。')));
  });
  request.setTimeout(10000,()=>request.destroy());
  request.on('error',()=>reject(new ConnectionError('文字起こしサーバーへ接続できません。起動状態とURLを確認してください。')));
 });
}
const identity=body=>body?.appId==='meeting-transcriber'&&body?.protocolVersion===3;
function check(response){
 if(response.status>=300&&response.status<400)throw new ConnectionError('サーバーが別URLを返しました。リダイレクトは追跡しません。',502,'redirect_refused');
}
export async function connectSpeech(value,key=''){
 const target=serverUrl(value);if(typeof key!=='string'||key.length>8192||/[\r\n]/.test(key))throw new ConnectionError('接続キーの形式を確認してください。',400);
 let result=await healthRequest(target);check(result);let headers={},mode;
 if(result.status===401){
  // The legacy server exposes this exact authentication error instead of a public health identity.
  const recognized=identity(result.body)&&result.body.authMode==='bearer'||result.body?.error==='サーバーの接続キーを確認してください。';
  if(!recognized)throw new ConnectionError('指定先を文字起こしサーバーとして確認できません。接続キーは送信していません。',401,'unrecognized_server');
  if(!key)throw new ConnectionError('このサーバーはBearer認証です。接続設定でサーバー接続キーを入力してください。',401,'bearer_key_required');
  headers={Authorization:`Bearer ${key}`};result=await healthRequest(target,headers);check(result);mode='bearer';
 }
 if(result.status===401)throw new ConnectionError('サーバー接続キーを確認して、接続設定から再接続してください。',401,'bearer_key_invalid');
 if(result.status!==200||!identity(result.body))throw new ConnectionError('指定先は対応する文字起こしサーバーではありません。',502,'unrecognized_server');
 const health=result.body;
 if(!mode&&health.authMode==='bearer'){
  if(!key)throw new ConnectionError('このサーバーはBearer認証です。接続設定でサーバー接続キーを入力してください。',401,'bearer_key_required');
  headers={Authorization:`Bearer ${key}`};result=await healthRequest(target,headers);check(result);
  if(result.status!==200||!identity(result.body))throw new ConnectionError('サーバー接続キーを確認してください。',401,'bearer_key_invalid');mode='bearer';
 }
 if(!mode){
  if(health.authMode&&!['lan','local'].includes(health.authMode))throw new ConnectionError('未対応の認証方式です。',502,'unsupported_auth');
  if(typeof health.token!=='string'||!health.token||/[\r\n]/.test(health.token))throw new ConnectionError('一時操作トークンを取得できません。',502,'missing_operation_token');
  mode=health.authMode==='lan'?'lan':'local';headers={'X-Local-Token':health.token};
 }
 return {target,headers,health:{appId:health.appId,protocolVersion:health.protocolVersion,serverVersion:health.serverVersion,executionTarget:health.executionTarget,authMode:mode}};
}
