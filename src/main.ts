import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { ARENA_RADIUS_MM, MM_TO_SCENE, type ControlMode, type SimulationResult, type StimulusSetup } from "./types";
import "./style.css";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const mount = $<HTMLDivElement>("#scene");
const message = $<HTMLParagraphElement>("#message");
const coords = $<HTMLSpanElement>("#target-label");
const cameraVideo = $<HTMLVideoElement>("#world-camera");
const cameraCanvas = document.createElement("canvas");
const cameraContext = cameraCanvas.getContext("2d", { willReadFrequently: false })!;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 100);
const observerPosition = new THREE.Vector3(0, 2.8, 5.4);
camera.position.copy(observerPosition);
camera.lookAt(0, 0.4, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x101511, 0);
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

const arenaGuides = new THREE.Group();
scene.add(arenaGuides);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(ARENA_RADIUS_MM * MM_TO_SCENE, 64),
  new THREE.MeshStandardMaterial({ color: 0x1b2929, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 0.68 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
arenaGuides.add(floor);
const grid = new THREE.GridHelper(ARENA_RADIUS_MM * MM_TO_SCENE * 2, 20, 0x5a7772, 0x30423e);
grid.position.y = 0.008;
arenaGuides.add(grid);
const boundary = new THREE.Mesh(
  new THREE.TorusGeometry(ARENA_RADIUS_MM * MM_TO_SCENE, 0.018, 8, 96),
  new THREE.MeshStandardMaterial({ color: 0x5b746d, emissive: 0x182722 }),
);
boundary.rotation.x = Math.PI / 2;
boundary.position.y = 0.025;
arenaGuides.add(boundary);

// Stylized rendering proxy only. Actual position/orientation come from FlyGym.
const fly = new THREE.Group();
fly.position.set(0, 0.18, 0);
scene.add(fly);
const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: 0x96aaa0, roughness: 0.54 }));
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

const target = new THREE.Group();
target.visible = false;
scene.add(target);
const targetGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.13, 18, 14),
  new THREE.MeshStandardMaterial({ color: 0xf2ad62, emissive: 0x803b0c, emissiveIntensity: 1.3 }),
);
targetGlow.position.y = 0.24;
target.add(targetGlow);
const targetRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.25, 0.025, 8, 36),
  new THREE.MeshStandardMaterial({ color: 0xf2ad62, emissive: 0x5b2c0c, emissiveIntensity: 0.8 }),
);
targetRing.rotation.x = Math.PI / 2;
targetRing.position.y = 0.035;
target.add(targetRing);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
let currentSetup: StimulusSetup | null = null;
let activeResult: SimulationResult | null = null;
let selectedControl: ControlMode = "brain";
let playbackStartedAt = 0;
let trajectoryLine: THREE.Line | null = null;
let cameraStream: MediaStream | null = null;
let capturedFrame: string | null = null;
let cameraMode = false;
let viewMode: "fly" | "observer" = "fly";

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  document.body.classList.remove("camera-live");
  cameraMode = false;
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose camera capture. Try HTTPS or use Arena mode.");
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraMode = true;
    viewMode = "observer";
    document.body.classList.add("camera-live", "started");
    $("#intro").setAttribute("hidden", "true");
    $("#trial-ui").removeAttribute("hidden");
    arenaGuides.visible = false;
    updateViewButton();
    message.textContent = "Camera stays on this device. Tap Scan to send one still frame to Muse for target localization.";
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Camera permission was unavailable.";
  }
}

function startArena() {
  stopCamera();
  document.body.classList.add("started");
  $("#intro").setAttribute("hidden", "true");
  $("#trial-ui").removeAttribute("hidden");
  arenaGuides.visible = true;
  viewMode = "observer";
  updateViewButton();
  message.textContent = "Place a target by tapping the floor, or open manual controls.";
}

function clearTrajectory() {
  activeResult = null;
  endPlaybackAt = 0;
  if (trajectoryLine) {
    scene.remove(trajectoryLine);
    trajectoryLine.geometry.dispose();
    trajectoryLine = null;
  }
  fly.position.set(0, 0.18, 0);
  fly.rotation.y = 0;
  $(".readout-badge").textContent = "AWAITING TRIAL";
}

