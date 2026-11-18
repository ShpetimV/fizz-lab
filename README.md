# Fizz

A science playground for your hands. The webcam becomes a 3D workbench with frosted-glass
windows, and Vera, a dry-witted lab AI, comments on what you do. Four toys, picked from the
rail on the left:

- **Molecules (`A`):** pinch atoms out of a dock, push them together to bond, and watch them
  snap into their real VSEPR shapes. 18 molecules to collect.
- **Liquid metal (`L`):** a floating blob of mercury that reflects your room. Pinch and pull
  droplets off, poke dimples into it, splash it apart and watch it gather itself back up.
  Swap it for gallium, molten gold, or ferrofluid, which rises into spikes under an open hand.
- **Bubbles (`B`):** blow soap bubbles with a pinch, wave them along, pop them. Their colours
  are real thin-film interference, and they fade and burst as the film drains.
- **Water (`W`):** 40 water molecules freezing, melting and boiling.

Runs locally in Chrome. Vite + vanilla JS, Three.js, MediaPipe hand and face tracking.

## Run

```bash
npm install        # also copies the MediaPipe runtime and downloads the two tracking models
npm run dev        # http://localhost:5173
```

Click **Start with camera** and allow the camera, or **Use the mouse instead** to try everything
without one. If `npm install` could not fetch the models, run `npm run setup` (the app falls
back to a CDN copy otherwise).

```bash
npm test           # 101 unit tests: chemistry, geometry, ice, water, liquid metal physics, soap-film colour
npm run build      # production build in dist/  (npm run preview to serve it)
```

### Optional: Vera's live voice (local LLM + neural voice)

Out of the box Vera reads built-in lines with the browser's speech synthesis. For a narrator
that reacts to what you actually do, in a natural voice, start the voice companion in a
second terminal:

```bash
npm run voice
```

The first run creates a private Python environment in `voice-server/.venv` and downloads the
speech model (about 350 MB) into `voice-server/models`; nothing is installed outside this
folder. After that it starts in a few seconds. It needs Python 3.10–3.13, and
[Ollama](https://ollama.com) with a chat model for the live remarks (without Ollama it still
speaks the built-in lines in the neural voice).

- **Brain:** an Ollama model writes each remark from the event plus the lab's verified facts,
  and is told to use only those. Default `dolphin-llama3:8b`; change with `VOICE_MODEL`.
- **Voice:** [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) on the CPU. Default voice
  `af_heart`. `npm run voice:samples` writes a clip of every English female voice to
  `voice-server/samples/`; pick one with `npm run voice -- --voice bf_emma`.
