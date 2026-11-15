export type Bookmark = {id:string;start:number;end:number;name:string;note:string};
export type ReviewMarks = {bookmarks?:Bookmark[];reviewed?:string[]};

/** Input cuts must be sorted, disjoint source-time ranges. */
export function bookmarksAfterCuts(bookmarks:readonly Bookmark[],cuts:readonly {start:number;end:number}[],duration:number):Bookmark[]{
 const at=(ms:number)=>ms-cuts.reduce((sum,c)=>sum+Math.max(0,Math.min(ms,c.end)-c.start),0);
 return bookmarks.flatMap(b=>{
  if(b.start>duration)return [];
  const end=Math.min(duration,b.end),start=at(b.start),finish=at(end);
  if(b.end===b.start?cuts.some(c=>b.start>=c.start&&b.start<c.end):finish<=start)return [];
  return [{...b,start,end:finish}];
 });
}

export function readReviewMarks(value:ReviewMarks):ReviewMarks {
  const bookmarks=value.bookmarks??[], reviewed=value.reviewed??[];
  if(!Array.isArray(bookmarks)||bookmarks.length>10000||!Array.isArray(reviewed)||reviewed.length>200000)throw Error('確認記録の形式が正しくありません。');
  const ids=new Set<string>();
  for(const b of bookmarks){
    if(!b||typeof b.id!=='string'||!b.id||b.id.length>200||ids.has(b.id)||!Number.isSafeInteger(b.start)||!Number.isSafeInteger(b.end)||b.start<0||b.end<b.start||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||typeof b.note!=='string'||b.note.length>4000)throw Error('ブックマークの形式が正しくありません。');
    ids.add(b.id);
  }
  if(reviewed.some(k=>typeof k!=='string'||k.length>200))throw Error('確認済み記録の形式が正しくありません。');
  return {bookmarks:bookmarks.map(b=>({...b})).sort((a,b)=>a.start-b.start),reviewed:[...new Set(reviewed)]};
}
