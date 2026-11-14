// Experimental browser port of the Apache-2.0 Haas TDT decoder/detokenizer.
// Source revision e46a4b107ffba60336eb3de9745da6f628cfae35.
function argmax(data,from=0,to=data.length){let best=from;for(let i=from+1;i<to;i++)if(data[i]>data[best])best=i;return best-from;}
function decodeBytes(bytes){
 let result='';const decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<bytes.length;){const first=bytes[i],size=first<0x80?1:first>=0xc2&&first<=0xdf?2:first>=0xe0&&first<=0xef?3:first>=0xf0&&first<=0xf4?4:0;
  if(size&&i+size<=bytes.length){try{result+=decoder.decode(Uint8Array.from(bytes.slice(i,i+size)));i+=size;continue;}catch{}}
  result+='\ufffd';i++;
 }return result;
}
export function decodeTokens(ids,table){
 const parts=[],pending=[];
 for(const token of ids){let piece=table.pieces[token];if(typeof piece!=='string')throw Error(`Invalid Haas token ${token}`);
  if(/^<0x[0-9a-fA-F]{2}>$/.test(piece)){pending.push(parseInt(piece.slice(3,5),16));continue;}
  if(pending.length){parts.push(decodeBytes(pending));pending.length=0;}
  if(token===table.unk_id)parts.push(' ⁇ ');
  else{if(!parts.length&&table.add_dummy_prefix&&piece.startsWith('▁'))piece=piece.slice(1);parts.push(piece.replaceAll('▁',' '));}
 }
 if(pending.length)parts.push(decodeBytes(pending));return parts.join('');
}

/** Model-independent greedy TDT loop, matching the supplied Python implementation. */
export async function tdtGreedyDecode({frameCount,jointAt,predict,start,config,onProgress,shouldStop}){
 let {pred,state}=start,t=0,lastTs=-1,lasts=0,steps=0;const ids=[],timestamps=[];
 const stepLimit=Math.max(100,frameCount*(config.max_symbols+2)+100);
 while(t<frameCount){let token,duration,tLabel;
  while(true){
   if(shouldStop?.())throw new DOMException('中止','AbortError');
   if(++steps>stepLimit)throw Error('Haas decoder did not advance');
   tLabel=t;const logits=await jointAt(t,pred);
   token=argmax(logits,0,config.num_tokens+1);duration=config.durations[argmax(logits,config.num_tokens+1)];
   if(!Number.isInteger(duration)||duration<0)throw Error('Invalid Haas TDT duration');
   if(token===config.blank_id&&duration===0)duration=1;
   t+=duration;if(token!==config.blank_id||t>=frameCount)break;
  }
  if(token===config.blank_id)break;
  ids.push(token);timestamps.push(tLabel);lasts=lastTs===tLabel?lasts+1:1;lastTs=tLabel;
  ({pred,state}=await predict(token,state));
  if(t<frameCount&&lasts>=config.max_symbols&&lastTs===t)t++;
  if(steps%16===0){onProgress?.({frame:t,frameCount,steps,tokenCount:ids.length});await new Promise(r=>setTimeout(r,0));}
 }
 onProgress?.({frame:frameCount,frameCount,steps,tokenCount:ids.length});return {ids,timestamps,steps};
}

/** ORT-Web binding. Encoder output is the model's enc_proj tensor [1,T,D]. */
export async function decodeTdt({ort,encoded,frameCount,prediction,joint,config,tokens,onProgress,shouldStop}){
 const dimension=Number(encoded.dims.at(-1));
 if(!Number.isSafeInteger(dimension)||dimension<=0||encoded.data.length<frameCount*dimension)throw Error('Invalid Haas encoder output');
 const tensor=(type,data,dims)=>new ort.Tensor(type,data,dims);
 const predict=async(token,state)=>{
  const out=await prediction.run({token:tensor('int64',new BigInt64Array([BigInt(token)]),[1]),kda_state:state.kda,conv_state:state.conv});
  return {pred:out.pred_proj,state:{kda:out.kda_state_out,conv:out.conv_state_out}};
 };
 const state={kda:tensor('float32',new Float32Array(2*1*5*64*64),[2,1,5,64,64]),conv:tensor('float32',new Float32Array(2*1*3*320*4),[2,1,3,320,4])};
 const start=await predict(config.blank_id,state);
 const jointAt=async(t,pred)=>{const out=await joint.run({enc_frame:tensor('float32',encoded.data.subarray(t*dimension,(t+1)*dimension),[1,dimension]),pred_proj:pred});return out.logits.data;};
 const result=await tdtGreedyDecode({frameCount,jointAt,predict,start,config,onProgress,shouldStop});
 return {...result,text:decodeTokens(result.ids,tokens).trim()};
}