- **Ears:** faster-whisper. **Hold `V`** and ask a question out loud ("what do I add to make
  methane?").
- Everything stays on `127.0.0.1`. The lab finds the companion automatically (the line under
  the title pill shows `Vera · live`); if it is not running, nothing breaks.
- First words arrive about 1.5–2.5 s after an event on an M1 Pro.
- Other overrides: `VOICE_PORT`, `VOICE_NAME`, `VOICE_SPEED`, `VOICE_PYTHON`, `OLLAMA_URL`;
  `npm run voice -- --no-llm` skips the LLM.

## Controls

| Gesture | What it does | Mouse / keyboard |
| --- | --- | --- |
| Pinch an element in the dock | pull out an atom | click-drag from the dock, or keys `1`–`6` |
| Pinch + drag | move an atom or molecule in 3D (hand closer to camera = closer to you) | drag · `Shift`+wheel = depth |
| Touch two atoms together | they bond if both have an open slot | same |
| Pinch one molecule with both hands, turn your hands | rotate it | right-drag |
| Open palm, fast swipe through a molecule | break it into atoms | double-click |
| Both palms open | distance between hands sets temperature (apart = hot) | wheel |
| Move your head | parallax: the scene shifts like objects behind a window | arrow keys |

Keys: `A` / `L` / `B` / `W` switch toy · `Q` quality (high/low) · `M` mute · `C` clear (refill
the liquid, pop all bubbles) · `H` cheat-sheet · `V` hold to ask (voice companion). With a
camera, every button also works by pointing at it and pinching.

| Liquid metal | Hands | Mouse |
| --- | --- | --- |
| Pull a droplet off | pinch the liquid and pull | drag it |
| Dent it | touch it with a fingertip | hover over it |
| Splash it apart | swipe a flat hand through it fast | double-click it |
| Magnet (ferrofluid) / push (others) | hold an open hand near it | hold the right button |
| Change liquid | pinch a sphere in the dock | click the dock or a chip, or keys `1`–`4` |

| Bubbles | Hands | Mouse |
| --- | --- | --- |
| Blow one | pinch and hold, open to let go | hold the button, release |
| Pop one | touch it with a fingertip | click it |
| Blow them along | move your hand | flick the cursor |
| Stream new ones | wave a flat hand quickly | – |

**Reading the scene:** small stubs on an atom are its open bonding positions. While you carry
an atom near another, green dashes mean "these will bond", red ones mean "refused".
The line at the bottom left always says what to do next; the panel on the right suggests the
next molecule and how to build it.

## Liquid metal

- The liquid is 16 overlapping spheres melted into one surface with a smooth minimum and
  ray-marched in a shader (`src/shaders/liquid.js`). It reflects the live webcam image plus a
  few studio lights, so it shows your own room; fingertips cut real dimples into it, and the
  ferrofluid's spikes stand on an evenly spread (spherical Fibonacci) pattern.
- Physics (`src/liquid/sim.js`, unit-tested): neighbouring spheres are held by springs that
  give way when overstretched, so a hard pull tears a droplet off; separate droplets drift back
  and merge on contact. Only the ferrofluid follows a magnet; the metals are not magnetic.
- It is a toy model of surface tension, not a fluid simulation: no gravity, no volume
  accounting beyond the spheres, and droplets cannot split smaller than one sphere.

## Bubbles

- Colour comes from thin-film interference computed per pixel (`src/bubbles/film.js`, shared
  with the shader and the panel chart, unit-tested): reflected intensity goes as
  sin²(2π·n·d·cosθ / λ) over a coarse spectrum. A film much thinner than light reflects almost
  nothing, which is the dark "black film" just before a bubble bursts.
- Each film starts some hundreds of nanometres thick, is thinner at the top (drainage) and
  thins with age; the panel plots every bubble's film on the colour chart as it slides toward
  zero. Lifetimes are shortened to seconds so the whole cycle is visible.
- Bubbles sink slowly in still air, are pushed by moving hands, and burst on a fingertip.

## Look

- **Glass.** Every window is the same frosted material. The DOM panels use `backdrop-filter`;
  the dock and the info card are panes inside the 3D scene that blur the camera image in a
  shader (`src/render/glass.js`), so they sit in depth with the atoms.
- **Solid, glossy atoms** in the usual CPK colours (H white, C graphite, N blue, O red, Na
  violet, Cl green) with pale bond sticks. Guides are thin white lines.
- **Playful touches.** Dock atoms swell as a hand comes near, atoms wobble when a bond lands,
  a finished molecule throws confetti, a first-time discovery adds a rainbow rim and a toast,
  and a name tag over your head levels up with your collection.
- Without a camera the room is a slow colour wallpaper. `Q` drops to a cheaper mode (no
  multisampling, single-tap glass, fewer particles).

## Chemistry model

- Valences: H 1, C 4, N 3, O 2, Cl 1, Na 1. Atoms bond when both have a free valence; a full
  atom repels newcomers.
- Bond order is the most both atoms can afford, up to triple: O + O gives O=O, N + N gives
  N≡N. So **build order matters**: make two CH₃ first and join them to get ethane; C + C
  directly gives the triple bond of ethyne.
- Sodium bonds ionically: one electron visibly jumps to the partner, leaving Na⁺ and an anion.
  No tube is drawn, because nothing is shared.
- Finished molecules relax into VSEPR geometry (2 / 3 / 4 electron domains, with lone-pair
  compression). The 18 catalogue molecules use measured angles where they differ from the
  ideal ones; unlisted but valid structures are labelled "unnamed structure" with `≈` angles.
- Carbon monoxide: C=O left alone for a few seconds closes to C≡O through a dative bond from
  oxygen (simple valence counting cannot produce CO otherwise).
- Electrons are drawn as a simplified Bohr-style picture (the info card says so).

All of this lives in `src/chemistry/` with no DOM or Three.js dependency.

## Project layout

```
src/chemistry/   pure rules: elements, bonding, catalogue + recognition, VSEPR geometry
src/physics/     world.js (bench: grabbing, bonding, break-up) · water.js (pure phase sim)
src/liquid/      liquid metal: sim.js (pure physics), materials, view (ray-march pass), lab (input)
src/bubbles/     soap bubbles: film.js (pure interference), sim.js (pure), view, lab (input)
src/tracking/    webcam + MediaPipe landmarkers
src/gestures/    pinch / open palm / two-hand logic, One Euro smoothing, mouse fallback
src/render/      off-axis camera stage, instanced batches, glass panels, effects, hands, info card
src/shaders/     GLSL for the scene and the final post pass
src/hud/         DOM interface (glass panels, toasts, captions) + emoji / rank flair
src/voice/       narrator (live companion or browser speech) + built-in lines
src/audio/       synthesised sound effects (Web Audio, no files)
voice-server/    optional Python companion (LLM + voice + ears); .venv and models are created on first run
tests/           Vitest suites
```

## Known limitations

- **Tracking** needs decent light and hands inside the frame. Depth comes from apparent hand
  size, so it is relative and a little noisy. A hand that leaves the frame for more than
  0.3 s drops what it holds.
- **No rings.** Atoms already in the same molecule never bond again, so benzene, cyclopropane
  and ozone's real structure cannot be built. Resonance and expanded octets are not modelled.
- **Conformations** of unlisted molecules use simple defaults (staggered / planar), which is
  not always the real lowest-energy shape. Angles marked `≈` are ideal VSEPR values.
- **Sizes are not to scale.** Bond lengths follow covalent radii but are stretched so tubes
  stay visible (H–H in particular).
- **Ice is guided.** Forty molecules cannot nucleate real ice in real time: below 0 °C each
  molecule is drawn toward a pre-built ice-Ih lattice (correct hexagonal structure and ice
  rules). The liquid/ice density difference is exaggerated compared with the real 9 %.
- **The liquids float.** There is no gravity in the liquid lab, mercury does not wet or stick to
  anything, and molten gold is shown at a safe distance with no heat. Real mercury is toxic.
- **Ferrofluid spikes are drawn, not solved.** The fluid really is pulled toward the magnet,
  but the spike pattern is a displacement on the surface, not the result of a magnetic-field
  calculation.
- **The LLM's wording is not vetted.** It is constrained to the facts the lab sends, but a
  small local model can still add a loose remark or skip an instruction. The info cards, the
  liquid and bubble panels and the built-in lines are the checked text.
- **No backend is needed** for the lab itself; the voice companion is the one optional local
  process. The neural voice runs on the CPU and can cost a few frames while it speaks.
- Chrome on macOS is the tested target. The Web Speech voice depends on the voices installed.
