import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { preprocess } from './gs-edit/preprocess.js';
import { loadGVRM } from './gs-edit/gvrm.js';
import { Recorder } from './gs-edit/recorder.js';
import { PoseDetector } from './gs-edit/pose.js';
import { Rotator } from './gs-edit/rotator.js';
import { FPSCounter } from './gs-edit/fps.js';
import { VRMCharacter } from './gs-edit/vrm.js';
import * as Utils from './gs-edit/utils.js';


// UI
const container = document.getElementById('threejs-container');
let width = window.innerWidth;
let height = window.innerHeight;


// params
const params = new URL(window.location.href).searchParams;
let gsPath = params.get('gs') ?? undefined;
let vrmPath = params.get('vrm') ?? undefined;
let gvrmPath = params.get('gvrm') ?? undefined;
const sotaiPath = params.get('sotai') ?? "./assets/sotai1.vrm";
const modelScale = params.get('scale');
const modelRotX = params.get('rotx');
const fast = params.has('fast');
const stage = params.get('stage');
const useVR = params.has('vr');
const size = params.get('size');
if (size) {
  const match = size.match(/([\d]+),([\d]+)/);
  width = parseInt(match[1]);
  height = parseInt(match[2]);
  document.body.style.backgroundColor = 'gray';
}


