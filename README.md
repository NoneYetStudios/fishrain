# 🐟 Fish Rain — A Stab The Finger Arcade Game

**Tagline:** *It's raining fish. Unfortunately, it's raining everything else, too.*

You're in a small fishing boat, trying to catch fish falling from the sky. Unfortunately, fish aren't the only things falling. Progress from a tiny muddy driveway puddle through ponds, mountain lakes, surging whitewater rivers, coastal bays, and into the hurricane-tossed Open Ocean—catching rare and legendary fish while dodging bowling balls, refrigerators, grand pianos, fiberglass steakhouse cows, weather satellites, and towering rogue waves!

Playable online as part of the [Stab The Finger Arcade](https://stabthefinger.com/).

---

## ✨ Key Features

- **8 Escalating Bodies of Water (Campaign & Quick Play)**:
  1. **💧 Muddy Driveway Puddle** — Narrow puddle, gentle introduction, common fish, and stray bricks.
  2. **🐸 Willow Creek Pond** — More room, faster rain, Uncommon fish, and falling bowling balls.
  3. **🌲 Echo Pine Lake** — Crosswind gusts blow falling objects sideways; Rare fish appear.
  4. **🛶 Lazy Bend River** — Steady river current pushes your boat downstream.
  5. **🌊 Whitewater Gorge River** — Strong oscillating currents, faster objects, and grand pianos.
  6. **⚓ Tempest Lighthouse Bay** — Coastal squalls, tidal shifts, Legendary fish, and fiberglass cows.
  7. **🌩️ Gale-Force Rocky Coast** — Heavy rolling swells, lightning storms, and early coastal surge waves.
  8. **🦑 Abyssal Hurricane Open Ocean** — Maximum chaos, decommissioned satellites, Golden Marlins, and **Rogue Waves**!
- **4 Steering Control Schemes**:
  - **Keyboard**: Left/Right Arrow keys and A/D (plus `P` / `Esc` to pause), always available.
  - **On-Screen Touch Buttons**: Large holdable `◀ STEER LEFT` and `STEER RIGHT ▶` buttons with `touch-action: none` to prevent accidental page scrolling.
  - **Mouse / Pointer Follow**: Smooth horizontal boat tracking toward the pointer position within water boundaries.
  - **Optional Mobile Tilt Mode (Gyro)**: Accelerometer/gyroscope steering via the DeviceOrientation API with explicit user-initiated permission, one-tap **Calibrate Center**, adjustable **Tilt Sensitivity** (`0.5×–2.5×`), and an always-visible **Switch to Buttons** fallback button.
- **Rich Catching, Humor & Combo Mechanics**:
  - **4 Fish Rarity Tiers**: Common (`50–110` pts), Uncommon (`180–300` pts), Rare (`420–620` pts), and Legendary (`900–2,000` pts).
  - **Special Bonus Collectibles**: *Deluxe Tackle Box* (+45% Wide Net), *Scalding Coffee Thermos* (Turbo Boat Speed & current resistance), *Pirate Gold Doubloon* (+500 pts & +2 Combo), and *Coast Guard Life Ring* (+1 Life).
  - **Harmless Comedy Junk (`0` pts)**: *Waterlogged Left Boot*, *Rubber Duck*, *Folding Lawn Chair*, *Soggy Pizza Slice*, and *Extended Warranty Message in a Bottle* earn `0` points without hurting your hull or breaking your combo.
  - **Falling Hazards (`-1` Life)**: *Bricks*, *Tires*, *Bowling Balls*, *ACME Anvils*, *Avocado Refrigerators*, *Grand Pianos*, *Fiberglass Cows*, and *Weather Satellites* (with top-of-screen drop warnings for giant hazards).
- **Dual Leaderboard Architecture**:
  - **Local Angler Records**: Persistent personal bests, unlocked levels, and per-environment stats in `localStorage`.
  - **SQLite Global Leaderboard**: Server-backed global rankings (`node:sqlite` WAL mode + native PHP PDO SQLite fallback in `api/index.php`) with HMAC-SHA256 single-use session tokens, server-side score recomputation, wall-clock timing checks, family-friendly nickname filtering, and optional automatic score submission.

---

## 🚀 Quick Start (Local Development)

### Requirements
- **Node.js `>= 22.13.0`** (uses built-in `node:sqlite`, `node:http`, and `node:crypto` — zero external npm dependencies).

```bash
# Start the local game & SQLite leaderboard server (default: http://127.0.0.1:8080)
npm start
```

Open **`http://localhost:8080`** in your browser.

---

## 🧪 Running Automated Tests

```bash
# Run game logic unit tests + SQLite leaderboard API & anti-cheat tests
npm test

# Run headless Chrome end-to-end browser tests
npm run test:e2e
```

---

## 📦 Deployment Options

### Option A: Node.js Server (Container / VPS / Fly.io / Render)
```bash
export NODE_ENV=production
export PORT=8080
export HOST=0.0.0.0
export TRUST_PROXY=1
export LEADERBOARD_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export LEADERBOARD_DB_PATH="/var/lib/fishrain/leaderboard.sqlite"

npm start
```

### Option B: JetHost / cPanel / Apache / PHP Shared Hosting
Like **Parking Lot** and **Worst Florist**, Fish Rain includes a zero-config native PHP + SQLite API in `api/index.php`. Upload `index.html`, `css/`, `js/`, `api/`, and `.htaccess` to your subdomain root (e.g. `public_html/fishrain/`).
