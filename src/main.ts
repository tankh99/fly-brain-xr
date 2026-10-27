import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { ARENA_RADIUS_MM, MM_TO_SCENE, type SimulationResult, type StimulusSetup } from "./types";
import "./style.css";

const mount = document.querySelector<HTMLDivElement>("#scene")!;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const coords = document.querySelector<HTMLSpanElement>("#coords")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#10171b");
scene.fog = new THREE.Fog("#10171b", 9, 19);

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 100);
camera.position.set(0, 2.8, 5.4);
camera.lookAt(0, 0.4, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
mount.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

scene.add(new THREE.HemisphereLight(0xbad5d2, 0x26322c, 2.1));
const keyLight = new THREE.DirectionalLight(0xffe1b4, 2.6);
keyLight.position.set(-3, 6, 4);
keyLight.castShadow = true;
scene.add(keyLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(ARENA_RADIUS_MM * MM_TO_SCENE, 64),
  new THREE.MeshStandardMaterial({ color: 0x1b2929, roughness: 0.9, metalness: 0.05 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = "arena-floor";
scene.add(floor);

const grid = new THREE.GridHelper(ARENA_RADIUS_MM * MM_TO_SCENE * 2, 20, 0x5a7772, 0x30423e);
grid.position.y = 0.008;
scene.add(grid);

const boundary = new THREE.Mesh(
  new THREE.TorusGeometry(ARENA_RADIUS_MM * MM_TO_SCENE, 0.018, 8, 96),
  new THREE.MeshStandardMaterial({ color: 0x5b746d, emissive: 0x182722 }),
);
boundary.rotation.x = Math.PI / 2;
boundary.position.y = 0.025;
scene.add(boundary);

// A non-biological placeholder silhouette for interface work only.
// It is deliberately labelled as a visual marker, not a modeled fly body.
const fly = new THREE.Group();
fly.position.set(0, 0.18, 0);
scene.add(fly);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x96aaa0, roughness: 0.54 });
const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), bodyMat);
body.scale.set(0.7, 0.72, 1.65);
body.castShadow = true;
fly.add(body);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb9c3b7 }));
head.position.z = -0.22;
head.castShadow = true;
fly.add(head);
for (const side of [-1, 1]) {
  const wing = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x9bc4c0, transparent: true, opacity: 0.58, roughness: 0.3 }),
  );
  wing.scale.set(1.3, 0.12, 2.7);
  wing.position.set(side * 0.12, 0.08, 0.01);
  fly.add(wing);
}

const cue = new THREE.Group();
cue.visible = false;
scene.add(cue);
const cueGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.13, 18, 14),
  new THREE.MeshStandardMaterial({ color: 0xf2ad62, emissive: 0x803b0c, emissiveIntensity: 1.3 }),
);
cueGlow.position.y = 0.24;
cue.add(cueGlow);
const cueRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.25, 0.025, 8, 36),
  new THREE.MeshStandardMaterial({ color: 0xf2ad62, emissive: 0x5b2c0c, emissiveIntensity: 0.8 }),
);
cueRing.rotation.x = Math.PI / 2;
cueRing.position.y = 0.035;
cue.add(cueRing);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
let currentSetup: StimulusSetup | null = null;
let activeResult: SimulationResult | null = null;
let playbackStartedAt = 0;
let trajectoryLine: THREE.Line | null = null;

function setCue(x: number, z: number, summary = "Pursuit target placed manually") {
  const radial = Math.hypot(x, z);
  const scale = radial > ARENA_RADIUS_MM - 3 ? (ARENA_RADIUS_MM - 3) / radial : 1;
  const boundedX = x * scale;
  const boundedZ = z * scale;
  cue.position.set(boundedX * MM_TO_SCENE, 0, boundedZ * MM_TO_SCENE);
  cue.visible = true;
  currentSetup = { kind: "pursuit_target", x: boundedX, z: boundedZ, summary };
  document.querySelector<HTMLButtonElement>("#simulate")!.disabled = false;
  coords.textContent = `target: x ${boundedX.toFixed(1)}mm · z ${boundedZ.toFixed(1)}mm`;
  activeResult = null;
  document.querySelector<HTMLParagraphElement>("#brain-status")!.textContent = "Target changed — run a new trial";
  document.querySelector<HTMLDivElement>(".readout-badge")!.textContent = "AWAITING TRIAL";
  if (trajectoryLine) {
    scene.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine = null;
  }
  fly.position.set(0, 0.18, 0);
  fly.rotation.y = 0;
  document.querySelector<HTMLParagraphElement>("#model-output")!.textContent =
    `${summary}. Target configured; run a connectome pursuit trial to generate a model trajectory.`;
}

