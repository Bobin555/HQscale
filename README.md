# HQscale — 360° site induction & HSE training

A lightweight web app for HR and HSE teams. Learners open a link on a laptop, tablet or phone,
look around a real site in 360°, and complete short tasks:

- **Find**: "Look around reception and tap the first aid kit." Supports several targets at once, e.g. "find all 3 hazards".
- **Quiz**: four-option questions shown over the 360° scene, e.g. "What should you do before you leave the building?"
- **Explore**: hazard and safety-check hotspots that open a "how to check" checklist.
- **Info**: short messages between tasks.

At the end, learners see their score and pass/fail against the module's pass mark. They can also download a CSV record.

The app has no build step and no dependencies. It is plain HTML, CSS and JavaScript with a small WebGL
panorama renderer (about 80 KB in total, around 25 KB gzipped, excluding your media). It works offline after the first
visit and can be installed to a phone's home screen (PWA).

## Try it

```bash
npm start            # serves the folder on http://localhost:8080
```

Any static web server works, e.g. `python3 -m http.server 8080`. It won't run by opening `index.html` directly
from disk, because browsers block `fetch()` of the scenario JSON from `file://`.

The bundled **HQ Site Induction** module uses drawn placeholder rooms, so it works before any
footage exists:

1. Reception: find the first aid kit.
2. 10th floor: spot the unescorted visitor (red lanyard), answer 2 questions, then find 3 hazards and learn how to check them.
3. Exit lobby: "What should you do before you leave the building?" (take your badge off).

### Put it on a web link

- **GitHub Pages** (free): `.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
  To turn it on, open the repo's **Settings → Pages** and set **Source** to **GitHub Actions**.
- Netlify, Vercel, Azure Static Web Apps, S3 and SharePoint-hosted static sites also work. Upload the folder as it is.

HTTPS is required for the phone "motion look" (gyroscope) and for offline mode.

## Controls

| | Laptop | Phone / tablet |
|---|---|---|
| Look around | drag, or arrow keys | drag, or 🧭 to move the phone |
| Zoom | scroll wheel, `+` / `-` | pinch |
| Select | click | tap |

## Using your own 360° footage

1. **Capture.** Any consumer 360 camera works (Insta360, Ricoh Theta, GoPro Max…). Export
   **equirectangular** images (2:1 ratio, e.g. 5760×2880) or MP4 video.
   - Mount the camera at eye height (about 1.6 m) on a tripod, and stand out of shot.
   - For phones, 4096×2048 JPGs at about 80% quality (≈1–2 MB each) look sharp and load fast. The viewer
     automatically scales down anything larger than the device's GPU supports.
   - For video, use H.264 MP4 at 3840×1920 or smaller, keep clips short, and loop them. Videos play muted.
2. **Add the file** to `media/` and point the scene at it:
   ```json
   "reception": {
     "title": "Reception — Ground floor",
     "initialView": { "yaw": 0, "pitch": 0 },
     "media": { "type": "image", "src": "media/reception.jpg" }
   }
   ```
   or `{ "type": "video", "src": "media/lobby.mp4" }`.
3. **Find coordinates** with the authoring tool: open `/?author=1` (or `/?author=1&scenario=scenarios/your-file.json`).
   Pick a scene or open a local 360 photo or video, then tap on the things you want learners to find. The tool
   lists each point's `yaw` and `pitch` ready to copy, and draws the existing targets as dashed circles so you can
   check they're the right size.

Coordinates: `yaw` runs from −180 to 180, where 0 is the centre of the image and positive values are to the right.
`pitch` runs from −90 to 90, where 0 is the horizon and positive values are up. The same numbers position the
placeholder objects, targets and hotspots.

## Writing a module

A module is one JSON file in `scenarios/`, listed in `scenarios/index.json`. You can deep-link straight into a module:
`https://your-site/?scenario=scenarios/hq-induction.json`.

```jsonc
{
  "id": "hq-induction",
  "title": "HQ Site Induction",
  "passMark": 0.8,                       // share of scored steps needed to pass
  "scenes": { "<sceneId>": { "title": "...", "media": { ... }, "initialView": { "yaw": 0, "pitch": 0 } } },
  "steps": [
    { "type": "info", "scene": "reception", "title": "Welcome", "body": "Text\nwith line breaks" },

    { "type": "find", "scene": "reception",
      "title": "Find the first aid kit", "prompt": "Look around and tap on the first aid kit.",
      "targets": [{ "yaw": 96, "pitch": 7, "radius": 8, "label": "First aid kit" }],   // radius in degrees
      "maxAttempts": 3,                    // wrong taps allowed before the answer is revealed
      "hint": "Shown after the first wrong tap", "explain": "Shown afterwards" },

    { "type": "quiz", "scene": "lobby", "question": "...",
      "options": ["A", "B", "C", "D"], "answer": 2,     // 0-based index of the correct option
      "explain": "...", "shuffle": true },

    { "type": "explore", "scene": "floor10", "title": "How to check", "prompt": "...",
      "requireAll": true,                  // learner must open every hotspot to continue
      "hotspots": [{ "yaw": -122, "pitch": -12, "icon": "check",   // hazard | check | info
                     "risk": "info",                                // high | medium | low | info
                     "title": "Fire extinguisher", "body": "...",
                     "checklist": ["Pin and tamper seal intact", "Gauge in the green"] }] }
  ]
}
```

`find` and `quiz` steps are scored. `info` and `explore` steps are not. The app checks the file when it loads it and
lists any problems, such as an unknown scene or a quiz answer index that's out of range.

## Project layout

```
index.html              app shell
css/styles.css          UI (mobile-first, safe-area aware)
js/viewer.js            WebGL 360° viewer: image/video, drag/pinch/keys/gyro, pinned DOM markers
js/placeholder.js       draws stand-in rooms until real footage exists
js/main.js              module runner (steps, scoring, results, authoring tool)
scenarios/*.json        training content
media/                  your 360° photos / videos
sw.js                   offline support (network-first cache)
tests/                  unit tests for the coordinate maths (npm test)
```

## Results and privacy

Results stay on the learner's device (the last 50 attempts in `localStorage`). Learners can download a CSV record.
Nothing is sent to a server. To report completions centrally, see the roadmap.

## Roadmap

- **Gaussian splat scenes** (`"media": { "type": "splat", "src": "media/floor10.spz" }`). The scene/step model is
  already media-agnostic. The plan is to lazy-load a splat renderer (e.g. Spark or `gaussian-splats-3d`, both built
  on three.js) only for splat scenes, so image and video modules stay small. Hotspots would move from yaw/pitch to
  3D positions.
- **Central reporting**: post results to an LMS (SCORM/xAPI), a Microsoft Form/SharePoint list, or a small API.
- **Visual editor**: build whole modules in the browser (the current authoring tool only captures coordinates).
- Audio narration, multiple languages, and scene-to-scene navigation arrows for free exploration.
