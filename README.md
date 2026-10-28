# FLY / FIELD — see through a fly's eyes

Hackathon-built mobile/WebXR experience: capture one real-world frame, let Muse Spark localize a target, then enter first-person fly POV and watch a connectome pursuit trial. Repeat the same target with normal, mirrored, and disconnected wiring to see how the connectome changes the turn.

## Current implementation

- Low-clutter start screen; phone camera capture; fly-POV and observer views; eased start/end and progressive trajectory trail.
- Muse Spark image grounding returns a target label and normalized image point. The app maps horizontal bearing into the fly arena; target depth is fixed/approximate, not recovered from the image. API keys stay server-side.
- Three.js arena with manual target placement, desktop mouse fallback, and WebXR entry via Three.js `VRButton`.
- `/api/simulate` runs the upstream FlyWire pursuit model from a separate local checkout and returns the virtual-body trajectory + descending turn-neuron activity.
- The fly silhouette is a visual proxy; the simulated trajectory comes from the upstream FlyGym/MuJoCo body + connectome pursuit interface. This is not a complete biological emulation or prediction of a living fly.

## Run

```bash
npm install
cp .env.example .env
# Add MODEL_API_KEY from the Meta Model API dashboard to .env to enable Muse.
# Set FLY_SIMULATOR_ROOT to the separate fly-simulator checkout (not this repo).
npm run dev
```

Prepare the separate simulator checkout once:

```bash
git clone https://github.com/NewYorkImperialist/fly-simulator.git ~/Documents/Code/fly-simulator-upstream
cd ~/Documents/Code/fly-simulator-upstream
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[brain]'
./.venv/bin/python scripts/fetch_brain_data.py
```

Set `FLY_SIMULATOR_ROOT=/Users/<you>/Documents/Code/fly-simulator-upstream` in the app `.env`. The simulator checkout and downloaded brain data stay outside this repository. The app uses `getUserMedia` for a local preview but sends **only one still frame after the user taps Scan** to Muse; it does not upload continuous video.

Phone camera access requires HTTPS on the phone (localhost is exempt only on the development computer). Quest WebXR also requires a supported browser and secure context; use HTTPS for remote/headset testing.

## Attribution and data handling

The upstream simulator source is MIT-licensed; its FlyWire-derived brain data is CC BY-NC 4.0. The data is not included or redistributed here. Preserve attribution. The upstream simulator reports that odor-plume tracking does not reliably steer toward an odor source, so this project uses its documented visual pursuit behavior instead.

## Hackathon contribution boundary

This is a new hackathon repo. New contributions are the camera-to-Muse grounding flow, WebXR/POV experience, controlled brain/mirror/no-brain comparisons, and simulation bridge. Credit the upstream simulator/model/data in the demo and submission; distinguish their existing simulator from the functionality built here.
