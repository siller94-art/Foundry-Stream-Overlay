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
  window.FoundryStreamOverlay = {
    getState: buildOverlayState,
    renderInto: renderOverlay
  };

  Hooks.on("updateActor", broadcastOverlayState);
  Hooks.on("updateUser", broadcastOverlayState);
  Hooks.on("createActor", broadcastOverlayState);
  Hooks.on("deleteActor", broadcastOverlayState);

  game.socket.on(`module.${MODULE_ID}`, data => {
    if (data?.type === "overlay-state") {
      window.dispatchEvent(new CustomEvent("foundry-stream-overlay-state", {detail: data.payload}));
    }
  });

  broadcastOverlayState();
});

function getHP(actor) {
  const hp = actor?.system?.attributes?.hp;
  return {
    value: Number(hp?.value ?? 0),
    max: Number(hp?.max ?? 0)
  };
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

  const users = game.users
    .filter(u => u.active)
    .map(user => {
      const actor = user.character;
      const hp = getHP(actor);
      const death = getDeathSaves(actor);
      return {
        id: user.id,
        name: actor?.name || user.name,
        isGM: user.isGM,
        image: actorPortrait(actor),
        hp,
        death,
        actorId: actor?.id || null
      };
    })
    .filter(entry => showGM || !entry.isGM)
    .slice(0, 4);

  return {shape, theme, showDeathSaves, users, updatedAt: Date.now()};
}

function broadcastOverlayState() {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  const payload = buildOverlayState();
  game.socket.emit(`module.${MODULE_ID}`, {type:"overlay-state", payload});
  window.dispatchEvent(new CustomEvent("foundry-stream-overlay-state", {detail: payload}));
}

function renderOverlay(root, state = buildOverlayState()) {
  if (!root) return;
  root.className = `fso-root theme-${state.theme} shape-${state.shape}`;
  root.innerHTML = "";

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
        <div class="fso-hp-row"><span>HP ${entry.hp.value}/${entry.hp.max}</span></div>
        <div class="fso-hp-track"><div class="fso-hp-fill" style="width:${hpPct}%"></div></div>
        ${state.showDeathSaves ? deathSaveMarkup(entry.death) : ""}
        `}
      </div>`;

    root.appendChild(card);
  }
}

function deathSaveMarkup(death) {
  const success = [0,1,2].map(i => `<span class="pip success ${i < death.successes ? "filled" : ""}"></span>`).join("");
  const fail = [0,1,2].map(i => `<span class="pip fail ${i < death.failures ? "filled" : ""}"></span>`).join("");
  return `<div class="fso-death"><span>Death Saves</span><span class="pips">${success}${fail}</span></div>`;
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
      window.open(getOBSOverlayURL(), "FoundryStreamOverlayPreview", "width=1280,height=720");
    });
  }

  async _updateObject() {}
}

function getOBSOverlayURL() {
  const url = new URL(window.location.href);
  const route = foundry.utils.getRoute("modules/foundry-stream-overlay/overlay/overlay.html");
  url.pathname = route;
  url.search = "";
  url.hash = "";
  return url.toString();
}
