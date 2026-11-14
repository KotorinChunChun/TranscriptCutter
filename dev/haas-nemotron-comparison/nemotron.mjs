// Experimental adapter only; upstream implementation remains an untracked runtime asset.
// Model: NVIDIA Nemotron 3 Diarization, ONNX revision
// 46642c09b3bd014c5ceb19d20524fa2f1dc27dee (OpenMDW-1.1).
// Runtime JS: professorcaren/transcriber/diar.js commit
// b11f004341b75b58ed754ecd30fda1394d8431f5. No source license is stated there;
// this experiment does not add that implementation to product distribution.
import {Diarizer} from './vendor/nemotron-diar.mjs';
/** Load only local model assets. ORT provider/thread configuration belongs to the caller. */
export async function loadNemotron(ort, {baseUrl='./model/nemotron/', onProgress=()=>{}}={}) {
  const asset = name => new URL(name, new URL(baseUrl, import.meta.url)).href;
  const fetchFloats = async (name, expected) => {
    const response = await fetch(asset(name));
    if (!response.ok) throw Error(`Nemotron ${name}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== expected * 4) throw Error(`Nemotron ${name}: invalid length`);
    const values = new Float32Array(buffer);
    if (!values.every(Number.isFinite)) throw Error(`Nemotron ${name}: nonfinite value`);
    return values;
  };
  let embedSession, stepSession;
  try {
    onProgress('Nemotronの音声係数を読み込み中');
    const [melFilters, silence] = await Promise.all([
      fetchFloats('mel_filters.bin', 128 * 257), fetchFloats('silence_embeds.bin', 512),
    ]);
    onProgress('Nemotronの特徴量モデルを読み込み中');
    embedSession = await ort.InferenceSession.create(asset('embed.onnx'), {executionProviders:['wasm']});
    onProgress('Nemotron INT8モデルを読み込み中');
    stepSession = await ort.InferenceSession.create(asset('step_int8.onnx'), {executionProviders:['wasm']});
    const diarizer = new Diarizer(ort, embedSession, stepSession, melFilters, silence);
    let disposed = false, running = false;
    return {
      async run(audio, progress=()=>{}) {
        if (disposed) throw Error('Nemotronモデルは解放済みです');
        if (running) throw Error('Nemotronはすでに実行中です');
        if (!(audio instanceof Float32Array) || audio.length < 160 || !audio.every(Number.isFinite)) {
          throw Error('Nemotronの入力は16kHzの有限なFloat32 PCMを10ms以上にしてください');
        }
        running = true;
        try { return await diarizer.run(audio, progress); }
        finally { running = false; }
      },
      async dispose() {
        if (running) throw Error('実行中のNemotronを解放できません');
        if (disposed) return;
        disposed = true;
        await Promise.all([embedSession.release(), stepSession.release()]);
      },
    };
  } catch(error) {
    await Promise.allSettled([embedSession?.release(), stepSession?.release()]);
    throw error;
  }
}