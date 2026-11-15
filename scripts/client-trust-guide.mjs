import {createServer} from 'node:http';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const privatePeer=address=>{const ip=String(address).replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(ip)||/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(ip);};
export function trustGuideHtml(info){
 const fingerprint=escape(info.certificate.rootSha256),url=escape(info.publicUrl);
 return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>クライアントの接続準備 - TranscriptCutter</title><style>body{font:16px system-ui;line-height:1.6;color:#173f39;background:#f3f7f5;margin:0}main{max-width:760px;margin:20px auto;padding:16px}section{padding:12px;border:1px solid #acc8be;border-radius:8px;background:white;margin:12px 0}h1{font-size:24px}h2{font-size:20px}code,p{overflow-wrap:anywhere}.button{display:inline-block;background:#087e67;color:white;padding:10px 16px;border-radius:6px;text-decoration:none}li{margin:8px 0}</style><main><h1>クライアントの接続準備</h1><p>このページはCA公開証明書と導入手順だけを配布します。字幕・動画・サーバー設定は扱いません。</p><section><h2>発行元を確認</h2><p>${escape(info.certificate.rootSubject)}</p><p>CA公開証明書のSHA-256</p><code>${fingerprint}</code><p>このページはHTTPです。ダウンロードした証明書のSHA-256を、管理者から電話など別の信頼できる経路で受け取った値と照合してください。このページの表示だけで発行元を信用しないでください。</p><p><a class="button" href="/root-ca.cer" download>CA公開証明書をダウンロード</a></p><p>確認例：<code>certutil -hashfile TranscriptCutter-RootCA.cer SHA256</code></p></section><section><h2>Intuneで配布済みの場合</h2><p>このCAが信頼済みなら追加の導入は不要です。管理者は上のDER形式.cerをIntuneの信頼済み証明書プロファイルで配布できます。</p></section><section><h2>各自で導入する場合</h2><ol><li>管理者が案内した発行元とSHA-256が一致することを確認します。</li><li>取得した.cerを開き、「証明書のインストール」→「現在のユーザー」→「証明書をすべて次のストアに配置する」→「信頼されたルート証明機関」を選びます。組織の制限がある場合は管理者へ依頼してください。</li><li>表示された発行元を本人が確認して導入します。このツールは信頼登録を自動実行しません。</li><li>同じWindowsユーザーのEdgeまたはChromeで、下のHTTPS接続先を開きます。警告が残る場合は無視せず管理者に確認してください。</li></ol></section><section><h2>TranscriptCutterへ接続</h2><p><a class="button" href="${url}">${url}</a></p><p>IPが変わった場合は管理者が同じ共通CAでサーバー証明書を再発行し、新しいURLを案内します。共通CA自体が同じなら、クライアントへのCA再登録は不要です。</p></section></main></html>`;
}
/** This server never reads a filesystem path or exposes any setup/mutation endpoint. */
export function createClientTrustGuide({hosts=[],getHosts=()=>hosts,getInfo}){
 const server=createServer((req,res)=>{
  const port=server.address()?.port,host=req.headers.host;
  if(!privatePeer(req.socket.remoteAddress)||![`127.0.0.1:${port}`,`localhost:${port}`,...getHosts()].includes(host)){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const info=getInfo();if(!info?.rootDer){res.writeHead(503).end('CA公開証明書を準備中です。');return;}
  if(req.url==='/root-ca.cer'){res.writeHead(200,{'Content-Type':'application/pkix-cert','Content-Disposition':'attachment; filename="TranscriptCutter-RootCA.cer"'});res.end(req.method==='HEAD'?undefined:info.rootDer);return;}
  if(req.url!=='/'){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:trustGuideHtml(info));
 });return server;
}
