const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const api=load('lib/together/imageGesture.ts');
test('pinch keeps the image point under the fingers as their midpoint moves',()=>{
  const bounds=api.fitImage(400,600,1200,1800);
  const next=api.zoomImage({scale:1,x:0,y:0},2,{x:30,y:40},{x:60,y:70},bounds);
  assert.equal(next.scale,2);assert.equal(next.x,0);assert.equal(next.y,-10);
  assert.equal((60-next.x)/next.scale,30);assert.equal((70-next.y)/next.scale,40);
});
test('portrait, landscape and small images stay inside their fitted pan bounds',()=>{
  for(const size of [[1200,1800],[1800,1200],[100,100]]){
    const bounds=api.fitImage(400,600,...size),result=api.clampImage({scale:3,x:10000,y:-10000},bounds);
    assert.ok(Math.abs(result.x)<=Math.max(0,(bounds.imageWidth*3-400)/2));
    assert.ok(Math.abs(result.y)<=Math.max(0,(bounds.imageHeight*3-600)/2));
    const reset=api.clampImage({...result,scale:1},bounds);assert.equal(reset.x,0);assert.equal(reset.y,0);
  }
});
test('zoom has a bounded range and fit uses the actual image aspect ratio',()=>{
  const bounds=api.fitImage(400,600,2000,1000);assert.equal(bounds.imageWidth,400);assert.equal(bounds.imageHeight,200);
  assert.equal(api.clampImage({scale:100,x:0,y:0},bounds).scale,5);
  assert.equal(api.clampImage({scale:.1,x:0,y:0},bounds).scale,1);
  const pair=api.pointerPair([{x:20,y:10},{x:80,y:90}]);assert.equal(pair.distance,100);assert.equal(pair.mid.x,50);assert.equal(pair.mid.y,50);
});
