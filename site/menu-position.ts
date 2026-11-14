type Anchor={top:number;bottom:number;right:number};
type Viewport={width:number;height:number};

/** Fits a fixed-position menu to the viewport, preferring the space below its trigger. */
export function menuPosition(anchor:Anchor,size:{width:number;height:number},viewport:Viewport){
 const edge=8,gap=4,maxWidth=Math.max(0,viewport.width-edge*2),width=Math.min(size.width,maxWidth);
 const below=Math.max(0,viewport.height-edge-anchor.bottom-gap),above=Math.max(0,anchor.top-gap-edge);
 const opensBelow=size.height<=below||below>=above,maxHeight=opensBelow?below:above,height=Math.min(size.height,maxHeight);
 const left=Math.max(edge,Math.min(anchor.right-width,viewport.width-edge-width));
 const desiredTop=opensBelow?anchor.bottom+gap:anchor.top-gap-height;
 const top=Math.max(edge,Math.min(desiredTop,Math.max(edge,viewport.height-edge-height)));
 return {left,top,maxWidth,maxHeight};
}
