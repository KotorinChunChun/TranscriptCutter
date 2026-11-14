// Fictional, subtitle-only conversation for editing and comparison.
import {serializeVtt,type Cue} from './vtt';
export const SAMPLE_CUES:Cue[]=[
 [0,4000,'佐藤','えっと、来月のAI勉強会について相談しましょう。'],
 [4000,8000,'佐藤','今日は会場と配信方法を決めたいと思います。'],
 [8800,12800,'田中','会場は第2会議室を予約できます。'],
 [12800,16000,'田中','定員は20名で、オンライン参加も受け付けます。'],
 [17500,21500,'鈴木','あの、配信の字幕も用意したいです。'],
 [22000,26000,'佐藤','それなら、録画のあとに字幕を作りましょう。'],
 [27000,31000,'鈴木','まず文字起こしをして、不要な待ち時間をカットします。'],
 [31000,35000,'鈴木','画面で資料を読んでいる時間は残したいですね。'],
 [37000,41000,'田中','編集した動画を、別のモデルでも文字起こししましょう。'],
 [42000,46000,'佐藤','3つの字幕を比較して、正しい表現を選びます。'],
 [46000,49000,'田中','えーと、専門用語は用語辞書に登録しておきます。'],
 [50000,54000,'鈴木','最後に人名と数字を、音声を聞いて確認します。'],
 [55000,59500,'佐藤','では、田中さんは会場、鈴木さんは配信の準備をお願いします。'],
].map(([start,end,speaker,text],i)=>({id:'sample-'+(i+1),start:start as number,end:end as number,speaker:speaker as string,text:text as string,sourceIds:['sample-'+(i+1)],sourceCount:1}));
export const SAMPLE_VTT=serializeVtt(SAMPLE_CUES,{speakerFormat:'voice'});
