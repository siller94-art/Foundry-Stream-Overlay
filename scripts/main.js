const MODULE_ID = "foundry-stream-overlay";
const OVERLAY_EVENT = "foundryStreamOverlayState";
const HEARTBEAT_MS = 3000;

let obsSocket = null;
let obsReady = false;
let obsRequestId = 0;
const pending = new Map();

Hooks.once("init", () => {
  const world = (key, name, type, def, extra={}) => game.settings.register(MODULE_ID, key, {
    name, scope:"world", config:true, type, default:def, ...extra
  });
  const client = (key, name, type, def, extra={}) => game.settings.register(MODULE_ID, key, {
    name, scope:"client", config:true, type, default:def, ...extra
  });

  world("enabled", "Enable Stream Overlay", Boolean, true);
  world("portraitShape", "Portrait Shape", String, "circle", {choices:{circle:"Circle",square:"Square"}});
  world("theme", "Overlay Theme", String, "dark", {choices:{dark:"Dark",light:"Light",nature:"Nature",bronze:"Bronze"}});
  world("showDeathSaves", "Show Death Saving Throws", Boolean, true);
  world("showGM", "Show GM Slot", Boolean, true);
  world("layoutPositions", "Overlay Card Positions", String, "{}", {config:false});

  client("obsHost", "OBS WebSocket Host", String, "127.0.0.1");
  client("obsPort", "OBS WebSocket Port", Number, 4455);
  client("obsPassword", "OBS WebSocket Password", String, "");
});

Hooks.once("ready", async () => {
  if (!game.user?.isGM) return;
  installLayoutButton();
  for (const hook of ["updateActor","updateUser","createActor","deleteActor","updateToken"]) {
    Hooks.on(hook, () => pushOverlay());
  }
  await connectOBS();
  setInterval(() => pushOverlay(true), HEARTBEAT_MS);
});

function getHP(actor) {
  const hp=actor?.system?.attributes?.hp;
  return {value:Number(hp?.value??0),max:Number(hp?.max??0)};
}
function getLevel(actor) { return Number(actor?.system?.details?.level??0); }
function getAC(actor) {
  const ac=actor?.system?.attributes?.ac;
  return Number(ac?.value??ac??0);
}
function getDeathSaves(actor) {
  const d=actor?.system?.attributes?.death;
  return {successes:Number(d?.success??0),failures:Number(d?.failure??0)};
}
function absoluteImageUrl(img) {
  if (!img) return "";
  if (/^(https?:|data:)/i.test(img)) return img;
  try {
    const routed=foundry?.utils?.getRoute?.(img)??img;
    return new URL(routed, window.location.href).href;
  } catch { return img; }
}
function buildOverlayState() {
  const showGM=game.settings.get(MODULE_ID,"showGM");
  const users=game.users.filter(u=>u.active).map(user=>{
    const actor=user.character;
    return {
      id:user.id, actorId:actor?.id??null,
      name:actor?.name||user.name, isGM:user.isGM,
      image:absoluteImageUrl(actor?.img||"icons/svg/mystery-man.svg"),
      level:getLevel(actor), ac:getAC(actor), hp:getHP(actor), death:getDeathSaves(actor)
    };
  }).filter(x=>showGM||!x.isGM).sort((a,b)=>Number(b.isGM)-Number(a.isGM)).slice(0,4);
  return {
    v:2, present:true, users,
    shape:game.settings.get(MODULE_ID,"portraitShape"),
    theme:game.settings.get(MODULE_ID,"theme"),
    showDeathSaves:game.settings.get(MODULE_ID,"showDeathSaves"),
    positions:(()=>{try{return JSON.parse(game.settings.get(MODULE_ID,"layoutPositions")||"{}")}catch{return {}}})(),
    updatedAt:Date.now()
  };
}

