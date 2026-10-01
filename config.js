// Alle veränderbaren Werte des Spiels. Die Spiellogik steht in game.js.
const CONFIG = {
  view: { width: 640, height: 360 },      // sichtbarer Kartenausschnitt in Kartenpixeln

  map: { image: "assets/karte.png" },     // Laufflächen: siehe mapdata.js

  player: {
    image: "assets/spieler.png",
    start: { x: 690, y: 434 },            // Startposition (Füße) auf der Karte
    speed: 95,                            // Kartenpixel pro Sekunde
    stepsPerSecond: 8,                    // Tempo der Laufanimation
    frame: { width: 36, height: 54 },     // Größe eines Bildes im Sprite-Sheet
    anchor: { x: 18, y: 50 },             // Punkt im Bild, der auf der Fußposition liegt
    hitbox: { width: 6, height: 4 },      // Kollisionsfläche an den Füßen
  },
};
