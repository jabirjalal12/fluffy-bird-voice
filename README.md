# 🐥 Fluffy Bird - Autonomous Voice-Activated Flight Game

A vibrant, cute, voice-controlled arcade game built with HTML5 Canvas, Web Audio API, and custom relative sound dynamics.

![Fluffy Bird](https://img.shields.io/badge/Fluffy%20Bird-Voice%20Activated-ff69b4.svg)
![HTML5](https://img.shields.io/badge/HTML5-Canvas-orange.svg)
![Web Audio](https://img.shields.io/badge/Web%20Audio-API-blue.svg)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

---

## 🌟 Key Highlights

- **🎙️ Zero-Configuration Relative Sound Trigger**:
  - **No manual sliders, volume knobs, or calibration setups needed.**
  - **Asymmetric Adaptive Noise Floor**: Tracks constant ambient noise (fans, air conditioning, laptop cooler hum) and ignores it automatically.
  - **Dynamic Margin**: Adjusts trigger sensitivity based on room acoustics ($Threshold = NoiseFloor + DynamicMargin$).
  - **Speech Freeze**: Baseline noise tracking freezes during speech so player vocalizations never raise the noise floor.

- **🎮 Dual Flight Modes**:
  - **⚡ Vocal Flap**: Say *"Hop!"*, *"Jump!"*, *"Up!"*, or *"Ah!"* to flap upwards (classic Flappy Bird arcade rhythm).
  - **🌊 Voice Float**: Continuous vocalization / humming elevates the bird smoothly.

- **🐣 Procedural Fluffy Plumage & Skins**:
  - 5 customizable bird styles: *Sunny Chick*, *Cotton Candy*, *Cloud Jay*, *Golden Ember*, and *Matcha Puff*.
  - Procedural wing flapping, blinking eyes, blush cheeks, and feather particle trails.

- **⭐ Collectibles & Audio FX**:
  - Collect spinning golden stars for $+3$ bonus score and sparkle bursts.
  - Built-in procedural Web Audio synthesizer (no external audio files required).
  - Medal achievement system (Bronze, Silver, Gold, Platinum) with high score persistence via `localStorage`.

- **🛠️ Hidden Developer Diagnostics HUD**:
  - Press <kbd>Shift</kbd>+<kbd>D</kbd> or <kbd>D</kbd> to inspect real-time sound levels, noise floor, trigger threshold, sound delta, and trigger event counters.

---

## 🚀 Quick Start

### 1. Instant Windows Launcher
Double-click `start.bat` to launch the local web server and open the game in your default browser.

### 2. Python HTTP Server
```bash
python run_game.py
```
Then visit [http://localhost:8080](http://localhost:8080).

### 3. Direct Browser
Open `index.html` directly in Chrome, Edge, Safari, or Firefox.

---

## ⌨️ Controls & Fallbacks

| Input Method | Action |
|---|---|
| **Voice / Sound** | Speak (*"Hop!"*, *"Jump!"*, *"Ah!"*), hum, or whistle to fly. |
| **Keyboard** | <kbd>Space</kbd>, <kbd>W</kbd>, <kbd>↑</kbd> to flap or hold to float. <kbd>F</kbd> for Fullscreen, <kbd>S</kbd> for Settings, <kbd>Shift</kbd>+<kbd>D</kbd> for Developer Diagnostics. |
| **Touch / Mouse** | Tap or click anywhere on the screen. |

---

## ☁️ Deployment

### Deploy to Vercel (1-Click)
This repository includes a pre-configured `vercel.json` for instant static zero-config deployment.

```bash
vercel --prod
```

---

## 📄 License
MIT License. Free to use, modify, and distribute!