async function sha256Base64(value) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  let binary=""; for (const b of new Uint8Array(digest)) binary+=String.fromCharCode(b);
  return btoa(binary);
}
async function obsAuth(password,salt,challenge) {
  const secret=await sha256Base64(password+salt);
  return sha256Base64(secret+challenge);
}
function obsRequest(requestType,requestData={}) {
  if (!obsReady || obsSocket?.readyState!==WebSocket.OPEN) return Promise.reject(new Error("OBS not connected"));
  const requestId=`fso-${++obsRequestId}`;
  return new Promise((resolve,reject)=>{
    pending.set(requestId,{resolve,reject});
    obsSocket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));
    setTimeout(()=>{ if(pending.delete(requestId)) reject(new Error("OBS request timeout")); },5000);
  });
}
async function connectOBS() {
  if (!game.user?.isGM) return;
  obsReady=false;
  try { obsSocket?.close(); } catch {}
  const host=String(game.settings.get(MODULE_ID,"obsHost")||"127.0.0.1");
  const port=Number(game.settings.get(MODULE_ID,"obsPort")||4455);
  const password=String(game.settings.get(MODULE_ID,"obsPassword")||"");
  const ws=new WebSocket(`ws://${host}:${port}`);
  obsSocket=ws;

  ws.addEventListener("message",async event=>{
    let msg; try { msg=JSON.parse(event.data); } catch { return; }
    if (msg.op===0) {
      const identify={rpcVersion:1};
      if (msg.d?.authentication) identify.authentication=await obsAuth(password,msg.d.authentication.salt,msg.d.authentication.challenge);
      ws.send(JSON.stringify({op:1,d:identify}));
    } else if (msg.op===2) {
      obsReady=true;
      ui.notifications.info("Foundry Stream Overlay connected to OBS.");
      pushOverlay(true);
    } else if (msg.op===7) {
      const p=pending.get(msg.d?.requestId); if(!p) return;
      pending.delete(msg.d.requestId);
      msg.d?.requestStatus?.result ? p.resolve(msg.d.responseData||{}) : p.reject(new Error(msg.d?.requestStatus?.comment||"OBS request failed"));
    }
  });
  ws.addEventListener("close",()=>{ obsReady=false; });
  ws.addEventListener("error",()=>{ obsReady=false; });
}
async function pushOverlay(force=false) {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID,"enabled") || !obsReady) return;
  try {
    await obsRequest("CallVendorRequest",{
      vendorName:"obs-browser", requestType:"emit_event",
      requestData:{event_name:OVERLAY_EVENT,event_data:buildOverlayState()}
    });
  } catch (err) {
    if (force) console.warn("Foundry Stream Overlay:",err);
  }
}

let layoutEditorRoot=null;
let layoutLocked=false;

