// Alle veränderbaren Werte des Spiels. Die Spiellogik steht in game.js.
const CONFIG = {
  version: "4",                           // bei jeder neuen Version erhöhen (auch in index.html), dann lädt der Browser alles frisch
  view: { width: 640, height: 360 },      // sichtbarer Kartenausschnitt in Kartenpixeln

  round: {
    duration: 150,                        // Spielzeit in Sekunden (2:30)
    warnAt: 10,                           // ab so vielen Restsekunden blinkt die Zeit und es tickt
  },

  map: {
    image: "assets/karte.png",            // Laufflächen: siehe mapdata.js
    foreground: "assets/vordergrund.png", // Baumkronen, Laternen und Dächer, hinter denen die Figur laufen kann
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

  energy: {
    max: 100,
    drainPerSecond: 1.2,                  // Verbrauch pro Sekunde (100 reichen für gut 80 Sekunden)
    lowAt: 25,                            // darunter wird die Anzeige rot
    emptySpeedFactor: 0.35,               // Lauftempo bei Energie 0 (Anteil vom normalen Tempo)
  },

  // Trampelquelle am Brunnenmädchen
  spring: {
    x: 794, y: 378, radius: 58,           // in diesem Umkreis kann getrunken werden
    refillPerSecond: 50,                  // Leertaste halten: 0 auf 100 in 2 Sekunden
    marker: { x: 794, y: 292 },           // hier schwebt der Wassertropfen
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

  geese: {
    image: "assets/gans.png",
    frame: { width: 36, height: 36 },
    anchor: { x: 16, y: 33 },
    starts: [                             // Startplätze; jede Gans bleibt in der Nähe ihres Platzes
      { x: 475, y: 380 }, { x: 991, y: 323 }, { x: 977, y: 478 },
      { x: 640, y: 250 }, { x: 880, y: 600 }, { x: 250, y: 620 },
    ],
    speed: 34,                            // Kartenpixel pro Sekunde
    walkTime: [1.2, 3],                   // so lange watschelt sie in eine Richtung (Sekunden, von, bis)
    pauseTime: [0.4, 1.6],                // so lange bleibt sie stehen
    homeRadius: 140,                      // weiter entfernt sie sich nicht von ihrem Startplatz
    hitRadius: 15,                        // Abstand, ab dem eine Berührung zählt
    energyLoss: 15,                       // Energieverlust pro Berührung
    protectTime: 1.5,                     // danach ist die Figur so lange geschützt und blinkt
    color: "#ffb37a",                     // Farbe der „-15“-Einblendung
  },

  water: {
    mask: "assets/wasser.png",            // wo Wasser ist (aus der Karte abgeleitet)
    strength: 0.5,                        // Sichtbarkeit des Glitzerns (0 bis 1)
    speed: 9,                             // Tempo des Glitzerns (Pixel pro Sekunde)
    // Fontänen: Fußpunkt, Höhe und Breite des Strahls, Tropfen pro Sekunde, Größe der Wellenringe (0 = keine)
    fountains: [
      { x: 418,  y: 123, height: 50, spread: 20, drops: 120, ripple: 34 },   // Springbrunnenteich
      { x: 1274, y: 351, height: 20, spread: 7,  drops: 28, ripple: 0 },    // Brunnen vor dem Hotel
      { x: 490,  y: 712, height: 10, spread: 4,  drops: 14, ripple: 0 },    // Schlossinsel
      { x: 501,  y: 753, height: 9,  spread: 4,  drops: 14, ripple: 0 },
      { x: 793,  y: 641, height: 9,  spread: 4,  drops: 14, ripple: 0 },    // Wasserbecken
    ],
    gravity: 170,
    // Wasserfälle am Schlossgraben: Rechtecke, in denen weiße Streifen herabfallen
    waterfalls: [
      { x: 246, y: 470, width: 50, height: 17 },
      { x: 255, y: 500, width: 43, height: 26 },
    ],
    fallSpeed: 38,
  },

  // Platzhalter-Töne: Folgen aus [Frequenz in Hz, Dauer in Sekunden, Wellenform]
  sound: {
    volume: 0.12,
    sounds: {
      start:   [[523, 0.08, "square"], [659, 0.08, "square"], [784, 0.16, "square"]],
      collect: [[880, 0.06, "square"], [1320, 0.12, "square"]],
      honk:    [[330, 0.09, "sawtooth"], [247, 0.16, "sawtooth"]],
      drink:   [[520, 0.05, "sine"], [700, 0.07, "sine"]],
      tick:    [[990, 0.06, "square"]],
      end:     [[659, 0.14, "square"], [523, 0.14, "square"], [392, 0.32, "square"]],
    },
  },
};