function setTarget(x: number, z: number, summary = "Visual target placed manually") {
  const radial = Math.hypot(x, z);
  const scale = radial > ARENA_RADIUS_MM - 3 ? (ARENA_RADIUS_MM - 3) / radial : 1;
  const boundedX = x * scale;
  const boundedZ = z * scale;
  target.position.set(boundedX * MM_TO_SCENE, 0, boundedZ * MM_TO_SCENE);
  target.visible = true;
  currentSetup = { kind: "pursuit_target", x: boundedX, z: boundedZ, summary };
  $("#target-label").textContent = summary;
  $("#simulate").removeAttribute("disabled");
  $("#brain-status").textContent = "Target set — ready for a controlled trial";
  $("#model-output").textContent = `${summary}. Select a control condition and run the same target again to compare.`;
  clearTrajectory();
}

function setTargetFromRay(ray: THREE.Ray) {
  if (!ray.intersectPlane(groundPlane, hitPoint)) return;
  setTarget(hitPoint.x / MM_TO_SCENE, hitPoint.z / MM_TO_SCENE);
}

mount.addEventListener("pointerdown", (event) => {
  if (cameraMode || renderer.xr.isPresenting) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  setTargetFromRay(raycaster.ray);
});

for (const handIndex of [0, 1]) {
  const controller = renderer.xr.getController(handIndex);
  controller.addEventListener("selectstart", () => setTargetFromRay(raycaster.ray));
  scene.add(controller);
}

$("#left-cue").addEventListener("click", () => setTarget(-12.5, -4, "Manual target · left"));
$("#right-cue").addEventListener("click", () => setTarget(12.5, -4, "Manual target · right"));

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedControl = button.dataset.mode as ControlMode;
    document.querySelectorAll("[data-mode]").forEach((candidate) => candidate.classList.remove("selected"));
    button.classList.add("selected");
    $("#simulate").textContent = `Run ${selectedControl === "brain" ? "connectome" : selectedControl === "mirror" ? "mirrored wiring" : "no-brain"} trial`;
  });
});

async function interpretTextTarget() {
  const prompt = $<HTMLTextAreaElement>("#prompt").value.trim();
  if (!prompt) {
    message.textContent = "Describe where the target should be first.";
    return;
  }
  const button = $<HTMLButtonElement>("#interpret");
  button.disabled = true;
  message.textContent = "Muse Spark is translating the instruction…";
  try {
    const response = await fetch("/api/interpret-stimulus", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: prompt }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Muse request failed");
    setTarget(payload.setup.x, payload.setup.z, payload.setup.summary);
    await runTrial();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Could not interpret that instruction.";
  } finally {
    button.disabled = false;
  }
}

$("#interpret").addEventListener("click", interpretTextTarget);

async function scanCamera() {
  if (!cameraStream || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    message.textContent = "Start the phone camera first.";
    return;
  }
  const button = $<HTMLButtonElement>("#scan-camera");
  button.disabled = true;
  try {
    const width = Math.min(cameraVideo.videoWidth, 960);
    const height = Math.round(cameraVideo.videoHeight * width / cameraVideo.videoWidth);
    cameraCanvas.width = width;
    cameraCanvas.height = height;
    cameraContext.drawImage(cameraVideo, 0, 0, width, height);
    capturedFrame = cameraCanvas.toDataURL("image/jpeg", 0.68);
    const thumb = $<HTMLImageElement>("#captured-frame");
    thumb.src = capturedFrame;
    thumb.hidden = false;

    message.textContent = "Muse is locating the object in this still frame…";
    const response = await fetch("/api/ground-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: capturedFrame, targetDescription: $<HTMLInputElement>("#object-prompt").value.trim() }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Muse could not locate a target.");
    if (!payload.target.found) throw new Error("Muse couldn't find that object. Try another target or a clearer view.");

    // Map image bearing into the fly-scale arena. Depth is fixed; one still image
    // cannot provide reliable metric distance without a depth sensor/model.
    const bearing = ((payload.target.x / 1000) - 0.5) * (Math.PI / 3);
    const distanceMm = 12;
    const xMm = distanceMm * Math.tan(bearing);
    const zMm = -distanceMm;
    const confidence = Math.round(payload.target.confidence * 100);
    setTarget(xMm, zMm, `${payload.target.objectName} · ${Math.round(bearing * 180 / Math.PI)}° · ${confidence}%`);
    message.textContent = "Target localized from one captured frame. Starting the connectome trial…";

    // The live feed is not uploaded continuously. Stop camera after the one still
    // has been analyzed, then enter the fly's simulated perspective.
    stopCamera();
    viewMode = "fly";
    updateViewButton();
    await runTrial();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Could not scan the camera frame.";
  } finally {
    button.disabled = false;
  }
}

$("#scan-camera").addEventListener("click", scanCamera);

async function runTrial() {
  if (!currentSetup) {
    message.textContent = "Select a target first.";
    return;
  }
  const button = $<HTMLButtonElement>("#simulate");
  button.disabled = true;
  message.textContent = `Running the ${selectedControl} pursuit trial…`;
  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup: currentSetup, control: selectedControl }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Simulation failed");
    activeResult = payload as SimulationResult;
    endPlaybackAt = 0;
    const points = activeResult.points.map((point) => new THREE.Vector3(point.x * MM_TO_SCENE, 0.19, point.z * MM_TO_SCENE));
    if (trajectoryLine) {
      scene.remove(trajectoryLine);
      trajectoryLine.geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setDrawRange(0, 1);
    trajectoryLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x8ed3b0, transparent: true, opacity: 0.92 }));
    scene.add(trajectoryLine);
    playbackStartedAt = clock.getElapsedTime();
    viewMode = "fly";
    updateViewButton();
    message.textContent = `${activeResult.control} condition · ${activeResult.points.length} model samples`;
    $("#model-output").textContent = activeResult.caveat;
    $("#brain-status").textContent = `${activeResult.model} · ${activeResult.control}`;
    $(".readout-badge").textContent = `${activeResult.control.toUpperCase()} · REPLAYABLE`;
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Simulation failed.";
  } finally {
    button.disabled = false;
  }
}