function overlayCardElement(entry,state) {
  const card=document.createElement("section");
  card.className="fso-layout-card "+(entry.isGM?"gm ":"")+(state.shape||"circle");
  card.dataset.userId=entry.id;
  const img=document.createElement("img"); img.className="fso-layout-portrait"; img.src=entry.image||""; img.alt=""; card.appendChild(img);
  const meta=document.createElement("div"); meta.className="fso-layout-meta";
  const name=document.createElement("div"); name.className="fso-layout-name"; name.textContent=entry.name; meta.appendChild(name);
  if(entry.isGM){const role=document.createElement("div");role.className="fso-layout-role";role.textContent="Dungeon Master";meta.appendChild(role);}
  else {
    const stats=document.createElement("div");stats.className="fso-layout-stats";stats.textContent=`LVL ${entry.level||"—"}   AC ${entry.ac||"—"}   HP ${entry.hp.value}/${entry.hp.max}`;meta.appendChild(stats);
    if(state.showDeathSaves){const death=document.createElement("div");death.className="fso-layout-death";death.textContent=`Death Saving Throws  ✓ ${entry.death.successes}/3   ✕ ${entry.death.failures}/3`;meta.appendChild(death);}
  }
  card.appendChild(meta); return card;
}
function closeLayoutEditor(){layoutEditorRoot?.remove();layoutEditorRoot=null;}
async function saveLayoutPositions(){
  if(!layoutEditorRoot)return;
  const box=layoutEditorRoot.getBoundingClientRect(), positions={};
  layoutEditorRoot.querySelectorAll(".fso-layout-card").forEach(card=>{
    positions[card.dataset.userId]={x:Number((parseFloat(card.style.left)/box.width).toFixed(5)),y:Number((parseFloat(card.style.top)/box.height).toFixed(5))};
  });
  await game.settings.set(MODULE_ID,"layoutPositions",JSON.stringify(positions));await pushOverlay(true);ui.notifications.info("Stream overlay layout saved.");
}
function openLayoutEditor(){
  if(!game.user?.isGM)return;
  closeLayoutEditor(); const state=buildOverlayState();
  const root=document.createElement("div");root.id="fso-layout-editor";root.className=`fso-layout-editor theme-${state.theme}`;
  root.style.width="100vw";root.style.height="100vh";
  root.innerHTML='<div class="fso-layout-toolbar"><strong>OBS Overlay Layout</strong><span>Drag cards where you want them on stream.</span><button data-act="lock">Lock</button><button data-act="reset">Reset</button><button data-act="save">Save & Close</button><button data-act="close">Close</button></div><div class="fso-layout-stage"></div>';
  document.body.appendChild(root);layoutEditorRoot=root;const stage=root.querySelector(".fso-layout-stage");
  const positions=state.positions||{};
  state.users.forEach((entry,index)=>{
    const card=overlayCardElement(entry,state),pos=positions[entry.id]||{x:.02+index*.245,y:.78};
    card.style.left=`${Math.max(0,Math.min(.82,pos.x))*100}%`;card.style.top=`${Math.max(0,Math.min(.86,pos.y))*100}%`;stage.appendChild(card);
    let drag=null;
    card.addEventListener("pointerdown",e=>{if(layoutLocked)return;const r=card.getBoundingClientRect(),sr=stage.getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top,sr};card.setPointerCapture(e.pointerId);});
    card.addEventListener("pointermove",e=>{if(!drag)return;const x=Math.max(0,Math.min(drag.sr.width-card.offsetWidth,e.clientX-drag.sr.left-drag.dx));const y=Math.max(0,Math.min(drag.sr.height-card.offsetHeight,e.clientY-drag.sr.top-drag.dy));card.style.left=x+"px";card.style.top=y+"px";});
    card.addEventListener("pointerup",()=>drag=null);
  });
  root.querySelector('[data-act="lock"]').onclick=e=>{layoutLocked=!layoutLocked;e.currentTarget.textContent=layoutLocked?"Unlock":"Lock";root.classList.toggle("locked",layoutLocked);};
  root.querySelector('[data-act="reset"]').onclick=()=>{stage.querySelectorAll(".fso-layout-card").forEach((c,i)=>{c.style.left=(2+i*24.5)+"%";c.style.top="78%";});};
  root.querySelector('[data-act="save"]').onclick=saveLayoutPositions;
  root.querySelector('[data-act="close"]').onclick=closeLayoutEditor;
}


function installLayoutButton(){
  if(document.getElementById("fso-open-layout")) return;
  const btn=document.createElement("button");
  btn.id="fso-open-layout";
  btn.type="button";
  btn.title="Open Stream Overlay Layout Editor";
  btn.innerHTML='<i class="fas fa-tv"></i><span> OBS Layout</span>';
  Object.assign(btn.style,{
    position:"fixed",left:"12px",bottom:"72px",zIndex:"99999",
    height:"34px",padding:"0 10px",border:"1px solid #8b7b62",
    borderRadius:"4px",background:"rgba(20,20,22,.94)",color:"#eee",
    fontSize:"12px",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.5)"
  });
  btn.addEventListener("click",openLayoutEditor);
  document.body.appendChild(btn);
}

window.FoundryStreamOverlay={connectOBS,pushOverlay,buildOverlayState,openLayoutEditor,closeLayoutEditor};