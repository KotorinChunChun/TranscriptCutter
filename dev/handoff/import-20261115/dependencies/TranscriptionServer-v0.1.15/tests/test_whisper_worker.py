import importlib.util,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('whisper_only',Path(__file__).resolve().parents[1]/'workers/whisper_worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class GpuCompatibility(unittest.TestCase):
    def test_maxwell_float32_is_a_gpu_candidate(self):
        with patch.dict(sys.modules,{'ctranslate2':types.SimpleNamespace(get_cuda_device_count=lambda:1,get_supported_compute_types=lambda _: {'float32'})}):self.assertEqual(worker.gpu_compute(),'float32')
    def test_modern_float16_and_no_gpu(self):
        with patch.dict(sys.modules,{'ctranslate2':types.SimpleNamespace(get_cuda_device_count=lambda:1,get_supported_compute_types=lambda _: {'float32','float16'})}):self.assertEqual(worker.gpu_compute(),'float16')
        with patch.dict(sys.modules,{'ctranslate2':types.SimpleNamespace(get_cuda_device_count=lambda:0)}):self.assertIsNone(worker.gpu_compute())
class StageEvents(unittest.TestCase):
    def test_opt_in_complete_error_and_legacy_silence(self):
        with patch.object(worker,'emit') as emit:
            with worker.stage({},'model_load'):pass
            emit.assert_not_called()
            with worker.stage({'reportStages':True},'recognition'):pass
            self.assertEqual([call.args[0]['event'] for call in emit.call_args_list],['start','complete'])
            emit.reset_mock()
            with self.assertRaisesRegex(RuntimeError,'fixture'):
                with worker.stage({'reportStages':True},'model_load'):raise RuntimeError('fixture')
            self.assertEqual([call.args[0]['event'] for call in emit.call_args_list],['start','error'])
class DownloadProgress(unittest.TestCase):
    def test_actual_counters_and_original_implementation_restored_on_error(self):
        class Counter:
            def __init__(self,*args,**kwargs):self.n=2;self.total=4;self.unit='B';self.desc='fixture';self.display()
        marker=object()
        utils=types.ModuleType('faster_whisper.utils');utils.disabled_tqdm=marker
        package=types.ModuleType('faster_whisper');package.utils=utils
        auto=types.ModuleType('tqdm.auto');auto.tqdm=Counter
        def fail(*args,**kwargs):
            utils.disabled_tqdm();raise RuntimeError('fixture')
        utils.download_model=fail
        with patch.dict(sys.modules,{'faster_whisper':package,'faster_whisper.utils':utils,'tqdm':types.ModuleType('tqdm'),'tqdm.auto':auto}),patch.object(worker,'emit') as emit:
            with self.assertRaisesRegex(RuntimeError,'fixture'):worker.download('tiny')
            self.assertIs(utils.disabled_tqdm,marker)
            self.assertEqual(emit.call_args.args[0]['percent'],50)
            self.assertEqual(emit.call_args.args[0]['unit'],'bytes')
if __name__=='__main__':unittest.main()
