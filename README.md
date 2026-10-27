# FLY / FIELD — embodied connectome lab

Hackathon-built WebXR interface: place a visual pursuit target in a fly-scale arena, run a connectome pursuit trial, and inspect the model's virtual movement.

## Current implementation status

- Three.js arena with a virtual fly marker and manually placeable visual target.
- WebXR entry point through Three.js `VRButton`; desktop mouse is the development fallback.
- Muse Spark server-side structured-output endpoint translates text instructions into a bounded target position. The API key never goes to the browser.
- `/api/simulate` runs the upstream FlyWire pursuit model from a separate checkout and returns an actual virtual-body trajectory. The upstream code and brain data are not copied into this repo.
- The fly silhouette is a visual placeholder; the movement trajectory comes from the upstream FlyGym/MuJoCo body + connectome pursuit simulation. The pursuit input and motor mapping are interface choices documented by that simulator, not a complete biological emulation.

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

Set `FLY_SIMULATOR_ROOT=/Users/<you>/Documents/Code/fly-simulator-upstream` in the app `.env`. The simulator checkout and its downloaded brain data stay outside this repository. The browser app is at Vite's local URL; real Quest Browser testing needs a secure HTTPS context, not a plain LAN HTTP URL.

Open the Vite URL on desktop for the first pass. WebXR headset testing requires a secure context and a supported browser; use localhost during development, then HTTPS for remote/headset testing.

## Attribution and data handling

The upstream `fly-simulator` source code is MIT, but its FlyWire-derived brain data is CC BY-NC 4.0. The data is installed in the separate local checkout and is not included here. Keep attribution and do not redistribute the data. The upstream simulator documents that odor-plume tracking does not reliably steer toward an odor source; this project uses its documented visual pursuit behavior instead.

## Hackathon contribution boundary

This repository is a new hackathon project. The upstream simulator is a separate runtime dependency; this project's new work is the WebXR interface, Muse target setup, and simulation bridge. The final demo must identify those hackathon-built contributions and credit the upstream simulator/model/data. The FlyWire data itself is not included or redistributed here.
