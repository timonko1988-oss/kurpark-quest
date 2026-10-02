// Alle veränderbaren Werte des Spiels. Die Spiellogik steht in game.js.
const CONFIG = {
  version: "9",                           // bei jeder neuen Version erhöhen (auch in index.html), dann lädt der Browser alles frisch
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
    start: { x: 1400, y: 612 },           // Startposition (Füße) auf der Karte: am Eingang rechts
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
    x: 793, y: 374, radius: 105,          // in diesem Umkreis kann getrunken werden
    refillPerSecond: 50,                  // Leertaste halten: 0 auf 100 in 2 Sekunden
    marker: { x: 793, y: 268 },           // hier schwebt der Wassertropfen
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

  // Krone auf der Schlosstreppe: einmal pro Runde
  crown: { x: 470, y: 690, points: 200, pickupRadius: 26, frame: 3, color: "#ffe680" },   // frame = Bild im Sprite-Sheet der Schätze

  // Ränge am Ende der Runde: es gilt der höchste Rang, dessen Mindestpunktzahl erreicht ist
  ranks: [
    { min: 0,    title: "Parkbank-Genießer" },
    { min: 500,  title: "Sonntagsspaziergänger" },
    { min: 1000, title: "Kurgast mit Schwung" },
    { min: 1500, title: "Walking-Profi" },
    { min: 2000, title: "Kurpark-Legende" },
  ],

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
    cry: "GAK!", sound: "honk",
  },

  // Igel: langsamer und kleiner als die Gänse, aber stachelig (gleiche Werte wie bei den Gänsen)
  hedgehogs: {
    image: "assets/igel.png",
    frame: { width: 36, height: 24 },
    anchor: { x: 18, y: 21 },
    starts: [{ x: 560, y: 330 }, { x: 1190, y: 660 }, { x: 300, y: 560 }],
    speed: 14,
    walkTime: [1.5, 3.5],
    pauseTime: [1, 3],
    homeRadius: 90,
    hitRadius: 13,
    energyLoss: 10,
    protectTime: 1.5,
    color: "#ffb37a",
    cry: "PIKS!", sound: "prick",
  },

  // Eichhörnchen: rennt zu einem herumliegenden Schatz, schnappt ihn und flitzt zurück
  squirrel: {
    image: "assets/eichhoernchen.png",
    frame: { width: 40, height: 28 },
    anchor: { x: 20, y: 25 },
    interval: [9, 16],                    // Sekunden zwischen zwei Beutezügen (von, bis)
    speed: 125,                           // schneller als die Spielfigur
    range: [150, 230],                    // aus dieser Entfernung kommt es angerannt (Pixel)
    catchRadius: 20,                      // so nah muss die Figur heran, um die Beute zurückzuholen
    color: "#ffb37a",                     // Farbe der „GEKLAUT!“-Einblendung
  },

  // Schwäne: gleiten von Ziel zu Ziel über das Wasser
  swans: {
    image: "assets/schwan.png",
    frame: { width: 40, height: 30 },
    anchor: { x: 20, y: 25 },
    starts: [{ x: 617, y: 583 }, { x: 288, y: 676 }, { x: 401, y: 874 }],
    speed: 9,                             // Kartenpixel pro Sekunde
    hop: [30, 110],                       // Strecke bis zum nächsten Ziel (von, bis)
    pause: [1, 4],                        // Pause am Ziel in Sekunden
  },

  // Karpfen: springt ab und zu aus dem Schlossgraben
  carp: {
    image: "assets/karpfen.png",
    frame: { width: 28, height: 16 },
    interval: [4, 9],                     // Sekunden zwischen zwei Sprüngen
    area: { x: 200, y: 470, width: 570, height: 450 },   // der Schlossgraben
    height: 26, length: 32,               // Höhe und Weite des Sprungs (Pixel)
    duration: 0.9,                        // Dauer des Sprungs in Sekunden
  },

  // Nebel am Kartenrand (die Stellen stehen in mapdata.js)
  fog: { alpha: 0.5, drift: 14, speed: 0.5 },   // Deckkraft, Auslenkung in Pixeln, Tempo

  water: {
    mask: "assets/wasser.png",            // wo Wasser ist (aus der Karte abgeleitet)
    strength: 0.5,                        // Sichtbarkeit des Glitzerns (0 bis 1)
    speed: 9,                             // Tempo des Glitzerns (Pixel pro Sekunde)
    // Fontänen: Fußpunkt, Höhe und Breite des Strahls, Tropfen pro Sekunde, Größe der Wellenringe (0 = keine)
    fountains: [
      { x: 418,  y: 123, height: 50, spread: 20, drops: 120, ripple: 34 },   // Springbrunnenteich
      { x: 1327, y: 344, height: 15, spread: 5,  drops: 22, ripple: 0 },    // Brunnen vor dem Hotel
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

  touch: { radius: 44, deadZone: 10 },    // Joystick: Auslenkung und toter Bereich in Bildschirmpixeln

  // Töne: Folgen aus [Frequenz in Hz (0 = Pause), Dauer in Sekunden, Wellenform, Endfrequenz (optional, Ton gleitet dorthin)]
  sound: {
    volume: 0.12,
    sounds: {
      start:   [[523, 0.08, "square"], [659, 0.08, "square"], [784, 0.08, "square"], [1047, 0.2, "square"]],
      collect: [[880, 0.05, "square"], [1175, 0.05, "square"], [1760, 0.12, "square"]],
      honk:    [[620, 0.12, "sawtooth", 300], [0, 0.04], [700, 0.1, "sawtooth", 340], [0, 0.03], [560, 0.2, "sawtooth", 230]],   // empörtes Schnattern
      drink:   [[260, 0.07, "sine", 520], [0, 0.03], [300, 0.07, "sine", 600]],                                                  // gluck, gluck
      ahh:     [[740, 0.38, "triangle", 370]],                                                                                   // zufriedenes „Ahh“
      tired:   [[311, 0.26, "sawtooth", 294], [294, 0.26, "sawtooth", 277], [277, 0.26, "sawtooth", 262], [262, 0.6, "sawtooth", 196]],   // traurige Posaune
      crown:   [[523, 0.08, "square"], [659, 0.08, "square"], [784, 0.08, "square"], [1047, 0.1, "square"], [1319, 0.3, "square"]],   // Fanfare
      prick:   [[1500, 0.05, "square", 900], [0, 0.03], [1300, 0.09, "square", 700]],
      steal:   [[900, 0.06, "square", 1400], [1400, 0.06, "square", 900], [900, 0.1, "square", 1600]],                              // freches Kichern
      splash:  [[520, 0.14, "sine", 170]],
      tick:    [[990, 0.06, "square"]],
      end:     [[784, 0.12, "square"], [659, 0.12, "square"], [523, 0.12, "square"], [392, 0.12, "square"], [523, 0.36, "square"]],
    },
  },

  music: {
    file: "",                             // z. B. "assets/musik.mp3"; leer = eingebaute Chiptune-Melodie
    volume: 0.07,
    tiredRate: 0.62,                      // Tempo bei Energie 0 (die Musik leiert)
    tiredPitch: 0.84,                     // dabei klingt die eingebaute Melodie so viel tiefer
    hurryRate: 1.3,                       // Tempo in den letzten Sekunden
    bpm: 132,
    // Eingebaute Melodie als MIDI-Noten in Achteln (0 = Pause); Bass: eine Note pro Viertel
    melody: [76, 79, 76, 72,  74, 77, 74, 71,  72, 76, 79, 76,  72, 0, 67, 0,
             69, 72, 69, 65,  67, 71, 74, 71,  72, 67, 64, 67,  72, 0, 0, 0],
    bass:   [48, 55, 43, 50,  48, 52, 48, 43,  41, 45, 43, 47,  48, 43, 48, 0],
  },
};
