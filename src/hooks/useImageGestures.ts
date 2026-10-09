"use client";
import { useEffect,useRef,useState,type PointerEvent } from "react";
import { clampImage,fitImage,pointerPair,zoomImage,type ImageBounds,type ImageView,type Point } from "@/lib/together/imageGesture";

const initial:ImageView={scale:1,x:0,y:0};
export function useImageGestures(key:string|undefined,enabled:boolean,onSwipe:(delta:number)=>void) {
  const stageRef=useRef<HTMLDivElement>(null),imageRef=useRef<HTMLImageElement>(null),labelRef=useRef<HTMLOutputElement>(null);
  const view=useRef<ImageView>({...initial}),bounds=useRef<ImageBounds>({width:1,height:1,imageWidth:1,imageHeight:1});
  const points=useRef(new Map<number,Point>()),base=useRef({view:{...initial},points:[] as Point[]});
  const start=useRef({point:{x:0,y:0},time:0,moved:false,multiple:false}),lastTap=useRef<{time:number;point:Point}|null>(null);
  const frame=useRef<number|null>(null),wheelTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),swipeRef=useRef(onSwipe);
  const [scale,setScale]=useState(1);swipeRef.current=onSwipe;
  function paint() {
    frame.current=null;const image=imageRef.current,stage=stageRef.current;if(!image||!stage)return;
    const next=view.current;image.style.transform=`translate3d(${next.x}px,${next.y}px,0) scale(${next.scale})`;
    stage.classList.toggle("is-zoomed",next.scale>1.01);
    if(labelRef.current)labelRef.current.value=`${Math.round(next.scale*100)}%`;
  }
  function update(next:ImageView) {view.current=clampImage(next,bounds.current);if(frame.current===null)frame.current=requestAnimationFrame(paint);}
  function measure() {
    const stage=stageRef.current,image=imageRef.current;if(!stage||!image)return;
    bounds.current=fitImage(stage.clientWidth,stage.clientHeight,image.naturalWidth||stage.clientWidth,image.naturalHeight||stage.clientHeight);
    update(view.current);
  }
  function local(client:Point):Point {const rect=stageRef.current!.getBoundingClientRect();return {x:client.x-rect.left-rect.width/2,y:client.y-rect.top-rect.height/2};}
  function rebase() {base.current={view:{...view.current},points:[...points.current.values()]};}
  function zoomTo(next:number,at:Point={x:0,y:0}) {update(zoomImage(view.current,next,at,at,bounds.current));setScale(view.current.scale);lastTap.current=null;}
  function down(event:PointerEvent<HTMLDivElement>) {
    if(!enabled||event.button>0||(event.target as HTMLElement).closest("button,video"))return;
    if(points.current.size>=2)return;
    measure();const point=local({x:event.clientX,y:event.clientY});points.current.set(event.pointerId,point);
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Device owns capture. */}
    if(points.current.size===1)start.current={point,time:performance.now(),moved:false,multiple:false};
    else {start.current.multiple=true;lastTap.current=null;}
    rebase();
  }
  function move(event:PointerEvent<HTMLDivElement>) {
    if(!points.current.has(event.pointerId))return;
    const point=local({x:event.clientX,y:event.clientY});points.current.set(event.pointerId,point);
    if(Math.hypot(point.x-start.current.point.x,point.y-start.current.point.y)>8)start.current.moved=true;
    const current=[...points.current.values()],origin=base.current;
    if(current.length===2&&origin.points.length===2){
      const before=pointerPair(origin.points),after=pointerPair(current);
      update(zoomImage(origin.view,origin.view.scale*after.distance/before.distance,before.mid,after.mid,bounds.current));
    }else if(current.length===1&&origin.points.length===1&&view.current.scale>1){
      update({...origin.view,x:origin.view.x+point.x-origin.points[0].x,y:origin.view.y+point.y-origin.points[0].y});
    }
  }
  function finish(event:PointerEvent<HTMLDivElement>,cancelled=false) {
    if(!points.current.has(event.pointerId))return;
    const point=local({x:event.clientX,y:event.clientY});points.current.delete(event.pointerId);
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Already released. */}
    if(points.current.size){rebase();return;}
    setScale(view.current.scale);
    const gesture=start.current,dx=point.x-gesture.point.x,dy=point.y-gesture.point.y;
    if(cancelled||gesture.multiple){lastTap.current=null;return;}
    if(view.current.scale<=1.01&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.3&&performance.now()-gesture.time<650){lastTap.current=null;swipeRef.current(dx<0?1:-1);return;}
    if(!gesture.moved&&Math.hypot(dx,dy)<8){
      const now=performance.now(),previous=lastTap.current;
      if(previous&&now-previous.time<300&&Math.hypot(point.x-previous.point.x,point.y-previous.point.y)<30)zoomTo(view.current.scale>1?1:2.5,point);
      else lastTap.current={time:now,point};
    }else lastTap.current=null;
  }
  useEffect(()=>{
    points.current.clear();lastTap.current=null;view.current={...initial};setScale(1);measure();
    const stage=stageRef.current;if(!stage||!enabled)return;
    const observer=new ResizeObserver(()=>{points.current.clear();measure();});observer.observe(stage);
    const wheel=(event:WheelEvent)=>{event.preventDefault();measure();const at=local({x:event.clientX,y:event.clientY});update(zoomImage(view.current,view.current.scale*Math.exp(-event.deltaY*.002),at,at,bounds.current));clearTimeout(wheelTimer.current);wheelTimer.current=setTimeout(()=>setScale(view.current.scale),120);};
    const hidden=()=>{if(document.visibilityState==="hidden"){points.current.clear();lastTap.current=null;setScale(view.current.scale);}};
    stage.addEventListener("wheel",wheel,{passive:false});document.addEventListener("visibilitychange",hidden);
    return ()=>{observer.disconnect();stage.removeEventListener("wheel",wheel);document.removeEventListener("visibilitychange",hidden);points.current.clear();clearTimeout(wheelTimer.current);if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}};
  // Gesture state stays outside React; only completion updates the zoom buttons.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,enabled]);
  return {stageRef,imageRef,labelRef,scale,zoomTo,onLoad:measure,onPointerDown:down,onPointerMove:move,onPointerUp:(event:PointerEvent<HTMLDivElement>)=>finish(event),onPointerCancel:(event:PointerEvent<HTMLDivElement>)=>finish(event,true),onLostPointerCapture:(event:PointerEvent<HTMLDivElement>)=>finish(event,true)};
}
