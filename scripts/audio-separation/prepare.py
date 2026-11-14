import hashlib,json,os
from pathlib import Path
from huggingface_hub import hf_hub_download
root=Path(__file__).resolve().parents[2]/'runtime/source-separation/models'
root.mkdir(parents=True,exist_ok=True)
models={
 'sepformer':('speechbrain/sepformer-libri3mix','1f2d824e2333aec9e60d0030fb144885c1afc426',['hyperparams.yaml','encoder.ckpt','decoder.ckpt','masknet.ckpt']),
 'ecapa':('speechbrain/spkrec-ecapa-voxceleb','0f99f2d0ebe89ac095bcc5903c4dd8f72b367286',['hyperparams.yaml','embedding_model.ckpt','mean_var_norm_emb.ckpt','classifier.ckpt','label_encoder.txt'])}
lock={}
for key,(repo,revision,files) in models.items():
 folder=root/key
 lock[key]={'repo':repo,'revision':revision,'files':{}}
 for name in files:
  path=Path(hf_hub_download(repo,name,revision=revision,local_dir=folder,token=False))
  lock[key]['files'][name]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
 print(key,revision,sum(v['bytes'] for v in lock[key]['files'].values()),flush=True)
(root/'models.lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8')
print('models ready',flush=True)