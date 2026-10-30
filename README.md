# 🐟 Fish Rain — A Stab The Finger Arcade Game

**Tagline:** *It's raining fish. Unfortunately, it's raining everything else, too.*

You're in a small wooden fishing boat, trying to catch fish falling from the sky. Unfortunately, fish aren't the only things falling. Progress through 8 escalating bodies of water—from a tiny driveway puddle through ponds, mountain lakes, raging whitewater rivers, coastal bays, and into the hurricane-tossed Open Ocean. Catch rare and legendary fish while dodging falling masonry bricks, bowling balls, avocado-green refrigerators, concert grand pianos, steakhouse fiberglass cows, decommissioned weather satellites, and massive rogue waves!

Playable online as part of the [Stab The Finger Arcade](https://stabthefinger.com/).

---

## ✨ Key Features & Game Mechanics

### 1. 8 Escalating Bodies of Water (Campaign & Quick Play)
1. **💧 Muddy Driveway Puddle** (Level 1) — Narrow playable channel, gentle drizzle, Common fish, and stray bricks.
2. **🐸 Willow Creek Pond** (Level 2) — Wider water, faster falling objects, Uncommon fish, and falling 16-lb bowling balls.
3. **🌲 Echo Pine Lake** (Level 3) — Gusty crosswinds blow falling objects laterally; Rare fish appear.
4. **🛶 Lazy Bend River** (Level 4) — Constant river currents push your boat downstream, requiring steady counter-steering.
5. **🌊 Whitewater Gorge River** (Level 5) — Strong oscillating currents, surging turbulence, faster hazards, and grand pianos.
6. **⚓ Tempest Lighthouse Bay** (Level 6) — Coastal squalls, shifting tides, Legendary fish, and steakhouse fiberglass cows.
7. **🌩️ Gale-Force Rocky Coast** (Level 7) — Heavy rolling swells, lightning storms, high-speed falling objects, and coastal surges.
8. **🦑 Abyssal Hurricane Open Ocean** (Level 8) — Extreme chaos, orbital weather satellites, mythic Golden Marlins, and physical **Rogue Waves**!

### 2. Physical Rogue Wave Mechanics (Open Ocean)
- **Warning System**: Foghorn alerts, storm sky dimming, and screen shake provide an unmistakable early warning before a crest emerges.
- **Three Escalating Tiers**:
  - **SWELL** (Low risk, moderate crest, modest displacement).
  - **GALE** (High risk, steep crest, pronounced displacement).
  - **TITANIC** (Severe peril, towering crest, massive knockback impulse).
- **Realistic Wave Climbing & Bow Lift**:
  - The boat physically pitches upward as it climbs the oncoming wave face in both directions (`pitchRad = waveDir * peakPitch`), tilting bow-up into the wave.
- **Spring-Damper Angular Recovery**:
  - Tilted recovery uses tuned physical spring-damper mechanics (`stiffness: 2.2, damping: 1.4`) that produce realistic multi-second rocking recovery rather than snapping to horizontal.
- **Fishing Suspension**:
  - Catching fish is realistically suspended while the boat is steeply tilted (`|pitchRad| > 0.38 rad`), while hull hazards continue to collide normally.
- **Player Steering Interaction**:
  - Active counter-steering into the wave face accelerates bow recovery; steering in the direction of the wave prolongs recovery time.

### 3. 4 Comprehensive Steering Control Schemes
- **Keyboard (Desktop)**: Left/Right Arrow keys or A/D keys (plus `P` or `Esc` to pause). Always active and responsive.
- **On-Screen Touch Buttons (Mobile)**: Large, thumb-friendly `◀ STEER LEFT` and `STEER RIGHT ▶` buttons with `touch-action: none` to prevent accidental page scrolling.
- **Persistent Mouse / Pointer Follow**:
  - Mouse movement sets a target horizontal destination that persists even if the cursor leaves the canvas or browser window.
  - Features an **Arrival Radius Zone** (`24px`): once the boat enters the arrival zone, active steering deactivates so natural environmental forces (river currents, waves, wind) drift the boat organically without fighting the controls. Moving the mouse establishes a new target.
- **Mobile Tilt Steering (Gyro)**:
  - Steer by physically tilting your smartphone or tablet left and right via the DeviceOrientation API.
  - Requires explicit user-initiated permission (iOS/Android compliant).
  - Features one-tap **Calibrate Center**, adjustable **Tilt Sensitivity** (`0.5×–2.5×`), deadzone filtering, and an instant **Switch to Buttons** fallback.

### 4. Rich Catching, Combo System & Distinct Custom Artwork
- **4 Fish Rarity Tiers**:
  - **Common** (Bluegill, Perch, Bass, Trout, Catfish: `50–110` pts)
  - **Uncommon** (Pike, Walleye, Salmon, Snapper, Mahi-Mahi: `180–300` pts)
  - **Rare** (High-Voltage Eel, Bluefin Tuna, Broadbill Swordfish, Golden Koi: `420–620` pts)
  - **Legendary** (Bioluminescent Anglerfish, Living Fossil Coelacanth, Baby Kraken, Sovereign Golden Marlin: `900–2,000` pts)
- **Special Bonus Collectibles**:
  - **🧰 Deluxe Tackle Box**: +45% Wide Net catch radius for 8s.
  - **☕ Scalding Coffee Thermos**: Turbo boat speed and current resistance for 8s.
  - **🪙 Pirate Gold Doubloon**: +500 points and +2 Combo multiplier boost.
  - **🛟 Coast Guard Life Ring**: +1 Hull Life (or +400 bonus points if already at max 5 lives).
- **Harmless Comedy Junk (0 pts, Keeps Combo!)**:
  - *Waterlogged Left Boots* (`🥾`), *Rubber Ducks* (`🦆`), *Folding Lawn Chairs* (`🪑`), *Soggy Pizza Slices* (`🍕`), and *Extended Warranty Messages in a Bottle* (`🍾`) award `0` points and humorous quips without damaging your hull or resetting your combo streak.
- **Falling Hazards (-1 Life, Resets Combo)**:
  - *Red Bricks* (`🧱`), *Radial Tires* (`🛞`), *16-lb Bowling Balls* (`🎳`), *ACME Anvils* (`🔨`), *Avocado Refrigerators* (`🧊`), *Concert Grand Pianos* (`🎹`), and giant *Steakhouse Fiberglass Cows* (`🐄`) & *Weather Satellites* (`🛰️`).
  - Giant hazards trigger top-of-screen pulsating incoming drop warnings.
- **Distinct Vector Silhouettes & Icon Badges**:
  - Every non-fish falling item is custom-rendered with recognizable 2D canvas vector art (keyboards on pianos, dual doors on fridges, lug soles & laces on boots, horns on anvils, Holstein patches on cows, solar panels on satellites) paired with clear emoji badges for instant arcade identification.

### 5. Mobile Responsive Architecture (Portrait & Landscape)
- **Scrollable Full-Screen Overlays**:
  - Level introduction ("Cast Off"), level complete, and pause dialogs use full-viewport fixed modal overlays with native touch scrolling (`-webkit-overflow-scrolling: touch`). The **"CAST OFF & CATCH FISH!"** button is guaranteed to be fully visible and accessible across all screen sizes.
- **Dedicated Zero-Scroll Landscape Mode**:
  - Rotating to landscape automatically collapses the site header and condenses the HUD into a slim 28px single-row status bar.
  - Canvas height scales to `max-height: calc(100dvh - 78px)` so that the HUD, canvas, and touch steering buttons fit 100% within the screen height with zero page scrolling required.
- **Automatic Scroll Resetting**:
  - Entering gameplay or rotating screen orientation automatically snaps the viewport scroll to top `(0, 0)`.

### 6. Dual Leaderboard Architecture & Anti-Cheat Security
- **Local Personal Records**:
  - Persistent personal bests, unlocked environments, and per-water statistics tracked privately in browser `localStorage`.
- **Global Arcade Leaderboard**:
  - Built-in dual backend support: modern zero-dependency Node.js (`node:sqlite` in WAL mode) and native PHP PDO SQLite fallback (`api/index.php`).
  - **HMAC-SHA256 Session Tokens**: Runs obtain a signed token on launch that binds to `{ gameMode, startEnvId, timestamp }` with a 3-hour TTL.
  - **Server-Side Mathematical Score Verification**: Shared `recomputeFinalScore()` independently audits catch scores, level clear bonuses, flawless bonuses, combo milestone bonuses, and achievement requirements.
  - **Wall-Clock Time Checks**: Rejects impossible sub-second bot submissions and verifies elapsed run duration.
  - **Replay Protection**: Single-use sessions enforced via `UNIQUE(session_id)` in SQLite (`409 Conflict` on duplicate submission).
  - **Family-Friendly Nickname Filter**: Validates UTF-8 length (1–16 characters) and filters profanity with leetspeak de-obfuscation.
  - **Auto-Submit Persistence**: Preserves player nickname and auto-submission preferences across page visits.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js `>= 22.13.0`** (uses built-in `node:sqlite`, `node:http`, and `node:crypto` — zero external npm dependencies).
- Modern web browser (Chrome, Firefox, Safari, Edge) with ES modules and HTML5 Canvas support.

```bash
# Start the local game & SQLite leaderboard server (http://127.0.0.1:8080)
npm start
```

Open **`http://localhost:8080`** in your browser.

---

## 🧪 Automated Testing

Fish Rain includes a comprehensive automated test suite with zero third-party testing dependencies:

```bash
# Run all game logic unit tests + SQLite leaderboard API anti-cheat tests
npm test

# Run only the core game logic & physics tests
npm run test:game

# Run only the leaderboard API & security validation tests
npm run test:leaderboard

# Run headless Chrome end-to-end browser tests via DevTools Protocol (CDP)
npm run test:e2e
```

---

## 📦 Deployment Options

### Option A: JetHost / cPanel / Apache / PHP Shared Hosting (Recommended)
Fish Rain includes a zero-config native PHP PDO SQLite API in `api/index.php`.

Upload the pre-packaged [`fishrain-deployment.zip`](fishrain-deployment.zip) to your subdomain root (e.g. `public_html/fishrain/`) and click **Extract**, or manually upload:
- `index.html`
- `.htaccess`
- `css/style.css`
- `js/` (all 9 JavaScript modules)
- `api/` (`api/index.php` and `api/.htaccess`)
- `data/` (`data/.htaccess`)

JetHost / LiteSpeed will automatically execute the PHP SQLite API and serve the game without needing Node.js or a background process.

### Option B: Node.js Container / VPS (Docker / Fly.io / Render)
```bash
export NODE_ENV=production
export PORT=8080
export HOST=0.0.0.0
export TRUST_PROXY=1
export LEADERBOARD_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export LEADERBOARD_DB_PATH="/var/lib/fishrain/leaderboard.sqlite"

npm start
```

---

## 📄 License

This project is licensed under the **MIT License**.

```text
MIT License

Copyright (c) 2026 Anthony Moore / None Yet Studios

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
