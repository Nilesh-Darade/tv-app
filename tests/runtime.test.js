"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { setImmediate: settle } = require("node:timers/promises");
const { test } = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = readFileSync(path.join(root, "app.js"), "utf8");
const content = {
  categories: {
    space: { label: "Space", accent: "#b9a6ff", items: [{ t: "Star" }, { t: "Moon" }, { t: "Planet" }] },
    math: { label: "Math", accent: "#a8e07a", items: [{ t: "Square" }, { t: "Circle" }] },
    quote: { label: "Think about it", accent: "#ffc857", items: [{ t: "Keep trying.", a: "Sample proverb" }] }
  }
};

class Element {
  constructor() {
    this.children = [];
    this.text = "";
    this.className = "";
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (name) => {
        if (!this.classList.contains(name)) this.className += " " + name;
      },
      remove: (name) => {
        this.className = this.className.split(" ").filter((part) => part !== name).join(" ");
      }
    };
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  set textContent(value) {
    this.text = value;
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  getBoundingClientRect() {
    return { width: 500, height: 200 };
  }

  find(name) {
    if (this.classList.contains(name)) return this;
    for (const child of this.children) {
      const found = child.find(name);
      if (found) return found;
    }
    return null;
  }

  remove() {
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}

async function launch({
  search = "", protocol = "http:", values = new Map(), storageThrows = false,
  fetch = async () => ({ ok: true, json: async () => content }),
  reducedMotion = false, wakeLock, fullscreenRejects = false
} = {}) {
  const stage = new Element();
  const listeners = new Map();
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  let randomSeed = 19;
  const math = Object.create(Math);
  math.random = () => {
    randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
    return randomSeed / 4294967296;
  };
  const document = {
    fullscreenElement: null,
    documentElement: {},
    getElementById: (id) => id === "stage" ? stage : null,
    createElement: () => new Element(),
    createTextNode(text) {
      const node = new Element();
      node.textContent = text;
      return node;
    },
    addEventListener: (name, handler) => listeners.set(name, handler),
    exitFullscreen: async () => { document.fullscreenElement = null; }
  };
  document.documentElement.requestFullscreen = async () => {
    if (fullscreenRejects) throw new Error("Fullscreen unavailable");
    document.fullscreenElement = document.documentElement;
  };
  const window = {
    location: { protocol, search },
    innerWidth: 1920,
    innerHeight: 1080,
    matchMedia: () => ({ matches: reducedMotion }),
    fetch,
    get localStorage() {
      if (storageThrows) throw new Error("Storage unavailable");
      return {
        getItem: (key) => values.get(key),
        setItem: (key, value) => values.set(key, value)
      };
    },
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  vm.runInNewContext(source, {
    document, window, navigator: wakeLock ? { wakeLock } : {}, Math: math,
    URLSearchParams, Date: { now: () => now },
    setTimeout(callback, delay) {
      timers.set(++nextTimer, { time: now + delay, callback });
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id)
  }, { filename: "app.js" });
  await settle();

  return {
    stage, values, document,
    emit: (name) => listeners.get(name)?.(),
    key(code, name) {
      let prevented = false;
      listeners.get("keydown")({
        keyCode: code, key: name,
        preventDefault() { prevented = true; }
      });
      return prevented;
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].time - b[1].time)[0];
        if (!next || next[1].time > end) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.time;
        timer.callback();
      }
      now = end;
    },
    text: () => stage.find("main")?.textContent,
    label: () => stage.find("label")?.textContent
  };
}

test("TC-tv-app-003: idle fade, timer stop and key or click wakes once", async () => {
  let requests = 0;
  let releases = 0;
  const app = await launch({
    search: "?sleep=0.005&cats=space",
    wakeLock: { async request(type) {
      assert.equal(type, "screen");
      requests++;
      return { async release() { releases++; } };
    } }
  });
  app.advance(17999);
  assert.ok(app.text());
  assert.equal(app.stage.classList.contains("is-asleep"), false);
  app.advance(1);
  assert.equal(app.stage.classList.contains("is-asleep"), true);
  assert.ok(app.text());
  app.advance(900);
  assert.equal(app.stage.children.length, 0);
  assert.equal(releases, 1);
  app.advance(4200);
  assert.equal(app.stage.children.length, 0);
  app.key(38);
  const wokeWithKey = app.text();
  assert.ok(wokeWithKey);
  assert.equal(app.stage.find("toast"), null);
  assert.equal(app.values.size, 0);
  await settle();
  assert.equal(requests, 2);
  app.advance(18900);
  assert.equal(app.stage.children.length, 0);
  app.emit("click");
  const wokeWithClick = app.text();
  assert.ok(wokeWithClick);
  app.advance(1200);
  assert.equal(app.text(), wokeWithClick);
  assert.equal(app.stage.classList.contains("is-asleep"), false);
});