async function setupPathsFromUrlOrUpload() {
  if (!gsPath && !vrmPath && !gvrmPath) {
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
            } else if (extension === 'vrm') {
              vrmPath = objectUrl;
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

let gvrm, character;
let stateAnim = "play";
let stateColor = "original";


function transferBoneOperations(source, target, isInit=false) {
  const sourceVRM = source.currentVrm;
  const targetVRM = target.currentVrm;

  const characterBones = new Set(Object.keys(sourceVRM.humanoid.humanBones));
  const sotaiBones = new Set(Object.keys(targetVRM.humanoid.humanBones));
  const commonBones = [...characterBones].filter(bone => sotaiBones.has(bone));
  const extraBones = [...characterBones].filter(bone => !sotaiBones.has(bone));
  const missingBones = [...sotaiBones].filter(bone => !characterBones.has(bone));
  if (extraBones.length > 0 || missingBones.length > 0) {
    console.error("Extra bones:", extraBones);
    console.error("Missing bones:", missingBones);
    return;
  }

  for (const boneName of commonBones) {
    const sourceRawBone = sourceVRM.humanoid.getRawBoneNode(boneName);
    const sourceNormBone = sourceVRM.humanoid.getNormalizedBoneNode(boneName);
    const targetRawBone = targetVRM.humanoid.getRawBoneNode(boneName);
    const targetNormBone = targetVRM.humanoid.getNormalizedBoneNode(boneName);

    if (sourceRawBone && targetRawBone && sourceNormBone && targetNormBone) {
      targetRawBone.position.copy(sourceRawBone.position);
      targetNormBone.rotation.copy(sourceNormBone.rotation);
    }
  }
  targetVRM.humanoid.update();

  sourceVRM.scene.position.y = 0;
  targetVRM.scene.position.y = 0;

  targetVRM.scene.updateMatrixWorld(true);
  const skinnedMesh = targetVRM.scene.children[target.skinnedMeshIndex];
  const geometry = skinnedMesh.geometry;
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const box = new THREE.Box3();
  box.makeEmpty();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const skinned = skinnedMesh.applyBoneTransform(i, vertex.clone());
    box.expandByPoint(skinned);
  }

  if (isInit) {
    const bbsize = new THREE.Vector3();
    box.getSize(bbsize);
    // const helper = new THREE.Box3Helper(box, 0xffff00);
    // helper.name = 'bboxHelper';
    // targetVRM.scene.add(helper);

    const floorOffset = box.min.y;
    targetVRM.scene.position.y = -floorOffset;

    const targetToes = targetVRM.humanoid.getNormalizedBoneNode('leftToes');
    const targetToeY = (new THREE.Vector3().setFromMatrixPosition(targetToes.matrixWorld)).y;
    const sourceToes = sourceVRM.humanoid.getNormalizedBoneNode('leftToes');
    const sourceToeY = (new THREE.Vector3().setFromMatrixPosition(sourceToes.matrixWorld)).y;
    targetVRM.scene.position.y += (sourceToeY - targetToeY) + source.ground;
    sourceVRM.scene.position.y = source.ground;
    target.ground = targetVRM.scene.position.y;
  } else {
    targetVRM.scene.position.y = target.ground;
    sourceVRM.scene.position.y = source.ground;
  }
}


// カメラ回転と画像キャプチャのための関数
async function captureImagesWithRotation(scene, camera, renderer, roundFrames = 30) {
  axesHelper.visible = false;
  Utils.visualizeVRM(character.sotai, false);

  const originalPosition = camera.position.clone();

  renderer.setSize(1024, 1024);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  scene.background = null;
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const angleStep = (Math.PI * 2) / roundFrames;

  const radius = 1.6;

  const zip = new JSZip();
  const imageFolderName = "images";
  const imageFolder = zip.folder(imageFolderName);

  const sotai = character.sotai;
  const boneOperations = [];

  for (const boneName of Object.keys(sotai.currentVrm.humanoid.humanBones)) {
    const rawBone = sotai.currentVrm.humanoid.getRawBoneNode(boneName);
    const normBone = sotai.currentVrm.humanoid.getNormalizedBoneNode(boneName);

    if (rawBone && normBone) {
      const operation = {
        boneName: boneName,
        position: {
          x: rawBone.position.x,
          y: rawBone.position.y,
          z: rawBone.position.z
        },
        rotation: {
          x: normBone.rotation.x * 180 / Math.PI,
          y: normBone.rotation.y * 180 / Math.PI,
          z: normBone.rotation.z * 180 / Math.PI
        }
      };
      boneOperations.push(operation);
    }
  }

  const boneOperationsJson = JSON.stringify({
    boneOperations: boneOperations
  }, null, 2);
  zip.file("bone_operations.json", boneOperationsJson);

  const w2cList = [];

  camera.position.y = 0.8;
  for (let i = 0; i < roundFrames; i++) {
    const angle = angleStep * i;

    camera.position.x = radius * Math.sin(angle);
    camera.position.z = radius * Math.cos(angle);
    camera.lookAt(0, 0, 0);

    camera.updateMatrixWorld(true);
    const w2c = camera.matrixWorldInverse.clone();
    w2cList.push(Array.from(w2c.elements));

    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png', 1.0);
    const imageData = dataUrl.split('base64,')[1];
    imageFolder.file(`rotation_${String(i).padStart(3, '0')}.png`, imageData, {base64: true});

    document.getElementById('loaddisplay').innerHTML = `Capturing: ${Math.round((i + 1) / roundFrames * 50)}%`;

    await new Promise(resolve => setTimeout(resolve, 33));
  }

  camera.position.y = -0.8;
  for (let i = 0; i < roundFrames; i++) {
    const angle = angleStep * i + angleStep / 2.0;

    camera.position.x = radius * Math.sin(angle);
    camera.position.z = radius * Math.cos(angle);
    camera.lookAt(0, 0, 0);

    camera.updateMatrixWorld(true);
    const w2c = camera.matrixWorldInverse.clone();
    w2cList.push(Array.from(w2c.elements));

    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const imageData = dataUrl.split('base64,')[1];
    imageFolder.file(`rotation_${String(i+roundFrames).padStart(3, '0')}.png`, imageData, {base64: true});

    document.getElementById('loaddisplay').innerHTML = `Capturing: ${Math.round((i + 1) / roundFrames * 50 + 50)}%`;

    await new Promise(resolve => setTimeout(resolve, 33));
  }

  const w2cJson = JSON.stringify({
    camera_params: w2cList
  }, null, 2);
  zip.file("camera_params.json", w2cJson);

  document.getElementById('loaddisplay').innerHTML = 'Generating ZIP...';
  const content = await zip.generateAsync({type: "blob"});
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = "images.zip";
  link.click();
  URL.revokeObjectURL(url);

  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  camera.aspect = width / height;
  camera.position.copy(originalPosition);
  camera.updateProjectionMatrix();

  axesHelper.visible = true;
  Utils.visualizeVRM(character.sotai, true);

  document.getElementById('loaddisplay').innerHTML = 'Capture complete';
}


if (gvrmPath) {
  const promise2 = loadGVRM(gvrmPath, scene, camera, renderer);
  promise2.then((result) => {
    gvrm = result.gvrm;
    window.gvrm = gvrm;

    flagReady1 = true;
    flagReady2 = true;
  });
} else if (gsPath) {
  const promise1 = preprocess(sotaiPath, gsPath, scene, camera, renderer, modelScale, modelRotX, stage, fast);
  promise1.then((result) => {
    gvrm = result.gvrm;
    window.gvrm = gvrm;
    flagReady1 = true;

    const promise2 = result.promise;
    promise2.then(() => {
      flagReady2 = true;
    });
  });
} else if (vrmPath) {
  character = new VRMCharacter(scene, vrmPath, '', 1.0, true);
  await character.loadingPromise;
  character.skinnedMeshIndex = 2;
  character.faceIndex = 1;
  window.character = character;

  let sotai = new VRMCharacter(scene, sotaiPath, '', 1.0, true);
  await sotai.loadingPromise;
  sotai.skinnedMeshIndex = 2;
  sotai.faceIndex = 1;
  character.sotai = sotai;

  let response = await fetch("./assets/default.json");
  const params = await response.json();
  const boneOperations = params.boneOperations;
  boneOperations.forEach(op => {
    if (op.position) {
      op.position.x = 0;
    }
  });
  boneOperations[2].rotation.z = 30;
  boneOperations[3].rotation.z = -30;
  character.boneOperations = boneOperations;

  Utils.resetPose(character, character.boneOperations);
  Utils.resetPose(character.sotai, character.boneOperations);
  transferBoneOperations(character, sotai, true);

  await captureImagesWithRotation(scene, camera, renderer);

  stateAnim = "stop";
}

const poseDetector = new PoseDetector(scene, camera, renderer);

const recorder = new Recorder(renderer);

const rotator = new Rotator(camera);

const fpsc = new FPSCounter();

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
  if (!gvrm) return;

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
      if (gvrm && gvrm.character.animationUrl !== '') {
        gvrm.character.action.play();
      }
    }
  }
  if (event.code === "KeyV") {
    if (!gvrm) return;

    Utils.removePMC(scene, gvrm.pmc);
    gvrm.updatePMC();
    Utils.addPMC(scene, gvrm.pmc);
    stateColor = gvrmPath ? "original" : stateColor;
  }
  if (event.code === "KeyC") {
    if (!gvrm) return;

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
    if (!gvrm) {
      Utils.visualizeVRM(character.sotai, null);
      return;
    };

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

  controls.update();
  controls2.update();

  renderer.render(scene, camera);
  fpsc.update();
  t += 1.0;
}


function animateVRM() {
  if (stateAnim === "play") {
    Utils.simpleAnim(character, t);
    Utils.simpleAnim(character.sotai, t);
  } else if (stateAnim === "pause") {
    Utils.resetPose(character, character.boneOperations);
    Utils.resetPose(character.sotai, character.boneOperations);
    transferBoneOperations(character, character.sotai);

    t = 0;
    stateAnim = "stop";
  }
  character.update();
  character.sotai.update();
  controls.update();
  controls2.update();
  renderer.render(scene, camera);
  fpsc.update();
  t += 1.0;
}


if (gsPath || gvrmPath) {
  renderer.setAnimationLoop(animate);
} else if (vrmPath) {
  renderer.setAnimationLoop(animateVRM);
}