$("#simulate").addEventListener("click", runTrial);

$("#start-camera").addEventListener("click", startCamera);

$("#start-arena").addEventListener("click", () => {
  document.body.classList.add("started");
  $("#intro").hidden = true;
  $("#trial-ui").hidden = false;
  arenaGuides.visible = true;
  message.textContent = "Tap the arena to place a target, then compare the control conditions.";
});

function updateViewButton() {
  $("#view-mode").textContent = viewMode === "fly" ? "FLY POV" : "OBSERVER";
}
$("#view-mode").addEventListener("click", () => {
  viewMode = viewMode === "fly" ? "observer" : "fly";
  updateViewButton();
});

function resize() {
  const width = mount.clientWidth || window.innerWidth;
  const height = mount.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(mount);
resize();

const clock = new THREE.Clock();
const povOffset = new THREE.Vector3(0, 0.12, -0.28);
const povWorld = new THREE.Vector3();
let endPlaybackAt = 0;

function updateCamera() {
  if (renderer.xr.isPresenting) return;
  if (viewMode === "fly") {
    povWorld.copy(povOffset);
    fly.localToWorld(povWorld);
    camera.position.lerp(povWorld, 0.16);
    const desired = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fly.rotation.y);
    camera.quaternion.slerp(desired, 0.16);
    if (camera.fov !== 92) { camera.fov = 92; camera.updateProjectionMatrix(); }
  } else {
    camera.position.lerp(observerPosition, 0.12);
    camera.lookAt(0, 0.35, 0);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  }
}

renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  if (activeResult?.points.length) {
    const points = activeResult.points;
    const firstTime = points[0].t;
    const duration = points[points.length - 1].t - firstTime;
    const playbackTime = elapsed - playbackStartedAt + firstTime;
    const index = points.findIndex((point) => point.t >= playbackTime);
    const sampleIndex = Math.max(0, index < 0 ? points.length - 1 : index);
    const current = points[sampleIndex];
    fly.position.set(current.x * MM_TO_SCENE, 0.18, current.z * MM_TO_SCENE);
    fly.rotation.y = current.yaw;
    trajectoryLine?.geometry.setDrawRange(0, Math.max(1, sampleIndex + 1));
    if (playbackTime >= points[points.length - 1].t) {
      endPlaybackAt ||= elapsed + 1.2;
      if (elapsed > endPlaybackAt && viewMode !== "observer") {
        viewMode = "observer";
        updateViewButton();
      }
    } else {
      endPlaybackAt = 0;
    }
  } else {
    fly.position.y = 0.18 + Math.sin(elapsed * 2.1) * 0.012;
  }
  targetGlow.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.07);
  if (renderer.xr.isPresenting) {
    raycaster.setFromXRController(renderer.xr.getController(0));
  } else if (!cameraMode) {
    raycaster.setFromCamera(pointer, camera);
  }
  updateCamera();
  renderer.render(scene, camera);
});

fetch("/api/health").then((response) => response.json()).then((health) => {
  if (health.simulatorConfigured) $("#brain-status").textContent = "Connectome ready";
  if (!health.museConfigured) message.textContent = "Add MODEL_API_KEY to the server .env to enable Muse vision and target interpretation.";
}).catch(() => {});

Object.assign(window, { currentStimulus: () => currentSetup });
