// Kurpark-Spiel – bisher: Karte, Kamera, Spielfigur, Kollision, Schätze und Punkte
(() => {
  const C = CONFIG;
  const VW = C.view.width, VH = C.view.height;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const rand = ([min, max]) => min + Math.random() * (max - min);

  // ---------- Karte ----------
  // Lauflängenkodierte Zeilen ("12.5W3G") zu einem Raster entpacken
  const grid = MAP_ROWS.map(row => row.replace(/(\d+)(.)/g, (_, n, ch) => ch.repeat(+n)));
  const mapW = grid[0].length * MAP_CELL, mapH = grid.length * MAP_CELL;
  const cellAt = (x, y) => (grid[Math.floor(y / MAP_CELL)] || "")[Math.floor(x / MAP_CELL)] || ".";

  // Ist die Fußfläche an Position (x, y) vollständig auf begehbarem Boden?
  function canStand(x, y) {
    const { width, height } = C.player.hitbox;
    const left = x - width / 2, right = x + width / 2, top = y - height;
    for (let py = top; ; py = Math.min(py + MAP_CELL, y)) {
      for (let px = left; ; px = Math.min(px + MAP_CELL, right)) {
        if (cellAt(px, py) === ".") return false;
        if (px === right) break;
      }
      if (py === y) break;
    }
    return true;
  }

  // ---------- Zustand ----------
  const state = {
    player: { ...C.player.start, dir: "down", moving: false, walkTime: 0 },
    camera: { x: 0, y: 0 },
    items: [],          // Schätze auf der Karte: { type, x, y, age, life }
    popups: [],         // aufsteigende „+100“-Texte: { x, y, text, color, age }
    score: 0,
    spawnTimer: 0,
    showWalkable: false,
  };

  // ---------- Eingabe ----------
  const keys = {};
  addEventListener("keydown", e => {
    if (e.key.startsWith("Arrow")) e.preventDefault();
    if (e.key.toLowerCase() === "l" && !e.repeat) state.showWalkable = !state.showWalkable;
    keys[e.key] = true;
  });
  addEventListener("keyup", e => { keys[e.key] = false; });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  // ---------- Logik ----------
  function updatePlayer(dt) {
    const p = state.player;
    let dx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    let dy = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    p.moving = dx !== 0 || dy !== 0;
    if (!p.moving) { p.walkTime = 0; return; }

    p.dir = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
    const dist = C.player.speed * dt / Math.hypot(dx, dy);   // diagonal nicht schneller
    // Achsen getrennt prüfen, damit die Figur an Kanten entlanggleitet
    const step = (ax, ay) => canStand(p.x + ax, p.y + ay) && (p.x += ax, p.y += ay, true);
    const s = C.player.slide;
    if (dx && !step(dx * dist, 0) && !dy) {
      // An schrägen Kanten und Ecken entlanggleiten, statt hängen zu bleiben
      if (canStand(p.x + dx * dist, p.y - s)) step(0, -dist);
      else if (canStand(p.x + dx * dist, p.y + s)) step(0, dist);
    }
    if (dy && !step(0, dy * dist) && !dx) {
      if (canStand(p.x - s, p.y + dy * dist)) step(-dist, 0);
      else if (canStand(p.x + s, p.y + dy * dist)) step(dist, 0);
    }
    p.walkTime += dt;
  }

  function updateCamera() {
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    state.camera.x = Math.round(clamp(state.player.x - VW / 2, mapW - VW));
    state.camera.y = Math.round(clamp(state.player.y - VH / 2, mapH - VH));
  }

  // ---------- Schätze ----------
  // Freie Fläche auf Weg oder Rasen, nicht unter Bäumen: dort dürfen Schätze erscheinen
  function isOpenGround(x, y) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const c = cellAt(x + dx * MAP_CELL, y + dy * MAP_CELL);
      if (c !== "W" && c !== "G") return false;
    }
    return true;
  }

  function pickItemType() {
    const types = C.items.types;
    let r = Math.random() * types.reduce((sum, t) => sum + t.chance, 0);
    return types.find(t => (r -= t.chance) < 0) || types[0];
  }

  // Zufällige Stelle im sichtbaren Ausschnitt (plus Rand) suchen; findet sich keine, entfällt dieser Schatz
  function spawnItem() {
    const I = C.items, cam = state.camera, p = state.player, m = I.spawnMargin;
    for (let tries = 0; tries < 40; tries++) {
      const x = cam.x - m + Math.random() * (VW + 2 * m);
      const y = cam.y - m + Math.random() * (VH + 2 * m);
      const tooClose = o => Math.hypot(x - o.x, y - o.y) < I.minDistance;
      if (!isOpenGround(x, y) || tooClose(p) || state.items.some(tooClose)) continue;
      state.items.push({ type: pickItemType(), x, y, age: 0, life: rand(I.lifetime) });
      return;
    }
  }

  const POPUP_TIME = 0.9;   // Sekunden, die ein „+100“ sichtbar bleibt
  function updateItems(dt) {
    const I = C.items, p = state.player;
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      if (state.items.length < I.maxOnMap) spawnItem();
      state.spawnTimer = rand(I.spawnInterval);
    }
    state.items = state.items.filter(it => {
      it.age += dt;
      if (Math.hypot(it.x - p.x, it.y - p.y) < I.pickupRadius) {
        state.score += it.type.points;
        state.popups.push({ x: it.x, y: it.y - 56, text: "+" + it.type.points, color: it.type.color, age: 0 });
        return false;
      }
      return it.age < it.life;
    });
    state.popups = state.popups.filter(pop => (pop.age += dt) < POPUP_TIME);
  }

  function update(dt) {
    updatePlayer(dt);
    updateCamera();
    updateItems(dt);
  }

  // ---------- Darstellung ----------
  const loadImage = src => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("Bild fehlt: " + src));
    img.src = src;
  });
  let mapImg, playerImg, foregroundImg, itemsImg, walkOverlay;

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

  const DIR_ROW = { down: 0, right: 1, left: 1, up: 2 };   // links = rechts gespiegelt
  function drawPlayer() {
    const p = state.player, f = C.player.frame, a = C.player.anchor;
    const col = p.moving ? Math.floor(p.walkTime * C.player.stepsPerSecond) % 4 : 1;
    const sx = Math.round(p.x - state.camera.x), sy = Math.round(p.y - state.camera.y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath(); ctx.ellipse(sx, sy, 11, 4, 0, 0, Math.PI * 2); ctx.fill();   // Schatten
    ctx.save();
    ctx.translate(sx, sy);
    if (p.dir === "left") ctx.scale(-1, 1);
    ctx.drawImage(playerImg, col * f.width, DIR_ROW[p.dir] * f.height, f.width, f.height, -a.x, -a.y, f.width, f.height);
    ctx.restore();
  }

  function drawItem(it) {
    const I = C.items, size = I.frame;
    const left = it.life - it.age;
    if (left < I.blinkTime && Math.floor(it.age * 8) % 2) return;            // blinkt kurz vor dem Verschwinden
    const sx = Math.round(it.x - state.camera.x), sy = Math.round(it.y - state.camera.y);
    const bob = Math.round(Math.sin(it.age * 5) * 2);                         // leichtes Schweben
    ctx.fillStyle = "rgba(255, 244, 170, 0.35)";
    ctx.beginPath(); ctx.arc(sx, sy - size / 2, 15 + bob, 0, Math.PI * 2); ctx.fill();   // Leuchten
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath(); ctx.ellipse(sx, sy, 8, 3, 0, 0, Math.PI * 2); ctx.fill();           // Schatten
    ctx.drawImage(itemsImg, I.types.indexOf(it.type) * size, 0, size, size, sx - size / 2, sy - size - 2 + bob, size, size);
  }

  function drawPopups() {
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#14203a";
    for (const pop of state.popups) {
      const x = Math.round(pop.x - state.camera.x), y = Math.round(pop.y - state.camera.y - pop.age * 30);
      ctx.globalAlpha = Math.min(1, 2.5 * (1 - pop.age / POPUP_TIME));   // erst am Ende ausblenden
      ctx.strokeText(pop.text, x, y);
      ctx.fillStyle = pop.color; ctx.fillText(pop.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Anzeige (HTML über dem Spielfeld) ----------
  const scoreEl = document.getElementById("score");
  let shownScore = -1;
  function updateHud() {
    if (state.score === shownScore) return;
    shownScore = state.score;
    scoreEl.textContent = String(shownScore).padStart(4, "0");
  }
  // Legende „Schatz = Punkte“ aus der Config aufbauen
  C.items.types.forEach((t, i) => {
    const icon = document.createElement("i");
    icon.className = "icon"; icon.title = t.name;
    icon.style.backgroundImage = `url(${C.items.image})`;
    icon.style.setProperty("--i", i);
    document.getElementById("legend").append(icon, "+" + t.points);
  });

  function render() {
    const cam = state.camera;
    ctx.drawImage(mapImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
    if (state.showWalkable) {
      ctx.drawImage(walkOverlay, cam.x / MAP_CELL, cam.y / MAP_CELL, VW / MAP_CELL, VH / MAP_CELL, 0, 0, VW, VH);
    }
    // Schätze und Figur von hinten nach vorn zeichnen
    const things = state.items.map(it => ({ y: it.y, draw: () => drawItem(it) }));
    things.push({ y: state.player.y, draw: drawPlayer });
    things.sort((a, b) => a.y - b.y).forEach(t => t.draw());
    // Steht die Figur unter einer Baumkrone oder hinter einer Laterne, liegt der Vordergrund über ihr
    if (cellAt(state.player.x, state.player.y) === "U") {
      ctx.globalAlpha = C.map.canopyAlpha;
      ctx.drawImage(foregroundImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }
    drawPopups();
    updateHud();
  }

  // Canvas in ganzzahliger Vergrößerung zeichnen und per CSS ins Fenster einpassen: scharfe Pixel bei jeder Fenstergröße
  function resize() {
    const fit = Math.min((innerWidth - 32) / VW, (innerHeight - 36) / VH);   // 32 = Seitenrand, 36 = Hinweiszeile
    const k = Math.max(1, Math.ceil(fit));
    canvas.width = VW * k; canvas.height = VH * k;
    canvas.style.width = Math.floor(VW * fit) + "px";
    canvas.parentElement.style.setProperty("--s", fit);   // Anzeige skaliert mit
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  // ---------- Start ----------
  let last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);   // zeitbasiert, große Sprünge begrenzen
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  Promise.all([C.map.image, C.map.foreground, C.player.image, C.items.image].map(loadImage)).then(([m, f, p, i]) => {
    mapImg = m; foregroundImg = f; playerImg = p; itemsImg = i; walkOverlay = buildWalkOverlay();
    addEventListener("resize", resize); resize();
    updateCamera();
    for (let n = 0; n < C.items.startCount; n++) spawnItem();
    requestAnimationFrame(t => { last = t; loop(t); });
  }).catch(err => { document.getElementById("hint").textContent = err.message; });

  window.__game = state;   // nur zum Testen in der Browser-Konsole
})();
