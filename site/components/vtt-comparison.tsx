import {SaveMenu} from '@/save-menu';
import {AddMenu} from './add-menu';
import {createPortal} from 'react-dom';
import {comparisonDisplayTime} from '@/comparison-layout';
import {confirmAction} from '@/browser';
"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from "react";
import {
  AlertCircle, AlignLeft, ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowRight,
  Check, CheckCheck, ChevronDown, Columns3, FileText, FolderOpen, Info, Pencil,
  Play, Pause, Plus, RotateCcw, Scissors, Search, SlidersHorizontal, UserRound, X,
} from "lucide-react";
import {
  buildComparisonRows, getComparisonChoice, getComparisonSpeakers,
  getComparisonSummary, removeComparisonSource, setComparisonReference,
  type ComparisonChoice, type ComparisonRow, type ComparisonSession,
  type ComparisonSource, type SpeakerChoice, toggleComparisonText, createEditableComparison, adoptComparisonChoice, adoptAllComparisonText, editComparisonCue,
} from "@/src/lib/comparison";
import { formatTime, type Cue } from "@/src/lib/vtt";
import { getSpeakerParts } from "@/src/lib/editor";
import {buildTimedItemIndex,findActiveTimedItems} from "@/src/lib/transcript-playback";

interface VttComparisonProps {
  session: ComparisonSession | null;
  active: boolean;
  onSample: () => void;
  canSample: boolean;
  onChange: (next: ComparisonSession) => void;
  onAddFiles: () => void;
  onGenerate: () => void;
  onApply: () => void;
  onExportVtt: () => void;
  onSeek: (milliseconds: number) => void;
  canPlay: boolean;
  currentMs: number;
  durationMs: number;
  playing: boolean;
  onTogglePlayback: () => void;
  onScrub: (milliseconds: number) => void;
  busy: boolean;
}

const PAGE_SIZE = 40;
const EMPTY_CUES: Cue[] = [];
const RESERVED_LABELS = new Set(["__proto__", "prototype", "constructor"]);

function nameError(value: string, allowEmpty = false): string {
  if (!allowEmpty && !value.trim()) return "名前を入力してください。";
  if (value.trim().length > 80) return "名前は80文字以内で入力してください。";
  if (/[\u0000-\u001f]/.test(value)) return "名前に制御文字は使用できません。";
  return "";
}

function rawAlias(session: ComparisonSession, sourceId: string, label: string): string {
  const aliases = session.speakerAliases[sourceId];
  return aliases && Object.prototype.hasOwnProperty.call(aliases, label) ? aliases[label] : "";
}

function speakerLabel(session: ComparisonSession, source: ComparisonSource, label: string | null): string {
  if (label === null) return "話者情報なし";
  const aliases = session.speakerAliases[source.id];
  const ownAlias = (name: string) => aliases && Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : undefined;
  if (ownAlias(label)) return ownAlias(label)!;
  const parts = getSpeakerParts(label);
  return parts.length > 1 && parts.some(part => ownAlias(part)) ? parts.map(part => ownAlias(part) || part).join(" / ") : label;
}

function matchesSpeaker(choice: SpeakerChoice, sourceId: string, label: string | null): boolean {
  return choice !== null && "sourceId" in choice && choice.sourceId === sourceId && choice.label === label;
}

function candidateSignature(cues: Cue[]): string {
  return JSON.stringify(cues.map(cue => [cue.start, cue.end, cue.text, cue.speaker, !!cue.isMultiVoice]));
}

function ModelName({ name, onCommit, disabled }: { name: string; onCommit: (value: string) => void; disabled: boolean }) {
  const [error, setError] = useState("");
  const commit = (input: HTMLInputElement) => {
    const value = input.value.trim();
    const error = nameError(input.value);
    setError(error);
    if (error) return;
    if (value && value !== name) onCommit(value);
    else input.value = name;
  };
  return <div className="comparison-model-name-field"><label className="comparison-model-name">
    <input key={name} aria-label={`${name}のモデル名`} title="モデル名を変更" maxLength={80} defaultValue={name} disabled={disabled}
      aria-invalid={!!error} onChange={() => setError("")} onBlur={event => commit(event.currentTarget)}
      onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = name; event.currentTarget.blur(); } }}/>
    <Pencil size={12} aria-hidden="true"/>
  </label>{error && <span className="comparison-input-error" role="alert">{error}</span>}</div>;
}

