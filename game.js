// Kurpark-Quest – Spiellogik. Alle veränderbaren Werte stehen in config.js.
(() => {
  const C = CONFIG;
  const VW = C.view.width, VH = C.view.height;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = id => document.getElementById(id);
  const rand = ([min, max]) => min + Math.random() * (max - min);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const PIXEL_FONT = '"Press Start 2P", monospace';

  // ---------- Karte ----------
  // Lauflängenkodierte Zeilen ("12.5W3G") zu einem Raster entpacken
  const grid = MAP_ROWS.map(row => row.replace(/(\d+)(.)/g, (_, n, ch) => ch.repeat(+n)));
  const mapW = grid[0].length * MAP_CELL, mapH = grid.length * MAP_CELL;
  const cellAt = (x, y) => (grid[Math.floor(y / MAP_CELL)] || "")[Math.floor(x / MAP_CELL)] || ".";

  // Liegt die Fußfläche (Breite × Höhe, Unterkante bei y) ganz auf erlaubten Zellen?
  function canStand(x, y, box, allowed) {
    const left = x - box.width / 2, right = x + box.width / 2, top = y - box.height;
    for (let py = top; ; py = Math.min(py + MAP_CELL, y)) {
      for (let px = left; ; px = Math.min(px + MAP_CELL, right)) {
        if (!allowed.includes(cellAt(px, py))) return false;
        if (px === right) break;
      }
      if (py === y) break;
    }
    return true;
  }
  const WALKABLE = "WGU";       // Weg, Rasen, unter Baumkronen
  const OPEN = "WG";            // offene Flächen: hier erscheinen Schätze und laufen Gänse

  // Freie Fläche auf Weg oder Rasen mit etwas Abstand zu Hindernissen
  function isOpenGround(x, y) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!OPEN.includes(cellAt(x + dx * MAP_CELL, y + dy * MAP_CELL))) return false;
    }
    return true;
  }

  // ---------- Zustand ----------
  const state = {
    mode: "start",      // "start" | "play" | "end"
    clock: 0,           // läuft immer (für Wasser und Animationen)
    camera: { x: 0, y: 0 },
    showWalkable: false,
    muted: false,
  };
  function resetRound() {
    Object.assign(state, {
      time: C.round.duration,
      score: 0,
      energy: C.energy.max,
      protect: 0,         // Schutzzeit nach einer Berührung mit Gans oder Igel
      drinking: false,
      player: { ...C.player.start, dir: "down", moving: false, walkTime: 0 },
      items: [],          // { type, x, y, age, life }
      popups: [],         // aufsteigende Texte wie „+100“: { x, y, text, color, age }
      critters: KINDS.flatMap(kind => kind.starts.map(start => makeCritter(kind, start))),   // Gänse und Igel
      squirrel: { mode: "away", timer: rand(C.squirrel.interval) },
      crownTaken: false,
      spawnTimer: 0,
      wasEmpty: false, wasFull: true,
    });
    updateCamera();
    for (let n = 0; n < C.items.startCount; n++) spawnItem();
  }

  // ---------- Eingabe ----------
  const keys = {};
  addEventListener("keydown", e => {
    if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "l") state.showWalkable = !state.showWalkable;
    if (k === "m") state.muted = !state.muted;
    if (k === "enter" && state.mode !== "play" && state.clock > menuReadyAt) startRound();
    keys[e.key] = true;
  });
  addEventListener("keyup", e => { keys[e.key] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  // Touch: Joystick erscheint dort, wo der Finger aufsetzt; Trinken-Knopf unten rechts
  const stage = $("stage"), stickEl = $("stick"), knobEl = $("knob");
  const stick = { id: null, x: 0, y: 0, dx: 0, dy: 0 };
  const coarse = matchMedia("(pointer: coarse)");
  const portrait = matchMedia("(orientation: portrait) and (pointer: coarse)");
  if (coarse.matches) document.body.classList.add("touch");
  stage.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" || e.target.closest("button")) return;
    document.body.classList.add("touch");
    if (state.mode !== "play" || stick.id !== null) return;
    const box = stage.getBoundingClientRect();
    Object.assign(stick, { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
    stickEl.style.left = e.clientX - box.left + "px"; stickEl.style.top = e.clientY - box.top + "px";
    knobEl.style.transform = "";
    stickEl.hidden = false;
  });
  stage.addEventListener("pointermove", e => {
    if (e.pointerId !== stick.id) return;
    const T = C.touch, vx = e.clientX - stick.x, vy = e.clientY - stick.y, len = Math.hypot(vx, vy);
    const k = Math.min(1, T.radius / (len || 1));
    knobEl.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
    // auf acht Richtungen einrasten, damit sich Touch wie die Pfeiltasten verhält
    const a = Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) * (Math.PI / 4);
    stick.dx = len < T.deadZone ? 0 : Math.round(Math.cos(a));
    stick.dy = len < T.deadZone ? 0 : Math.round(Math.sin(a));
  });
  const releaseStick = e => { if (e.pointerId === stick.id) { stick.id = null; stick.dx = stick.dy = 0; stickEl.hidden = true; } };
  stage.addEventListener("pointerup", releaseStick);
  stage.addEventListener("pointercancel", releaseStick);
  const drinkBtn = $("drink");
  drinkBtn.addEventListener("pointerdown", e => { e.preventDefault(); drinkBtn.setPointerCapture(e.pointerId); keys[" "] = true; });
  for (const type of ["pointerup", "pointercancel"]) drinkBtn.addEventListener(type, () => { keys[" "] = false; });

  // ---------- Sound (einfache Platzhalter-Töne) ----------
  let audio = null;
  // Ein Ton: Frequenz gleitet von freq nach freqEnd (für Schnattern, Seufzen, Posaune)
  function tone(freq, start, len, wave, volume, freqEnd = freq) {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, start + len);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + len);
    osc.connect(gain).connect(audio.destination);
    osc.start(start); osc.stop(start + len);
  }
  // pitch verschiebt den ganzen Effekt (z. B. höher für wertvollere Schätze)
  function playSound(name, pitch = 1) {
    const notes = C.sound.sounds[name];
    if (!audio || state.muted || !notes) return;
    let t = audio.currentTime;
    for (const [freq, len, wave, freqEnd] of notes) {
      if (freq) tone(freq * pitch, t, len, wave, C.sound.volume, (freqEnd || freq) * pitch);
      t += len;
    }
  }

  // ---------- Musik ----------
  // Tempo hängt am Spielgeschehen: erschöpft leiert sie, kurz vor Schluss wird sie hektisch
  const M = C.music, music = { el: null, timer: null, step: 0, next: 0 };
  const midi = n => 440 * 2 ** ((n - 69) / 12);
  function musicRate() {
    if (state.mode !== "play") return 1;
    if (state.energy <= 0) return M.tiredRate;
    return state.time <= C.round.warnAt ? M.hurryRate : 1;
  }
  function stopMusic() {
    if (music.el) music.el.pause();
    clearInterval(music.timer); music.timer = null;
  }
  function startMusic() {
    stopMusic();
    if (M.file) {                                    // Musikdatei: wird langsamer und tiefer bzw. schneller abgespielt
      music.el = music.el || Object.assign(new Audio(M.file + "?v=" + C.version), { loop: true, preservesPitch: false });
      music.el.currentTime = 0; music.el.volume = M.volume;
      music.el.play().catch(() => {});
    } else if (audio) {                              // sonst die eingebaute Chiptune-Melodie
      music.step = 0; music.next = audio.currentTime + 0.15;
      music.timer = setInterval(scheduleMusic, 50);
    }
  }
  function scheduleMusic() {
    while (music.next < audio.currentTime + 0.2) {
      const rate = musicRate(), len = 30 / M.bpm / rate, pitch = rate < 1 ? M.tiredPitch : 1;
      const i = music.step++ % M.melody.length;
      if (!state.muted) {
        if (M.melody[i]) tone(midi(M.melody[i]) * pitch, music.next, len * 0.9, "square", M.volume * 0.5);
        if (i % 2 === 0 && M.bass[i / 2]) tone(midi(M.bass[i / 2]) * pitch, music.next, len * 1.6, "triangle", M.volume);
      }
      music.next += len;
    }
  }
  function updateMusic() {
    if (!music.el) return;
    music.el.muted = state.muted;
    music.el.playbackRate = musicRate();
  }

  // ---------- Spielfigur ----------
  function updatePlayer(dt) {
    const p = state.player, P = C.player;
    let dx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0) || stick.dx;
    let dy = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0) || stick.dy;
    if (state.drinking) dx = dy = 0;                           // beim Trinken bleibt die Figur stehen
    p.moving = dx !== 0 || dy !== 0;
    if (!p.moving) { p.walkTime = 0; return; }

    p.dir = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
    const tired = state.energy <= 0 ? C.energy.emptySpeedFactor : 1;
    const d = P.speed * tired * dt / Math.hypot(dx, dy);       // diagonal nicht schneller
    const free = (x, y) => canStand(x, y, P.hitbox, WALKABLE);
    const step = (ax, ay) => free(p.x + ax, p.y + ay) && (p.x += ax, p.y += ay, true);
    // Achsen getrennt prüfen; an Ecken, schrägen Kanten und in engen Durchgängen weicht die Figur selbst seitlich aus
    const nudge = (mx, my) => {
      for (const s of [2, 4, P.slide]) for (const side of [-1, 1]) {
        const ox = my ? side * s : 0, oy = mx ? side * s : 0;
        if (free(p.x + mx + ox, p.y + my + oy)) return step(Math.sign(ox) * d, Math.sign(oy) * d);
      }
    };
    if (dx && !step(dx * d, 0) && !dy) nudge(dx * d, 0);
    if (dy && !step(0, dy * d) && !dx) nudge(0, dy * d);
    p.walkTime += dt * tired;
  }

  function updateCamera() {
    const p = state.player || C.player.start;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    state.camera.x = Math.round(clamp(p.x - VW / 2, mapW - VW));
    state.camera.y = Math.round(clamp(p.y - VH / 2, mapH - VH));
  }

  // ---------- Energie und Trampelquelle ----------
  const atSpring = () => dist(state.player, C.spring) < C.spring.radius;
  let drinkSoundTimer = 0;
  function updateEnergy(dt) {
    const E = C.energy;
    state.drinking = !!keys[" "] && atSpring();
    if (state.drinking) {
      state.energy = Math.min(E.max, state.energy + C.spring.refillPerSecond * dt);
      if ((drinkSoundTimer -= dt) <= 0) { playSound("drink"); drinkSoundTimer = 0.3; }
    } else {
      state.energy = Math.max(0, state.energy - E.drainPerSecond * dt);
      drinkSoundTimer = 0;
    }
    const empty = state.energy <= 0, full = state.energy >= E.max;
    if (empty && !state.wasEmpty) playSound("tired");
    if (full && !state.wasFull) playSound("ahh");
    state.wasEmpty = empty; state.wasFull = full;
  }

  // ---------- Schätze ----------
  function pickItemType() {
    const types = C.items.types;
    let r = Math.random() * types.reduce((sum, t) => sum + t.chance, 0);
    return types.find(t => (r -= t.chance) < 0) || types[0];
  }

  // Zufällige Stelle im sichtbaren Ausschnitt plus großem Rand suchen, aber nicht direkt am Brunnen;
  // findet sich keine, entfällt dieser Schatz
  function spawnItem() {
    const I = C.items, cam = state.camera, m = I.spawnMargin;
    for (let tries = 0; tries < 40; tries++) {
      const pos = { x: cam.x - m + Math.random() * (VW + 2 * m), y: cam.y - m + Math.random() * (VH + 2 * m) };
      const tooClose = o => dist(pos, o) < I.minDistance;
      if (!isOpenGround(pos.x, pos.y) || tooClose(state.player) || state.items.some(tooClose) || dist(pos, C.spring) < I.springDistance) continue;
      state.items.push({ type: pickItemType(), ...pos, age: 0, life: rand(I.lifetime) });
      return;
    }
  }

  const POPUP_TIME = 0.9;   // Sekunden, die ein „+100“ sichtbar bleibt
  const addPopup = (x, y, text, color) => state.popups.push({ x, y, text, color, age: 0 });

  function updateItems(dt) {
    const I = C.items, p = state.player;
    if ((state.spawnTimer -= dt) <= 0) {
      if (state.items.length < I.maxOnMap) spawnItem();
      state.spawnTimer = rand(I.spawnInterval);
    }
    state.items = state.items.filter(it => {
      it.age += dt;
      if (dist(it, p) < I.pickupRadius) {
        state.score += it.type.points;
        addPopup(it.x, it.y - 56, "+" + it.type.points, it.type.color);
        playSound("collect", 0.8 + I.types.indexOf(it.type) * 0.2);
        return false;
      }
      return it.age < it.life;
    });
    // Die Krone im Schloss gibt es nur einmal pro Runde
    const K = C.crown;
    if (!state.crownTaken && dist(K, p) < K.pickupRadius) {
      state.crownTaken = true;
      state.score += K.points;
      addPopup(K.x, K.y - 50, "+" + K.points, K.color);
      playSound("crown");
    }
    state.popups = state.popups.filter(pop => (pop.age += dt) < POPUP_TIME);
  }

  // ---------- Wildgänse und Igel: laufen herum und kosten bei Berührung Energie ----------
  const KINDS = [{ ...C.geese, img: "goose" }, { ...C.hedgehogs, img: "hedgehog" }];
  const CRITTER_BOX = { width: 10, height: 6 };

  // Startplatz auf die nächste freie Stelle schieben, falls er nicht begehbar ist
  function makeCritter(kind, start) {
    let pos = start;
    search: for (let r = 0; r <= 120; r += MAP_CELL) {
      for (let a = 0; a < 16; a++) {
        const cand = { x: start.x + Math.cos(a * Math.PI / 8) * r, y: start.y + Math.sin(a * Math.PI / 8) * r };
        if (isOpenGround(cand.x, cand.y)) { pos = cand; break search; }
      }
    }
    return { kind, x: pos.x, y: pos.y, home: { ...pos }, vx: 0, vy: 0, faceLeft: Math.random() < 0.5,
             moving: false, timer: Math.random() * 1.5, walkTime: 0, cry: 0 };
  }

  function updateCritters(dt) {
    const p = state.player;
    state.protect = Math.max(0, state.protect - dt);
    for (const c of state.critters) {
      const K = c.kind;
      c.cry = Math.max(0, c.cry - dt);
      if ((c.timer -= dt) <= 0) {
        c.moving = !c.moving;
        c.timer = rand(c.moving ? K.walkTime : K.pauseTime);
        if (c.moving) {
          // neue Richtung: zufällig, oder zurück zum Startplatz, wenn das Tier zu weit weg ist
          const angle = dist(c, c.home) > K.homeRadius
            ? Math.atan2(c.home.y - c.y, c.home.x - c.x) + (Math.random() - 0.5)
            : Math.random() * Math.PI * 2;
          c.vx = Math.cos(angle) * K.speed; c.vy = Math.sin(angle) * K.speed;
          c.faceLeft = c.vx < 0;
        }
      }
      if (c.moving) {
        const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
        if (canStand(nx, ny, CRITTER_BOX, OPEN)) { c.x = nx; c.y = ny; c.walkTime += dt; }
        else c.timer = 0;                                       // Hindernis: stehen bleiben, dann neue Richtung
      }
      if (state.protect <= 0 && dist(c, p) < K.hitRadius) {
        state.energy = Math.max(0, state.energy - K.energyLoss);
        state.protect = K.protectTime;
        c.cry = 0.8;
        addPopup(p.x, p.y - 56, "-" + K.energyLoss, K.color);
        playSound(K.sound);
      }
    }
  }

  // ---------- Eichhörnchen: klaut herumliegende Schätze; wer es mit Beute erwischt, bekommt die Punkte ----------
  function lineHas(ax, ay, bx, by, test) {
    for (let k = 0; k <= 1.001; k += 0.05) if (test(ax + (bx - ax) * k, ay + (by - ay) * k)) return true;
    return false;
  }
  function updateSquirrel(dt) {
    const Q = C.squirrel, q = state.squirrel, p = state.player;
    if (q.mode === "away") {
      if ((q.timer -= dt) > 0 || !state.items.length) return;
      // kommt aus zufälliger Richtung angerannt, aber nie übers Wasser
      const target = state.items[Math.floor(Math.random() * state.items.length)];
      const a = Math.random() * Math.PI * 2, d = rand(Q.range);
      const from = { x: target.x + Math.cos(a) * d, y: target.y + Math.sin(a) * d };
      if (lineHas(from.x, from.y, target.x, target.y, (x, y) => cellAt(x, y) === "~")) { q.timer = 0.3; return; }
      Object.assign(q, { mode: "fetch", x: from.x, y: from.y, from, target, loot: null, run: 0 });
      return;
    }
    if (q.mode === "fetch" && !state.items.includes(q.target)) q.mode = "flee";   // Schatz ist schon weg: Rückzug
    const goal = q.mode === "fetch" ? q.target : q.from;
    const d = dist(q, goal), step = Q.speed * dt;
    q.faceLeft = goal.x < q.x; q.run += dt;
    if (d > step) { q.x += (goal.x - q.x) / d * step; q.y += (goal.y - q.y) / d * step; }
    else if (q.mode === "fetch") {
      state.items.splice(state.items.indexOf(q.target), 1);
      q.loot = q.target.type; q.mode = "flee";
      addPopup(q.x, q.y - 40, "GEKLAUT!", Q.color);
      playSound("steal");
    } else { q.mode = "away"; q.timer = rand(Q.interval); }
    if (q.loot && dist(q, p) < Q.catchRadius) {
      state.score += q.loot.points;
      addPopup(q.x, q.y - 40, "+" + q.loot.points, q.loot.color);
      playSound("collect", 1.3);
      q.loot = null;
    }
  }

  // ---------- Leben auf dem Wasser: Schwäne gleiten umher, im Schlossgraben springt ab und zu ein Karpfen ----------
  const isWater = (x, y) => [[0, 0], [-8, 0], [8, 0], [0, -6], [0, 6]].every(([dx, dy]) => cellAt(x + dx, y + dy) === "~");
  const swans = C.swans.starts.map(s => ({ ...s, target: null, wait: Math.random() * 3, faceLeft: Math.random() < 0.5 }));
  function updateSwans(dt) {
    const S = C.swans;
    for (const s of swans) {
      if (s.wait > 0) { s.wait -= dt; continue; }
      if (!s.target) {
        // neues Ziel in der Nähe; gilt nur, wenn der ganze Weg dorthin über Wasser führt
        const a = Math.random() * Math.PI * 2, d = rand(S.hop);
        const t = { x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d };
        if (!lineHas(s.x, s.y, t.x, t.y, (x, y) => !isWater(x, y))) { s.target = t; s.faceLeft = t.x < s.x; }
        continue;
      }
      const d = dist(s, s.target), step = S.speed * dt;
      if (d <= step) { s.target = null; s.wait = rand(S.pause); }
      else { s.x += (s.target.x - s.x) / d * step; s.y += (s.target.y - s.y) / d * step; }
    }
  }

  const carp = { timer: rand(C.carp.interval), jump: null };   // jump: { x, y, dir, t }
  function updateCarp(dt) {
    const K = C.carp, A = K.area;
    if (carp.jump) { if ((carp.jump.t += dt) > K.duration) carp.jump = null; return; }
    if ((carp.timer -= dt) > 0) return;
    carp.timer = 0.5;                                    // falls sich keine freie Wasserstelle findet: gleich noch einmal versuchen
    for (let tries = 0; tries < 30; tries++) {
      // erst im sichtbaren Ausschnitt suchen, dann im ganzen Schlossgraben
      const box = tries < 15 ? { x: state.camera.x, y: state.camera.y, width: VW, height: VH } : A;
      const x = box.x + Math.random() * box.width, y = box.y + Math.random() * box.height;
      const inArea = x > A.x && x < A.x + A.width && y > A.y && y < A.y + A.height;
      if (!inArea || lineHas(x - K.length, y, x + K.length, y, (px, py) => !isWater(px, py))) continue;
      carp.jump = { x, y, dir: Math.random() < 0.5 ? -1 : 1, t: 0 };
      carp.timer = rand(K.interval);
      if (state.mode === "play" && inView(x, y, 0)) playSound("splash");
      return;
    }
  }

  // ---------- Wasser: Glitzern, Fontänen, Wasserfälle ----------
  const fx = document.createElement("canvas");            // Zwischenbild für das Glitzern
  fx.width = VW; fx.height = VH;
  const fxCtx = fx.getContext("2d");
  let shimmer = null;

  // Kleines Kachelmuster aus hellen und dunklen Strichen
  function buildShimmer() {
    const size = 64, tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const g = tile.getContext("2d");
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // immer dasselbe Muster
    for (let i = 0; i < 44; i++) {
      g.fillStyle = i % 3 ? "rgba(255, 255, 255, 0.75)" : "rgba(12, 70, 150, 0.5)";
      g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 3 + Math.floor(rnd() * 5), 1);
    }
    return fxCtx.createPattern(tile, "repeat");
  }

  function drawShimmer() {
    const cam = state.camera, drift = state.clock * C.water.speed;
    fxCtx.globalCompositeOperation = "source-over";
    fxCtx.clearRect(0, 0, VW, VH);
    fxCtx.fillStyle = shimmer;
    // zwei Schichten, die gegeneinander wandern; das Muster hängt an der Karte, nicht am Bildschirm
    for (const [dirX, dirY] of [[1, 0.35], [-0.6, -0.2]]) {
      const ox = Math.round(cam.x + drift * dirX), oy = Math.round(cam.y + drift * dirY);
      fxCtx.setTransform(1, 0, 0, 1, -ox, -oy);
      fxCtx.fillRect(ox, oy, VW, VH);
    }
    fxCtx.setTransform(1, 0, 0, 1, 0, 0);
    fxCtx.globalCompositeOperation = "destination-in";     // nur dort stehen lassen, wo Wasser ist
    fxCtx.drawImage(IMG.water, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
    ctx.globalAlpha = C.water.strength;
    ctx.drawImage(fx, 0, 0);
    ctx.globalAlpha = 1;
  }

  const inView = (x, y, margin) => x > state.camera.x - margin && x < state.camera.x + VW + margin &&
                                   y > state.camera.y - margin && y < state.camera.y + VH + margin;

  // Fontänen: Tropfen steigen aus dem Fußpunkt auf und fallen zurück
  const fountains = C.water.fountains.map(f => ({ ...f, drops: [], emit: 0, rate: f.drops }));
  function updateFountains(dt) {
    const grav = C.water.gravity;
    for (const f of fountains) {
      if (!inView(f.x, f.y, 80)) { f.drops.length = 0; continue; }
      for (f.emit += f.rate * dt; f.emit >= 1; f.emit--) {
        const up = Math.sqrt(2 * grav * f.height) * (0.75 + Math.random() * 0.3);
        f.drops.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * f.spread * 2.2, vy: -up, land: f.y + Math.random() * 4 });
      }
      f.drops = f.drops.filter(d => {
        d.vy += grav * dt; d.x += d.vx * dt; d.y += d.vy * dt;
        return d.vy < 0 || d.y < d.land;
      });
    }
  }
  function drawFountains() {
    const cam = state.camera, t = state.clock;
    for (const f of fountains) {
      if (!inView(f.x, f.y, 80)) continue;
      const sx = f.x - cam.x, sy = f.y - cam.y;
      // Wellenringe um den Fuß
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
      for (let i = 0; i < 3 && f.ripple; i++) {
        const phase = (t * 0.55 + i / 3) % 1, r = 6 + phase * f.ripple;
        ctx.globalAlpha = (1 - phase) * 0.55;
        ctx.beginPath(); ctx.ellipse(sx, sy + 3, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      }
      // pulsierender Strahl
      const h = f.height * (0.86 + 0.14 * Math.sin(t * 11 + f.x));
      const wide = f.height > 30 ? 2 : 1;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.35; ctx.fillRect(Math.round(sx) - wide - 1, Math.round(sy - h * 0.8), wide * 2 + 3, Math.round(h * 0.8));
      ctx.globalAlpha = 0.6;  ctx.fillRect(Math.round(sx) - wide, Math.round(sy - h), wide * 2 + 1, Math.round(h));
      // Tropfen
      ctx.globalAlpha = 0.9;
      f.drops.forEach((d, i) => {
        ctx.fillStyle = i % 3 ? "#ffffff" : "#bfe6ff";
        const size = f.height > 30 && i % 4 === 0 ? 3 : 2;
        ctx.fillRect(Math.round(d.x - cam.x), Math.round(d.y - cam.y), size, size);
      });
      ctx.globalAlpha = 1;
    }
  }

  // Wasserfälle: weiße Striche wandern im Rechteck nach unten
  function drawWaterfalls() {
    const cam = state.camera, fall = state.clock * C.water.fallSpeed;
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (const w of C.water.waterfalls) {
      if (!inView(w.x + w.width / 2, w.y, 100)) continue;
      for (let i = 0; i < w.width * 0.7; i++) {
        const x = w.x + (i * 37 % w.width), y = (i * 53 + fall * (0.8 + (i % 5) * 0.1)) % w.height;
        ctx.fillRect(Math.round(x - cam.x), Math.round(w.y + y - cam.y), 1, Math.min(4, w.height - y));
      }
    }
  }

  // ---------- Darstellung ----------
  const IMG = {};          // geladene Bilder, siehe SOURCES am Dateiende
  let walkOverlay;

  // Lädt ein Bild mit Versionsnummer, damit der Browser nach einem Update nicht das alte zeigt
  const loadImage = src => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => {
      if (img.src.includes("?v=")) img.src = src;           // falls der Server die Versionsnummer nicht mag
      else fail(new Error("Bild fehlt: " + src));
    };
    img.src = src + "?v=" + C.version;
  });

  // Gesperrte Zellen als kleines Bild (1 Zelle = 1 Pixel), zum Prüfen mit Taste L
  function buildWalkOverlay() {
    const c = document.createElement("canvas");
    c.width = grid[0].length; c.height = grid.length;
    const g = c.getContext("2d");
    const colors = { ".": "rgba(190, 0, 70, 0.6)", "~": "rgba(190, 0, 70, 0.6)", "U": "rgba(0, 110, 255, 0.55)" };   // gesperrt / Wasser / unter Baumkrone
    grid.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) if (colors[row[gx]]) { g.fillStyle = colors[row[gx]]; g.fillRect(gx, gy, 1, 1); }
    });
    return c;
  }

  function drawShadow(sx, sy, rx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx * 0.36, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Umrandeter Pixeltext (Kartenkoordinaten bereits abgezogen)
  function drawText(text, x, y, color, size = 8) {
    ctx.font = `${size}px ${PIXEL_FONT}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#14203a";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  const DIR_ROW = { down: 0, right: 1, left: 1, up: 2 };   // links = rechts gespiegelt
  function drawPlayer() {
    const p = state.player, f = C.player.frame, a = C.player.anchor;
    const sx = Math.round(p.x - state.camera.x), sy = Math.round(p.y - state.camera.y);
    drawShadow(sx, sy, 11);
    if (state.protect > 0 && Math.floor(state.clock * 12) % 2) return;       // blinkt in der Schutzzeit
    // Beim Trinken: Reihe 3 des Sprite-Sheets, Glas kurz vor der Brust, dann länger am Mund
    const drink = state.drinking;
    const col = drink ? (Math.floor(state.clock * 4) % 4 ? 1 : 0) : p.moving ? Math.floor(p.walkTime * C.player.stepsPerSecond) % 4 : 1;
    ctx.save();
    ctx.translate(sx, sy);
    if (p.dir === "left" && !drink) ctx.scale(-1, 1);
    ctx.drawImage(IMG.player, col * f.width, (drink ? 3 : DIR_ROW[p.dir]) * f.height, f.width, f.height, -a.x, -a.y, f.width, f.height);
    ctx.restore();
  }

  // Zeichnet ein Bild aus einem Sprite-Sheet mit dem Ankerpunkt auf (sx, sy), auf Wunsch gespiegelt
  function drawSprite(img, f, a, col, sx, sy, flip) {
    ctx.save();
    ctx.translate(sx, sy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, col * f.width, 0, f.width, f.height, -a.x, -a.y, f.width, f.height);
    ctx.restore();
  }
  const screenX = o => Math.round(o.x - state.camera.x), screenY = o => Math.round(o.y - state.camera.y);

  function drawCritter(c) {
    const K = c.kind, sx = screenX(c), sy = screenY(c);
    drawShadow(sx, sy, K.frame.width / 3.6);
    drawSprite(IMG[K.img], K.frame, K.anchor, c.moving ? Math.floor(c.walkTime * 6) % 2 : 0, sx, sy, c.faceLeft);
  }
  function drawCry(c) {
    if (c.cry > 0) drawText(c.kind.cry, screenX(c) + (c.faceLeft ? -26 : 26), screenY(c) - 30, "#ffffff", 7);
  }

  function drawSquirrel() {
    const Q = C.squirrel, q = state.squirrel, sx = screenX(q), sy = screenY(q), size = C.items.frame;
    drawShadow(sx, sy, 10);
    drawSprite(IMG.squirrel, Q.frame, Q.anchor, Math.floor(q.run * 10) % 2, sx, sy, q.faceLeft);
    if (q.loot) ctx.drawImage(IMG.items, C.items.types.indexOf(q.loot) * size, 0, size, size, sx - 7, sy - Q.frame.height - 12, 14, 14);   // Beute über dem Kopf
  }

  function drawSwans() {
    const S = C.swans;
    for (const s of swans) {
      if (!inView(s.x, s.y, 40)) continue;
      const sx = screenX(s), sy = screenY(s) + Math.round(Math.sin(state.clock * 2 + s.x) * 1);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 17 + Math.sin(state.clock * 3 + s.y) * 2, 5, 0, 0, Math.PI * 2); ctx.stroke();   // Wellenring
      drawSprite(IMG.swan, S.frame, S.anchor, 0, sx, sy, s.faceLeft);
    }
  }

  // Der Karpfen fliegt in einem Bogen aus dem Wasser; beim Absprung und Eintauchen spritzt es
  function drawCarp() {
    const j = carp.jump, K = C.carp;
    if (!j || !inView(j.x, j.y, 60)) return;
    const p = j.t / K.duration, cam = state.camera;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
    for (const [at, from] of [[-1, 0], [1, 0.75]]) {          // Spritzer: Absprung ab p = 0, Eintauchen ab p = 0.75
      const k = (p - from) / 0.4;
      if (k < 0 || k > 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.ellipse(j.x + at * j.dir * K.length / 2 - cam.x, j.y - cam.y, 4 + k * 12, 2 + k * 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(Math.round(j.x + j.dir * K.length * (p - 0.5) - cam.x), Math.round(j.y - K.height * 4 * p * (1 - p) - cam.y));
    ctx.scale(j.dir, 1);
    ctx.rotate(Math.atan2(-K.height * 4 * (1 - 2 * p), K.length));   // Nase zeigt in Flugrichtung
    ctx.drawImage(IMG.carp, -K.frame.width / 2, -K.frame.height / 2);
    ctx.restore();
  }

  // Schatz mit Leuchten und Schatten; schwebt leicht auf und ab
  function drawTreasure(x, y, index, age, glow = 15) {
    const size = C.items.frame, sx = Math.round(x - state.camera.x), sy = Math.round(y - state.camera.y);
    const bob = Math.round(Math.sin(age * 5) * 2);
    ctx.fillStyle = "rgba(255, 244, 170, 0.35)";
    ctx.beginPath(); ctx.arc(sx, sy - size / 2, glow + bob, 0, Math.PI * 2); ctx.fill();
    drawShadow(sx, sy, 8);
    ctx.drawImage(IMG.items, index * size, 0, size, size, sx - size / 2, sy - size - 2 + bob, size, size);
  }
  function drawItem(it) {
    if (it.life - it.age < C.items.blinkTime && Math.floor(it.age * 8) % 2) return;   // blinkt kurz vor dem Verschwinden
    drawTreasure(it.x, it.y, C.items.types.indexOf(it.type), it.age);
  }
  // Kleine Pfeile am Bildrand zeigen zu Schätzen, die außerhalb des Ausschnitts liegen
  function drawItemPointers() {
    const cx = VW / 2, cy = VH / 2 + 10, rx = VW / 2 - 12, ry = VH / 2 - 26;       // oben bleibt Platz für die Anzeige
    for (const it of state.items) {
      if (inView(it.x, it.y, 0)) continue;
      if (it.life - it.age < C.items.blinkTime && Math.floor(it.age * 8) % 2) continue;
      const dx = it.x - state.camera.x - cx, dy = it.y - state.camera.y - cy;
      const k = Math.min(rx / Math.abs(dx || 1), ry / Math.abs(dy || 1));          // auf den Bildrand schieben
      ctx.save();
      ctx.translate(Math.round(cx + dx * k), Math.round(cy + dy * k));
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = "#14203a"; ctx.stroke();
      ctx.fillStyle = it.type.color; ctx.fill();
      ctx.restore();
    }
  }
  const drawCrown = () => drawTreasure(C.crown.x, C.crown.y, C.crown.frame, state.clock, 19 + Math.sin(state.clock * 6) * 2);

  // ---------- Nebel: weiche Schwaden wabern über den Wolkenfeldern am Kartenrand ----------
  const puff = document.createElement("canvas");
  puff.width = puff.height = 64;
  {
    const g = puff.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)"); grad.addColorStop(0.5, "rgba(255, 255, 255, 0.6)"); grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }
  function drawFog() {
    const F = C.fog, t = state.clock * F.speed, cam = state.camera;
    ctx.imageSmoothingEnabled = true;                    // Nebel darf weich sein
    MAP_FOG.forEach(([x, y, r], i) => {
      if (!inView(x, y, r + F.drift)) return;
      const px = x + Math.sin(t + i * 1.7) * F.drift, py = y + Math.cos(t * 0.8 + i * 2.3) * F.drift * 0.5;
      const size = r * 2 * (1 + 0.12 * Math.sin(t * 1.3 + i));
      ctx.globalAlpha = F.alpha * (0.7 + 0.3 * Math.sin(t * 1.1 + i * 0.9));
      ctx.drawImage(puff, px - size / 2 - cam.x, py - size / 2 - cam.y, size, size);
    });
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  // Wassertropfen über der Trampelquelle; pulsiert, wenn die Energie knapp wird
  function drawSpringMarker() {
    const m = C.spring.marker;
    if (!inView(m.x, m.y, 40)) return;
    const low = state.mode === "play" && state.energy < C.energy.lowAt;
    const sx = m.x - state.camera.x, sy = m.y - state.camera.y + Math.round(Math.sin(state.clock * 4) * 3);
    const r = low ? 7 + Math.sin(state.clock * 10) * 1.5 : 6;
    const drop = (radius, tip) => {
      ctx.beginPath(); ctx.moveTo(sx, sy - tip); ctx.lineTo(sx + radius, sy); ctx.arc(sx, sy, radius, 0, Math.PI); ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = "#14203a"; drop(r + 2, r * 2.4);
    ctx.fillStyle = "#4db8ff"; drop(r, r * 1.9);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - 1), 2, 3);
  }

  function drawPopups() {
    for (const pop of state.popups) {
      ctx.globalAlpha = Math.min(1, 2.5 * (1 - pop.age / POPUP_TIME));          // erst am Ende ausblenden
      drawText(pop.text, Math.round(pop.x - state.camera.x), Math.round(pop.y - state.camera.y - pop.age * 30), pop.color, 10);
    }
    ctx.globalAlpha = 1;
  }

  // Hinweiszeile unten im Spielfeld
  const isTouch = () => document.body.classList.contains("touch");
  function drawPrompt() {
    let text = "";
    if (state.drinking) text = "GLUCK, GLUCK ...";
    else if (atSpring() && state.energy < C.energy.max - 5) text = isTouch() ? "TRINKEN GEDRÜCKT HALTEN" : "LEERTASTE HALTEN: TRINKEN";
    else if (state.energy <= 0) text = "ERSCHÖPFT! AB ZUM BRUNNENMÄDCHEN";
    if (text) drawText(text, VW / 2, VH - 14, "#ffffff");
  }

  function render() {
    const cam = state.camera, playing = state.mode !== "start";
    ctx.drawImage(IMG.map, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
    drawShimmer();
    drawWaterfalls();
    drawFountains();
    drawSwans();
    drawCarp();
    if (state.showWalkable) {
      ctx.drawImage(walkOverlay, cam.x / MAP_CELL, cam.y / MAP_CELL, VW / MAP_CELL, VH / MAP_CELL, 0, 0, VW, VH);
    }
    if (playing) {
      // Schätze, Tiere und Figur von hinten nach vorn zeichnen
      const things = [
        ...state.items.map(it => ({ y: it.y, draw: () => drawItem(it) })),
        ...state.critters.map(c => ({ y: c.y, draw: () => drawCritter(c) })),
        { y: state.player.y, draw: drawPlayer },
      ];
      if (!state.crownTaken) things.push({ y: C.crown.y, draw: drawCrown });
      if (state.squirrel.mode !== "away") things.push({ y: state.squirrel.y, draw: drawSquirrel });
      things.sort((a, b) => a.y - b.y).forEach(t => t.draw());
      // Steht die Figur unter einer Baumkrone, hinter einer Laterne oder im Hoteldurchgang, liegt der Vordergrund über ihr
      if (cellAt(state.player.x, state.player.y) === "U") {
        ctx.globalAlpha = C.map.canopyAlpha;
        ctx.drawImage(IMG.fg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
        ctx.globalAlpha = 1;
      }
    }
    drawFog();
    drawSpringMarker();
    if (state.mode === "play") { state.critters.forEach(drawCry); drawItemPointers(); drawPopups(); drawPrompt(); }
    updateHud();
  }

  // ---------- Anzeige und Bildschirme (HTML über dem Spielfeld) ----------
  const fmtTime = s => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const hudCache = {};
  function setText(id, text) { if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; } }
  function updateHud() {
    if (state.mode === "start") return;
    const secs = Math.ceil(state.time), pct = Math.round(state.energy / C.energy.max * 100);
    setText("time", fmtTime(secs));
    setText("score", String(state.score).padStart(4, "0"));
    if (hudCache.energy !== pct) { hudCache.energy = pct; $("energy-fill").style.width = pct + "%"; }
    $("time").classList.toggle("warn", state.mode === "play" && secs <= C.round.warnAt);
    $("energy").classList.toggle("warn", state.energy < C.energy.lowAt);
    drinkBtn.hidden = !(state.mode === "play" && isTouch() && atSpring());
  }

  let menuReadyAt = 0;                       // kurz warten, bevor Enter den Endbildschirm wegdrückt
  let lastTick = 0;
  function startRound() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ohne Ton spielen */ } }
    resetRound();
    state.mode = "play";
    $("start").hidden = $("end").hidden = true;
    $("hud").hidden = false;
    lastTick = 0;
    playSound("start");
    startMusic();
  }
  function endRound() {
    state.mode = "end";
    state.time = 0;
    menuReadyAt = state.clock + 0.8;
    $("final").textContent = state.score.toLocaleString("de-DE");
    $("rank").textContent = [...C.ranks].reverse().find(r => state.score >= r.min).title;
    $("end").hidden = false;
    stickEl.hidden = true; stick.id = null; stick.dx = stick.dy = 0; keys[" "] = false;
    stopMusic();
    playSound("end");
  }
  $("play").addEventListener("click", startRound);
  $("again").addEventListener("click", startRound);

  // Texte des Startbildschirms aus der Config füllen
  $("duration").textContent = fmtTime(C.round.duration).replace(/^0/, "");
  function buildLegend() {
    const entries = [...C.items.types.map((t, i) => [t.name, i, t.points]), ["Krone im Schloss", C.crown.frame, C.crown.points]];
    for (const [name, index, points] of entries) {
      const icon = document.createElement("i");
      icon.className = "icon"; icon.title = name;
      icon.style.backgroundImage = `url(${IMG.items.src})`;
      icon.style.setProperty("--i", index);
      $("legend").append(icon, "+" + points);
    }
  }

  // ---------- Ablauf ----------
  function update(dt) {
    state.clock += dt;
    updateFountains(dt);
    updateSwans(dt);
    updateCarp(dt);
    updateMusic();
    if (state.mode !== "play" || portrait.matches) return;   // im Hochformat pausiert das Spiel („Bitte Handy drehen“)
    updateEnergy(dt);
    updatePlayer(dt);
    updateCamera();
    updateItems(dt);
    updateCritters(dt);
    updateSquirrel(dt);
    state.time -= dt;
    const secs = Math.ceil(state.time);
    if (secs <= C.round.warnAt && secs !== lastTick && secs > 0) { lastTick = secs; playSound("tick"); }
    if (state.time <= 0) endRound();
  }

  // Canvas in ganzzahliger Vergrößerung zeichnen und per CSS ins Fenster einpassen: scharfe Pixel bei jeder Fenstergröße
  function resize() {
    const fit = Math.min((innerWidth - 32) / VW, (innerHeight - $("hint").offsetHeight) / VH);   // 32 = Seitenrand, darunter die Hinweiszeile
    const k = Math.max(1, Math.ceil(fit));
    canvas.width = VW * k; canvas.height = VH * k;
    canvas.style.width = Math.floor(VW * fit) + "px";
    canvas.parentElement.style.setProperty("--s", fit);   // Anzeige und Bildschirme skalieren mit
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  let last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);   // zeitbasiert, große Sprünge begrenzen
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  const SOURCES = { map: C.map.image, fg: C.map.foreground, water: C.water.mask, player: C.player.image, items: C.items.image,
                    goose: C.geese.image, hedgehog: C.hedgehogs.image, squirrel: C.squirrel.image, swan: C.swans.image, carp: C.carp.image };
  Promise.all(Object.entries(SOURCES).map(([key, src]) => loadImage(src).then(img => { IMG[key] = img; }))).then(() => {
    walkOverlay = buildWalkOverlay();
    shimmer = buildShimmer();
    buildLegend();
    addEventListener("resize", resize); resize();
    updateCamera();
    $("play").disabled = false;
    requestAnimationFrame(t => { last = t; loop(t); });
  }).catch(err => { $("hint").textContent = err.message; });

  window.__game = Object.assign(state, { swans, carp });   // nur zum Testen in der Browser-Konsole
})();