test("TC-tv-app-004: direct file and unsuccessful fetch paths explain how to serve the page", async () => {
  let directFetches = 0;
  for (const options of [
    { protocol: "file:", fetch: async () => { directFetches++; } },
    { fetch: async () => { throw new Error("Offline"); } },
    { fetch: async () => ({ ok: false, status: 404 }) },
    { fetch: async () => ({ ok: true, json: async () => JSON.parse("invalid") }) },
    { fetch: async () => ({ ok: true, json: async () => ({ categories: {} }) }) }
  ]) {
    const app = await launch(options);
    assert.equal(app.text(), "The content could not load.");
    assert.match(app.stage.find("detail").textContent, /\.\/serve\.sh.*printed address/);
    assert.match(app.stage.find("slide-drift").className, /\bdrift-[a-d]\b/);
  }
  assert.equal(directFetches, 0);
});

test("TC-tv-app-005: pause keys, Back pass-through, temporary toasts and persisted pace", async () => {
  const app = await launch({ search: "?cats=space&pace=1.5" });
  const initial = app.text();
  assert.equal(app.key(461, "ArrowRight"), false);
  assert.equal(app.key(13), true);
  assert.equal(app.stage.find("toast").textContent, "Paused");
  const firstPosition = { ...app.stage.find("toast").style };
  for (const coordinate of ["left", "top"]) {
    assert.ok(parseFloat(firstPosition[coordinate]) >= 20 && parseFloat(firstPosition[coordinate]) <= 80);
  }
  app.advance(1499);
  assert.ok(app.stage.find("toast").classList.contains("is-visible"));
  app.advance(1);
  assert.equal(app.stage.find("toast").classList.contains("is-visible"), false);
  app.advance(900);
  assert.equal(app.stage.find("toast"), null);
  assert.equal(app.stage.children.length, 1);
  app.advance(7500);
  assert.equal(app.text(), initial);
  assert.equal(app.key(415), true);
  assert.equal(app.stage.find("toast").textContent, "Playing");
  assert.equal(app.key(19), true);
  assert.equal(app.stage.find("toast").textContent, "Paused");
  const lastPosition = app.stage.find("toast").style;
  assert.notDeepEqual([lastPosition.left, lastPosition.top], [firstPosition.left, firstPosition.top]);

  app.key(38);
  assert.equal(app.stage.find("toast").textContent, "Speed 1.7x");
  for (let i = 0; i < 10; i++) app.key(38);
  assert.equal(app.values.get("brightMinds.pace"), "2.5");
  const reloaded = await launch({ values: app.values });
  reloaded.key(40);
  assert.equal(reloaded.stage.find("toast").textContent, "Speed 2.3x");
  for (let i = 0; i < 20; i++) reloaded.key(40);
  assert.equal(app.values.get("brightMinds.pace"), "0.5");
});

test("TC-tv-app-015: loaded stage advances, replays history and handles pointer/fullscreen", async () => {
  const app = await launch({ search: "?cats=space,math&pace=1.5", reducedMotion: true });
  const first = app.text();
  const firstLabel = app.label();
  assert.equal(app.stage.children.length, 1);
  assert.ok(["Math", "Space"].includes(firstLabel));
  app.key(37);
  app.advance(5999);
  assert.equal(app.text(), first);
  assert.ok(app.stage.find("slide-pos").classList.contains("is-visible"));
  app.advance(1);
  assert.equal(app.stage.find("slide-pos").classList.contains("is-visible"), false);
  for (let i = 0; i < 12; i++) app.key(39);
  app.advance(249);
  assert.equal(app.text(), first);
  app.advance(1);
  const second = app.text();
  assert.notEqual(app.label(), firstLabel);
  assert.notEqual(second, first);
  assert.equal(app.stage.children.length, 1);
  app.key(37);
  app.advance(250);
  assert.equal(app.text(), first);
  app.key(39);
  app.advance(250);
  assert.equal(app.text(), second);

  app.emit("click");
  app.advance(550);
  const afterClick = app.text();
  assert.notEqual(afterClick, second);
  app.emit("click");
  app.emit("click");
  app.emit("dblclick");
  app.advance(550);
  assert.equal(app.text(), afterClick);
  assert.equal(app.document.fullscreenElement, app.document.documentElement);
  app.key(0, "f");
  assert.equal(app.document.fullscreenElement, null);
});

test("TC-tv-app-016: rejected optional APIs and unavailable storage leave the slideshow usable", async () => {
  let requests = 0;
  const app = await launch({
    search: "?cats=unknown&pace=abc", storageThrows: true, fullscreenRejects: true,
    wakeLock: { async request() { requests++; throw new Error("Wake lock unavailable"); } }
  });
  const before = app.text();
  assert.ok(before);
  app.key(70);
  app.key(38);
  assert.equal(app.stage.find("toast").textContent, "Speed 1.2x");
  app.emit("visibilitychange");
  await settle();
  assert.equal(requests, 2);
  app.advance(4900);
  assert.notEqual(app.text(), before);
});

test("TC-tv-app-017: automatic playback resumes when the paused display wakes", async () => {
  const app = await launch({ search: "?sleep=0.005&cats=space" });
  app.key(13);
  assert.equal(app.stage.find("toast").textContent, "Paused");
  app.advance(18900);
  assert.equal(app.stage.children.length, 0);
  app.key(39);
  const resumed = app.text();
  assert.ok(resumed, "waking should show a slide");
  app.advance(4900);
  assert.notEqual(app.text(), resumed, "the next slide should appear after 4 seconds plus the fade");
});