function AliasInput({ sourceName, label, value, onCommit, disabled }: {
  sourceName: string; label: string; value: string; onCommit: (value: string) => void; disabled: boolean;
}) {
  const [error, setError] = useState("");
  const commit = (input: HTMLInputElement) => {
    const next = input.value.trim();
    const error = nameError(input.value, true) || (next && RESERVED_LABELS.has(label) ? "このラベルは区間の「話者名を指定」で変更してください。" : "");
    setError(error);
    if (!error && next !== value) onCommit(next);
  };
  return <div className="comparison-alias-row">
    <span className="comparison-alias-original">{label}</span>
    <ArrowRight size={12} aria-hidden="true"/>
    <input key={value} aria-label={`${sourceName}の${label}の共通話者名`} placeholder="共通の名前" defaultValue={value} maxLength={80} disabled={disabled}
      aria-invalid={!!error} onChange={() => setError("")} onBlur={event => commit(event.currentTarget)}
      onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); } }}/>
    {error && <span className="comparison-input-error" role="alert">{error}</span>}
  </div>;
}

function CustomSpeaker({ value, onCommit, disabled, rowTime }: {
  value: string; onCommit: (name: string) => void; disabled: boolean; rowTime: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  return <div className="comparison-custom-speaker">
    {!open ? <button type="button" className={`comparison-text-button${value ? " is-custom" : ""}`} disabled={disabled}
      aria-label={`${rowTime}の話者名を直接指定`} aria-expanded={false} onClick={() => { setDraft(value); setError(""); setOpen(true); }}>
      <Pencil size={12}/>{value ? "話者名を変更" : "話者名を指定"}
    </button> : <form onSubmit={event => { event.preventDefault(); const error = nameError(draft); setError(error); if (!error) { onCommit(draft.trim()); setOpen(false); } }}>
      <input ref={inputRef} aria-label={`${rowTime}の採用する話者名`} value={draft} maxLength={80} placeholder="話者名を入力" disabled={disabled}
        aria-invalid={!!error} onChange={event => { setDraft(event.target.value); setError(""); }} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Escape") setOpen(false); }}/>
      <button className="comparison-text-button" type="submit" disabled={disabled || !draft.trim()}><Check size={13}/>設定</button>
      <button className="comparison-mini-icon" type="button" aria-label="話者名の入力を閉じる" onClick={() => setOpen(false)}><X size={13}/></button>
      {error && <span className="comparison-input-error" role="alert">{error}</span>}
    </form>}
  </div>;
}

function SpeakerResult({ session, row, choice }: { session: ComparisonSession; row: ComparisonRow; choice: ComparisonChoice }) {
  if (choice.speaker && "custom" in choice.speaker) return <><strong>{choice.speaker.custom}</strong><span className="comparison-result-origin">指定した名前</span></>;
  if (choice.speaker && "sourceId" in choice.speaker) {
    const selected = choice.speaker;
    const source = session.sources.find(item => item.id === selected.sourceId);
    return source ? <><strong>{speakerLabel(session, source, selected.label)}</strong><span className="comparison-result-origin">{source.name}</span></> : <>字幕と同じ</>;
  }
  const source = session.sources.find(item => item.id === (choice.outputSourceId??choice.textSourceId));
  const cues = source ? row.candidates[source.id] || [] : [];
  if (!source || !cues.length) return <span className="comparison-result-origin">字幕と同じ</span>;
  if (cues.some(cue => cue.isMultiVoice)) return <><strong>字幕内の話者</strong><span className="comparison-result-origin">元の区分を保持</span></>;
  const labels = [...new Set(cues.map(cue => speakerLabel(session, source, cue.speaker)))];
  return <><strong>{labels.join(" / ")}</strong><span className="comparison-result-origin">字幕と同じ</span></>;
}

function Candidate({ session, row, source, choice, onChoice, canPlay, onSeek, busy, simple=false }: {
  session: ComparisonSession; row: ComparisonRow; source: ComparisonSource; choice: ComparisonChoice;
  onChoice: (next: ComparisonChoice) => void; canPlay: boolean; onSeek: (ms: number) => void; busy: boolean; simple?:boolean;
}) {
  const cues = row.candidates[source.id] || EMPTY_CUES;
  const textSelected = choice.textSourceId === source.id;
  const labels: (string | null)[] = useMemo(() => {
    const known = getComparisonSpeakers({ ...source, cues });
    return cues.some(cue => cue.speaker === null && !cue.isMultiVoice) ? [...known, null] : known;
  }, [source, cues]);
  const speakerSelected = choice.speaker !== null && "sourceId" in choice.speaker && choice.speaker.sourceId === source.id;

  if(simple)return <button type="button" className={`comparison-candidate comparison-text-only${textSelected?' text-selected':''}${!cues.length?' no-candidate':''}`} data-source-id={source.id} aria-pressed={textSelected} aria-label={`${formatTime(row.start,true)} ${source.name}の字幕を${textSelected?'採用解除':'採用'}`} disabled={busy||!cues.length} onClick={()=>onChoice(toggleComparisonText(session,row,source.id,true))}>{textSelected&&<span className="comparison-selected-mark" aria-hidden="true">✓</span>}{cues.length?cues.map(cue=><span className="comparison-simple-text" key={cue.id}>{cue.text}</span>):<span>—</span>}</button>;

  return <div className={`comparison-candidate${textSelected ? " text-selected" : ""}${speakerSelected ? " speaker-selected" : ""}${!cues.length ? " no-candidate" : ""}`}
    data-source-id={source.id} data-text-selected={textSelected || undefined}>
    {!cues.length ? <div className="comparison-candidate-empty" title="字幕は時間の重なりが最大の行に1回だけ配置します。長い字幕は前後の行に表示される場合があります。"><span aria-hidden="true">—</span><p>この行の候補なし</p></div> : <>
      <div className="comparison-candidate-action">
        <button type="button" className={`comparison-adopt-text${textSelected ? " selected" : ""}`} aria-pressed={textSelected} disabled={busy}
          aria-label={`${formatTime(row.start, true)} ${source.name}の字幕を採用`}
          onClick={() => onChoice(toggleComparisonText(session,row,source.id,false))}>
          {textSelected ? <Check size={14}/> : <AlignLeft size={14}/>}{textSelected ? "字幕を採用中" : "この字幕を採用"}
        </button>
        {cues.length > 1 && <span className="comparison-cue-count">{cues.length}字幕</span>}
      </div>
      <div className="comparison-cues">
        {cues.map(cue => <div className="comparison-cue" key={cue.id}>
          <div className="comparison-cue-meta">
            <button type="button" className="comparison-cue-time" disabled={!canPlay || busy} onClick={() => onSeek(cue.start)}
              aria-label={`${source.name}の字幕 ${formatTime(cue.start, true)}から再生`}
              title={canPlay ? "この字幕の開始位置を再生" : "動画を追加すると、この時刻を再生できます"}>
              {canPlay && <Play size={10}/>}<span>{formatTime(cue.start, true)}<span className="comparison-time-dash">–</span>{formatTime(cue.end, true)}</span>
            </button>
            <span className="comparison-original-speaker">{cue.isMultiVoice ? "複数話者" : speakerLabel(session, source, cue.speaker)}</span>
          </div>
          <p className="comparison-cue-text">{cue.text}</p>
        </div>)}
      </div>
      <div className="comparison-speaker-choices" aria-label={`${source.name}の話者候補`}>
        <span className="comparison-speaker-caption"><UserRound size={12}/>話者</span>
        {labels.map(label => {
          const selected = matchesSpeaker(choice.speaker, source.id, label);
          return <button key={label ?? "__no_speaker__"} type="button" className={`comparison-adopt-speaker${selected ? " selected" : ""}`} disabled={busy} aria-pressed={selected}
            aria-label={`${formatTime(row.start, true)} ${source.name}の話者「${speakerLabel(session, source, label)}」を採用`}
            title={`${source.name} · ${label ?? "話者情報なし"}の話者を採用`}
            onClick={() => onChoice({ ...choice, speaker: { sourceId: source.id, label } })}>
            {selected ? <Check size={12}/> : <Plus size={11}/>}<span>{speakerLabel(session, source, label)}</span>
          </button>;
        })}
        {!labels.length && <span className="comparison-multivoice-note">字幕内の話者区分を保持</span>}
      </div>
    </>}
  </div>;
}

export function VttComparison({ session, active, onSample, canSample, onChange, onAddFiles, onGenerate, onApply, onExportVtt, onSeek, canPlay, currentMs, durationMs, playing, onTogglePlayback, onScrub, busy }: VttComparisonProps) {
  const [query, setQuery] = useState("");
  const [simple,setSimple]=useState(()=>{try{return localStorage.getItem('tc-comparison-view')!=='detail';}catch{return true;}});
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [display, setDisplay] = useState({ key: "", count: PAGE_SIZE });
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [followPlayback,setFollowPlayback]=useState(true);
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set()),[editError,setEditError]=useState('');
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const headingScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const sources = session?.sources;
  const referenceId = session?.referenceId;
  // Alignment depends only on source cues and the reference, never row choices.
  const rows = useMemo(() => sources && referenceId ? buildComparisonRows({ schemaVersion: 1, kind: "vtt-dialogue-comparison", sources, referenceId, choices: {}, speakerAliases: {} }) : [], [sources, referenceId]);
  const summary = useMemo(() => session ? getComparisonSummary(session, rows) : null, [session, rows]);
  const adoptedEnd = useMemo(() => session ? rows.reduce((latest, row) => {
    const choice=getComparisonChoice(session,row),sourceId=choice.outputSourceId??choice.textSourceId;
    return sourceId ? (row.candidates[sourceId] || []).reduce((end, cue) => Math.max(end, cue.end), latest) : latest;
  }, 0) : 0, [session, rows]);
  const sourceIdentity = JSON.stringify(sources?.map(source => source.id) || []);
  const displayKey = JSON.stringify([query, differencesOnly, sourceIdentity, referenceId]);
  const visibleCount = display.key === displayKey ? display.count : PAGE_SIZE;
  const sourceSpeakers = useMemo(() => aliasesOpen && sources ? Object.fromEntries(sources.map(source => [source.id, getComparisonSpeakers(source)])) : {}, [sources, aliasesOpen]);
  const filteredRows = useMemo(() => {
    if (!sources) return [];
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter(row => {
      if (differencesOnly && sources.length > 1) {
        const signatures = sources.map(source => candidateSignature(row.candidates[source.id] || []));
        if (signatures.every(signature => signature === signatures[0])) return false;
      }
      if (!needle) return true;
      return `${formatTime(row.start, true)} ${formatTime(row.end, true)}`.includes(needle) || sources.some(source =>
        (row.candidates[source.id] || []).some(cue => `${source.name}\n${cue.text}\n${cue.speaker || ""}\n${session?.speakerAliases[source.id]?.[cue.speaker || ""] || ""}\n${formatTime(cue.start, true)}\n${formatTime(cue.end, true)}`.toLocaleLowerCase().includes(needle)));
    });
  }, [rows, sources, query, differencesOnly, session?.speakerAliases]);

  const speakerRuns=useMemo(()=>{
    const result=new Map<string,{key:string;label:string;first:boolean;count:number}>();
    if(!session)return result;
    let run:{key:string;label:string;ids:string[]}|null=null;
    const finish=()=>{if(run)run.ids.forEach((id,index)=>result.set(id,{key:run!.key,label:run!.label,first:index===0,count:run!.ids.length}));};
    for(const row of filteredRows){
      const choice=getComparisonChoice(session,row),speaker=simple?null:choice.speaker;
      const picked=speaker&&'sourceId' in speaker?speaker.sourceId:choice.outputSourceId??choice.textSourceId;
      const source=session.sources.find(s=>s.id===picked),cues=picked?row.candidates[picked]??[]:[];
      const label=!choice.textSourceId?'字幕なし':speaker&&'custom' in speaker?speaker.custom:source?(speaker&&'sourceId' in speaker?speakerLabel(session,source,speaker.label):[...new Set(cues.map(c=>speakerLabel(session,source,c.speaker)))].join(' / ')||'話者情報なし'):'話者情報なし';
      if(!run||run.label!==label){finish();run={key:row.id,label,ids:[]};}run.ids.push(row.id);
    }finish();return result;
  },[filteredRows,session,simple]);
  const playbackRows=useMemo(()=>buildTimedItemIndex(filteredRows),[filteredRows]);
  const activeRow=canPlay?findActiveTimedItems(playbackRows,currentMs)[0]:undefined;
  const rowIndices=useMemo(()=>new Map(filteredRows.map((row,index)=>[row.id,index])),[filteredRows]);
  const seekRow=(ms:number)=>{setFollowPlayback(true);onSeek(ms);};
  useEffect(()=>{
    if(!followPlayback||!activeRow)return;
    const index=rowIndices.get(activeRow.id)??0;
    if(index>=visibleCount){setDisplay({key:displayKey,count:Math.min(filteredRows.length,Math.ceil((index+1)/PAGE_SIZE)*PAGE_SIZE)});return;}
    const run=speakerRuns.get(activeRow.id);
    if(run&&collapsed.has(run.key)){setCollapsed(old=>{const next=new Set(old);next.delete(run.key);return next;});return;}
    const frame=timelineScrollRef.current;
    const node=frame?.querySelector<HTMLElement>('[data-comparison-row="'+CSS.escape(activeRow.id)+'"]');
    if(frame&&node){const box=node.getBoundingClientRect(),viewport=frame.getBoundingClientRect();if(box.top<viewport.top||box.bottom>viewport.bottom)frame.scrollTop+=box.top-viewport.top-Math.max(0,(frame.clientHeight-node.clientHeight)/2);}
  },[activeRow?.id,followPlayback,visibleCount,displayKey,rowIndices,speakerRuns,collapsed,filteredRows.length]);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || visibleCount >= filteredRows.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setDisplay(current => ({ key: displayKey, count: Math.min(filteredRows.length, (current.key === displayKey ? current.count : PAGE_SIZE) + PAGE_SIZE) }));
    }, { root: timelineScrollRef.current, rootMargin: "700px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, filteredRows.length, displayKey]);

  const syncScroll = (event: UIEvent<HTMLDivElement>, other: HTMLDivElement | null) => {
    if (other && Math.abs(other.scrollLeft - event.currentTarget.scrollLeft) > 1) other.scrollLeft = event.currentTarget.scrollLeft;
  };
  const update=(action:()=>ComparisonSession)=>{try{onChange(action());setEditError('');}catch(error){setEditError(error instanceof Error?error.message:String(error));}};
  const choose = (row:ComparisonRow,next:ComparisonChoice)=>{if(!session)return;update(()=>adoptComparisonChoice(session,row,next));setAnnouncement(formatTime(row.start,true)+'の採用内容を更新しました');};
  const adoptAllText=(source:ComparisonSource)=>{if(session)update(()=>adoptAllComparisonText(session,source.id,simple));};
  const resetSpeakers = () => {
    if (!session) return;
    const choices: ComparisonSession["choices"] = {};
    for (const row of rows) choices[row.id] = { ...getComparisonChoice(session, row), speaker: null };
    onChange({ ...session, choices });
    setAnnouncement("すべての話者を採用した字幕に合わせました");
  };
  const changeReference = async (id: string) => {
    if (!session || id === session.referenceId) return;
    const nextSource = session.sources.find(source => source.id === id);
    if (!nextSource) return;
    if (!(await confirmAction(`時間軸の基準を「${nextSource.name}」に変更します。行の区切りと採用内容を初期化し、このモデルの字幕を採用します。変更しますか？`))) return;
    onChange(setComparisonReference(session, id));
    setAnnouncement(`時間軸の基準を${nextSource.name}に変更しました`);
  };
  const removeSource = async (source: ComparisonSource) => {
    if (!session || session.sources.length <= 1) return;
    const hasSelections = rows.some(row => {
      const choice = getComparisonChoice(session, row);
      return (choice.textSourceId === source.id || choice.outputSourceId === source.id) || (choice.speaker && "sourceId" in choice.speaker && choice.speaker.sourceId === source.id);
    });
    const removingReference = session.referenceId === source.id;
    if ((hasSelections || removingReference) && !(await confirmAction(removingReference
      ? `「${source.name}」を比較から外します。時間軸の基準が変わるため、残るモデルの先頭を基準に採用内容を初期化します。外しますか？`
      : `「${source.name}」を比較から外します。このモデルから採用した字幕は未採用に戻り、話者の指定は解除されます。外しますか？`))) return;
    onChange(removeComparisonSource(session, source.id));
    setAnnouncement(`${source.name}を比較から外しました`);
  };
  const renameSource = (sourceId: string, name: string) => {
    if (!session) return;
    onChange({ ...session, sources: session.sources.map(source => source.id === sourceId ? { ...source, name } : source) });
  };
  const updateAlias = (sourceId: string, label: string, value: string) => {
    if (!session) return;
    const aliases: Record<string, string> = Object.assign(Object.create(null), session.speakerAliases[sourceId]);
    if (value) aliases[label] = value;
    else delete aliases[label];
    onChange({ ...session, speakerAliases: { ...session.speakerAliases, [sourceId]: aliases } });
  };

  const addCustom=async()=>{if(!session)return;if(session.sources.some(source=>source.editable))return;if(session.sources.some(source=>source.generated)&&!(await confirmAction('現在のカスタム列を採用結果から作り直します。必要な比較は先に保存してください。')))return;update(()=>createEditableComparison(session));};
  const draftCell=(source:ComparisonSource,row:ComparisonRow)=>{
    const cues=row.candidates[source.id]??[],choice=getComparisonChoice(session!,row),selected=choice.textSourceId===source.id||choice.outputSourceId===source.id;
    return <div className={'comparison-draft-cell'+(selected?' text-selected':'')} key={source.id}>
      <button className="comparison-edit-adopt" aria-label={formatTime(row.start,true)+' '+source.name+'の字幕を'+(selected?'採用解除':'採用')} aria-pressed={selected} disabled={busy||!cues.some(cue=>cue.text.trim())} onClick={()=>choose(row,toggleComparisonText(session!,row,source.id,simple))}>{selected?'✓':'採用'}</button>
      {(cues.length?cues:[null]).map((cue,index)=><textarea key={index} aria-label={source.name+' '+formatTime(cue?.start??row.start,true)+'の本文'} rows={2} value={cue?.text??''} placeholder="本文を編集" disabled={busy} onChange={event=>update(()=>editComparisonCue(session!,row,source.id,cue?.id,event.target.value))}/>)}</div>;
  };
  const transport=<div className="comparison-transport" role="region" aria-label="字幕比較の再生">
    <button className="button secondary small" disabled={!canPlay||busy} aria-label={playing?'比較再生を一時停止':'比較を再生'} onClick={onTogglePlayback}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>
    <time aria-label="比較の再生位置" title={formatTime(currentMs,true)}>{comparisonDisplayTime(currentMs)}</time>
    <input type="range" aria-label="字幕比較のシークバー" min={0} max={Math.max(1,durationMs)} step={1} value={Math.min(currentMs,Math.max(1,durationMs))} disabled={!canPlay||busy} onChange={event=>{setFollowPlayback(true);onScrub(Number(event.target.value));}}/>
    <time title={formatTime(durationMs,true)}>{comparisonDisplayTime(durationMs)}</time>
    <label><input type="checkbox" checked={followPlayback} onChange={event=>setFollowPlayback(event.target.checked)}/>再生箇所を追う</label>
  </div>;
  const addition=<AddMenu disabled={busy} label="比較列を追加" items={[
    {label:'VTTを貼り付け',disabled:(sources?.filter(source=>!source.generated).length??0)>=3,run:onAddFiles},
    {label:'カスタム',disabled:!session||session.sources.some(source=>source.editable),run:()=>void addCustom()},
    {label:'AI生成',disabled:!session,run:onGenerate},
  ]}/>;
  const header=<div className="comparison-workspace-heading">
    {!!sources?.length&&<div className="comparison-title"><span className="comparison-heading-icon"><Columns3 size={19}/></span><span className="comparison-source-count">{sources.filter(source=>!source.generated).length}字幕{sources.some(source=>source.generated)&&<>・カスタム1列</>}</span></div>}
    {canPlay?transport:<span className="comparison-media-drop-hint" title="ここに動画(mp4)をドロップして読込">ここに動画(mp4)をドロップして読込</span>}
    <div className="comparison-primary-actions"><SaveMenu stage={2} active={active} className="button primary small"/><button type="button" className="button primary small" disabled={busy||!summary?.cueCount} onClick={onApply}>会話編集に反映<ArrowRight size={14}/></button></div>
  </div>;
  if (!session || !sources?.length || !summary) return <section className="vtt-comparison comparison-empty-workspace" aria-label="字幕比較">
    {header}<div className="comparison-drop-content"><span>ここに字幕(vtt)および元にした動画(mp4)をドロップ</span><div className="comparison-empty-actions">{canSample&&<button className="button secondary" disabled={busy} onClick={onSample}>サンプル</button>}{addition}</div></div>
  </section>;

  const warnings = [...new Set([...summary.warnings, ...sources.flatMap(source => source.warnings.map(warning => `${source.name}：${warning}`))])];
  const aliasCount = Object.values(session.speakerAliases).reduce((total, map) => total + Object.values(map).filter(Boolean).length, 0);
  const hasSpeakerOverrides = rows.some(row => getComparisonChoice(session, row).speaker !== null);
  const shownRows = filteredRows.slice(0, visibleCount);
  const timelineStyle = { "--comparison-columns": sources.length } as CSSProperties;

  return <section className={`vtt-comparison comparison-layout-preview${simple?" comparison-simple":""}`} aria-label="字幕比較" style={timelineStyle}>
    {header}

    <div className="comparison-tools"><div className="action-group comparison-view-toggle" role="group" aria-label="比較の表示"><button className="button secondary small" aria-pressed={simple} onClick={()=>{setSimple(true);localStorage.setItem('tc-comparison-view','simple');}}>簡易</button><button className="button secondary small" aria-pressed={!simple} onClick={()=>{setSimple(false);localStorage.setItem('tc-comparison-view','detail');}}>詳細</button></div>
      <label className="comparison-search"><Search size={15}/><input type="search" placeholder="字幕・話者・時刻を検索" value={query} onChange={event => setQuery(event.target.value)} aria-label="比較中の字幕を検索"/>{query && <button type="button" aria-label="検索をクリア" onClick={() => setQuery("")}><X size={13}/></button>}</label>
      <label className="comparison-difference-toggle"><input type="checkbox" checked={differencesOnly} disabled={sources.length < 2} onChange={event => setDifferencesOnly(event.target.checked)}/><span>差分のみ</span></label>
      <div className="comparison-tools-divider"/>
      <label className="comparison-reference"><span>時間軸の基準</span><select value={session.referenceId} disabled={busy || sources.length < 2} onChange={event => changeReference(event.target.value)}>{sources.filter(source=>!source.editable).map(source => <option value={source.id} key={source.id}>{source.name}</option>)}</select><ChevronDown size={12}/></label>
      <span className="comparison-selection-count"><CheckCheck size={14}/><strong>{summary.selectedRowCount.toLocaleString()}</strong> / {rows.length.toLocaleString()} 区間を採用</span>
    </div>

    <details className="comparison-alias-panel" open={aliasesOpen} onToggle={event => setAliasesOpen(event.currentTarget.open)}>
      <summary><SlidersHorizontal size={14}/><span>話者名の対応</span>{aliasCount > 0 && <span className="comparison-alias-count">{aliasCount}件設定</span>}<span className="comparison-alias-summary-help">同じ人物の名前をそろえる</span><ChevronDown size={13} className="comparison-details-chevron"/></summary>
      {aliasesOpen && <div className="comparison-alias-content">
        <p>各モデルの話者に同じ名前を設定すると、同一人物として扱います。未設定の同名ラベルは、モデルごとに区別して書き出します。</p>
        <div className="comparison-alias-grid">
          {sources.map((source, index) => <div className={`comparison-alias-model model-${index}`} key={source.id}>
            <h3><span className="comparison-model-dot"/>{source.name}</h3>
            {sourceSpeakers[source.id]?.length ? sourceSpeakers[source.id].map(label => <AliasInput key={label} sourceName={source.name} label={label} value={rawAlias(session, source.id, label)} onCommit={value => updateAlias(source.id, label, value)} disabled={busy}/>) : <p className="comparison-alias-empty">話者情報がありません</p>}
          </div>)}
        </div>
      </div>}
    </details>

    {warnings.length > 0 && <details className="comparison-warnings"><summary><AlertCircle size={15}/><span>確認事項 {warnings.length}件</span><span className="comparison-warning-preview">{warnings[0]}</span><ChevronDown size={13}/></summary><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}

    <div className="comparison-timeline-caption"><span>基準VTTの区間ごとに整列 · 各字幕は元の開始・終了時刻で採用 <span className="comparison-alignment-help" tabIndex={0} aria-label="字幕は分割せず、時間の重なりが最大の行に1回だけ配置します。長い字幕は前後の行に表示される場合があります。" title="字幕は分割せず、時間の重なりが最大の行に1回だけ配置します。長い字幕は前後の行に表示される場合があります。"><Info size={11}/></span></span><div className="comparison-legend"><span><i/>字幕</span><span><i/>話者</span></div></div>
    <div className="comparison-grid-frame">
      <div className="comparison-heading-scroll" ref={headingScrollRef} onScroll={event => syncScroll(event, timelineScrollRef.current)}>
        <div className="comparison-grid comparison-column-headers">
          <div className="comparison-speaker-heading"><span>話者</span></div><div className="comparison-axis-heading"><span>時刻</span></div>
          {sources.map((source, index) => <div className={`comparison-model-header model-${index}`} key={source.id}>
            <div className="comparison-model-top"><span className="comparison-model-index">{String.fromCharCode(65 + index)}</span><ModelName name={source.name} onCommit={value => renameSource(source.id, value)} disabled={busy}/><button type="button" className="comparison-mini-icon comparison-remove-source" aria-label={`${source.name}を比較から外す`} title={sources.length <= 1 ? "VTTを1つ以上残してください" : "このモデルを比較から外す"} disabled={busy || sources.length <= 1 || (!source.generated&&sources.filter(item=>!item.generated).length===1)} onClick={() => removeSource(source)}><X size={14}/></button></div>
            {source.editable&&<span className="comparison-draft-badge">カスタム・編集可能</span>}<span className="comparison-model-file" title={source.fileName}><FileText size={11}/>{source.fileName}</span>
            <div className="comparison-model-meta"><span>{source.cues.length.toLocaleString()}字幕</span>{source.id === session.referenceId && <span className="comparison-reference-badge">時間軸の基準</span>}</div>
            <button type="button" className="comparison-bulk-adopt" disabled={busy} aria-label={`${source.name}をすべて採用`} onClick={() => adoptAllText(source)}><CheckCheck size={13}/>すべて採用</button>
          </div>)}
          <div className="comparison-add-header">{addition}</div>
        </div>
      </div>
      <div className="comparison-timeline-scroll" ref={timelineScrollRef} onScroll={event => syncScroll(event, headingScrollRef.current)} onWheel={event=>{if(event.deltaY)setFollowPlayback(false);}} onKeyDown={event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)&&event.target===event.currentTarget)setFollowPlayback(false);}} onPointerDown={event=>{if(event.target===event.currentTarget)setFollowPlayback(false);}} tabIndex={0} aria-label="字幕の比較タイムライン。横にスクロールできます。">
        <div className="comparison-timeline">
          {shownRows.map(row => {
            const run=speakerRuns.get(row.id);if(run&&!run.first&&collapsed.has(run.key))return null;
            const choice = getComparisonChoice(session, row);
            const chosenSource = sources.find(source => source.id === (choice.outputSourceId??choice.textSourceId));
            const rowTime = formatTime(row.start, true);
            return <section className={`comparison-row${expanded.has(row.id)?" row-details":""}${!choice.textSourceId ? " row-skipped" : ""}${canPlay&&currentMs>=row.start&&currentMs<row.end?" row-playhead"+(playing?" row-playing":""):""}`} key={row.id} data-comparison-row={row.id} aria-label={`${rowTime}からの比較区間`}>
              <div className="comparison-grid">
                <div className="comparison-speaker-cell">{run?.first&&<button aria-label={run.label+' '+run.count+'発言を'+(collapsed.has(run.key)?'展開':'折りたたむ')} aria-expanded={!collapsed.has(run.key)} disabled={run.count<2} onClick={()=>{setFollowPlayback(false);setCollapsed(old=>{const next=new Set(old);if(next.has(run.key))next.delete(run.key);else next.add(run.key);return next;});}}><span>{run.count>1?(collapsed.has(run.key)?'▸':'▾'):''}{run.label}</span>{run.count>1&&<small>{run.count}発言</small>}</button>}</div><div className="comparison-time-axis"><button type="button" onClick={() => seekRow(row.start)} disabled={!canPlay || busy} aria-label={`元動画の${rowTime}から再生`}><time title={rowTime}>{comparisonDisplayTime(row.start)}</time><span className="comparison-axis-end">{comparisonDisplayTime(row.end)}</span>{canPlay && <span className="comparison-axis-play"><Play size={10}/>再生</span>}</button>{!row.referenceCueId && <span className="comparison-extra-row">基準外の字幕</span>}</div>
                {sources.map(source => source.editable?draftCell(source,row):<Candidate key={source.id} session={session} row={row} source={source} choice={choice} onChoice={next => choose(row, next)} canPlay={canPlay} onSeek={seekRow} busy={busy} simple={simple&&!expanded.has(row.id)}/>)}
                <div className="comparison-side-details">{simple&&<button className="comparison-text-button" aria-expanded={expanded.has(row.id)} onClick={()=>setExpanded(old=>{const next=new Set(old);if(next.has(row.id))next.delete(row.id);else next.add(row.id);return next;})}>{expanded.has(row.id)?'閉じる':'詳細'}</button>}</div>
              </div>
              <div className="comparison-result-bar">
                <span className={`comparison-result-state${choice.textSourceId ? " adopted" : ""}`}>{choice.textSourceId ? <Check size={13}/> : <span className="comparison-skip-dot"/>}{choice.textSourceId ? "採用" : "未採用"}</span>
                <div className="comparison-result-details"><span className="comparison-result-text"><AlignLeft size={12}/>{chosenSource ? <strong>{chosenSource.name}</strong> : <span>字幕なし</span>}</span><span className={`comparison-result-speaker${choice.speaker ? " overridden" : ""}`}><UserRound size={12}/><SpeakerResult session={session} row={row} choice={choice}/></span></div>
                <div className="comparison-row-actions"><button type="button" className={`comparison-text-button${choice.speaker === null ? " current" : ""}`} disabled={busy || choice.speaker === null} aria-label={`${rowTime}の話者を字幕と同じにする`} onClick={() => choose(row, { ...choice, speaker: null })}><RotateCcw size={11}/>字幕と同じ</button><CustomSpeaker rowTime={rowTime} value={choice.speaker && "custom" in choice.speaker ? choice.speaker.custom : ""} disabled={busy} onCommit={name => choose(row, { ...choice, speaker: { custom: name } })}/></div>
              </div>
            </section>;
          })}
          {!filteredRows.length && <div className="comparison-no-results"><Search size={24}/><h3>該当する区間がありません</h3><p>{differencesOnly ? "差分のみの表示や、検索条件を変更してください。" : "別の言葉・話者名・時刻で検索してください。"}</p><button type="button" className="button secondary small" onClick={() => { setQuery(""); setDifferencesOnly(false); }}>絞り込みを解除</button></div>}
        </div>
    <div className="comparison-load-more" ref={loadMoreRef}>{visibleCount < filteredRows.length ? <button type="button" className="button secondary small" onClick={() => setDisplay({ key: displayKey, count: Math.min(filteredRows.length, visibleCount + PAGE_SIZE) })}><ArrowDown size={13}/>スクロールして続きを表示<span>{Math.min(visibleCount, filteredRows.length).toLocaleString()} / {filteredRows.length.toLocaleString()}</span></button> : <span>{filteredRows.length.toLocaleString()}区間を表示{filteredRows.length !== rows.length ? ` / 全${rows.length.toLocaleString()}区間` : " · 最後まで表示しています"}</span>}<span className="comparison-pan-hint"><ArrowLeftRight size={12}/>横にスクロールして比較</span></div>
      </div>
    </div>



    <div className="comparison-bottom-bar"><div className="comparison-bottom-summary"><div className="comparison-bottom-summary-main"><span className="comparison-bottom-stat"><CheckCheck size={15}/><strong>{summary.cueCount.toLocaleString()}</strong> 字幕を採用</span>{summary.cueCount > 0 && <span className="comparison-end-time"><Scissors size={12}/>採用VTTの終了 <time>{comparisonDisplayTime(adoptedEnd)}</time></span>}</div>{summary.cueCount > 0 && <p className="comparison-bottom-note">会話編集に反映後も、字幕のない末尾は標準で保持します。</p>}<p className="comparison-bottom-note">検索・差分表示にかかわらず、採用した全区間を書き出します。</p></div><button type="button" className="comparison-text-button" disabled={busy || !hasSpeakerOverrides} onClick={resetSpeakers}><RotateCcw size={12}/>すべての話者を字幕に合わせる</button></div>
    {editError&&<p role="alert" className="field-error">{editError}</p>}
    <div className="comparison-live-status" aria-live="polite" aria-atomic="true">{announcement}</div>
  </section>;
}
