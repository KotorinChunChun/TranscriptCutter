# Quadro M4000搭載Windows PCへのGPU導入手順

2026-11-12調査。対象はTranscriptionServerのWhisper認識ワーカーです。Haasなどのspeech.cpp/Vulkan経路、話者分離のGPU対応は別です。今回は手順を作成し、対象PCへのインストールや停止は行っていません。

## 実PCの報告と追加モデル（2026-11-12）

ユーザー報告はQuadro M4000、ドライバー552.86、VRAM8192MiBです。前回のWhisper用CUDA12.8.1構成の基準572.61未満なので、当該構成へ揃える場合はM4000と対象Windowsを明示的にサポートするドライバーへの更新を先に検討します。CUDA12系の互換モードの最小値と、この手順の推奨構成は区別してください。更新・再起動は対象PCで行い、この調査では実行していません。

具体的な候補として[NVIDIA公式R580 U12 / 582.99](https://www.nvidia.com/en-us/drivers/details/282544/)（2026-10-21公開、Windows 10 x64 / Windows 11）の対応製品にQuadro M4000を確認しました。対象PCのOSを確認して選びます。このリンクはCUDA追加の代わりにWhisperのSM5.2不足を解消するものではありません。

v0.1.2で追加する [Nemotron 3.5 ASR Streaming 0.6B](nemotron-asr.md) は別のC++/Vulkan経路です。このモデルにCUDA/cuDNNは不要です。インストーラーと管理画面で742MBのQ8モデルを準備し、まずCPU、次に明示GPUを短い音声で検証できます。552.86/M4000でのVulkan実推論・速度・VRAMは未受入です。Whisper用のSM5.2ワーカーが用意されたことにはなりません。

## 最初に確認する制約

**公開済みv0.2.0のWhisperワーカーでは、CUDAを追加するだけでM4000を利用できません。SM 5.2を含めて再ビルドしたワーカーの配布が先に必要です。**

M4000はMaxwell / Compute Capability 5.2です（M4000Mは別製品）。[NVIDIA GPU一覧](https://developer.nvidia.com/cuda/gpus/legacy)

v0.2.0の実配布 `worker/_internal/ctranslate2/ctranslate2.dll` を公式cuobjdump 12.8.90で検査しました。

- cubin: `sm_53, sm_60, sm_61, sm_70, sm_75, sm_80, sm_86`、各25個。
- PTX: `sm_86`。`sm_50` / `sm_52` / M4000で使えるPTXはありません。
- DLL SHA256: `34ff1eeefef2330f8abe777ae12b2238718e04503ad6e3bc9b6c9cb5be9fd274`。

SM 5.3用コードをSM 5.2へ逆向きに適用できません。FP32のGPU検出に成功しても、モデルのロード・推論時に失敗する構成です。v0.2.0で追加した計算形式の検出だけでは不足しています。[NVIDIA Maxwell互換性](https://docs.nvidia.com/cuda/maxwell-compatibility-guide/index.html)

以下は**SM 5.2対応版のワーカーが用意された後**に実行する導入手順です。現時点ではM4000での動作・速度は未検証です。

## 揃える構成

| 項目 | 導入候補・条件 |
| --- | --- |
| OS | 対象ドライバーとCUDA 12.8が対応するWindows x64。Windows 10 22H2 / Windows 11など。OSのサポート状況も確認する |
| NVIDIAドライバー | Quadro M4000と対象OSを明示的にサポートする版。本手順では572.61以上を基準とし、R580系を候補にする |
| CUDA | **12.8 Update 1（12.8.1）**。Runtime 12.8.90、cuBLAS 12.8.4.1 |
| cuDNN | **9.10.2.21 / CUDA 12用 / Windows x86_64**。異なるcuDNN 9のDLLを混在させない |
| VC++ Runtime | Microsoft Visual C++ v14再頒布可能パッケージ **x64**。Whisperワーカー用 |
| ワーカー | CTranslate2 4.8.2をSM 5.2入りでビルド・同梱した対応版。faster-whisper 1.2.1、PyAV 16.0.1を維持 |
| 認識方式 | GPU / **float32**。最初はTiny、次にBase、Small |
| 媒体変換 | FFmpegとFFprobe。管理画面で検出済みであること |

CUDA 12.8.1とcuDNN 9.10.2は[CTranslate2 v4.8.2のWindows公式ビルド](https://github.com/OpenNMT/CTranslate2/blob/v4.8.2/python/tools/prepare_build_environment_windows.sh)に揃えた候補です。CUDA/ドライバーは[NVIDIA CUDA 12.8.1表](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html)、cuDNNは[9.10.2対応表](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.2/reference/support-matrix.html)で照合しました。ドライバー572.61は本手順の基準であり、CUDA 12系の互換モードにおける絶対的な最小値という意味ではありません。

Maxwellの最終CUDA Toolkit系列は12.x、ドライバー系列はR580です。CUDA 13やcuDNNの最新版を一律に選びません。[NVIDIA世代対応表](https://docs.nvidia.com/datacenter/tesla/drivers/cuda-toolkit-driver-and-architecture-matrix.html)

cuDNNの表にはMaxwell向けCUDA 11.8の性能推奨もありますが、それを現行CUDA 12ビルドのワーカーへ混ぜることはできません。CUDA 11への変更には別のビルド・検証が必要です。M4000ではFP16/INT8の高速化を前提にせずFP32を使います。[CTranslate2計算形式](https://opennmt.net/CTranslate2/quantization.html)

配布物にはPythonと認識ライブラリーが同梱されています。別途Python、pip、PyTorch、Visual StudioをサーバーPCへ導入する必要はありません。Visual Studio / CUDAコンパイラーはワーカーを再ビルドする開発PCだけで必要です。

## 1. 現状を記録して処理を終える

対象サーバーPCのPowerShell 7（pwsh）で確認します。

```powershell
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture
```

`Quadro M4000`、VRAM約8GB、ドライバー版を記録します。`nvidia-smi`が見つからない場合はドライバー導入後に再確認します。画面上の「CUDA Version」はドライバーの対応上限で、Toolkitの導入済み版ではありません。[NVIDIAの説明](https://docs.nvidia.com/datacenter/tesla/drivers/cuda-toolkit-driver-and-architecture-matrix.html)

管理画面で実行中・待機ジョブを確認し、既存処理を完了させてからサーバーを正常終了します。設定とデータ保存先を記録し、設定・DB・媒体をバックアップします。タスクマネージャーでの強制終了は避けます。対象PCがv0.1.0の場合も、既存処理の完了後に管理画面付きの版へ更新します。v0.2.0への更新だけではSM 5.2対応は完了しません。

## 2. NVIDIAドライバーとVC++ Runtimeを導入する

1. [NVIDIA公式ドライバー検索](https://www.nvidia.com/Download/index.aspx)でQuadro M4000と対象Windowsを指定します。
2. ダウンロードする版の対応製品一覧に**Quadro M4000**があることを確認します。572.61以上、R580系を候補とし、現状が条件を満たす場合は無理に入れ替えません。
3. 必要な場合だけドライバーをインストールし、要求に従って再起動します。再度`nvidia-smi`で製品名と版を確認します。
4. [Microsoft公式のVisual C++ v14 x64 Runtime](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)を導入・更新します。x86版だけでは代用できません。

## 3. CUDA 12.8 Update 1を導入する

1. [CUDA 12.8.1公式アーカイブ](https://developer.nvidia.com/cuda-12-8-1-download-archive)でWindows / x86_64 / 対象OSのインストーラーを選びます。
2. カスタム構成でCUDAの実行用ライブラリー（CUDA Runtime、cuBLAS、cuRANDなど）を導入します。cuDNNの構成によって利用するNVRTC等も含むCUDAライブラリーを揃えます。名称は[Windows導入ガイド](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-installation-guide-microsoft-windows/index.html)を参照します。
3. 手順2で整えたドライバーがある場合、CUDAインストーラーによるドライバーの上書きを外します。Nsight、サンプル、Visual Studio統合は推論用途には不要です。Visual Studio未導入の警告と、実行ライブラリーの導入失敗を区別します。
4. 標準の導入先は `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8` です。

既存の別版CUDAを削除する必要はありません。このアプリの起動時だけ12.8の探索先を指定します。`nvcc --version`はコンパイラーを省略した構成では使えません。

開発用Toolkit一式は容量が大きくなります。公式の部品ZIPを使う場合、CUDA Runtime / cuBLAS / cuRAND / NVRTCとcuDNNの圧縮サイズ合計だけで約1.51GiBです（展開後容量・モデル重み・ドライバーは別）。最小DLL構成は実機試験前なので、容量削減のために未確認のDLLを取り除かないでください。[CUDA公式部品一覧](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.8.1.json)、[cuDNN公式部品一覧](https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_9.10.2.json)

## 4. cuDNN 9.10.2のCUDA 12版を展開する

1. [NVIDIA公式ZIP](https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.10.2.21_cuda12-archive.zip)を取得します。ライセンス条件に従って利用してください。
2. ZIPのSHA256を確認します。サイズは683,336,095バイト、公式SHA256は次です。

```text
c1a4567d822ebda7373fa1f19255dff4942302de741f830160b6c7d1fb31af23
```

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\cudnn-windows-x86_64-9.10.2.21_cuda12-archive.zip" -Algorithm SHA256
```

3. 例として `C:\Tools\NVIDIA\cudnn-9.10.2` へ展開します。内側のアーカイブ名フォルダーにある`bin`を見つけ、その絶対パスを次の手順へ指定します。`bin`に入っているDLL一式を同じ版の組として保持します。

以前の「CUDA非同梱」という説明を補足すると、v0.2.0にはcuDNNの入口DLL `worker/_internal/ctranslate2/cudnn64_9.dll`（266,288バイト）が含まれます。これだけでcuDNN一式が揃っているわけではありません。公式ワーカーはcuDNNを使わない畳み込み設定でもこの入口DLLを同梱しており、実際に必要な追加DLLはワーカービルドに依存します。ここでは将来の対応ワーカーにも揃えられる同版一式を準備します。System32や配布ワーカーの内部へDLLを上書きコピーしません。

## 5. このアプリのプロセスだけに探索先を指定する

対応ワーカーを含むインストーラーを導入し、旧サーバープロセスが停止していることを確認してから実行します。`$cudnnBin`は実際の展開先へ変更してください。

```powershell
$serverRoot = Join-Path $env:LOCALAPPDATA 'Programs\TranscriptionServer'
$cudaRoot = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8'
$cudaBin = Join-Path $cudaRoot 'bin'
$cudnnBin = 'C:\Tools\NVIDIA\cudnn-9.10.2\cudnn-windows-x86_64-9.10.2.21_cuda12-archive\bin'
$worker = Join-Path $serverRoot 'worker\WhisperWorker.exe'
foreach ($path in @($worker, "$cudaBin\cublas64_12.dll", "$cudaBin\cublasLt64_12.dll", "$cudnnBin\cudnn64_9.dll")) {
    if (!(Test-Path -LiteralPath $path)) { throw "見つかりません: $path" }
}
$env:CUDA_PATH = $cudaRoot
$env:PATH = "$cudnnBin;$cudaBin;$env:PATH"
$env:CT2_VERBOSE = '1'
& $worker --probe
if ($LASTEXITCODE -ne 0) { throw 'Whisperワーカーの点検に失敗しました。' }
# 点検結果を確認後、この同じpwshで起動する
& (Join-Path $serverRoot 'TranscriptionServer.exe') --installed --open
```

期待する点検結果は `"gpu": true` と `"gpuComputeType": "float32"` です。ただし、**これは推論成功の証明にはなりません**。`CUDA_PATH`も指定するのは、CTranslate2のWindows版がcuBLASをロードするときにこの変数の`bin`を参照するためです。[v4.8.2公式実装](https://github.com/OpenNMT/CTranslate2/blob/v4.8.2/src/cuda/cublas_stub.cc)

この指定は現在のpwshと子プロセスだけに有効です。今後もこの起動ブロックを専用`.ps1`へ保存してpwshから起動するか、運用側で同じ環境変数を明示した起動方法に揃えます。別のショートカットや既に起動中のサーバーには反映されません。ユーザーPATHを恒久変更する場合は既存値を退避し、アプリ更新後の起動方法も含めて再確認します。

`--installed`は保存済みの接続・データ設定を読みます。既存のラッパーに明示の保存先や許可サブネットがある場合、それも引き継ぎます。GPU確認のために保存先やLAN許可範囲を変更する必要はありません。

## 6. 管理画面と実音声で確認する

1. サーバーPCで `http://127.0.0.1:8769/` を開きます。FFmpeg/FFprobeの検出とGPU候補の`float32`を確認します。管理画面はモデル重みを取得しますが、CUDAやドライバーをインストールする機能ではありません。
2. 処理・待機ジョブがない状態でWhisper Tinyを「導入」し、詳細表示で処理方法を「GPU候補」にして使用するモードを「ロード」します。初期選択は自動なので、GPUだけの検証では明示的に切り替えます。
3. TranscriptCutterなどの利用アプリでWhisper Tiny、処理方法GPUを選び、10〜30秒程度の発話を含む日本語音声を認識します。最初は話者識別を外し、Whisper単独の経路を確認します。本サーバーの同梱文字起こし画面は未リリース修正で廃止します。
4. 字幕生成とジョブの正常完了を確認します。ジョブ詳細の`metadata.actualDevice`が`cuda`、`metadata.computeType`が`float32`であることを確認します。`auto`や単なるロード済み表示だけでGPU成功と判断しません。
5. 別のpwshで次を実行し、処理中のGPU使用率とメモリー増加も補助的に確認します。Windows WDDMではプロセス別メモリーが表示されない場合があります。

```powershell
nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv -l 1
```

6. 同じ短い音声をCPUでも測定し、初回モデル取得時間を除いた所要時間と精度を比較します。Tiny → Base → Smallの順に増やします。GPUだから必ずCPUより速いとは限りません。8GBの共有状況とFP32消費量を見て、大型モデルや同時実行を判断します。
7. 「アンロード」でVRAMの減少を確認し、通常の起動方法で再起動した後もGPU認識を再確認します。最後にTranscriptCutterなど別PCから同じサーバーへ接続して認識します。GPUライブラリーはクライアントPCには不要です。

## エラーの切り分け

| 症状 | 確認する点 |
| --- | --- |
| `nvidia-smi`でM4000が出ない | ドライバーの対応製品、デバイスマネージャー、再起動 |
| `gpu: false` | ドライバー、ワーカーの起動ユーザー、CUDAエラー。CPU認識成功と区別する |
| `cublas64_12.dll`等をロードできない | CUDA 12用DLL、依存DLL、CUDA_PATHとPATH。既に起動中のプロセスは再起動する |
| `cudnn_*64_9.dll`がない・版が不整合 | CUDA 12用9.10.2一式、入口DLLと追加DLLの版、探索先の別版混入 |
| `no kernel image is available` / `invalid device function` | SM5.2対応ワーカーか確認。v0.2.0の元DLLには対応コードがない |
| FP16非対応・float16要求 | 処理形式がfloat32になる対応ワーカーか確認。CPUへ落ちた成功と区別する |
| GPUメモリー不足 | 他プロセス・別枠のモデルを解放し、Tiny/Baseで単独試験する |
| `VCRUNTIME140` / `MSVCP140`関連 | Microsoft公式VC++ v14 x64 Runtime。DLL単体の非公式取得はしない |
| 接続できない | GPUとは別にサーバーIP、8769、信頼LAN許可、PrivateプロファイルFW、ブラウザー接続許可を確認 |

失敗時はエラー全文、製品名/ドライバー版、ワーカー版/対象SM、DLLの配置、点検結果、ジョブID/処理方式/所要時間を記録します。接続トークン・APIキー・録音本文は共有ログへ含めません。GPUが受入を通るまではCPUでの運用を継続できます。

## 開発側で必要な対応（未実施）

- 公式CTranslate2 4.8.2をWindows x64 / CUDA 12.8.1で再ビルドし、`CUDA_ARCH_LIST`へ明示的に`5.2`（必要に応じて`5.2+PTX`）を含めます。現行公式の`Common`指定をそのまま使うとM4000用コードが入りません。既存GPU対象も保持します。
- 現行公式Windowsビルドは`WITH_CUDNN=OFF`です。これを維持するか、cuDNN 9.10.2を使う構成にするかを明示して検証します。単にPythonパッケージをダウングレードして現行製品と混在させません。
- Pythonは認識ワーカーだけに保持し、同じfaster-whisper / PyAVとの組み合わせでPyInstaller配布物を作成します。未検証のDLLだけを既存導入先へ差し替える運用にはしません。
- `cuobjdump --list-elf` / `--list-ptx`で全カーネルのM4000向け対象を確認し、M4000上でGPU強制のロード・実認識・アンロード・再起動と、既存CPU/新世代GPUの回帰を実施します。
- 対応ワーカーを実機検証した後、新しいパッチ版のインストーラー/Releaseを作ります。旧v0.2.0のReleaseは版番号訂正で撤回済みです。現行v0.1.4にもSM5.2用Whisperワーカーは含まれず、この未対応はNemotron ASRのVulkan経路とは別です。

この文書の完了は導入手順と配布物検査までです。SM5.2対応ワーカーの作成、対象PCのOS/ドライバー確認、ライブラリー導入、M4000上の実認識・性能確認は未完了です。
