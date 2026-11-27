(function () {
  "use strict";

  const paceKey = "brightMinds.pace";

  function clamp(min, max, v) {
    return Math.min(max, Math.max(min, v));
  }

  function countWords(item) {
    return [item.t, item.d, item.a].reduce(function (count, text) {
      return count + (typeof text === "string" && text.trim()
        ? text.trim().split(/\s+/).length
        : 0);
    }, 0);
  }

  function displaySeconds(item, pace) {
    return clamp(4, 13, 2 + countWords(item) * 0.4) * pace;
  }

  function shuffle(arr, rand) {
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const value = result[i];
      result[i] = result[j];
      result[j] = value;
    }
    return result;
  }

  function createPool(n, rand) {
    const order = shuffle(Array.from({ length: n }, function (_, i) {
      return i;
    }), rand);
    return { order: order, cursor: 0 };
  }

  function nextFromPool(pool, rand) {
    const length = pool.order.length;
    if (!length) return null;

    if (pool.cursor === length) {
      const last = pool.order[length - 1];
      pool.order = shuffle(pool.order, rand);
      if (length > 1 && pool.order[0] === last) {
        const swapIndex = 1 + Math.floor(rand() * (length - 1));
        pool.order[0] = pool.order[swapIndex];
        pool.order[swapIndex] = last;
      }
      pool.cursor = 0;
    }
    const next = pool.order[pool.cursor];
    pool.cursor += 1;
    return next;
  }

  function pickCategory(activeKeys, lastKey, rand) {
    if (activeKeys.length < 2) return activeKeys[0] || null;
    const choices = activeKeys.filter(function (key) { return key !== lastKey; });
    return choices[Math.floor(rand() * choices.length)];
  }

  function createHistory(cap) {
    const limit = cap === undefined ? 500 : cap;
    const entries = [];
    let cursor = -1;

    return {
      push: function (entry) {
        entries.length = cursor + 1;
        entries.push(entry);
        if (entries.length > limit) entries.shift();
        cursor = entries.length - 1;
      },
      back: function () {
        if (cursor <= 0) return null;
        cursor -= 1;
        return entries[cursor];
      },
      forward: function () {
        if (cursor >= entries.length - 1) return null;
        cursor += 1;
        return entries[cursor];
      },
      current: function () {
        return cursor < 0 ? null : entries[cursor];
      },
      atEnd: function () {
        return cursor === entries.length - 1;
      }
    };
  }

  function normalizePace(v) {
    return Math.round(clamp(0.5, 2.5, v) * 10) / 10;
  }

  function stepPace(pace, delta) {
    return normalizePace(pace + delta);
  }

  function parseOptions(search) {
    const params = new URLSearchParams(search);
    const cats = (params.get("cats") || "").split(",").map(function (key) {
      return key.trim().toLowerCase();
    }).filter(Boolean);
    const pace = parseFloat(params.get("pace"));
    const sleep = Number(params.get("sleep"));
    return {
      cats: cats,
      pace: Number.isFinite(pace) ? normalizePace(pace) : null,
      sleepHours: Number.isFinite(sleep) && sleep > 0 ? Math.min(sleep, 24) : 3
    };
  }

  function readStoredPace(storage) {
    try {
      const pace = parseFloat(storage.getItem(paceKey));
      return Number.isFinite(pace) ? normalizePace(pace) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStoredPace(storage, pace) {
    try {
      storage.setItem(paceKey, String(pace));
      return true;
    } catch (error) {
      return false;
    }
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateContent(json) {
    const categories = Object.create(null);
    if (isRecord(json) && isRecord(json.categories)) {
      Object.keys(json.categories).forEach(function (key) {
        const category = json.categories[key];
        if (!isRecord(category) || typeof category.label !== "string"
          || !category.label.trim() || typeof category.accent !== "string"
          || !/^#[0-9a-f]{6}$/i.test(category.accent) || !Array.isArray(category.items)) {
          return;
        }

        const items = category.items.filter(function (item) {
          return isRecord(item) && typeof item.t === "string" && item.t.trim();
        }).map(function (item) {
          const result = { t: item.t };
          if (typeof item.d === "string") result.d = item.d;
          if (typeof item.a === "string") result.a = item.a;
          return result;
        });
        if (items.length) {
          categories[key] = { label: category.label, accent: category.accent, items: items };
          // "style": "quote" sets the italic quote look for categories other than "quote".
          if (category.style === "quote") categories[key].style = "quote";
        }
      });
    }
    return { ok: Object.keys(categories).length > 0, categories: categories };
  }

  function randomCenter(rand, boxWpct, boxHpct) {
    function axis(min, max, size) {
      const margin = size / 2 + 3;
      const low = Math.max(min, margin);
      const high = Math.min(max, 100 - margin);
      return low <= high ? low + rand() * (high - low) : 50;
    }
    return { x: axis(42, 58, boxWpct), y: axis(40, 60, boxHpct) };
  }

  function keyAction(keyCode, key) {
    switch (keyCode) {
      case 461: return "pass-through";
      case 39: return "next";
      case 37: return "prev";
      case 13:
      case 415:
      case 19: return "toggle-pause";
      case 38: return "pace-up";
      case 40: return "pace-down";
      case 70: return "fullscreen";
    }

    switch (key) {
      case "ArrowRight": return "next";
      case "ArrowLeft": return "prev";
      case "Enter": return "toggle-pause";
      case "ArrowUp": return "pace-up";
      case "ArrowDown": return "pace-down";
      case "f":
      case "F": return "fullscreen";
      default: return "ignore";
    }
  }

  function filterCategories(all, requested) {
    const keys = Array.isArray(all) ? all : Object.keys(all);
    const matches = keys.filter(function (key) {
      return requested.indexOf(key.toLowerCase()) !== -1;
    });
    return matches.length ? matches : keys;
  }

  const core = {
    clamp: clamp,
    countWords: countWords,
    displaySeconds: displaySeconds,
    shuffle: shuffle,
    createPool: createPool,
    nextFromPool: nextFromPool,
    pickCategory: pickCategory,
    createHistory: createHistory,
    parseOptions: parseOptions,
    normalizePace: normalizePace,
    stepPace: stepPace,
    readStoredPace: readStoredPace,
    writeStoredPace: writeStoredPace,
    validateContent: validateContent,
    randomCenter: randomCenter,
    keyAction: keyAction,
    filterCategories: filterCategories
  };

  if (typeof module !== "undefined") module.exports = core;
  if (typeof window !== "undefined") window.BrightMinds = { core: core };
  if (typeof document === "undefined") return;

  const stage = document.getElementById("stage");
  if (!stage) return;

  const rand = Math.random;
  const history = createHistory(500);
  const pools = Object.create(null);
  const actions = {
    next: showNext,
    prev: showPrev,
    "toggle-pause": togglePause,
    "pace-up": function () { changePace(0.2); },
    "pace-down": function () { changePace(-0.2); },
    fullscreen: toggleFullscreen
  };
  let categories;
  let activeKeys;
  let pace;
  let sleepMs;
  let paused = false;
  let asleep = false;
  let slide;
  let toastNode;
  let wakeLock;
  let requestingWakeLock = false;
  let pendingEntry;
  let slideTimer;
  let transitionTimer;
  let toastTimer;
  let sleepTimer;
  let sleepFadeTimer;
  let clickTimer;
  let suppressClickUntil = 0;

  function fadeMs() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 250
      : 900;
  }

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function reveal(node) {
    // Commit the initial opacity before adding the fade-in class.
    node.getBoundingClientRect();
    node.classList.add("is-visible");
  }

  function render(entry) {
    const driftClasses = ["drift-a", "drift-b", "drift-c", "drift-d"];
    slide = makeNode("div", "slide-pos");
    slide.style.setProperty("--accent", entry.category.accent);
    const drift = makeNode("div", "slide-drift " + driftClasses[Math.floor(rand() * 4)]);
    const label = makeNode("div", "label");
    label.appendChild(makeNode("span", "dot"));
    label.appendChild(document.createTextNode(entry.category.label));
    drift.appendChild(label);
    drift.appendChild(makeNode("div", entry.key === "quote" || entry.category.style === "quote" ? "main is-quote" : "main", entry.item.t));
    if (entry.item.d) drift.appendChild(makeNode("div", "detail", entry.item.d));
    if (entry.item.a) drift.appendChild(makeNode("div", "author", entry.item.a));
    slide.appendChild(drift);
    stage.appendChild(slide);

    const box = slide.getBoundingClientRect();
    const center = randomCenter(rand, box.width / window.innerWidth * 100,
      box.height / window.innerHeight * 100);
    slide.style.left = center.x + "%";
    slide.style.top = center.y + "%";
    reveal(slide);
  }

  function transitionTo(entry) {
    clearTimeout(slideTimer);
    pendingEntry = entry;
    function replaceSlide() {
      transitionTimer = undefined;
      pendingEntry = undefined;
      if (slide) slide.remove();
      render(entry);
      schedule();
    }

    if (slide) {
      slide.classList.remove("is-visible");
      transitionTimer = setTimeout(replaceSlide, fadeMs());
    } else {
      replaceSlide();
    }
  }

  function schedule() {
    clearTimeout(slideTimer);
    const current = history.current();
    if (!paused && !asleep && transitionTimer === undefined && current) {
      slideTimer = setTimeout(showNext, displaySeconds(current.item, pace) * 1000);
    }
  }

  function showNext() {
    if (transitionTimer !== undefined) return;
    let entry = history.forward();
    if (!entry) {
      const last = history.current();
      const key = pickCategory(activeKeys, last && last.key, rand);
      const category = categories[key];
      entry = { key: key, category: category, item: category.items[nextFromPool(pools[key], rand)] };
      history.push(entry);
    }
    transitionTo(entry);
  }

  function showPrev() {
    if (transitionTimer !== undefined) return;
    const entry = history.back();
    if (entry) transitionTo(entry);
  }

  function removeToast() {
    clearTimeout(toastTimer);
    if (toastNode) toastNode.remove();
    toastNode = undefined;
  }

  function toast(text) {
    removeToast();
    toastNode = makeNode("div", "toast", text);
    toastNode.style.left = (20 + 60 * rand()) + "%";
    toastNode.style.top = (20 + 60 * rand()) + "%";
    stage.appendChild(toastNode);
    reveal(toastNode);
    toastTimer = setTimeout(function () {
      toastNode.classList.remove("is-visible");
      toastTimer = setTimeout(removeToast, fadeMs());
    }, 1500);
  }

  function togglePause() {
    paused = !paused;
    schedule();
    toast(paused ? "Paused" : "Playing");
  }

  function getStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function changePace(delta) {
    pace = stepPace(pace, delta);
    writeStoredPace(getStorage(), pace);
    toast("Speed " + pace.toFixed(1) + "x");
  }

  function toggleFullscreen() {
    try {
      const full = document.fullscreenElement || document.webkitFullscreenElement;
      const element = document.documentElement;
      const method = full
        ? document.exitFullscreen || document.webkitExitFullscreen
        : element.requestFullscreen || element.webkitRequestFullscreen;
      if (method) {
        const result = method.call(full ? document : element);
        if (result && typeof result.catch === "function") result.catch(function () {});
      }
    } catch (error) {
      // Fullscreen is optional on the TV browser.
    }
  }

  function releaseLock(lock) {
    if (!lock) return;
    try {
      const result = lock.release();
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (error) {
      // The browser may already have released the lock.
    }
  }

  function requestWakeLock() {
    if (asleep || document.hidden || requestingWakeLock || (wakeLock && !wakeLock.released)) return;
    try {
      if (!("wakeLock" in navigator)) return;
      requestingWakeLock = true;
      navigator.wakeLock.request("screen").then(function (lock) {
        requestingWakeLock = false;
        if (asleep || document.hidden) {
          releaseLock(lock);
        } else {
          wakeLock = lock;
        }
      }).catch(function () { requestingWakeLock = false; });
    } catch (error) {
      requestingWakeLock = false;
    }
  }

  function clearStage() {
    stage.textContent = "";
    slide = undefined;
    toastNode = undefined;
  }

  function goToSleep() {
    asleep = true;
    clearTimeout(slideTimer);
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
    clearTimeout(toastTimer);
    clearTimeout(clickTimer);
    stage.classList.add("is-asleep");
    sleepFadeTimer = setTimeout(clearStage, fadeMs());
    releaseLock(wakeLock);
    wakeLock = undefined;
  }

  function resetSleepTimer() {
    clearTimeout(sleepTimer);
    if (!asleep) sleepTimer = setTimeout(goToSleep, sleepMs);
  }

  function wake() {
    clearTimeout(sleepFadeTimer);
    clearStage();
    asleep = false;
    paused = false;
    stage.classList.remove("is-asleep");
    requestWakeLock();
    if (pendingEntry) {
      // Sleep can interrupt a fade before the selected slide is shown.
      transitionTo(pendingEntry);
    } else {
      showNext();
    }
    resetSleepTimer();
  }

  function onKeyDown(event) {
    const action = keyAction(event.keyCode, event.key);
    const handled = action !== "ignore" && action !== "pass-through";
    if (handled) event.preventDefault();
    if (asleep) {
      wake();
      return;
    }
    resetSleepTimer();
    if (handled) actions[action]();
  }

  function onClick() {
    if (asleep) {
      suppressClickUntil = Date.now() + 300;
      wake();
      return;
    }
    resetSleepTimer();
    if (Date.now() < suppressClickUntil) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(showNext, 300);
  }

  function onDoubleClick() {
    clearTimeout(clickTimer);
    if (asleep) {
      wake();
      return;
    }
    resetSleepTimer();
    if (Date.now() >= suppressClickUntil) toggleFullscreen();
  }

  function renderLoadError() {
    render({
      key: "error",
      category: { label: "Bright Minds", accent: "#ffad66" },
      item: {
        t: "The content could not load.",
        d: "Start ./serve.sh and open the printed address."
      }
    });
  }

  function start(json) {
    const content = validateContent(json);
    if (!content.ok) {
      renderLoadError();
      return;
    }
    const options = parseOptions(window.location.search);
    categories = content.categories;
    activeKeys = filterCategories(categories, options.cats);
    activeKeys.forEach(function (key) {
      pools[key] = createPool(categories[key].items.length, rand);
    });
    pace = options.pace || readStoredPace(getStorage()) || 1;
    sleepMs = options.sleepHours * 3600000;

    requestWakeLock();
    document.addEventListener("visibilitychange", requestWakeLock);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick);
    window.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("wheel", resetSleepTimer);
    showNext();
    resetSleepTimer();
  }

  function boot() {
    if (window.location.protocol === "file:" || typeof window.fetch !== "function") {
      renderLoadError();
      return;
    }
    window.fetch("content.json", { cache: "no-store" }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(start, renderLoadError);
  }

  boot();
}());
