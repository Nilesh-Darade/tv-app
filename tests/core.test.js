"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../app.js");

function seededRandom() {
  let state = 57;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("TC-tv-app-002: category exclusion and complete shuffled cycles", () => {
  const keys = ["quote", "physics", "math", "animals", "space", "learn"];
  const rand = seededRandom();
  const selected = new Set();
  let previous = null;
  for (let i = 0; i < 10000; i++) {
    const next = core.pickCategory(keys, previous, rand);
    assert.ok(keys.includes(next));
    assert.notEqual(next, previous);
    selected.add(next);
    previous = next;
  }
  assert.equal(selected.size, keys.length);
  assert.equal(core.pickCategory(["space"], "space", rand), "space");
  assert.equal(core.pickCategory([], null, rand), null);

  const original = [0, 1, 2];
  assert.deepEqual(core.shuffle(original, () => 0), [1, 2, 0]);
  assert.deepEqual(original, [0, 1, 2]);

  const pool = core.createPool(15, rand);
  let last;
  for (let cycle = 0; cycle < 20; cycle++) {
    const entries = Array.from({ length: 15 }, () => core.nextFromPool(pool, rand));
    assert.notEqual(entries[0], last);
    assert.deepEqual(entries.slice().sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i));
    last = entries[14];
  }
  // Force the reshuffle to put the last slide first, so the swap path must run.
  const pair = core.createPool(2, () => 0);
  assert.deepEqual(Array.from({ length: 4 }, () => core.nextFromPool(pair, () => 0)), [1, 0, 1, 0]);
  const singleton = core.createPool(1, rand);
  assert.equal(core.nextFromPool(singleton, rand), 0);
  assert.equal(core.nextFromPool(singleton, rand), 0);
  assert.equal(core.nextFromPool(core.createPool(0, rand), rand), null);
});

test("TC-tv-app-007: history back, forward, oldest boundary and 500-entry cap", () => {
  const history = core.createHistory();
  assert.equal(history.current(), null);
  assert.equal(history.back(), null);
  assert.equal(history.forward(), null);
  assert.equal(history.atEnd(), true);
  for (let i = 0; i <= 500; i++) history.push(i);
  assert.equal(history.current(), 500);
  for (let previous = 499; previous >= 1; previous--) {
    assert.equal(history.back(), previous);
  }
  assert.equal(history.back(), null);
  assert.equal(history.current(), 1);
  assert.equal(history.atEnd(), false);
  assert.equal(history.forward(), 2);
  history.push("new");
  assert.equal(history.current(), "new");
  assert.equal(history.atEnd(), true);
  assert.equal(history.forward(), null);
  assert.equal(history.back(), 2);
  const single = core.createHistory(1);
  single.push("old");
  single.push("new");
  assert.equal(single.back(), null);
  assert.equal(single.current(), "new");
});

test("TC-tv-app-008: duration counts visible words, clamps, then scales", () => {
  assert.equal(core.clamp(4, 13, 2), 4);
  assert.equal(core.clamp(4, 13, 20), 13);
  assert.equal(core.countWords({ t: "  one\ttwo ", d: "\nthree four ", a: "five six" }), 6);
  assert.equal(core.countWords({ t: " ", d: null, a: 0 }), 0);
  assert.equal(core.displaySeconds({ t: "Short" }, 1), 4);
  const duration = core.displaySeconds({ t: "one two three four", d: "five six", a: "seven eight" }, 1.5);
  assert.ok(Math.abs(duration - 7.8) < 1e-10, `Expected 7.8 seconds, got ${duration}`);
  assert.equal(core.displaySeconds({ t: "word ".repeat(33) }, 2.5), 32.5);
});

test("TC-tv-app-009: URL options, filters and pace boundaries", () => {
  assert.deepEqual(core.parseOptions(""), { cats: [], pace: null, sleepHours: 3 });
  assert.deepEqual(core.parseOptions("?cats=Space,%20math&pace=1.5&sleep=0.005"),
    { cats: ["space", "math"], pace: 1.5, sleepHours: 0.005 });
  assert.deepEqual(core.parseOptions("?cats=&pace=abc&sleep=0"), { cats: [], pace: null, sleepHours: 3 });
  assert.equal(core.parseOptions("?pace=0&sleep=-1").pace, 0.5);
  assert.equal(core.parseOptions("?sleep=-1").sleepHours, 3);
  assert.deepEqual(core.parseOptions("?pace=9&sleep=1e9"), { cats: [], pace: 2.5, sleepHours: 24 });
  const all = { space: {}, math: {}, quote: {} };
  assert.deepEqual(core.filterCategories(all, ["math", "space"]), ["space", "math"]);
  assert.deepEqual(core.filterCategories(["space", "math"], ["space"]), ["space"]);
  assert.deepEqual(core.filterCategories(all, ["unknown"]), Object.keys(all));
  assert.deepEqual(core.filterCategories(all, []), Object.keys(all));
  assert.equal(core.normalizePace(1.46), 1.5);
  assert.equal(core.stepPace(1.2, 0.2), 1.4);
  assert.equal(core.stepPace(1.2, -0.2), 1);
  assert.equal(core.stepPace(2.5, 0.2), 2.5);
  assert.equal(core.stepPace(0.5, -0.2), 0.5);
});

