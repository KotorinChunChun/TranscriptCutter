"""Optional local CPU speech separation. No model download occurs during processing."""
import os,sys,json,time,itertools,hashlib,math,warnings
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
warnings.filterwarnings('ignore',category=UserWarning)
import numpy as np
import torch,torchaudio,av,soundfile as sf
from speechbrain.inference.separation import SepformerSeparation
from speechbrain.inference.speaker import EncoderClassifier
from speechbrain.utils.fetching import LocalStrategy

def emit(**value): print(json.dumps(value,ensure_ascii=False),flush=True)
def main():
 config=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
 root=Path(config['output']);models=Path(config['models']);root.mkdir(parents=True,exist_ok=True)
 started=time.monotonic();torch.set_num_threads(4)
 lock=json.loads((models/'models.lock.json').read_text())
 for key in ['sepformer','ecapa']:
  for name,info in lock[key]['files'].items():
   if hashlib.sha256((models/key/name).read_bytes()).hexdigest()!=info['sha256']:raise ValueError('Model checksum mismatch')
 emit(phase='decoding',progress=.02)
 rate=8000
 with av.open(config['input']) as source:
  stream=source.streams.audio[0];duration=float(source.duration/av.time_base)
  if duration<=0 or duration>7200:raise ValueError('Separation supports up to two hours')
  audio=np.zeros(math.ceil(duration*rate),np.float32);resampler=av.AudioResampler(format='fltp',layout='mono',rate=rate);cursor=0
  for frame in source.decode(stream):
   for part in resampler.resample(frame):
    values=part.to_ndarray().reshape(-1);offset=round(float(part.time)*rate) if part.time is not None else cursor
    left=max(0,-offset);right=min(values.size,audio.size-offset)
    if right>left:audio[max(0,offset):offset+right]=values[left:right]
    cursor=offset+values.size
  for part in resampler.resample(None):
   values=part.to_ndarray().reshape(-1);right=min(values.size,audio.size-cursor)
   if right>0:audio[cursor:cursor+right]=values[:right]
 emit(phase='loading',progress=.05)
 for key in ['sepformer','ecapa']:
  stub=models/key/'custom.py'
  if not stub.exists():stub.write_text('# No custom definitions; use installed SpeechBrain classes only.\n',encoding='utf-8')
 separator=SepformerSeparation.from_hparams(source=str(models/'sepformer'),savedir=str(models/'loaded-sepformer'),run_opts={'device':'cpu'},local_strategy=LocalStrategy.COPY)
 verifier=EncoderClassifier.from_hparams(source=str(models/'ecapa'),savedir=str(models/'loaded-ecapa'),overrides={'pretrained_path':str(models/'ecapa')},run_opts={'device':'cpu'},local_strategy=LocalStrategy.COPY)
 def embedding(samples):
  with torch.inference_mode():
   x=torch.from_numpy(np.ascontiguousarray(samples)).unsqueeze(0)
   x=torchaudio.functional.resample(x,rate,16000)
   if x.shape[-1]<16000:x=torch.nn.functional.pad(x,(0,16000-x.shape[-1]))
   e=verifier.encode_batch(x).flatten();return (e/torch.linalg.vector_norm(e).clamp_min(1e-8)).numpy()
 references=config.get('references',[])[:3];centroids=[];labels=[]
 for ref in references:
  start=max(0,round(ref['start']*rate/1000));end=min(audio.size,start+8*rate,round(ref['end']*rate/1000))
  if end-start>=rate:
   centroids.append(embedding(audio[start:end]));labels.append(ref['name'])
 while len(centroids)<3:centroids.append(None);labels.append('分離音声'+str(len(labels)+1))
 result=np.zeros((3,audio.size),np.float32);weight=np.zeros(audio.size,np.float32)
 window=6*rate;hop=5*rate;blocks=math.ceil(audio.size/hop);uncertain=0
 for block,start in enumerate(range(0,audio.size,hop)):
  end=min(audio.size,start+window);chunk=audio[start:end]
  if np.sqrt(np.mean(chunk*chunk))<0.00008:
   weight[start:end]+=1
   emit(phase='separating',progress=.1+.85*(block+1)/blocks,processedMs=round(end*1000/rate));continue
  with torch.inference_mode():
   padded=torch.from_numpy(chunk.copy()).unsqueeze(0)
   if padded.shape[-1]<rate:padded=torch.nn.functional.pad(padded,(0,rate-padded.shape[-1]))
   separated=separator.separate_batch(padded)[0,:chunk.size,:].cpu().numpy().T
  energy=np.sqrt(np.mean(separated*separated,axis=1));maximum=max(energy.max(),1e-8)
  vectors=[embedding(x) if power>max(.00008,maximum*.06) else None for x,power in zip(separated,energy)]
  scores=np.array([[float(np.dot(v,c)) if v is not None and c is not None else .25 if v is not None else 0 for c in centroids] for v in vectors])
  assignment=max(itertools.permutations(range(3)),key=lambda p:sum(scores[i,p[i]] for i in range(3)))
  ramp=np.ones(chunk.size,np.float32);overlap=window-hop
  if start>0:ramp[:min(overlap,chunk.size)]=np.linspace(0,1,min(overlap,chunk.size),dtype=np.float32)
  if end<audio.size:ramp[-overlap:]=np.linspace(1,0,overlap,dtype=np.float32)
  for channel,target in enumerate(assignment):
   result[target,start:end]+=separated[channel]*ramp
   if vectors[channel] is not None and energy[channel]>maximum*.25:
    if centroids[target] is None:centroids[target]=vectors[channel]
    elif scores[channel,target]<.4:uncertain+=1
  weight[start:end]+=ramp
  emit(phase='separating',progress=.1+.85*(block+1)/blocks,processedMs=round(end*1000/rate))
 result/=np.maximum(weight,1e-6)
 # Use one shared attenuation factor; never normalize speakers independently.
 peak=float(np.abs(result).max());scale=min(1,.99/max(peak,1e-8));result*=scale
 tracks=[];bins=min(6000,max(1,round(duration*10)));edges=np.linspace(0,audio.size,bins+1,dtype=int)
 for i,track in enumerate(result):
  file='voice-'+str(i+1)+'.wav';sf.write(str(root/file),track,rate,subtype='PCM_16')
  peaks=[float(np.abs(track[a:b]).max()) if b>a else 0 for a,b in zip(edges[:-1],edges[1:])]
  tracks.append({'id':str(i+1),'label':labels[i],'file':file,'peaks':peaks,'rms':float(np.sqrt(np.mean(track*track)))})
 info={'schemaVersion':1,'durationMs':round(duration*1000),'sampleRate':rate,'model':'SepFormer Libri3Mix + ECAPA','experimental':True,'uncertainAssignments':uncertain,'runSeconds':time.monotonic()-started,'tracks':tracks}
 (root/'result.json').write_text(json.dumps(info,ensure_ascii=False),encoding='utf-8')
 emit(phase='complete',progress=1,runSeconds=info['runSeconds'])
if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(phase='error',error=str(error));raise