function setCueFromRay(ray: THREE.Ray) {
  if (!ray.intersectPlane(groundPlane, hitPoint)) return;
  setCue(hitPoint.x / MM_TO_SCENE, hitPoint.z / MM_TO_SCENE);
}

mount.addEventListener("pointerdown", (event) => {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  setCueFromRay(raycaster.ray);
});

for (const handIndex of [0, 1]) {
  const controller = renderer.xr.getController(handIndex);
  controller.addEventListener("selectstart", () => setCueFromRay(raycaster.ray));
  scene.add(controller);
}

document.querySelector("#left-cue")!.addEventListener("click", () => setCue(-12.5, -4));
document.querySelector("#right-cue")!.addEventListener("click", () => setCue(12.5, -4));

document.querySelector<HTMLButtonElement>("#interpret")!.addEventListener("click", async () => {
  const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!.value.trim();
  if (!prompt) {
    message.textContent = "Describe where to place the cue first.";
    return;
  }
  const button = document.querySelector<HTMLButtonElement>("#interpret")!;
  button.disabled = true;
  message.textContent = "Muse Spark is translating the instruction into a bounded stimulus setup…";
  try {
    const response = await fetch("/api/interpret-stimulus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: prompt }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Muse request failed");
    const setup = payload.setup as StimulusSetup;
    setCue(setup.x, setup.z, setup.summary);
    message.textContent = `Muse configured a ${setup.kind.replaceAll("_", " ")}.`;
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Could not interpret that instruction.";
  } finally {
    button.disabled = false;
  }
});

document.querySelector<HTMLButtonElement>("#simulate")!.addEventListener("click", async () => {
  if (!currentSetup) {
    message.textContent = "Place a target before running a trial.";
    return;
  }
  const button = document.querySelector<HTMLButtonElement>("#simulate")!;
  button.disabled = true;
  message.textContent = "Running the FlyWire connectome pursuit trial on the local simulator…";
  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup: currentSetup }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Simulation failed");
    activeResult = payload as SimulationResult;
    const points = activeResult.points.map((point) => new THREE.Vector3(
      point.x * MM_TO_SCENE, 0.19, point.z * MM_TO_SCENE,
    ));
    if (trajectoryLine) {
      scene.remove(trajectoryLine);
      trajectoryLine.geometry.dispose();
    }
    trajectoryLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x8ed3b0, linewidth: 2 }),
    );
    scene.add(trajectoryLine);
    playbackStartedAt = clock.getElapsedTime();
    message.textContent = `Model returned ${activeResult.points.length} trajectory samples.`;
    document.querySelector<HTMLParagraphElement>("#model-output")!.textContent = activeResult.caveat;
    document.querySelector<HTMLParagraphElement>("#brain-status")!.textContent = `${activeResult.model} · trajectory ready`;
    document.querySelector<HTMLDivElement>(".readout-badge")!.textContent = "MODEL TRAJECTORY";
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Simulation failed.";
  } finally {
    button.disabled = false;
  }
});

function resize() {
  const width = mount.clientWidth;
  const height = mount.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(mount);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  if (activeResult?.points.length) {
    const points = activeResult.points;
    const playbackTime = elapsed - playbackStartedAt + points[0].t;
    const index = points.findIndex((point) => point.t >= playbackTime);
    const current = points[Math.max(0, index < 0 ? points.length - 1 : index)];
    fly.position.set(current.x * MM_TO_SCENE, 0.18, current.z * MM_TO_SCENE);
    fly.rotation.y = current.yaw;
  } else {
    fly.rotation.y = Math.sin(elapsed * 0.45) * 0.06;
    fly.position.y = 0.18 + Math.sin(elapsed * 2.1) * 0.012;
  }
  cueGlow.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.07);
  if (renderer.xr.isPresenting) {
    const controller = renderer.xr.getController(0);
    raycaster.setFromXRController(controller);
  } else {
    raycaster.setFromCamera(pointer, camera);
  }
  renderer.render(scene, camera);
});

// Keep state inspectable in devtools while the brain adapter is being built.
Object.assign(window, { currentStimulus: () => currentSetup });

fetch("/api/health").then((response) => response.json()).then((health) => {
  const status = document.querySelector<HTMLParagraphElement>("#brain-status")!;
  if (health.simulatorConfigured) status.textContent = "FlyWire pursuit runtime ready";
  if (!health.museConfigured) message.textContent = "Target placement works manually. Add MODEL_API_KEY to .env to enable Muse Spark.";
}).catch(() => {});
