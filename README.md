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
3. **Build the module** in the module builder: open the app with `#author` at the end of the address (or tap
   **Build a module** on the home screen).
   - **Add 360° photo or video** to add each location as a scene.
   - Add steps: **⚠ Hazard spots** (markers with a description, risk level and "how to check" list),
     **🎯 Find task** (learners tap the right thing), **❓ Question** (multiple choice) or **💬 Message**.
   - For hazard spots and find tasks, **tap the 360° view** where the thing is. Use **Move** to reposition it.
   - Or use the **📚 Hazard library** (24 common office, fire, site, warehouse, electrical and security hazards):
     drag one onto the view, or tap it and then tap the view. Its description, risk level and "how to check" list
     are filled in for you. Items marked 🖼 also put a picture of the hazard into the scene (a spill, cone, overloaded
     socket, ladder…), so you can stage hazards that aren't in your footage. Edit the list in `js/hazards.js`.
   - **Adjust a picture** by dragging it in the 360° view (corner handle = resize, top handle = rotate), or with
     **Adjust picture** in its card: size, rotation, width, **lie flat** (for things on the floor) and mirror.
     On a 360° video, pictures only appear on the frozen moment they were placed on, never over moving footage.
   - **360° videos:** each step freezes the video on one moment, so markers stay on the thing they point at.
     Use the timeline at the bottom of the view to pick the moment, then **Use this moment**. Messages and
     questions can keep the video playing instead.
   - **▶ Preview** plays the module exactly as learners will see it.
   - **Save** gives you the module file. Upload it to `scenarios/` and the photos/videos to `media/<module-id>/`,
     then add the module to `scenarios/index.json`.

   Your work is kept in the browser while you build. Photos and videos aren't, so after closing the page the
   builder asks you to reopen those files.

Coordinates: `yaw` runs from −180 to 180, where 0 is the centre of the image and positive values are to the right.
`pitch` runs from −90 to 90, where 0 is the horizon and positive values are up. The same numbers position the
placeholder objects, targets and hotspots.

### When a photo doesn't look right

When you open a file, the authoring tool shows its size and how it will be displayed, and warns about these common problems:

| What you see | Cause | Fix |
|---|---|---|
| Two round images side by side | Unstitched photo straight from the camera | Export from the camera app (Insta360 Studio, Theta, GoPro Player) as a 360° or equirectangular JPG |
| A dark band above and below, and you can't look straight up | Phone panorama (a wide strip, not a full sphere) | Fine for a quick test. Use a 360 camera for a full sphere |
| You can only turn part of the way round | Normal photo or partial panorama | Use a 2:1 360° image |
| Error opening `.insp`, `.insv`, `.360` or `.heic` | Raw camera file, or an iPhone HEIC photo | Export as JPG or MP4 first |
| Blurry | Image smaller than about 4096×2048 | Export at full resolution |

If the app guesses a partial panorama's coverage wrong, set it in the scene: `"media": { "type": "image", "src": "...", "hfov": 180, "vfov": 90 }`
(degrees across and degrees up and down).

## Adding a new scenario

Each scenario (site induction, warehouse walk, fire safety, security awareness…) is its own **module**: one JSON
file plus a folder of photos. Nothing in the app's code changes when you add one.

```bash
npm run new-module -- warehouse "Warehouse Safety Walk"   # creates scenarios/warehouse.json + media/warehouse/
# 1. put your 360° photos in media/warehouse/ and point each scene's "media" at them
# 2. open the app with #author to find positions for targets and hotspots
# 3. write the steps (see "Writing a module" below)
npm run validate                                          # checks every module and its media files
```

The new module appears on the home screen straight away. `npm run validate` also runs automatically before every
GitHub Pages deploy, so a broken module can't go live.

Suggested layout as the library grows:

```
scenarios/index.json            the list shown on the home screen (order = display order)
scenarios/hq-induction.json     one file per module
scenarios/warehouse.json
media/hq/reception.jpg          one folder per site; several modules can share the same photos
media/warehouse/loading-bay.jpg
```

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

`find` and `quiz` steps are scored. `info` and `explore` steps are not. The app checks the file when it loads it, and
`npm run validate` checks every module. Both list problems in plain language, such as an unknown scene or a quiz answer
that's out of range.

## Project layout

```
index.html              app shell
css/styles.css          UI (mobile-first, safe-area aware)
js/viewer.js            WebGL 360° viewer: image/video, drag/pinch/keys/gyro, pinned DOM markers
js/placeholder.js       draws stand-in rooms until real footage exists
js/main.js              module runner (steps, scoring, results)
js/builder.js           module builder (#author)
js/hazards.js           hazard library used by the builder
js/validate.js          module checks, shared by the app and npm run validate
scenarios/*.json        training content
media/                  your 360° photos / videos
sw.js                   offline support (network-first cache)
tools/                  new-module, validate and bundle scripts
tests/                  unit tests (npm test)
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

## Single-file build

`npm run bundle` writes `dist/hqscale.html`, one self-contained file with the CSS, JavaScript, modules and icon inlined.
Use it where you can only host or send a single file. Images and videos referenced by `src` still need to be hosted next to it.
