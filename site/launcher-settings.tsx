import {useEffect,useState} from 'react';
export function LauncherSettingsLink(){
 const [url,setUrl]=useState('');
 useEffect(()=>{void fetch('/launcher').then(async response=>{if(response.ok){const value=await response.json();if(typeof value.setupUrl==='string'&&/^http:\/\/127\.0\.0\.1:\d+\/$/.test(value.setupUrl))setUrl(value.setupUrl);}}).catch(()=>{});},[]);
 return url?<a className="setup-link" href={url} target="_blank" rel="noopener noreferrer">利用方式</a>:null;
}
