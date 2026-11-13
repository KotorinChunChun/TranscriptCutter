import {useEffect,useState} from 'react';
import {validateRules,type TermRule} from './src/lib/terminology';
const key='tc-terminology-v1',changed='tc-terminology-changed';
export function loadTermRules():TermRule[]{const raw=localStorage.getItem(key);return raw?validateRules(JSON.parse(raw).rules):[];}
export function saveTermRules(rules:TermRule[]){const valid=validateRules(rules);localStorage.setItem(key,JSON.stringify({schemaVersion:1,rules:valid}));window.dispatchEvent(new Event(changed));}
export function learnTermPairs(pairs:{from:string;to:string}[]){const rules=loadTermRules();for(const pair of pairs){const old=rules.find(r=>r.from===pair.from);if(old){old.to=pair.to;old.enabled=true;}else rules.push({id:crypto.randomUUID(),...pair,reading:'',nearKana:false,logic:true,ai:true,enabled:true,note:''});}saveTermRules(rules);}
export function useTermRules(){const [rules,setRules]=useState<TermRule[]>(()=>{try{return loadTermRules();}catch{return [];}});useEffect(()=>{const update=()=>{try{setRules(loadTermRules());}catch{}};window.addEventListener(changed,update);return()=>window.removeEventListener(changed,update);},[]);return rules;}
