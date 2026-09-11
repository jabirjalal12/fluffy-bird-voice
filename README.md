# 🐥 Fluffy Bird - Voice-Controlled Flight Game

A cute, responsive, voice-intensity-controlled arcade game built with HTML5 Canvas, Web Audio API, and custom physics.

![Fluffy Bird](https://img.shields.io/badge/Fluffy%20Bird-Voice%20Controlled-ff69b4.svg)
![HTML5](https://img.shields.io/badge/HTML5-Canvas-orange.svg)
![Web Audio](https://img.shields.io/badge/Web%20Audio-API-blue.svg)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)

---

## 🎮 Features

- **🎙️ Real-Time Voice Flight**:
  - **⚡ Vocal Flap (Spike Mode)**: Say *"Hop!"*, *"Up!"*, or *"Ah!"* to flap upwards (classic Flappy Bird rhythm).
  - **🌊 Voice Float (Continuous Mode)**: Hum, sing, or scream continuously! Louder voices elevate higher, softer hums hover gently.
- **🎛️ Live Audio HUD & Calibration**:
  - Real-time volume meter with adjustable trigger threshold line.
  - **1-Click Auto-Calibrate**: Measures ambient background noise for 2 seconds to adapt to quiet or noisy rooms.
  - Custom sliders for **Jump Height (Flap Power)**, **Pillar Gap (Spaciousness)**, **Threshold**, and **Sensitivity**.
- **🐣 Procedural Cute Fluffy Bird Aesthetics**:
  - Layered fluff tufts, animated fluttering wings, blinking/dizzy eyes, and feather particle trails.
  - 5 customizable skins: *Sunny Chick*, *Cotton Candy*, *Cloud Jay*, *Golden Ember*, and *Matcha Puff*.
- **⭐ Collectibles & Audio FX**:
  - Collect spinning golden stars for $+3$ bonus points and sparkle bursts.
  - Procedural sound effects synthesizer using the Web Audio API without external file dependencies.
  - Medal achievement system (Bronze, Silver, Gold, Platinum) with high score persistence via `localStorage`.

---

## 🚀 Quick Start

### Option 1: 1-Click Batch Launcher (Windows)
Double-click `start.bat` to launch the local web server and open the browser automatically.

### Option 2: Python HTTP Server
```bash
python run_game.py
```
Then visit [http://localhost:8080](http://localhost:8080).

### Option 3: Direct Browser
Open `index.html` in any modern web browser (Chrome, Edge, Firefox, Safari).

---

## ⌨️ Controls & Fallbacks

- **Voice**: Make sharp sounds or hum into your microphone.
- **Keyboard**: `Spacebar`, `Up Arrow`, or `W` to flap (or hold to float in Continuous mode).
- **Mouse / Touch**: Click or tap the canvas.

---

## 📄 License
MIT License. Free to use, modify, and distribute!
