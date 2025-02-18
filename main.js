import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { preprocess } from './gs-edit/preprocess.js';
import { loadGVRM } from './gs-edit/gvrm.js';
import { Recorder } from './gs-edit/recorder.js';
import { PoseDetector } from './gs-edit/pose.js';
import { Rotator, RotatorRTC } from './gs-edit/rotator.js';
import { FPSCounter } from './gs-edit/fps.js';
import { startWebRTC } from './webrtc/utils.js';
import { relayCommander } from './webrtc/command.js';
import * as Utils from './gs-edit/utils.js';


// UI
const container = document.getElementById('threejs-container');
let width = window.innerWidth;
let height = window.innerHeight;


// params
const params = new URL(window.location.href).searchParams;
let gsPath = params.get('gs') ?? undefined;
let gvrmPath = params.get('gvrm') ?? undefined;
const vrmPath = params.get('vrm') ?? "./assets/sotai1.vrm";
const modelScale = params.get('scale');
const modelRotX = params.get('rotx');
const fast = params.has('fast');
const stage = params.get('stage');
const useVR = params.has('vr');
const sessionId = params.get('session') ?? 'test';
const signalingType = params.get('signaling') ?? 'auto';
const signalingHost =
  params.get('host') === 'local' ? 'http://localhost' : params.get('host');
const signalingPort = params.get('port') ?? 3000;
const size = params.get('size');
if (size) {
  const match = size.match(/([\d]+),([\d]+)/);
  width = parseInt(match[1]);
  height = parseInt(match[2]);
  document.body.style.backgroundColor = 'gray';
}
const sessionIdInputArea = document.getElementById('sessionId');
sessionIdInputArea.value = sessionId;
if (signalingType !== 'none') {
  document.getElementById('webrtc').style.display = 'block';
}


async function setupPathsFromUrlOrUpload() {
  const params = new URL(window.location.href).searchParams;
  gsPath = params.get('gs') ?? undefined;
  gvrmPath = params.get('gvrm') ?? undefined;

  if (!gsPath && !gvrmPath) {
    const uploadContainer = document.getElementById('upload-container');
    const uploadButton = document.getElementById('upload-button');
    const fileInput = document.getElementById('file-input');

    uploadContainer.style.display = 'block';

    const fileLoadPromise = new Promise((resolve) => {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const extension = file.name.split('.').pop().toLowerCase();

          const reader = new FileReader();
          reader.onload = function(event) {
            const arrayBuffer = event.target.result;
            const blob = new Blob([arrayBuffer]);
            const objectUrl = URL.createObjectURL(blob);

            if (extension === 'ply') {
              gsPath = objectUrl;
            } else if (extension === 'gvrm') {
              gvrmPath = objectUrl;
            }

            uploadContainer.style.display = 'none';
            resolve({ gsPath, gvrmPath });
          };
          reader.readAsArrayBuffer(file);
        }
      });
    });

    uploadButton.addEventListener('click', () => fileInput.click());

    const result = await fileLoadPromise;
    return result;
  }
}

await setupPathsFromUrlOrUpload();


// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
container.appendChild(renderer.domElement);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(width, height);


// camera
const camera = new THREE.PerspectiveCamera(65.0, width / height, 0.01, 2000.0);
camera.position.set(0.0, 0.6, 1.7);
camera.aspect = width / height;
camera.updateProjectionMatrix();


// custom camera controls (Orbit for rotate, Track for zoom)
const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = true;
// controls.target.set(0.0, 0.1, 0.0);  // for monolith, TODO
controls.target.set(0.0, 0.0, 0.0);
controls.minDistance = 0.1;
// controls.rotateSpeed = 0.5;
controls.maxDistance = 1000;
controls.enableDamping = true;
// controls.dampingFactor = 0.1;
controls.enableZoom = false;
controls.enablePan = false;
controls.update();

const controls2 = new TrackballControls(camera, renderer.domElement);
controls2.noRotate = true;
// controls2.target.set(0.0, 0.1, 0.0);  // for monolith, TODO
controls2.target.set(0.0, 0.0, 0.0);
controls2.noPan = false;
controls2.noZoom = false;
controls2.zoomSpeed = 0.25;
// controls2.dynamicDampingFactor = 0.1;
// controls2.smoothFactor = 0.25;
controls2.useDummyMouseWheel = true;
// controls2.dummyDampingFactor = 0.15;
controls2.update();


// scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const axesHelper = new THREE.AxesHelper(1);
scene.add(axesHelper);
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(10.0, 10.0, 10.0);
scene.add(light);
// const gridHelper = new THREE.GridHelper(1000, 200, 0xdfdfdf, 0xdfefdf);
// scene.add(gridHelper);


import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

