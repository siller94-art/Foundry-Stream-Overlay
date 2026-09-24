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
  world("editOverlay", "Edit Overlay Layout", Boolean, false, {hint:"Turn on and Save Changes to open the GM overlay editor.",onChange:async value=>{if(value){openLayoutEditor();await game.settings.set(MODULE_ID,"editOverlay",false);}}});
  world("reconnectOBS", "Reconnect / Test OBS", Boolean, false, {hint:"Turn on and Save Changes to reconnect and send the current overlay.",onChange:async value=>{if(value){await connectOBS();setTimeout(()=>pushOverlay(true),750);await game.settings.set(MODULE_ID,"reconnectOBS",false);}}});
  world("layoutPositions", "Overlay Card Positions", String, "{}", {config:false});

  client("obsHost", "OBS WebSocket Host", String, "127.0.0.1");
  client("obsPort", "OBS WebSocket Port", Number, 4455);
  client("obsPassword", "OBS WebSocket Password", String, "");
});


// Foundry V14 public Scene Controls API: place OBS Layout under Notes.
Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM) return;
  const notes = controls?.notes;
  if (!notes?.tools) return;
  notes.tools.foundryStreamOverlay = {
    name: "foundryStreamOverlay",
    title: "OBS Overlay Layout",
    icon: "fa-solid fa-tv",
    order: Object.keys(notes.tools).length,
    button: true,
    visible: true,
    onChange: () => openLayoutEditor()
  };
});

Hooks.once("ready", async () => {
  if (!game.user?.isGM) return;
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
  const entries=game.users.filter(u=>u.active).map(user=>{
    const actor=user.character;
    return {
      id:user.id, actorId:actor?.id??null,
      name:actor?.name||user.name, isGM:user.isGM,
      image:absoluteImageUrl(actor?.img||"icons/svg/mystery-man.svg"),
      level:getLevel(actor), ac:getAC(actor), hp:getHP(actor), death:getDeathSaves(actor)
    };
  });
  const gm=entries.find(x=>x.isGM);
  const players=entries.filter(x=>!x.isGM).slice(0,3);
  const users=[...(showGM&&gm?[gm]:[]),...players].slice(0,4);
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
  if (!game.user?.isGM || !game.settings.get(MODULE_ID,"enabled") || !obsReady || (layoutEditorRoot && !force)) return;
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
  const pendingTheme=layoutEditorRoot.dataset.pendingTheme;if(pendingTheme&&pendingTheme!==game.settings.get(MODULE_ID,"theme"))await game.settings.set(MODULE_ID,"theme",pendingTheme);
  const box=layoutEditorRoot.getBoundingClientRect(), positions={};
  layoutEditorRoot.querySelectorAll(".fso-layout-card").forEach(card=>{
    const baseX=parseFloat(card.style.left)||0,baseY=parseFloat(card.style.top)||0;
    const dx=Number(card.dataset.dx||0),dy=Number(card.dataset.dy||0);
    positions[card.dataset.userId]={x:Number(((baseX+dx)/box.width).toFixed(5)),y:Number(((baseY+dy)/box.height).toFixed(5))};
  });
  await game.settings.set(MODULE_ID,"layoutPositions",JSON.stringify(positions));await pushOverlay(true);ui.notifications.info("Stream overlay layout saved.");
}
function openLayoutEditor(){
  if(!game.user?.isGM)return;
  closeLayoutEditor(); const state=buildOverlayState();
  const root=document.createElement("div");root.id="fso-layout-editor";root.className=`fso-layout-editor theme-${state.theme}`;
  
  root.innerHTML='<div class="fso-layout-toolbar"><strong>OBS Overlay Layout</strong><span>Drag cards where you want them on stream.</span><select data-act="theme"><option value="dark">Dark</option><option value="light">Muted Light</option><option value="nature">Nature</option><option value="bronze">Bronze</option></select><button data-act="lock">Lock</button><button data-act="reset">Reset</button><button data-act="save">Save & Close</button><button data-act="close">Close</button></div><div class="fso-layout-stage"></div>';
  document.body.appendChild(root);layoutEditorRoot=root;const stage=root.querySelector(".fso-layout-stage");
  const positions=state.positions||{};
  state.users.forEach((entry,index)=>{
    const card=overlayCardElement(entry,state),pos=positions[entry.id]||{x:.02+index*.245,y:.78};
    card.style.left=`${Math.max(0,Math.min(.82,pos.x))*100}%`;card.style.top=`${Math.max(0,Math.min(.86,pos.y))*100}%`;stage.appendChild(card);
    card.addEventListener("pointerdown",e=>{
      if(layoutLocked)return;
      e.preventDefault();
      const sr=stage.getBoundingClientRect();
      const startX=e.clientX,startY=e.clientY,baseDX=Number(card.dataset.dx||0),baseDY=Number(card.dataset.dy||0);
      const move=ev=>{
        ev.preventDefault();
        const left=parseFloat(card.style.left)||0,top=parseFloat(card.style.top)||0;
        let dx=baseDX+(ev.clientX-startX),dy=baseDY+(ev.clientY-startY);
        dx=Math.max(-left,Math.min(sr.width-card.offsetWidth-left,dx));
        dy=Math.max(-top,Math.min(sr.height-card.offsetHeight-top,dy));
        card.dataset.dx=String(dx);card.dataset.dy=String(dy);
        card.style.transform=`translate3d(${dx}px,${dy}px,0)`;
      };
      const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);window.removeEventListener("pointercancel",stop);};
      window.addEventListener("pointermove",move,{passive:false});
      window.addEventListener("pointerup",stop,{once:true});
      window.addEventListener("pointercancel",stop,{once:true});
    });
  });
  const themeSelect=root.querySelector('[data-act="theme"]');themeSelect.value=state.theme;themeSelect.onchange=e=>{const theme=e.currentTarget.value;root.dataset.pendingTheme=theme;root.className=`fso-layout-editor theme-${theme}`;};
  root.querySelector('[data-act="lock"]').onclick=e=>{layoutLocked=!layoutLocked;e.currentTarget.textContent=layoutLocked?"Unlock":"Lock";root.classList.toggle("locked",layoutLocked);};
  root.querySelector('[data-act="reset"]').onclick=()=>{stage.querySelectorAll(".fso-layout-card").forEach((c,i)=>{c.style.left=(2+i*24.5)+"%";c.style.top="78%";c.style.transform="";c.dataset.dx="0";c.dataset.dy="0";});};
  root.querySelector('[data-act="save"]').onclick=async()=>{await saveLayoutPositions();closeLayoutEditor();};
  root.querySelector('[data-act="close"]').onclick=closeLayoutEditor;
}



window.FoundryStreamOverlay={connectOBS,pushOverlay,buildOverlayState,openLayoutEditor,closeLayoutEditor};