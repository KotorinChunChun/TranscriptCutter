// Fixed public ONNX assets. No audio leaves the browser.
export const browserHaasModel={id:'haas-ja',label:'Silero VAD＋Haas',revision:'e46a4b107ffba60336eb3de9745da6f628cfae35',devices:['wasm'],modelBytes:{wasm:382636016,webgpu:null}} as const;
export const browserHaasCache='transcript-cutter-browser-haas-v1';
export type HaasBundle='haas'|'nemotron';
export type HaasAsset={id:string;kind:string;url:string;bytes:number;sha256:string};
export const browserHaasAssets:readonly HaasAsset[]=[
  {
    "id": "ortModule",
    "kind": "runtime",
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.wasm.min.mjs",
    "bytes": 53725,
    "sha256": "c21d9c326d453a4a61398270c804d5979e118540597cb0c07f7b3d64e6098234"
  },
  {
    "id": "ortMjs",
    "kind": "runtime",
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.mjs",
    "bytes": 24738,
    "sha256": "30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3"
  },
  {
    "id": "ortWasm",
    "kind": "runtime",
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort-wasm-simd-threaded.wasm",
    "bytes": 14848852,
    "sha256": "4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d"
  },
  {
    "id": "haasFrontend",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/common/frontend.json",
    "bytes": 377057,
    "sha256": "0e5a2769db71a146f3d12229c1b6cf3399718b0f71bf43221807de05dd2def8c"
  },
  {
    "id": "haasDecoding",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/common/decoding.json",
    "bytes": 122,
    "sha256": "e535e51bed8729c3d1c5acb5d016feae774f8b13160f2dccbcd4841ad6ecd5be"
  },
  {
    "id": "haasTokens",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/common/tokens.json",
    "bytes": 36037,
    "sha256": "3f8f996ce5cfeca0f6091395d3b030d9e7e8f49f0f775a05673e58185ba1a286"
  },
  {
    "id": "haasEncoder",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/int4-onecomp/encoder.onnx",
    "bytes": 1114166,
    "sha256": "0b817b90f6187bacc5d0a09c3760b4ded4bb450d10b03837c70ded6863b6cc12"
  },
  {
    "id": "haasEncoderData",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/int4-onecomp/encoder.onnx.data",
    "bytes": 353733120,
    "sha256": "f153731fe6054e5d7d851ac3e8317cd1dbecb9f1a60ebc97d121bc9b35b3dc21"
  },
  {
    "id": "haasPrediction",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/common/prediction.onnx",
    "bytes": 17155566,
    "sha256": "db831ff923cb96d4e9fc856fd989fa7ae6714c0541c16a76f25257f25f9a1520"
  },
  {
    "id": "haasJoint",
    "kind": "haas",
    "url": "https://huggingface.co/kizuna-intelligence/Haas-ja-v1.0-OneCompression-ONNX/resolve/e46a4b107ffba60336eb3de9745da6f628cfae35/common/joint.onnx",
    "bytes": 7892424,
    "sha256": "e54701abe6809dbddf243212b9f4640c4dc1db6d7adc8f6644a55f4e3651fd93"
  },
  {
    "id": "silero",
    "kind": "silero",
    "url": "https://raw.githubusercontent.com/snakers4/silero-vad/066409f3d9db45a30d21dfcbf9147826ffdd7052/src/silero_vad/data/silero_vad.onnx",
    "bytes": 2327524,
    "sha256": "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
  },
  {
    "id": "nemotronEmbed",
    "kind": "nemotron",
    "url": "https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX/resolve/46642c09b3bd014c5ceb19d20524fa2f1dc27dee/embed.onnx",
    "bytes": 2102458,
    "sha256": "2e8796e42286abe2e2d7d44a97fab7e5a7d06b2d4cbee82a3a0f730cfff84a33"
  },
  {
    "id": "nemotronStep",
    "kind": "nemotron",
    "url": "https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX/resolve/46642c09b3bd014c5ceb19d20524fa2f1dc27dee/step_int8.onnx",
    "bytes": 103325385,
    "sha256": "1f18a5aed4909677d3618c9e6ed6e3003720b6d6e766f0f8b337aa4fcb0a9d2a"
  },
  {
    "id": "nemotronMel",
    "kind": "nemotron",
    "url": "https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX/resolve/46642c09b3bd014c5ceb19d20524fa2f1dc27dee/mel_filters.bin",
    "bytes": 131584,
    "sha256": "bce5ec5f194a5913f6508cee5a85512e7bad2352db8fc28f5c6ff75af8b09137"
  },
  {
    "id": "nemotronSilence",
    "kind": "nemotron",
    "url": "https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX/resolve/46642c09b3bd014c5ceb19d20524fa2f1dc27dee/silence_embeds.bin",
    "bytes": 2048,
    "sha256": "d4417b3c0eabdf7c47032fac2b5b5a7ee83d819a6ddda8fd8eaf74e2b5cc4ac7"
  }
];
export const haasAssets=(kind:HaasBundle)=>browserHaasAssets.filter(a=>kind==='nemotron'?a.kind==='nemotron':a.kind!=='nemotron');
export const haasAssetKey=(asset:HaasAsset,origin:string)=>new URL('/__tc-haas/assets/'+asset.id+'/'+asset.sha256,origin).href;
export const haasMarkerKey=(kind:HaasBundle,origin:string)=>new URL('/__tc-haas/installed/'+kind+'/v1',origin).href;
export const haasManifestId=(kind:HaasBundle)=>haasAssets(kind).map(a=>a.id+':'+a.sha256).join('|');
