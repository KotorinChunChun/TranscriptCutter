/** UI default name; comparison data and file formats stay unchanged. */
export function comparisonFileName(names:readonly string[]){
 const bases=names.map(name=>name.replace(/\.vtt$/i,'')).filter(Boolean);
 let prefix=bases[0]??'';for(const name of bases.slice(1)){let length=0;while(length<prefix.length&&length<name.length&&prefix[length]===name[length])length++;prefix=prefix.slice(0,length);}
 prefix=prefix.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[\s_.-]+$/g,'');
 return `${Array.from(prefix||'vtt').slice(0,120).join('')}_比較.compare.json`;
}
