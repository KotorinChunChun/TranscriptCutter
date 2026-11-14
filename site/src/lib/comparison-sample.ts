import {createComparisonSession} from './comparison';
import {SAMPLE_CUES} from './sample';
import type {Cue} from './vtt';

// Three versions of the same fictional recording, with deliberate recognition differences.
export function createSampleComparison(){
 const a=SAMPLE_CUES.map(c=>({...c}));
 const b=SAMPLE_CUES.map((c,i)=>({...c,start:c.start+100,end:c.end+100,speaker:({'佐藤':'SPEAKER_00','田中':'SPEAKER_01','鈴木':'SPEAKER_02'} as Record<string,string>)[c.speaker!],text:c.text.replace(/^えっと、|^あの、|^えーと、/,'').replace('第2会議室','第二会議室').replace('用語辞書','用語事象'),id:'b-'+i}));
 // Split one consecutive utterance to exercise alignment across different cue boundaries.
 b.splice(0,1,{...b[0],id:'b-0a',end:1900,text:'来月のAI勉強会について'},{...b[0],id:'b-0b',start:1900,text:'相談しましょう。'});
 const c=SAMPLE_CUES.map((cue,i)=>({...cue,id:'c-'+i,start:cue.start+50,end:cue.end+50,speaker:i===4?'田中':cue.speaker,text:cue.text.replace('20名','二十名').replace('配信方法','配信の方法').replace('不要な待ち時間','不要な待機時間').replace('別のモデル','別のモード')}));
 return createComparisonSession(([a,b,c] as Cue[][]).map((cues,i)=>({id:'sample-model-'+['a','b','c'][i],name:'モデル '+['A','B','C'][i],fileName:'3人の会議_モデル'+['A','B','C'][i]+'.vtt',cues,warnings:[]})));
}
