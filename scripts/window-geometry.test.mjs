import assert from 'node:assert/strict';
import { fitWindow, resizeWindow, iconCells, arrangeIcons, dropIcon, nearestCell } from '../src/window-geometry.ts';

for (const view of [{width:1440,height:900},{width:390,height:844},{width:667,height:375},{width:320,height:480}]) {
  const rect = fitWindow({x:100,y:60,width:800,height:500},view);
  for (const edge of ['n','ne','e','se','s','sw','w','nw']) for (const delta of [-5000,-120,0,120,5000]) {
    const resized = resizeWindow(rect,edge,delta,delta,view);
    assert.ok(resized.x >= 0 && resized.y >= 0, JSON.stringify(resized));
    assert.ok(resized.width > 0 && resized.height > 0);
    assert.ok(resized.x+resized.width <= view.width && resized.y+resized.height <= view.height, JSON.stringify(resized));
    if(edge==='w') assert.equal(resized.x+resized.width,rect.x+rect.width);
    if(edge==='n') assert.equal(resized.y+resized.height,rect.y+rect.height);
  }
  const ids=['files','overview','tasks','logs','downloads','settings'];
  const cells=iconCells(view,ids.length);
  const icons=arrangeIcons(ids,{files:{x:96,y:36},tasks:{x:96,y:36},logs:{x:NaN,y:0}},cells);
  assert.equal(new Set(Object.values(icons).map(p=>`${p.x},${p.y}`)).size,6);
  for(const a of ids) for(const b of ids) if(a!==b) assert.ok(Math.abs(icons[a].x-icons[b].x)>=96 || Math.abs(icons[a].y-icons[b].y)>=100);
  const swapped=dropIcon(icons,'files',icons.logs);
  assert.deepEqual(swapped.files,icons.logs);assert.deepEqual(swapped.logs,icons.files);
  assert.deepEqual(nearestCell({x:icons.files.x+7,y:icons.files.y+8},cells),icons.files);
  assert.deepEqual(arrangeIcons(ids,swapped,cells),swapped);
}
const start={x:100,y:80,width:600,height:400};
assert.deepEqual(resizeWindow(start,'se',50,30,{width:1440,height:900}),{x:100,y:80,width:650,height:430});
assert.deepEqual(resizeWindow(start,'nw',-50,-30,{width:1440,height:900}),{x:50,y:50,width:650,height:430});
console.log('Window bounds, eight resize edges, icon snapping, collision swaps and stored layout migration passed.');
