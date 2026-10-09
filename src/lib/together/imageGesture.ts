export type ImageView = { scale:number;x:number;y:number };
export type ImageBounds = { width:number;height:number;imageWidth:number;imageHeight:number };
export type Point = { x:number;y:number };
export const IMAGE_MIN_SCALE=1, IMAGE_MAX_SCALE=5;
export function fitImage(width:number,height:number,naturalWidth:number,naturalHeight:number): ImageBounds {
  const ratio=Math.min(width/Math.max(1,naturalWidth),height/Math.max(1,naturalHeight));
  return {width,height,imageWidth:naturalWidth*ratio,imageHeight:naturalHeight*ratio};
}
export function clampImage(view:ImageView,bounds:ImageBounds):ImageView {
  const scale=Math.max(IMAGE_MIN_SCALE,Math.min(IMAGE_MAX_SCALE,view.scale));
  const maxX=Math.max(0,(bounds.imageWidth*scale-bounds.width)/2),maxY=Math.max(0,(bounds.imageHeight*scale-bounds.height)/2);
  return {scale,x:maxX?Math.max(-maxX,Math.min(maxX,view.x)):0,y:maxY?Math.max(-maxY,Math.min(maxY,view.y)):0};
}
// Keep the image point under the fingers fixed as their distance and midpoint change.
export function zoomImage(view:ImageView,scale:number,from:Point,to:Point,bounds:ImageBounds):ImageView {
  const nextScale=Math.max(IMAGE_MIN_SCALE,Math.min(IMAGE_MAX_SCALE,scale));
  return clampImage({scale:nextScale,x:to.x-(from.x-view.x)*nextScale/view.scale,y:to.y-(from.y-view.y)*nextScale/view.scale},bounds);
}
export function pointerPair(points:Point[]) {
  const [a,b]=points;
  return {mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
}
