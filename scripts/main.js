const MODULE_ID = "foundry-stream-overlay";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable Stream Overlay",
    hint: "Enable the transparent overlay output for OBS.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "portraitShape", {
    name: "Portrait Shape",
    hint: "Choose circle or square portraits in the overlay.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      circle: "Circle",
      square: "Square"
    },
    default: "circle"
  });

  game.settings.register(MODULE_ID, "theme", {
    name: "Overlay Theme",
    scope: "world",
    config: true,
    type: String,
    choices: {
      dark: "Dark",
      light: "Light",
      nature: "Nature",
      bronze: "Bronze"
    },
    default: "dark"
  });

  game.settings.register(MODULE_ID, "showDeathSaves", {
    name: "Show Death Saves",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "twitchChatEnabled", {
    name: "Show Twitch Chat",
    hint: "Optional. Display Twitch chat in the stream overlay.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "twitchChannel", {
    name: "Twitch Channel",
    hint: "Your Twitch channel name only. Used only when Show Twitch Chat is enabled.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "twitchChatPosition", {
    name: "Twitch Chat Position",
    scope: "world",
    config: true,
    type: String,
    choices: {
      left: "Left",
      right: "Right"
    },
    default: "right"
  });

  game.settings.registerMenu(MODULE_ID, "obsHelper", {
    name: "OBS Browser Source",
    label: "Open OBS Setup",
    hint: "Generate, copy, and test the transparent Browser Source URL for OBS.",
    icon: "fas fa-broadcast-tower",
    type: OBSHelper,
    restricted: true
  });

  game.settings.register(MODULE_ID, "showGM", {
    name: "Show GM Slot",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  const overlayClient = isOverlayClient();

  window.FoundryStreamOverlay = {
    getState: buildOverlayState,
    renderInto: renderOverlay
  };

  Hooks.on("updateActor", broadcastOverlayState);
  Hooks.on("updateUser", broadcastOverlayState);
  Hooks.on("createActor", broadcastOverlayState);
  Hooks.on("deleteActor", broadcastOverlayState);
  Hooks.on("updateToken", broadcastOverlayState);

  if (overlayClient) {
    activateOBSOverlayMode();
  }

  game.socket.on(`module.${MODULE_ID}`, data => {
    if (data?.type === "overlay-state") {
      window.dispatchEvent(new CustomEvent("foundry-stream-overlay-state", {detail: data.payload}));
    }
  });

  broadcastOverlayState();
  if (overlayClient) {
    renderOBSClient();
    setTimeout(checkOBSCanvas, 2500);
  }
});

function getHP(actor) {
  const hp = actor?.system?.attributes?.hp;
  return {
    value: Number(hp?.value ?? 0),
    max: Number(hp?.max ?? 0)
  };
}

function getLevel(actor) {
  return Number(actor?.system?.details?.level ?? 0);
}

function getAC(actor) {
  const ac = actor?.system?.attributes?.ac;
  return Number(ac?.value ?? ac ?? 0);
}

function getDeathSaves(actor) {
  const death = actor?.system?.attributes?.death;
  return {
    successes: Number(death?.success ?? 0),
    failures: Number(death?.failure ?? 0)
  };
}

function actorPortrait(actor) {
  return actor?.img || "icons/svg/mystery-man.svg";
}

function buildOverlayState() {
  const shape = game.settings.get(MODULE_ID, "portraitShape");
  const theme = game.settings.get(MODULE_ID, "theme");
  const showDeathSaves = game.settings.get(MODULE_ID, "showDeathSaves");
  const showGM = game.settings.get(MODULE_ID, "showGM");
  const twitchChatEnabled = game.settings.get(MODULE_ID, "twitchChatEnabled");
  const twitchChannel = String(game.settings.get(MODULE_ID, "twitchChannel") || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const twitchChatPosition = game.settings.get(MODULE_ID, "twitchChatPosition");

  const users = game.users
    .filter(u => u.active)
    .map(user => {
      const actor = user.character;
      const hp = getHP(actor);
      const death = getDeathSaves(actor);
      const level = getLevel(actor);
      const ac = getAC(actor);
      return {
        id: user.id,
        name: actor?.name || user.name,
        isGM: user.isGM,
        image: actorPortrait(actor),
        hp,
        level,
        ac,
        death,
        actorId: actor?.id || null
      };
    })
    .filter(entry => showGM || !entry.isGM)
    .slice(0, 4);

  return {
    shape,
    theme,
    showDeathSaves,
    users,
    twitch: {
      enabled: Boolean(twitchChatEnabled && twitchChannel),
      channel: twitchChannel,
      position: twitchChatPosition
    },
    updatedAt: Date.now()
  };
}

function broadcastOverlayState() {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  const payload = buildOverlayState();
  game.socket.emit(`module.${MODULE_ID}`, {type:"overlay-state", payload});
  window.dispatchEvent(new CustomEvent("foundry-stream-overlay-state", {detail: payload}));
  if (isOverlayClient()) renderOBSClient(payload);
}

function isOverlayClient() {
  return new URLSearchParams(window.location.search).get("fsoOverlay") === "1";
}

function activateOBSOverlayMode() {
  document.documentElement.classList.add("fso-overlay-client");
  document.body.classList.add("fso-overlay-client");

  let root = document.getElementById("foundry-stream-overlay-root");
  if (!root) {
    root = document.createElement("main");
    root.id = "foundry-stream-overlay-root";
    document.body.appendChild(root);
  }

  // Keep the overlay above the Foundry game client while CSS disables the
  // normal canvas and interface for a low-noise OBS Browser Source.
  root.className = "fso-obs-root";
}

function renderOBSClient(state = buildOverlayState()) {
  let root = document.getElementById("foundry-stream-overlay-root");
  if (!root) {
    activateOBSOverlayMode();
    root = document.getElementById("foundry-stream-overlay-root");
  }
  renderOverlay(root, state);
}

function checkOBSCanvas() {
  if (!isOverlayClient()) return;
  const board = document.getElementById("board");
  const canvasEl = board?.querySelector("canvas") || document.querySelector("canvas");
  const ready = Boolean(canvasEl && canvasEl.width > 0 && canvasEl.height > 0);
  document.querySelector(".fso-obs-warning")?.remove();
  if (ready) return;

  const warning = document.createElement("div");
  warning.className = "fso-obs-warning";
  warning.textContent = "Foundry scene canvas is not rendering in this browser. In OBS: Settings → Advanced → Sources → toggle Browser Source Hardware Acceleration, restart OBS, then refresh this Browser Source.";
  document.body.appendChild(warning);
}

function renderOverlay(root, state = buildOverlayState()) {
  if (!root) return;
  root.className = `fso-root theme-${state.theme} shape-${state.shape}`;
  root.innerHTML = "";

  const players = document.createElement("div");
  players.className = "fso-players";
  root.appendChild(players);

  for (const entry of state.users) {
    const card = document.createElement("section");
    card.className = `fso-card ${entry.isGM ? "is-gm" : ""}`;

    const hpMax = Math.max(1, entry.hp.max || 1);
    const hpPct = Math.max(0, Math.min(100, (entry.hp.value / hpMax) * 100));

    card.innerHTML = `
      <div class="fso-portrait-wrap">
        <img class="fso-portrait" src="${entry.image}" alt="">
      </div>
      <div class="fso-meta">
        <div class="fso-name">${escapeHtml(entry.name)}</div>
        ${entry.isGM ? '<div class="fso-role">Dungeon Master</div>' : `
        <div class="fso-stats-row"><span><b>LVL</b> ${entry.level || "—"}</span><span><b>AC</b> ${entry.ac || "—"}</span><span><b>HP</b> ${entry.hp.value}/${entry.hp.max}</span></div>
        <div class="fso-hp-track"><div class="fso-hp-fill" style="width:${hpPct}%"></div></div>
        ${state.showDeathSaves ? deathSaveMarkup(entry.death) : ""}
        `}
      </div>`;

    players.appendChild(card);
  }

  renderTwitchChat(root, state.twitch);
}

function renderTwitchChat(root, twitch) {
  if (!twitch?.enabled || !twitch.channel) return;

  const wrap = document.createElement("aside");
  wrap.className = `fso-twitch-chat position-${twitch.position === "left" ? "left" : "right"}`;

  const title = document.createElement("div");
  title.className = "fso-chat-title";
  title.textContent = "Twitch Chat";

  const frame = document.createElement("iframe");
  frame.className = "fso-chat-frame";
  frame.title = "Twitch Chat";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.src = buildTwitchChatURL(twitch.channel);

  wrap.append(title, frame);
  root.appendChild(wrap);
}

function buildTwitchChatURL(channel) {
  const params = new URLSearchParams();
  params.set("parent", window.location.hostname || "localhost");
  params.set("darkpopout", "");
  return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${params.toString()}`;
}

function deathSaveMarkup(death) {
  const success = [0,1,2].map(i => `<span class="pip success ${i < death.successes ? "filled" : ""}"></span>`).join("");
  const fail = [0,1,2].map(i => `<span class="pip fail ${i < death.failures ? "filled" : ""}"></span>`).join("");
  return `<div class="fso-death"><span class="fso-death-label">Death Saving Throws</span><span class="fso-save-group"><small>Success</small><span class="pips">${success}</span></span><span class="fso-save-group"><small>Fail</small><span class="pips">${fail}</span></span></div>`;
}

function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}


class OBSHelper extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "foundry-stream-overlay-obs-helper",
      title: "Foundry Stream Overlay — OBS Setup",
      template: "modules/foundry-stream-overlay/templates/obs-helper.hbs",
      width: 620,
      height: "auto",
      closeOnSubmit: false
    });
  }

  getData() {
    const obsUrl = getOBSOverlayURL();
    return {
      obsUrl,
      width: 1920,
      height: 1080
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="copy-url"]').on("click", async event => {
      event.preventDefault();
      const url = getOBSOverlayURL();
      try {
        await navigator.clipboard.writeText(url);
        ui.notifications.info("OBS overlay URL copied.");
      } catch (_) {
        const input = html.find("#fso-obs-url")[0];
        input?.focus();
        input?.select();
        ui.notifications.warn("Select the URL and copy it manually.");
      }
    });

    html.find('[data-action="test-overlay"]').on("click", event => {
      event.preventDefault();
      openOverlayTestInBrowser();
    });
  }

  async _updateObject() {}
}

function openOverlayTestInBrowser() {
  const url = getOBSOverlayURL();
  // A normal _blank navigation opens the test in the user's default web browser
  // rather than a constrained popup-style preview window.
  const testWindow = window.open(url, "_blank");
  if (!testWindow) {
    navigator.clipboard?.writeText(url).catch(() => {});
    ui.notifications.warn("The browser blocked the test tab. The overlay URL was copied; paste it into Google Chrome.");
  }
}

function getOBSOverlayURL() {
  // Use the real Foundry game URL so OBS loads a normal Foundry client.
  // The query flag tells this module to hide Foundry's interface and render
  // only the transparent stream overlay.
  const url = new URL(window.location.href);
  url.searchParams.set("fsoOverlay", "1");
  url.hash = "";
  return url.toString();
}
