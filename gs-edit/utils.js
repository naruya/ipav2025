import * as THREE from 'three';


// colors

Math.seedrandom(0);
export const colors = [];

function getRandomColor() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return [r, g, b];
}

for (let i = 0; i < 100; i++) {
  const [r, g, b] = getRandomColor();
  colors.push([r, g, b]);
}




// bone operations

export function applyBoneOperations(vrm, boneOperations) {
  for (const op of boneOperations) {
    const boneName = op.boneName;
    const rawBone = vrm.humanoid.getRawBoneNode(boneName);
    const normBone = vrm.humanoid.getNormalizedBoneNode(boneName);

    if (op.position) {
      rawBone.position.x += op.position.x;
      rawBone.position.y += op.position.y;
      rawBone.position.z += op.position.z;
    }

    if (op.rotation) {
      normBone.rotation.x = op.rotation.x * Math.PI / 180.0;
      normBone.rotation.y = op.rotation.y * Math.PI / 180.0;
      normBone.rotation.z = op.rotation.z * Math.PI / 180.0;
    }
  }
}


export function setPose(character, boneOperations) {
  applyBoneOperations(character.currentVrm, boneOperations);
  character.currentVrm.humanoid.update();
}


export function resetPose(character, boneOperations) {
  character.currentVrm.humanoid.resetRawPose();
  character.currentVrm.humanoid.resetNormalizedPose();
  setPose(character, boneOperations);
}




// visualization

export function visualizeVRM(character, flag) {
  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
  const face = character.faceIndex ? character.currentVrm.scene.children[character.faceIndex] : null;

  if (flag === null) {
    skinnedMesh.material.forEach(material => {
      // material.visible = !material.visible;
      material.colorWrite = !material.colorWrite;
      material.depthWrite = !material.depthWrite;
    });
    if (face) {
      face.visible = !face.visible;
    }
  } else {
    skinnedMesh.material.forEach(material => {
      // material.visible = flag;
      material.colorWrite = flag;
      material.depthWrite = flag;
    });
    if (face) {
      face.visible = flag;
    }
  }
}
  
  
export function visualizePMC(pmc, flag) {
  const { points, mesh, capsules } = pmc;

  points.visible = flag;
  mesh.visible = flag;
  capsules.children.forEach((capsule) => { capsule.visible = flag; });
}


export function removePMC(scene, pmc) {
  const { points, mesh, capsules } = pmc;

  if (points) { scene.remove(points); points.geometry.dispose(); points.material.dispose(); }
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  if (capsules) {
    scene.remove(capsules);
    capsules.children.forEach((capsule) => {
      capsule.geometry.dispose(); capsule.material.dispose();
    });
  }
}


export function addPMC(scene, pmc) {
  const { points, mesh, capsules } = pmc;

  if (points) { scene.add(points); }
  if (mesh) { scene.add(mesh); }
  if (capsules) { scene.add(capsules); }
}


export function addChannels(fromArray, toArray, count, N=1) {
  for (let i = 0; i < count; i++) {
    toArray[i * 4 + 0] = N > 3 ? 1.0 : fromArray[i * (4-N) + 0];
    toArray[i * 4 + 1] = N > 2 ? 1.0 : fromArray[i * (4-N) + 1];
    toArray[i * 4 + 2] = N > 1 ? 1.0 : fromArray[i * (4-N) + 2];
    toArray[i * 4 + 3] = N > 0 ? 1.0 : fromArray[i * (4-N) + 3];
  }
}


export function createDataTexture(...args) {
  const texture = new THREE.DataTexture(...args);
  texture.needsUpdate = true;
  return texture;
}


export function changeColor(gs, state) {
  let stateColor = state;
  if (state === "empty") {
    stateColor = "assign";
  } else if (state === "assign") {
    if (gs.colorsB) {
      for (let i = 0; i < gs.splatCount; i++) {
        gs.colors[i * 4 + 0] = gs.colorsB[i * 4 + 0];
        gs.colors[i * 4 + 1] = gs.colorsB[i * 4 + 1];
        gs.colors[i * 4 + 2] = gs.colorsB[i * 4 + 2];
        gs.colors[i * 4 + 3] = gs.colorsB[i * 4 + 3];
      }
    }
    stateColor = "original";
  } else if (state === "original") {
    if (gs.colorsB) {
      for (let i = 0; i < gs.splatCount; i++) {
        gs.colors[i * 4 + 0] = gs.colors0[i * 4 + 0];
        gs.colors[i * 4 + 1] = gs.colors0[i * 4 + 1];
        gs.colors[i * 4 + 2] = gs.colors0[i * 4 + 2];
        gs.colors[i * 4 + 3] = gs.colors0[i * 4 + 3];
      }
    }
    stateColor = "empty";
  }
  gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);

  return stateColor;
}


export function simpleAnim(character, t) {
  const s1 = Math.PI * 65 / 180 * Math.sin( Math.PI * (t / 60. + 0.5));
  const s2 = 0.4 * Math.PI * Math.sin( Math.PI * (t / 60.));
  character.currentVrm.humanoid.getNormalizedBoneNode( 'leftUpperArm' ).rotation.z = s1;
  character.currentVrm.humanoid.getNormalizedBoneNode( 'leftUpperLeg' ).rotation.x = s2;
  character.currentVrm.humanoid.getNormalizedBoneNode( 'leftLowerLeg' ).rotation.x = -Math.max(s2,0);
  character.currentVrm.humanoid.getNormalizedBoneNode( 'rightLowerLeg' ).rotation.y = s2;
}