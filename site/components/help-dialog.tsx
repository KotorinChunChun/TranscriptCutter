import {useState} from 'react';
import {Modal} from './editor-ui';
import './help-dialog.css';

const tabs=[{id:'basics',label:'基本操作'},{id:'workflow',label:'理想の使い方'},{id:'tools',label:'関連ツール'}] as const;
type Tab=typeof tabs[number]['id'];
function Flow({steps}:{steps:string[]}){return <ol className="help-flow">{steps.map((step,i)=><li key={i}>{step}</li>)}</ol>;}
export function HelpDialog({onClose}:{onClose:()=>void}){
 const [tab,setTab]=useState<Tab>('basics');
 return <Modal title="使い方" wide onClose={onClose} footer={<button className="button primary" onClick={onClose}>作業に戻る</button>}>
 <div className="help-tabs" role="tablist" aria-label="使い方の項目" onKeyDown={event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const index=tabs.findIndex(t=>t.id===tab),next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
  setTab(next.id);event.currentTarget.querySelector<HTMLButtonElement>(`#help-tab-${next.id}`)?.focus();
 }}>{tabs.map(t=><button type="button" key={t.id} id={`help-tab-${t.id}`} role="tab" tabIndex={tab===t.id?0:-1} aria-selected={tab===t.id} aria-controls={`help-panel-${t.id}`} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
 <section className="help-panel" role="tabpanel" id={`help-panel-${tab}`} aria-labelledby={`help-tab-${tab}`} tabIndex={0}>
 {tab==='basics'&&<>
  <h3>3つの画面の役割</h3>
  <dl className="help-definitions"><dt>文字起こし</dt><dd>実行先・話者識別・認識モデルを選び、動画や音声をドロップして開始します。完了後の「VTT編集」で次の作業へ引き継げます。</dd><dt>字幕比較</dt><dd>同じ動画・同じ時間軸の字幕を最大3つ並べ、各区間の本文と話者を選びます。採用中の字幕をもう一度押すと解除できます。＋からカスタム列を加え、AI生成を初期値にして編集することもできます。元字幕とカスタム列を合わせて最大4列です。</dd><dt>動画編集</dt><dd>文字をドラッグして範囲を選び、右クリックから話者変更・選択範囲削除・1手戻すを操作します。再生モードでは本文や時刻から確認でき、削除モードでは単語をクリックしてカットできます。</dd></dl>
  <h3>境界・空白・話者を確認する</h3>
  <p>文字を選ぶと下部に時間軸が出ます。単語時刻はカット候補として使い、ゼロ長・不一致・曖昧な部分は文字数から推定します。「波形を表示」で音声を見ながら開始・終了を調整し、「前後を試聴」で確認できます。</p>
  <p>「空白」は字幕のない区間で、必ずしも無音ではありません。資料を読む時間や映像だけで伝わる場面を確認してからカットします。画像は要求時に生成します。</p>
  <p>「動画・話者」で話者ごとの絞り込みや名前の一括変更ができます。ペインの右下をドラッグすると大きさを変えられます。削除部分を戻すには「削除箇所」をONにし、該当文字の右クリックから「この文字を復元」を選びます。Ctrl Zでも直前の編集を戻せます。</p>
  <h3>保存して続きから再開する</h3>
  <p>「保存」から字幕・カットしたメディア・編集プロジェクトなどを選べます。「すべて保存」はカット後のメディア・同期したVTT・再開用プロジェクト等をZIPにまとめます。再開時は同じZIP内の動画とプロジェクトを一緒にドロップします。</p>
  <p>F5では同じブラウザーの作業状態から復元します。別のブラウザーやPCへ持ち出す場合はファイルで保存してください。元の動画は上書きしません。MP4を書き出せない環境では、対応するWebMを選べます。</p>
  <p className="help-note">組込サンプルは佐藤・田中・鈴木の3人による架空の会話です。字幕のみで、音声・動画は付属しません。</p>
 </>}
 {tab==='workflow'&&<>
  <article className="help-pattern"><h3>1．動画をそのまま使い、字幕を完成させる</h3><Flow steps={['文字起こし','字幕比較','完成']}/><p>カットが不要な講演や、録画全体を残して字幕だけを仕上げたい場合に向いています。</p><ol><li>同じ元動画を2〜3種類のモデルで文字起こしします。開始・終了の範囲をそろえ、話者識別が必要なら指定します。</li><li>「字幕比較」で原音を確認しながら本文と話者を選びます。必要ならAI整理案や用語辞書を使い、固有名詞・数字・否定表現を直します。</li><li>元動画の時刻を保った完成字幕をVTTで保存します。映像をカットしたい場合は「動画編集へ進む」へ移ります。</li></ol><p><strong>特徴：</strong>動画の再書き出しが不要で、手順が少なく、元の時間軸を保てます。モデルごとの認識は元動画の全範囲に対して行います。</p></article>
  <article className="help-pattern"><h3>2．先に動画を編集し、完成動画に合わせた字幕を作る</h3><Flow steps={['文字起こし','動画編集','文字起こし','字幕比較','完成']}/><p>長い待ち時間・言い直し・不要な話題を取り除き、見やすい動画と字幕を一緒に仕上げたい場合に向いています。</p><ol><li>最初はフィラーや言い直しを残した、原文に忠実な文字起こしを作ります。この字幕をカット位置の手掛かりにします。</li><li>「動画編集」で不要部分を選び、波形や原音で境界を確認します。空白でも映像に必要な説明があれば残し、編集した動画を書き出します。</li><li><strong>書き出した動画</strong>を共通の入力にして、3種類のモデルで改めて文字起こしします。</li><li>同じ出力動画の字幕だけを「字幕比較」に並べます。本文・話者を選び、必要ならAI整理と用語辞書を使って完成させます。</li><li>完成動画と、その動画に同期したVTTを保存します。追加のカットが必要なら再び動画編集し、書き出したメディアと同期する字幕を確認します。</li></ol><p><strong>特徴：</strong>初回認識・カット確認・動画書き出しの手間が増えます。不要部分が多いほど、後から3モデルで処理する対象を短くできます。元動画は保持し、編集後の動画を最終字幕の基準にします。</p></article>
  <h3>品質を上げる確認ポイント</h3>
  <ul><li>編集前と編集後の字幕を、同じ比較へ混ぜないでください。カットにより時刻が変わります。</li><li>最初の字幕では原文を残し、最終字幕で読みやすさを整えます。字幕だけの言い換えと、映像・音声のカットは区別します。</li><li>多数決だけで決めず、意見が分かれる区間を原音で確認します。人名・専門用語・数値・単位・否定の抜けを重点的に見ます。</li><li>繰り返し直す語句は辞書へ登録します。AI生成は編集可能な候補として扱い、聞こえない内容を補っていないか確認します。</li></ul>
 </>}
 {tab==='tools'&&<>
  <h3>関連ツールの役割</h3>
  <dl className="help-definitions"><dt>TranscriptionServer</dt><dd>動画・音声を文字起こしするサーバーです。認識モデル・話者識別モデル・実行環境・FFmpeg/FFprobeはサーバー管理画面で準備します。自PCの専用サーバーにも、別PCのサーバーにも接続できます。</dd><dt>ブラウザー内Whisper</dt><dd>このブラウザーへモデルを導入し、音声をブラウザー内で認識します。CPUを使用でき、WebGPUに対応する環境ではGPUも選べます。サーバー認識とは使えるモデルや速度・精度が異なります。</dd><dt>Codex app server</dt><dd>「字幕を整える」のAI生成を担当します。最大3つの元字幕や用語辞書を使い、選択したAIモデルで整理案を作ります。生成後はカスタム列と同じように編集できます。字幕の文章を扱う処理なので、原音を聞いた判定の代わりにはなりません。</dd><dt>会議録画・録音ツール</dt><dd>Teamsなどで収録した元メディアを入力として使えます。MP4・WebMなど、利用中のブラウザーで読み込める形式を用意してください。最終的な同期確認には、字幕の元にした同じ動画・音声が必要です。</dd></dl>
  <h3>本ツール内で併用する機能</h3>
  <dl className="help-definitions"><dt>用語辞書</dt><dd>誤認識と正しい表記の組を管理します。修正時の学習、登録語句の追加・削除、ルール置換、AI整理での参照に使います。専門用語や固有名詞をそろえるときに役立ちます。</dd><dt>VTTとプロジェクト</dt><dd>VTTは完成字幕として他のプレーヤーや編集ソフトへ渡すファイルです。編集プロジェクトJSONは話者・カット記録・単語時刻候補などを保持して作業を再開するために使います。JSONだけには元動画のデータを含みません。</dd></dl>
 </>}
 </section>
 </Modal>;
}
