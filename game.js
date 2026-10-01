// Kurpark-Spiel – Schritt 1: Karte, Kamera, Spielfigur, Bewegung, Kollision
(() => {
  const C = CONFIG;
  const VW = C.view.width, VH = C.view.height;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

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
    if (dx && canStand(p.x + dx * dist, p.y)) p.x += dx * dist;
    if (dy && canStand(p.x, p.y + dy * dist)) p.y += dy * dist;
    p.walkTime += dt;
  }

  function updateCamera() {
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    state.camera.x = Math.round(clamp(state.player.x - VW / 2, mapW - VW));
    state.camera.y = Math.round(clamp(state.player.y - VH / 2, mapH - VH));
  }

  function update(dt) {
    updatePlayer(dt);
    updateCamera();
  }

  // ---------- Darstellung ----------
  const loadImage = src => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("Bild fehlt: " + src));
    img.src = src;
  });
  let mapImg, playerImg, walkOverlay;

  // Gesperrte Zellen als kleines Bild (1 Zelle = 1 Pixel), zum Prüfen mit Taste L
  function buildWalkOverlay() {
    const c = document.createElement("canvas");
    c.width = grid[0].length; c.height = grid.length;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(190, 0, 70, 0.6)";
    grid.forEach((row, gy) => { for (let gx = 0; gx < row.length; gx++) if (row[gx] === ".") g.fillRect(gx, gy, 1, 1); });
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

  function render() {
    const cam = state.camera;
    ctx.drawImage(mapImg, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
    if (state.showWalkable) {
      ctx.drawImage(walkOverlay, cam.x / MAP_CELL, cam.y / MAP_CELL, VW / MAP_CELL, VH / MAP_CELL, 0, 0, VW, VH);
    }
    drawPlayer();
  }

  // Canvas in ganzzahliger Vergrößerung zeichnen und per CSS ins Fenster einpassen: scharfe Pixel bei jeder Fenstergröße
  function resize() {
    const fit = Math.min((innerWidth - 32) / VW, (innerHeight - 36) / VH);   // 32 = Seitenrand, 36 = Hinweiszeile
    const k = Math.max(1, Math.ceil(fit));
    canvas.width = VW * k; canvas.height = VH * k;
    canvas.style.width = Math.floor(VW * fit) + "px";
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

  Promise.all([loadImage(C.map.image), loadImage(C.player.image)]).then(([m, p]) => {
    mapImg = m; playerImg = p; walkOverlay = buildWalkOverlay();
    addEventListener("resize", resize); resize();
    requestAnimationFrame(t => { last = t; loop(t); });
  }).catch(err => { document.getElementById("hint").textContent = err.message; });

  window.__game = state;   // nur zum Testen in der Browser-Konsole
})();
