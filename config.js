// Alle veränderbaren Werte des Spiels. Die Spiellogik steht in game.js.
const CONFIG = {
  view: { width: 640, height: 360 },      // sichtbarer Kartenausschnitt in Kartenpixeln

  map: {
    image: "assets/karte.png",            // Laufflächen: siehe mapdata.js
    foreground: "assets/vordergrund.png", // Baumkronen und Laternen, hinter denen die Figur laufen kann
    canopyAlpha: 0.6,                     // 1 = Figur ganz verdeckt, kleiner = Figur scheint durch
  },

  player: {
    image: "assets/spieler.png",
    start: { x: 690, y: 434 },            // Startposition (Füße) auf der Karte
    speed: 95,                            // Kartenpixel pro Sekunde
    stepsPerSecond: 8,                    // Tempo der Laufanimation
    frame: { width: 36, height: 54 },     // Größe eines Bildes im Sprite-Sheet
    anchor: { x: 18, y: 50 },             // Punkt im Bild, der auf der Fußposition liegt
    hitbox: { width: 6, height: 4 },      // Kollisionsfläche an den Füßen
    slide: 8,                             // so weit (Pixel) weicht die Figur an Ecken und schrägen Kanten selbst aus
  },

  items: {
    image: "assets/schaetze.png",
    frame: 28,                            // Größe eines Bildes im Sprite-Sheet (quadratisch)
    // Reihenfolge = Reihenfolge der Bilder im Sprite-Sheet. chance = relative Häufigkeit.
    types: [
      { name: "Glücksklee", points: 25,  chance: 5,   color: "#8fe86a" },
      { name: "Rose",       points: 50,  chance: 3,   color: "#ff8a8f" },
      { name: "Goldmünze",  points: 100, chance: 1.5, color: "#ffd84a" },
    ],
    startCount: 3,                        // so viele liegen beim Start schon da
    maxOnMap: 6,                          // mehr liegen nie gleichzeitig herum
    spawnInterval: [1.5, 3.5],            // Sekunden bis zum nächsten Schatz (von, bis)
    lifetime: [7, 12],                    // Sekunden, bis ein Schatz wieder verschwindet (von, bis)
    blinkTime: 2.5,                       // so lange vor dem Verschwinden blinkt er
    spawnMargin: 60,                      // Schätze erscheinen im sichtbaren Ausschnitt plus diesem Rand (Pixel)
    minDistance: 70,                      // Mindestabstand zur Figur und zu anderen Schätzen (Pixel)
    pickupRadius: 18,                     // so nah muss die Figur herankommen (Pixel)
  },
};
