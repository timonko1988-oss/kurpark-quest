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
      protect: 0,         // Schutzzeit nach einer Gänse-Berührung
      drinking: false,
      player: { ...C.player.start, dir: "down", moving: false, walkTime: 0 },
      items: [],          // { type, x, y, age, life }
      popups: [],         // aufsteigende Texte wie „+100“: { x, y, text, color, age }
      geese: C.geese.starts.map(makeGoose),
      spawnTimer: 0,
      place: null,        // Ort, in dem die Figur gerade steht
      sign: null,         // eingeblendetes Namensschild: { text, age }
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

  // ---------- Orte: Namensschild beim Betreten ----------
  function updatePlaces(dt) {
    const place = C.places.list.find(p => dist(state.player, p) < p.radius) || null;
    if (place && place.name !== state.place) { state.sign = { text: place.name, age: 0 }; playSound("sign"); }
    state.place = place && place.name;
    if (state.sign && (state.sign.age += dt) > C.places.signTime) state.sign = null;
  }

  // ---------- Schätze ----------
  function pickItemType() {
    const types = C.items.types;
    let r = Math.random() * types.reduce((sum, t) => sum + t.chance, 0);
    return types.find(t => (r -= t.chance) < 0) || types[0];
  }

  // Zufällige Stelle im sichtbaren Ausschnitt (plus Rand) suchen; findet sich keine, entfällt dieser Schatz
  function spawnItem() {
    const I = C.items, cam = state.camera, m = I.spawnMargin;
    for (let tries = 0; tries < 40; tries++) {
      const pos = { x: cam.x - m + Math.random() * (VW + 2 * m), y: cam.y - m + Math.random() * (VH + 2 * m) };
      const tooClose = o => dist(pos, o) < I.minDistance;
      if (!isOpenGround(pos.x, pos.y) || tooClose(state.player) || state.items.some(tooClose)) continue;
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
    state.popups = state.popups.filter(pop => (pop.age += dt) < POPUP_TIME);
  }

  // ---------- Wildgänse ----------
  const GOOSE_BOX = { width: 10, height: 6 };

  // Startplatz auf die nächste freie Stelle schieben, falls er nicht begehbar ist
  function makeGoose(start) {
    let pos = start;
    search: for (let r = 0; r <= 120; r += MAP_CELL) {
      for (let a = 0; a < 16; a++) {
        const cand = { x: start.x + Math.cos(a * Math.PI / 8) * r, y: start.y + Math.sin(a * Math.PI / 8) * r };
        if (isOpenGround(cand.x, cand.y)) { pos = cand; break search; }
      }
    }
    return { x: pos.x, y: pos.y, home: { ...pos }, vx: 0, vy: 0, faceLeft: Math.random() < 0.5,
             moving: false, timer: Math.random() * 1.5, walkTime: 0, honk: 0 };
  }

  function updateGeese(dt) {
    const G = C.geese, p = state.player;
    state.protect = Math.max(0, state.protect - dt);
    for (const g of state.geese) {
      g.honk = Math.max(0, g.honk - dt);
      if ((g.timer -= dt) <= 0) {
        g.moving = !g.moving;
        g.timer = rand(g.moving ? G.walkTime : G.pauseTime);
        if (g.moving) {
          // neue Richtung: zufällig, oder zurück zum Startplatz, wenn sie zu weit weg ist
          const angle = dist(g, g.home) > G.homeRadius
            ? Math.atan2(g.home.y - g.y, g.home.x - g.x) + (Math.random() - 0.5)
            : Math.random() * Math.PI * 2;
          g.vx = Math.cos(angle) * G.speed; g.vy = Math.sin(angle) * G.speed;
          g.faceLeft = g.vx < 0;
        }
      }
      if (g.moving) {
        const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
        if (canStand(nx, ny, GOOSE_BOX, OPEN)) { g.x = nx; g.y = ny; g.walkTime += dt; }
        else g.timer = 0;                                       // Hindernis: stehen bleiben, dann neue Richtung
      }
      if (state.protect <= 0 && dist(g, p) < G.hitRadius) {
        state.energy = Math.max(0, state.energy - G.energyLoss);
        state.protect = G.protectTime;
        g.honk = 0.8;
        addPopup(p.x, p.y - 56, "-" + G.energyLoss, G.color);
        playSound("honk");
      }
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
    fxCtx.drawImage(waterImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
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
  let mapImg, playerImg, foregroundImg, itemsImg, gooseImg, waterImg, walkOverlay;

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
    const colors = { ".": "rgba(190, 0, 70, 0.6)", "U": "rgba(0, 110, 255, 0.55)" };   // gesperrt / unter Baumkrone
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
    const col = p.moving ? Math.floor(p.walkTime * C.player.stepsPerSecond) % 4 : 1;
    ctx.save();
    ctx.translate(sx, sy);
    if (p.dir === "left") ctx.scale(-1, 1);
    ctx.drawImage(playerImg, col * f.width, DIR_ROW[p.dir] * f.height, f.width, f.height, -a.x, -a.y, f.width, f.height);
    ctx.restore();
  }

  function drawGoose(g) {
    const f = C.geese.frame, a = C.geese.anchor;
    const sx = Math.round(g.x - state.camera.x), sy = Math.round(g.y - state.camera.y);
    drawShadow(sx, sy, 10);
    const col = g.moving ? Math.floor(g.walkTime * 6) % 2 : 0;
    ctx.save();
    ctx.translate(sx, sy);
    if (g.faceLeft) ctx.scale(-1, 1);
    ctx.drawImage(gooseImg, col * f.width, 0, f.width, f.height, -a.x, -a.y, f.width, f.height);
    ctx.restore();
  }
  function drawHonk(g) {
    if (g.honk > 0) drawText("GAK!", Math.round(g.x - state.camera.x) + (g.faceLeft ? -26 : 26), Math.round(g.y - state.camera.y) - 30, "#ffffff", 7);
  }

  function drawItem(it) {
    const I = C.items, size = I.frame;
    if (it.life - it.age < I.blinkTime && Math.floor(it.age * 8) % 2) return;   // blinkt kurz vor dem Verschwinden
    const sx = Math.round(it.x - state.camera.x), sy = Math.round(it.y - state.camera.y);
    const bob = Math.round(Math.sin(it.age * 5) * 2);                            // leichtes Schweben
    ctx.fillStyle = "rgba(255, 244, 170, 0.35)";
    ctx.beginPath(); ctx.arc(sx, sy - size / 2, 15 + bob, 0, Math.PI * 2); ctx.fill();   // Leuchten
    drawShadow(sx, sy, 8);
    ctx.drawImage(itemsImg, I.types.indexOf(it.type) * size, 0, size, size, sx - size / 2, sy - size - 2 + bob, size, size);
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

  // Namensschild oben in der Mitte, blendet am Anfang und Ende weich
  function drawSign() {
    const sg = state.sign;
    if (!sg) return;
    ctx.font = `10px ${PIXEL_FONT}`;
    const w = Math.ceil(ctx.measureText(sg.text).width) + 20, x = Math.round((VW - w) / 2), y = 40;
    ctx.globalAlpha = Math.min(1, sg.age * 5, (C.places.signTime - sg.age) * 3);
    ctx.fillStyle = "#f4f1e4"; ctx.fillRect(x - 1, y - 1, w + 2, 24);
    ctx.fillStyle = "#14203a"; ctx.fillRect(x, y, w, 22);
    ctx.textAlign = "center"; ctx.fillStyle = "#f3d77a"; ctx.fillText(sg.text, VW / 2, y + 16);
    ctx.globalAlpha = 1;
  }

  // Hinweiszeile unten im Spielfeld
  const isTouch = () => document.body.classList.contains("touch");
  function drawPrompt() {
    let text = "";
    if (state.drinking) text = "GLUCK, GLUCK ...";
    else if (atSpring() && state.energy < C.energy.max - 5) text = isTouch() ? "TRINKEN GEDRÜCKT HALTEN" : "LEERTASTE HALTEN: TRINKEN";
    else if (state.energy <= 0) text = "ERSCHÖPFT! AB ZUR TRAMPELQUELLE";
    if (text) drawText(text, VW / 2, VH - 14, "#ffffff");
  }

  function render() {
    const cam = state.camera, playing = state.mode !== "start";
    ctx.drawImage(mapImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
    drawShimmer();
    drawWaterfalls();
    drawFountains();
    if (state.showWalkable) {
      ctx.drawImage(walkOverlay, cam.x / MAP_CELL, cam.y / MAP_CELL, VW / MAP_CELL, VH / MAP_CELL, 0, 0, VW, VH);
    }
    if (playing) {
      // Schätze, Gänse und Figur von hinten nach vorn zeichnen
      const things = [
        ...state.items.map(it => ({ y: it.y, draw: () => drawItem(it) })),
        ...state.geese.map(g => ({ y: g.y, draw: () => drawGoose(g) })),
        { y: state.player.y, draw: drawPlayer },
      ];
      things.sort((a, b) => a.y - b.y).forEach(t => t.draw());
      // Steht die Figur unter einer Baumkrone, hinter einer Laterne oder im Hoteldurchgang, liegt der Vordergrund über ihr
      if (cellAt(state.player.x, state.player.y) === "U") {
        ctx.globalAlpha = C.map.canopyAlpha;
        ctx.drawImage(foregroundImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
        ctx.globalAlpha = 1;
      }
    }
    drawSpringMarker();
    if (state.mode === "play") { state.geese.forEach(drawHonk); drawPopups(); drawSign(); drawPrompt(); }
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
    C.items.types.forEach((t, i) => {
      const icon = document.createElement("i");
      icon.className = "icon"; icon.title = t.name;
      icon.style.backgroundImage = `url(${itemsImg.src})`;
      icon.style.setProperty("--i", i);
      $("legend").append(icon, "+" + t.points);
    });
  }

  // ---------- Ablauf ----------
  function update(dt) {
    state.clock += dt;
    updateFountains(dt);
    updateMusic();
    if (state.mode !== "play" || portrait.matches) return;   // im Hochformat pausiert das Spiel („Bitte Handy drehen“)
    updateEnergy(dt);
    updatePlayer(dt);
    updateCamera();
    updateItems(dt);
    updateGeese(dt);
    updatePlaces(dt);
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

  const images = [C.map.image, C.map.foreground, C.player.image, C.items.image, C.geese.image, C.water.mask];
  Promise.all(images.map(loadImage)).then(loaded => {
    [mapImg, foregroundImg, playerImg, itemsImg, gooseImg, waterImg] = loaded;
    walkOverlay = buildWalkOverlay();
    shimmer = buildShimmer();
    buildLegend();
    addEventListener("resize", resize); resize();
    updateCamera();
    $("play").disabled = false;
    requestAnimationFrame(t => { last = t; loop(t); });
  }).catch(err => { $("hint").textContent = err.message; });

  window.__game = state;   // nur zum Testen in der Browser-Konsole
})();
