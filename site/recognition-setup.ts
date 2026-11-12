export type SetupStep=1|2|3|4;
export function recognitionSetup({connected,ready,modelSelected,methodSelected,hasFile,busy}:{connected:boolean;ready?:boolean;modelSelected:boolean;methodSelected:boolean;hasFile:boolean;busy:boolean}){
 const modelReady=connected&&ready!==false&&modelSelected&&methodSelected;
 return {allowed:{1:true,2:connected,3:modelReady,4:modelReady&&hasFile} as Record<SetupStep,boolean>,suggested:(!connected?1:!modelReady?2:!hasFile?3:4) as SetupStep,canStart:modelReady&&hasFile&&!busy};
}
export function managementUrl(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?new URL('/',url).href:null;}catch{return null;}}
