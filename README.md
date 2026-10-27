# FLY / FIELD — embodied connectome lab

Hackathon-built WebXR interface concept: place a visual pursuit target in a small arena and, once an eligible connectome simulator is integrated, inspect the model's neural response and virtual movement.

## Current implementation status

- Three.js arena with a virtual fly marker and manually placeable visual target.
- WebXR entry point through Three.js `VRButton`; desktop mouse is the development fallback.
- Muse Spark server-side structured-output endpoint translates text instructions into a bounded stimulus setup. The API key never goes to the browser.
- **No connectome simulation is currently connected.** The scene does not claim or draw a predicted fly path. The fly silhouette is a visual placeholder, not a biomechanical fly model.

## Run

```bash
npm install
cp .env.example .env
# Add MODEL_API_KEY from the Meta Model API dashboard to .env to enable Muse.
npm run dev
```

Open the Vite URL on desktop for the first pass. WebXR headset testing requires a secure context and a supported browser; use localhost during development, then HTTPS for remote/headset testing.

## Scientific and licensing gate

The proposed upstream `fly-simulator` dependency is being evaluated separately. Its source code is MIT, but its FlyWire-derived brain data is CC BY-NC 4.0. Do not redistribute or use that data in the submission until its non-commercial terms are checked against this prize competition. The upstream simulator also documents that its odor-plume tracking does not reliably steer toward an odor source. Any integrated behavior must match a demonstrated model capability and clearly label model assumptions.

## Hackathon contribution boundary

This repository is a new hackathon project. Third-party simulator code/data, if later used, must remain clearly attributed and separate from the WebXR/Muse integration built here. The final demo will identify only the features added during the hackathon.