test("TC-tv-app-010: storage round-trip and exceptions", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(core.readStoredPace(storage), null);
  assert.equal(core.writeStoredPace(storage, 1.7), true);
  assert.equal(values.get("brightMinds.pace"), "1.7");
  assert.equal(core.readStoredPace(storage), 1.7);
  const unavailable = {
    getItem() { throw new Error("Unavailable"); },
    setItem() { throw new Error("Unavailable"); }
  };
  assert.equal(core.readStoredPace(unavailable), null);
  assert.equal(core.writeStoredPace(unavailable, 2), false);
  assert.equal(core.readStoredPace(null), null);
  assert.equal(core.writeStoredPace(null, 2), false);
});

test("TC-tv-app-011: content validation retains minimal slides and discards unusable data", () => {
  const category = (items) => ({ label: "Sample", accent: "#123456", items });
  for (const input of [null, [], {}, { categories: null }, { categories: { empty: category([]) } }]) {
    assert.equal(core.validateContent(input).ok, false);
  }
  const result = core.validateContent({
    categories: {
      minimal: category([null, [], { t: 0 }, { t: " " }, { t: "Text", d: 0, a: {} }]),
      complete: category([{ t: "Example", d: "Details", a: "Author" }]),
      malformed: { label: "", accent: "red", items: [] },
      empty: category([{ t: "" }])
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.categories), ["minimal", "complete"]);
  assert.deepEqual(result.categories.minimal.items, [{ t: "Text" }]);
  assert.deepEqual(result.categories.complete.items, [{ t: "Example", d: "Details", a: "Author" }]);
});

test("TC-tv-app-018: category style 'quote' is kept, any other style is dropped", () => {
  const result = core.validateContent({
    categories: {
      inspire: { label: "Inspiring words", accent: "#ff7f6e", style: "quote", items: [{ t: "Words", a: "Someone" }] },
      odd: { label: "Odd", accent: "#123456", style: "bold", items: [{ t: "Fact" }] },
      plain: { label: "Plain", accent: "#123456", items: [{ t: "Fact two" }] }
    }
  });
  assert.equal(result.categories.inspire.style, "quote");
  assert.equal("style" in result.categories.odd, false);
  assert.equal("style" in result.categories.plain, false);
});

test("TC-tv-app-012: slide centers use both bounds and fit measured boxes", () => {
  assert.deepEqual(core.randomCenter(() => 0, 20, 20), { x: 42, y: 40 });
  assert.deepEqual(core.randomCenter(() => 0.5, 20, 20), { x: 50, y: 50 });
  const high = core.randomCenter(() => 0.999, 20, 20);
  assert.ok(high.x > 57.9 && high.x <= 58);
  assert.ok(high.y > 59.9 && high.y <= 60);
  assert.deepEqual(core.randomCenter(() => 0, 90, 88), { x: 48, y: 47 });
  assert.deepEqual(core.randomCenter(() => 0, 100, 100), { x: 50, y: 50 });
});

test("TC-tv-app-013: legacy remote codes and keyboard fallback", () => {
  const codes = { 39: "next", 37: "prev", 13: "toggle-pause", 415: "toggle-pause", 19: "toggle-pause",
    38: "pace-up", 40: "pace-down", 70: "fullscreen", 461: "pass-through" };
  for (const [code, action] of Object.entries(codes)) {
    assert.equal(core.keyAction(Number(code), "ArrowRight"), action);
  }
  const keys = { ArrowRight: "next", ArrowLeft: "prev", Enter: "toggle-pause", ArrowUp: "pace-up",
    ArrowDown: "pace-down", f: "fullscreen", F: "fullscreen", Escape: "ignore" };
  for (const [key, action] of Object.entries(keys)) {
    assert.equal(core.keyAction(0, key), action);
  }
});
