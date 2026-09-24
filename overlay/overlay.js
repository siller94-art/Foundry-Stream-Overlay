(function(){
"use strict";
var EVENT="foundryStreamOverlayState",root=document.getElementById("root"),last="";
function escText(v){return v==null?"":String(v)}
function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=escText(text);return n}
function pips(kind,count){var wrap=node("span","pips");for(var i=0;i<3;i++){wrap.appendChild(node("span","pip "+kind+(i<count?" on":"")))}return wrap}
function render(state){
 var serial;try{serial=JSON.stringify(state)}catch(e){serial=""}if(serial&&serial===last)return;last=serial;
 var theme=(state&&state.theme||"dark"),shape=(state&&state.shape||"circle");root.className="theme-"+theme+" "+shape;document.body.className="theme-"+theme+" "+shape;root.textContent="";
 var users=state&&Array.isArray(state.users)?state.users.slice(0,4):[];
 if(!users.length){root.appendChild(node("div","wait","Connected — waiting for active Foundry users…"));return}
 users.forEach(function(u,index){
  var card=node("section","card"+(u.isGM?" gm":""));
  var pos=state.positions&&state.positions[u.id]||{x:.02+index*.245,y:.78};card.style.left=(Math.max(0,Math.min(.82,Number(pos.x)||0))*100)+"%";card.style.top=(Math.max(0,Math.min(.86,Number(pos.y)||0))*100)+"%";
  var img=node("img","portrait");img.alt="";if(u.image)img.src=u.image;card.appendChild(img);
  var meta=node("div","meta");meta.appendChild(node("div","name",u.name));
  if(u.isGM){meta.appendChild(node("div","role","Dungeon Master"));card.appendChild(meta);root.appendChild(card);return}
  var stats=node("div","stats");
  [["LVL",u.level||"—"],["AC",u.ac||"—"],["HP",(u.hp?u.hp.value:0)+"/"+(u.hp?u.hp.max:0)]].forEach(function(x){var s=node("span");s.appendChild(node("b","",x[0]+" "));s.appendChild(document.createTextNode(x[1]));stats.appendChild(s)});meta.appendChild(stats);
  var track=node("div","hpbar"),fill=node("div","hpfill");var max=Math.max(1,u.hp&&u.hp.max||1),pct=Math.max(0,Math.min(100,(u.hp&&u.hp.value||0)/max*100));fill.style.width=pct+"%";track.appendChild(fill);meta.appendChild(track);
  if(state.showDeathSaves){var d=node("div","death");d.appendChild(node("div","death-title","Death Saving Throws"));var ok=node("div","save","Success");ok.appendChild(pips("ok",u.death&&u.death.successes||0));var bad=node("div","save","Fail");bad.appendChild(pips("bad",u.death&&u.death.failures||0));d.appendChild(ok);d.appendChild(bad);meta.appendChild(d)}
  card.appendChild(meta);root.appendChild(card)
 })
}
window.addEventListener(EVENT,function(e){render(e.detail)});
window.FoundryStreamOverlayOBS={render:render,event:EVENT};
})();