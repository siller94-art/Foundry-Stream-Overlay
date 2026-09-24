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

  client("obsHost", "OBS WebSocket Host", String, "127.0.0.1");
  client("obsPort", "OBS WebSocket Port", Number, 4455);
  client("obsPassword", "OBS WebSocket Password", String, "");

  game.settings.registerMenu(MODULE_ID, "obsHelper", {
    name:"OBS Overlay Setup", label:"Open OBS Setup",
    hint:"Set up the local OBS Browser Source. No Foundry login or OBS Interact is required.",
    icon:"fas fa-broadcast-tower", type:OBSHelper, restricted:true
  });
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

class OBSHelper extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions,{
      id:"foundry-stream-overlay-obs-helper",title:"Foundry Stream Overlay — OBS Setup",
      template:"modules/foundry-stream-overlay/templates/obs-helper.hbs",width:660,height:"auto",closeOnSubmit:false
    });
  }
  getData() {
    return {
      overlayPath:"Data/modules/foundry-stream-overlay/overlay/obs-overlay.html",
      connected:obsReady?"Connected":"Not connected",
      width:1920,height:1080
    };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="reconnect"]').on("click",async e=>{e.preventDefault();await connectOBS();this.render();});
    html.find('[data-action="test"]').on("click",async e=>{e.preventDefault();await pushOverlay(true);ui.notifications.info("Test overlay data sent to OBS.");});
  }
  async _updateObject(){}
}

window.FoundryStreamOverlay={connectOBS,pushOverlay,buildOverlayState};
