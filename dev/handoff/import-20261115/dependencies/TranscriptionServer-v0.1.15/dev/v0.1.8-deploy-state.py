"""Local deployment receipts only; no inference, downloads or data migration."""
import argparse,hashlib,json,os,pathlib,sqlite3

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def files(root,small_hash=False):
    if not root.exists():return {}
    result={}
    for path in sorted(root.rglob('*')):
        relative=path.relative_to(root)
        if '.locks' in relative.parts or not path.is_file():continue
        if relative.parent==pathlib.Path('.') and (relative.name.startswith('workbench.sqlite3') or relative.name=='.service.lock'):continue
        stat=path.stat();row={'bytes':stat.st_size,'modified':stat.st_mtime_ns}
        if small_hash or stat.st_size<=2*1024*1024:row['sha256']=digest(path)
        result[relative.as_posix()]=row
    return result

def db_state(path):
    with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
        result={}
        for table,order in [('jobs','id'),('segments','job_id,id'),('job_index','id')]:
            rows=db.execute(f'SELECT * FROM {table} ORDER BY {order}').fetchall()
            result[table]={'count':len(rows),'sha256':hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()}
        return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['capture','verify']);parser.add_argument('backup',type=pathlib.Path);args=parser.parse_args()
    backup=args.backup.resolve();allowed=pathlib.Path('C:/develop/Services/runtime').resolve()
    assert backup!=allowed and backup.is_relative_to(allowed)
    app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/TranscriptionServer';home=pathlib.Path(os.environ['LOCALAPPDATA'])/'TranscriptionServer';data=allowed/'transcription-server/data'
    models=[pathlib.Path(os.environ['LOCALAPPDATA'])/'speech.cpp/models',pathlib.Path(os.environ['USERPROFILE'])/'.cache/huggingface/hub',home/'models']
    state={'database':db_state(data/'workbench.sqlite3'),'media':files(data),'worker':files(app/'worker',True),'models':{str(root):files(root) for root in models},'settings':json.loads((home/'settings.json').read_text(encoding='utf-8-sig')),'configFiles':{path.name:digest(path) for path in home.glob('*.json') if path.name!='settings.json'}}
    if args.mode=='capture':
        assert not (backup/'before.json').exists()
        (backup/'before.json').write_text(json.dumps(state,indent=2,ensure_ascii=False),encoding='utf-8')
        with sqlite3.connect((data/'workbench.sqlite3').as_uri()+'?mode=ro',uri=True) as source, sqlite3.connect(backup/'workbench.sqlite3') as destination:source.backup(destination)
        print(json.dumps({'jobs':state['database']['jobs']['count'],'segments':state['database']['segments']['count'],'mediaFiles':len(state['media']),'mediaBytes':sum(r['bytes'] for r in state['media'].values()),'workerFiles':len(state['worker']),'modelFiles':sum(len(rows)for rows in state['models'].values())}))
    else:
        before=json.loads((backup/'before.json').read_text(encoding='utf-8'))
        assert before['database']==state['database'],'existing SQL rows changed'
        assert before['media']==state['media'],'media file inventory changed'
        # Copying preserves mtime; all worker bytes are also compared.
        assert before['worker']==state['worker'],'legacy worker changed'
        for root,rows in before['models'].items():
            assert all(state['models'][root].get(name)==value for name,value in rows.items()),'existing model files changed'
        assert all(state['settings'].get(key)==value for key,value in before['settings'].items()),'existing settings changed'
        assert all(state['configFiles'].get(key)==value for key,value in before['configFiles'].items()),'other configuration changed'
        receipt={'jobs':state['database']['jobs']['count'],'segments':state['database']['segments']['count'],'mediaFiles':len(state['media']),'mediaBytes':sum(r['bytes']for r in state['media'].values()),'workerFiles':len(state['worker']),'modelFiles':sum(len(rows)for rows in before['models'].values()),'oldSettingsPreserved':True,'oldSqlRowsPreserved':True,'oldMediaInventoryPreserved':True,'oldModelsPreserved':True,'workerByteHashesPreserved':True}
        (backup/'verified.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
if __name__=='__main__':main()
