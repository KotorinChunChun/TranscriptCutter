export const RESTORE_POINT_LIMIT=10;
export const restorePointPrefix=(workspace:string)=>`restore-point:${encodeURIComponent(workspace)}:`;
export function pointsToKeep<T extends {key:string;createdAt:number}>(points:readonly T[]):T[]{
 return [...points].sort((a,b)=>b.createdAt-a.createdAt||b.key.localeCompare(a.key)).slice(0,RESTORE_POINT_LIMIT);
}