if (useVR) {
  renderer.xr.enabled = true;  // experimental
  const button = VRButton.createButton(renderer);
  button.style.bottom = '60px';
  container.appendChild(button);

  const controllerModelFactory = new XRControllerModelFactory();

  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(geometry);
  line.name = "line";
  line.scale.z = 5;

  function addController(index) {
    const controller = renderer.xr.getController(index);
    scene.add(controller);

    const controllerGrip = renderer.xr.getControllerGrip(index);
    controllerGrip.add(
      controllerModelFactory.createControllerModel(controllerGrip)
    );
    scene.add(controllerGrip);

    controller.add(line.clone());
    return controller;
  }

  const controller0 = addController(0);
  const controller1 = addController(1);
}


let flagReady1, flagReady2;

let gvrm, commander, pc, rotatorRTC;

let stateAnim = "play";
let stateColor = "original";


if (gvrmPath) {
  const promise2 = loadGVRM(gvrmPath, scene, camera, renderer);
  promise2.then((result) => {
    gvrm = result.gvrm;
    window.gvrm = gvrm;

    flagReady1 = true;
    flagReady2 = true;
    if (commander) commander.set(gvrm);
  });
} else if (gsPath) {
  const promise1 = preprocess(vrmPath, gsPath, scene, camera, renderer, modelScale, modelRotX, stage, fast);
  promise1.then((result) => {
    gvrm = result.gvrm;
    window.gvrm = gvrm;
    flagReady1 = true;

    const promise2 = result.promise;
    promise2.then(() => {
      flagReady2 = true;
    if (commander) commander.set(gvrm);
    });
  });
}

const poseDetector = new PoseDetector(scene, camera, renderer);

const recorder = new Recorder(renderer);

const rotator = new Rotator(camera);

const fpsc = new FPSCounter();

if (signalingType !== 'none') {
  pc = startWebRTC(signalingType, signalingHost, signalingPort, sessionId, renderer.domElement);
  rotatorRTC = new RotatorRTC(pc, camera);
}

if (signalingType === 'auto') {
  commander = new relayCommander(signalingHost, signalingPort, scene, camera, renderer);
}

window.poseDetector = poseDetector;


window.addEventListener('resize', function (event) {
  if (size) return;
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
});


window.addEventListener('dragover', function (event) {
  event.preventDefault();
});

window.addEventListener('drop', async function (event) {
  event.preventDefault();

  const files = event.dataTransfer.files;
  if (!files) return;

  const file = files[0];
  if (!file) return;

  const fileType = file.name.split('.').pop();
  const blob = new Blob([file], { type: 'application/octet-stream' });  // TODO: ?
  const url = URL.createObjectURL(blob);

  async function onDrop(fileType, url) {
    if (fileType === 'fbx') {
      await gvrm.character.changeFBX(scene, url);
    }
  }

  Utils.resetPose(gvrm.character, gvrm.boneOperations);
  await onDrop(fileType, url);
  stateAnim = "play";
});


document.getElementById('captureButton').addEventListener('click', async () => {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL('image/png');
  poseDetector.detect(dataURL);
});


window.addEventListener("keydown", (e) => {
  if (e.key === "r") {
    recorder.startRecording();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "s") {
    recorder.stopRecording();
  }
});


window.addEventListener('keydown', function (event) {
  if (event.code === "Space") {
    if (stateAnim === "play") {
      stateAnim = "pause";
    } else {
      stateAnim = "play";
      t = 0;
      if (gvrm.character.animationUrl !== '') {
        gvrm.character.action.play();
      }
    }
  }
  if (event.code === "KeyV") {
    Utils.removePMC(scene, gvrm.pmc);
    gvrm.updatePMC();
    Utils.addPMC(scene, gvrm.pmc);
    stateColor = gvrmPath ? "original" : stateColor;
  }
  if (event.code === "KeyC") {
    if (stateColor === "empty") {
      stateColor = Utils.changeColor(gvrm.gs, stateColor);
      Utils.visualizePMC(gvrm.pmc, false);
    } else if (stateColor === "assign") {
      stateColor = Utils.changeColor(gvrm.gs, stateColor);
      Utils.visualizePMC(gvrm.pmc, true);
    } else if (stateColor === "original") {
      stateColor = Utils.changeColor(gvrm.gs, stateColor);
      Utils.visualizePMC(gvrm.pmc, true);
    }
  }
  if (event.code === "KeyX") {
    Utils.visualizeVRM(gvrm.character, null);
  }
});


let t = 0;

function animate() {
  if (!flagReady1) return;

  if (flagReady2 && gvrm.isReady) {
    gvrm.character.update();

    if (stateAnim === "play") {
      if (gvrm.character.animationUrl === '') {
        Utils.simpleAnim(gvrm.character, t);
      }
    } else if (stateAnim === "pause") {
      Utils.resetPose(gvrm.character, gvrm.boneOperations);
      if (gvrm.character.animationUrl === '')  {
        t = 0;
      } else {
        gvrm.character.action.reset();
        gvrm.character.action.stop();
      }
      stateAnim = "stop";
    }

    // dynamic sort
    gvrm.updateByBones();
  }

  rotator.update();

  if (rotatorRTC) {
    rotatorRTC.update();
  }

  controls.update();
  controls2.update();

  renderer.render(scene, camera);
  fpsc.update();
  t += 1.0;
}


renderer.setAnimationLoop(animate);
