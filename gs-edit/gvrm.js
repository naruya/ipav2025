import * as THREE from 'three';
import * as Utils from './utils.js';
import { VRMCharacter } from './vrm.js';
import { GaussianSplatting } from './gs.js';
import { getPointsMeshCapsules } from './preprocess.js';
import { PLYParser } from './ply.js';


export async function initVRM(sotaiPath, scene, camera, renderer, modelScale, boneOperations) {
  if ( !boneOperations ) {
    boneOperations = (await (await fetch("./assets/default.json")).json()).boneOperations;
  }
  if ( !modelScale ) {
    modelScale = 1.0;
  }
  const character = new VRMCharacter(scene, sotaiPath, '', modelScale, true);
  await character.loadingPromise;
  character.currentVrm.scene.renderOrder = 10;

  character.skinnedMeshIndex = 1;
  character.faceIndex = undefined;
  if (character.currentVrm.scene.children.length > 4) {
    character.skinnedMeshIndex = 2;
    character.faceIndex = 1;
  }

  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];

  Utils.visualizeVRM(character, false);

  Utils.setPose(character, boneOperations);

  // これを呼ぶと、直ちに bone の matrixWorld 計算し直されるが、bones[r] が undefinedになる?
  // character.currentVrm.scene.updateMatrixWorld(true);
  skinnedMesh.skeleton.update();
  skinnedMesh.skeleton.computeBoneTexture();
  skinnedMesh.geometry.computeVertexNormals();

  if (character.skinnedMeshIndex === 2) {
    const headNode = character.currentVrm.humanoid.getRawBoneNode('head');
    const headTopEndNode = new THREE.Bone();
    headTopEndNode.name = "J_Bip_C_HeadTop_End";
    headTopEndNode.position.set(0, 0.2, -0.05);
    headTopEndNode.updateMatrixWorld(true);
    headNode.add(headTopEndNode);
    skinnedMesh.skeleton.bones.push(headTopEndNode);
    skinnedMesh.bind(new THREE.Skeleton(skinnedMesh.skeleton.bones), skinnedMesh.matrixWorld);
  }
  // call renderer.render after skinnedMesh.bind (?)
  renderer.render(scene, camera);  // ???

  // do not use .clone(), texture.image will be shared unexpectedly
  // const boneTexture0 = skinnedMesh.skeleton.boneTexture.clone();
  skinnedMesh.bindMatrix0 = skinnedMesh.bindMatrix.clone();
  skinnedMesh.bindMatrixInverse0 = skinnedMesh.bindMatrixInverse.clone();

  const widthtex = skinnedMesh.skeleton.boneTexture.image.width;
  const heighttex = skinnedMesh.skeleton.boneTexture.image.height;
  const format = skinnedMesh.skeleton.boneTexture.format;
  const type = skinnedMesh.skeleton.boneTexture.type;
  const dataCopy = skinnedMesh.skeleton.boneTexture.image.data.slice();
  skinnedMesh.boneTexture0 = new THREE.DataTexture(dataCopy, widthtex, heighttex, format, type);
  skinnedMesh.boneTexture0.needsUpdate = true;

  return { character };
}


export async function initGS(gsPath, gsQuaternion, scene, camera, renderer) {
  const gs = await new GaussianSplatting(gsPath, 1, gsQuaternion);

  gs.loadingPromise.then(() => {
    // gs.position.copy(new THREE.Vector3(0, -0.03, 0));
    // gs.rotation.copy(new THREE.Euler(0, 0, 0));
    scene.add(gs);
  })
  await gs.loadingPromise;

  gs.splatMesh = gs.viewer.viewer.splatMesh;
  gs.centers = gs.splatMesh.splatDataTextures.baseData.centers;
  gs.colors = gs.splatMesh.splatDataTextures.baseData.colors;
  gs.covariances = gs.splatMesh.splatDataTextures.baseData.covariances;
  gs.splatCount = gs.splatMesh.geometry.attributes.splatIndex.array.length;

  gs.centers0 = new Float32Array(gs.centers);
  gs.colors0 = new Float32Array(gs.colors);
  gs.covariances0 = new Float32Array(gs.covariances);
  gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);

  return { gs };
}


export async function loadGVRM(url, scene, camera, renderer) {
  const response = await fetch(url);
  const zip = await JSZip.loadAsync(response.arrayBuffer());
  const vrmBuffer = await zip.file('model.vrm').async('arraybuffer');
  const plyBuffer = await zip.file('model.ply').async('arraybuffer');
  const extraData = JSON.parse(await zip.file('data.json').async('text'));

  const vrmBlob = new Blob([vrmBuffer], { type: 'application/octet-stream' });
  const vrmUrl = URL.createObjectURL(vrmBlob);

  const plyBlob = new Blob([plyBuffer], { type: 'application/octet-stream' });
  const plyUrl = URL.createObjectURL(plyBlob);

  const modelScale = 1.05;  // TODO
  const boneOperations = extraData.boneOperations;

  if (extraData.splatRelativePoses === undefined) {  // TODO: remove
    extraData.splatRelativePoses = extraData.relativePoses;
  }


  const { character } = await initVRM(
    vrmUrl, scene, camera, renderer, modelScale, boneOperations);

  // no dynamic sort
  // const { gs } = await initGS(plyUrl, undefined, scene, camera, renderer);

  // dynamic sort (choose one splat sort)
  const { sceneSplatIndices, boneSceneMap } = sortSplatsByBones(extraData);
  // const { sceneSplatIndices, vertexSceneMap } = sortSplatsByVertices(extraData);
  const sceneUrls  = await splitPLY(plyUrl, sceneSplatIndices);

  const { gs } = await initGS(sceneUrls, extraData.gsQuaternion, scene, camera, renderer);

  const gvrm = new GVRM(character, gs);
  gvrm.modelScale = modelScale;
  gvrm.boneOperations = boneOperations;
  // dynamic sort (choose one map)
  gvrm.boneSceneMap = boneSceneMap;
  // gvrm.vertexSceneMap = vertexSceneMap;
  gvrm.rotation0 = gs.viewer.splatMesh.scenes[0].rotation.clone();

  gvrm.updatePMC();
  Utils.addPMC(scene, gvrm.pmc);
  Utils.visualizePMC(gvrm.pmc, false);
  renderer.render(scene, camera);

  gvrm.gs.splatVertexIndices = extraData.splatVertexIndices;
  gvrm.gs.splatBoneIndices = extraData.splatBoneIndices;
  gvrm.gs.splatRelativePoses = extraData.splatRelativePoses;
  gsCustomizeMaterial(character, gs);

  // splats を精査して、splatRelativePoses の距離 0.3 以上の splats は、alpha 0 にする
  for (let i = 0; i < gvrm.gs.splatCount; i++) {
    let distance = Math.sqrt(
      gvrm.gs.splatRelativePoses[i * 3 + 0] ** 2 +
      gvrm.gs.splatRelativePoses[i * 3 + 1] ** 2 +
      gvrm.gs.splatRelativePoses[i * 3 + 2] ** 2
    );
    if (gvrm.gs.splatRelativePoses[i * 3 + 1] < 0.05 && distance > 0.4) {
      gvrm.gs.colors0[i * 4 + 3] = 0;
      gvrm.gs.colors[i * 4 + 3] = 0;
    }
  }
  gvrm.gs.splatMesh.updateDataTexturesFromBaseData(0, gvrm.gs.splatCount - 1);

  gvrm.isReady = true;

  return { 'gvrm': gvrm };
}


export async function saveGVRM(gvrm, sotaiPath, gsPath, boneOperations, modelScale = 1.05) {
  const vrmBuffer = await fetch(sotaiPath).then(response => response.arrayBuffer());
  const plyBuffer = await fetch(gsPath).then(response => response.arrayBuffer());

  const extraData = {
    modelScale: modelScale,
    boneOperations: boneOperations,
    gsQuaternion: gvrm.gs.viewer.viewer.splatMesh.scenes[0].quaternion.toArray(),
    splatVertexIndices: gvrm.gs.splatVertexIndices,
    splatBoneIndices: gvrm.gs.splatBoneIndices,
    splatRelativePoses: gvrm.gs.splatRelativePoses,
  };

  const zip = new JSZip();

  zip.file('model.vrm', vrmBuffer);
  zip.file('model.ply', plyBuffer);
  zip.file('data.json', JSON.stringify(extraData, null, 2));

  const content = await zip.generateAsync({ type: 'blob' });

  let fileName;
  if (gsPath.endsWith('.ply')) {
    fileName = gsPath.split('/').pop().replace('.ply', '.gvrm');
  } else {  // blob
    fileName = gsPath.split('/').pop() + '.gvrm';
  }

  downloadBlob(content, fileName);

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    if (gvrm.url) {
      URL.revokeObjectURL(gvrm.url);
    }
    gvrm.url = url;
  }
}


export async function removeGVRM(gvrm, scene) {
  await gvrm.character.leave(scene);
  gvrm.character = null;

  await gvrm.gs.viewer.dispose();
  gvrm.gs = null;

  if (gvrm.pmc) {
    Utils.removePMC(scene, gvrm.pmc);
  }
}


export class GVRM {
  constructor(character, gs) {
    this.character = character;
    this.gs = gs;
    this.debugAxes = new Map();
    this.isReady = false;
    this.rotation0 = undefined;
  }

  async loadGVRM(url, scene, camera, renderer) {
    const result = await loadGVRM(url, scene, camera, renderer);
    const _gvrm = result.gvrm;
    // TODO: refactor
    this.character = _gvrm.character;
    this.gs = _gvrm.gs;
    this.modelScale = _gvrm.modelScale;
    this.boneOperations = _gvrm.boneOperations;
    this.boneSceneMap = _gvrm.boneSceneMap;
    this.vertexSceneMap = _gvrm.vertexSceneMap;
    this.rotation0 = _gvrm.gs.viewer.splatMesh.scenes[0].rotation.clone();
    this.isReady = true;
  }

  async saveGVRM(sotaiPath, gsPath, boneOperations, modelScale) {
    await saveGVRM(this, sotaiPath, gsPath, boneOperations, modelScale);
  }

  async removeGVRM(scene) {
    this.isReady = false;
    await removeGVRM(this, scene);
  }

  async changeFBX(url, scene) {
    await this.character.changeFBX(scene, url);
  }

  updatePMC() {
    const { pmc } = getPointsMeshCapsules(this.character);
    this.pmc = pmc;
  }

  updateByBones() {
    if (this.rotation0 === undefined) {
      this.rotation0 = this.gs.viewer.splatMesh.scenes[0].rotation.clone();
      return;
    }

    const tempNodePos = new THREE.Vector3();
    const tempChildPos = new THREE.Vector3();
    const tempMidPoint = new THREE.Vector3();
    const boneRotationMatrix = new THREE.Matrix4();
    const characterRotationMatrix = new THREE.Matrix4();
    const rotationQuaternion = new THREE.Quaternion();
    const characterQuaternion = new THREE.Quaternion();

    const skeleton = this.character.currentVrm.scene.children[2].skeleton;

    characterRotationMatrix.extractRotation(this.character.currentVrm.scene.matrix);
    characterQuaternion.setFromRotationMatrix(characterRotationMatrix);

    skeleton.bones.forEach((bone, boneIndex) => {
      const children = bone.children;
      if (children.length === 0) return;

      children.forEach(childBone => {
        const childIndex = skeleton.bones.indexOf(childBone);
        const sceneIndex = this.boneSceneMap[childIndex];
        if (sceneIndex === undefined) return;

        tempNodePos.setFromMatrixPosition(bone.matrixWorld);
        tempChildPos.setFromMatrixPosition(childBone.matrixWorld);
        tempMidPoint.addVectors(tempNodePos, tempChildPos).multiplyScalar(0.5);

        boneRotationMatrix.extractRotation(childBone.matrixWorld);
        rotationQuaternion.setFromRotationMatrix(boneRotationMatrix);
        rotationQuaternion.multiply(characterQuaternion);

        const quaternion = new THREE.Quaternion().setFromEuler(this.rotation0);
        rotationQuaternion.multiply(quaternion);

        const scene = this.gs.viewer.viewer.getSplatScene(sceneIndex);
        if (scene) {
          scene.position.copy(tempMidPoint);
          scene.quaternion.copy(rotationQuaternion);

          let axesHelper = this.debugAxes.get(sceneIndex);
          if (!axesHelper) {
            axesHelper = this.createDebugAxes(sceneIndex);
          }
          axesHelper.position.copy(scene.position);
          axesHelper.quaternion.copy(rotationQuaternion);
        }
      });
    });
  }

  // updateByVertices() {
  //   const skinnedMesh = this.character.currentVrm.scene.children[this.character.skinnedMeshIndex];
  //   const position = skinnedMesh.geometry.getAttribute('position');
  //   const tempVertex = new THREE.Vector3();

  //   for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
  //     const sceneIndex = this.vertexSceneMap[vertexIndex];
  //     if (sceneIndex === undefined) continue;
  //     if (sceneIndex > NNN) break;

  //     tempVertex.fromBufferAttribute(position, vertexIndex);
  //     const skinnedVertex = skinnedMesh.applyBoneTransform(vertexIndex, tempVertex.clone());
  //     skinnedVertex.applyMatrix4(this.character.currentVrm.scene.matrixWorld);

  //     const scene = this.gs.viewer.viewer.getSplatScene(sceneIndex);
  //     if (scene) {
  //       scene.position.copy(skinnedVertex);

  //       let axesHelper = this.debugAxes.get(sceneIndex);
  //       if (!axesHelper) {
  //         axesHelper = this.createDebugAxes(sceneIndex);
  //       }
  //       axesHelper.position.copy(skinnedVertex);
  //     }
  //   }
  // }

  createDebugAxes(sceneIndex) {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.gs.add(axesHelper);
    this.debugAxes.set(sceneIndex, axesHelper);
    return axesHelper;
  }
}


function sortSplatsByBones(extraData) {
  const sceneSplatIndices = {};

  let sceneCount = 0;
  const boneSceneMap = {};

  for (let i = 0; i < extraData.splatBoneIndices.length; i++) {
    const boneIndex = extraData.splatBoneIndices[i];

    if (boneSceneMap[boneIndex] === undefined) {
      boneSceneMap[boneIndex] = sceneCount;
      sceneCount++;
      sceneSplatIndices[boneSceneMap[boneIndex]] = [];
    }
    sceneSplatIndices[boneSceneMap[boneIndex]].push(i);
  }

  updateExtraData(extraData, sceneSplatIndices);

  return { sceneSplatIndices, boneSceneMap };
}


function sortSplatsByVertices(extraData) {
  const sceneSplatIndices = {};

  let sceneCount = 0;
  const vertexSceneMap = {};

  for (let i = 0; i < extraData.splatVertexIndices.length; i++) {
    const vertexIndex = extraData.splatVertexIndices[i];

    if (vertexSceneMap[vertexIndex] === undefined) {
      vertexSceneMap[vertexIndex] = sceneCount;
      sceneCount++;
      sceneSplatIndices[vertexSceneMap[vertexIndex]] = [];
    }
    sceneSplatIndices[vertexSceneMap[vertexIndex]].push(i);
  }

  updateExtraData(extraData, sceneSplatIndices);

  return { sceneSplatIndices, vertexSceneMap };
}


function updateExtraData(extraData, sceneSplatIndices) {

  let splatIndices = [];
  for (let i = 0; i < Object.keys(sceneSplatIndices).length; i++) {
    splatIndices = splatIndices.concat(sceneSplatIndices[i]);
  }

  const splatVertexIndices = [];
  const splatBoneIndices = [];
  const splatRelativePoses = [];

  for (const sceneIndex of Object.keys(sceneSplatIndices)) {
    for (const splatIndex of sceneSplatIndices[sceneIndex]) {
      splatVertexIndices.push(extraData.splatVertexIndices[splatIndex]);
      splatBoneIndices.push(extraData.splatBoneIndices[splatIndex]);
      splatRelativePoses.push(
        extraData.splatRelativePoses[splatIndex * 3],
        extraData.splatRelativePoses[splatIndex * 3 + 1],
        extraData.splatRelativePoses[splatIndex * 3 + 2]
      );
    }
  }

  extraData.splatVertexIndices = splatVertexIndices;
  extraData.splatBoneIndices = splatBoneIndices;
  extraData.splatRelativePoses = splatRelativePoses;
}


async function splitPLY(plyUrl, sceneSplatIndices) {
  const parser = new PLYParser();
  const plyData = await parser.parsePLY(plyUrl, false);

  const createModifiedHeader = (vertexCount) => {
      return plyData.header.map(line => {
          if (line.startsWith('element vertex')) {
              return `element vertex ${vertexCount}`;
          }
          return line;
      });
  };

  const sceneUrls = [];
  for (const [sceneIndex, indices] of Object.entries(sceneSplatIndices)) {
    const sceneVertices = indices.map(index => plyData.vertices[index]);

    const scenePlyData = parser.createPLYFile(
      createModifiedHeader(sceneVertices.length),
      sceneVertices,
      plyData.vertexSize
    );

    const blob = new Blob([scenePlyData], { type: 'application/octet-stream' });
    sceneUrls.push(URL.createObjectURL(blob));
  }

  return sceneUrls;
}


export function gsCustomizeMaterial(character, gs) {
  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];

  const meshVertexCount = skinnedMesh.geometry.attributes.position.count;

  const meshPositions = skinnedMesh.geometry.attributes.position.array;
  const meshNormals = skinnedMesh.geometry.attributes.normal.array;
  const meshSkinIndices = skinnedMesh.geometry.attributes.skinIndex.array;
  const meshSkinWeights = skinnedMesh.geometry.attributes.skinWeight.array;
  const gsVertexIndices = gs.splatVertexIndices;
  const gsRelativePoses = gs.splatRelativePoses;

  const meshPositionData = new Float32Array(4096*1024*4);
  const meshNormalData = new Float32Array(4096*1024*4);
  const meshSkinIndexData = new Float32Array(4096*1024*4);
  const meshSkinWeightData = new Float32Array(4096*1024*4);
  const gsMeshVertexIndexData = new Float32Array(4096*1024*4);
  const gsMeshRelativePosData = new Float32Array(4096*1024*4);

  Utils.addChannels(meshPositions, meshPositionData, meshVertexCount, 1);
  Utils.addChannels(meshNormals, meshNormalData, meshVertexCount, 1);
  meshSkinIndexData.set(meshSkinIndices);
  meshSkinWeightData.set(meshSkinWeights);
  Utils.addChannels(gsVertexIndices, gsMeshVertexIndexData, gs.splatCount, 3);
  Utils.addChannels(gsRelativePoses, gsMeshRelativePosData, gs.splatCount, 1);

  const meshPositionTexture = Utils.createDataTexture(
    meshPositionData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);
  const meshNormalTexture = Utils.createDataTexture(
    meshNormalData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);
  const meshSkinIndexTexture = Utils.createDataTexture(
    meshSkinIndexData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);
  const meshSkinWeightTexture = Utils.createDataTexture(
    meshSkinWeightData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);
  const gsMeshVertexIndexTexture = Utils.createDataTexture(
    gsMeshVertexIndexData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);
  const gsMeshRelativePosTexture = Utils.createDataTexture(
    gsMeshRelativePosData, 4096, 1024, THREE.RGBAFormat, THREE.FloatType);

  gs.splatMesh.material.onBeforeCompile = function (shader) {
    shader.uniforms.meshPositionTexture = { value: meshPositionTexture };
    shader.uniforms.meshNormalTexture = { value: meshNormalTexture };
    shader.uniforms.meshSkinIndexTexture = { value: meshSkinIndexTexture };
    shader.uniforms.meshSkinWeightTexture = { value: meshSkinWeightTexture };
    shader.uniforms.gsMeshVertexIndexTexture = { value: gsMeshVertexIndexTexture };
    shader.uniforms.gsMeshRelativePosTexture = { value: gsMeshRelativePosTexture };
    shader.uniforms.bindMatrix0 = { value: skinnedMesh.bindMatrix0 };
    shader.uniforms.bindMatrix = { value: skinnedMesh.bindMatrix };
    shader.uniforms.bindMatrixInverse0 = { value: skinnedMesh.bindMatrixInverse0 };
    shader.uniforms.bindMatrixInverse = { value: skinnedMesh.bindMatrixInverse };
    shader.uniforms.boneTexture0 = { value: skinnedMesh.boneTexture0 };
    shader.uniforms.boneTexture = { value: skinnedMesh.skeleton.boneTexture };
    shader.uniforms.meshMatrixWorld = { value: character.currentVrm.scene.matrixWorld };

    // コンパイル直前のシェーダーコードを取得
    // console.log('Vertex Shader:', shader.vertexShader);
    // console.log('Fragment Shader:', shader.fragmentShader);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #define USE_SKINNING

      #include <common>
      #include <skinning_pars_vertex>  // boneTexture

      uniform sampler2D meshPositionTexture;
      uniform sampler2D meshNormalTexture;
      uniform sampler2D meshSkinIndexTexture;
      uniform sampler2D meshSkinWeightTexture;
      uniform sampler2D gsMeshVertexIndexTexture;
      uniform sampler2D gsMeshRelativePosTexture;
      uniform mat4 meshMatrixWorld;

      uniform mat4 bindMatrix0;
      uniform mat4 bindMatrixInverse0;
      uniform highp sampler2D boneTexture0;

      mat4 getBoneMatrix0( const in float i ) {
        int size = textureSize( boneTexture0, 0 ).x;
        int j = int( i ) * 4;
        int x = j % size;
        int y = j / size;
        vec4 v1 = texelFetch( boneTexture0, ivec2( x, y ), 0 );
        vec4 v2 = texelFetch( boneTexture0, ivec2( x + 1, y ), 0 );
        vec4 v3 = texelFetch( boneTexture0, ivec2( x + 2, y ), 0 );
        vec4 v4 = texelFetch( boneTexture0, ivec2( x + 3, y ), 0 );
        return mat4( v1, v2, v3, v4 );
      }
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      'vec3 splatCenter = uintBitsToFloat(uvec3(sampledCenterColor.gba));',
      `
      vec2 samplerUV2 = vec2(0.0, 0.0);
      float d2 = float(splatIndex) / 4096.0;
      samplerUV2.y = float(floor(d2)) / 1024.0;
      samplerUV2.x = fract(d2);
      float meshVertexIndex = texture2D(gsMeshVertexIndexTexture, samplerUV2).r;
      vec3 relativePos = texture2D(gsMeshRelativePosTexture, samplerUV2).rgb;

      vec2 samplerUV3 = vec2(0.0, 0.0);
      float d3 = float(meshVertexIndex) / 4096.0;
      samplerUV3.y = float(floor(d3)) / 1024.0;
      samplerUV3.x = fract(d3);
      vec3 transformed = texture2D(meshPositionTexture, samplerUV3).rgb;
      vec3 objectNormal = texture2D(meshNormalTexture, samplerUV3).rgb;
      vec4 skinIndex = texture2D(meshSkinIndexTexture, samplerUV3);
      vec4 skinWeight = texture2D(meshSkinWeightTexture, samplerUV3);

      mat4 boneMatX0 = getBoneMatrix0( skinIndex.x );
      mat4 boneMatY0 = getBoneMatrix0( skinIndex.y );
      mat4 boneMatZ0 = getBoneMatrix0( skinIndex.z );
      mat4 boneMatW0 = getBoneMatrix0( skinIndex.w );
      mat4 skinMatrix0 = mat4( 0.0 );
      skinMatrix0 += skinWeight.x * boneMatX0;
      skinMatrix0 += skinWeight.y * boneMatY0;
      skinMatrix0 += skinWeight.z * boneMatZ0;
      skinMatrix0 += skinWeight.w * boneMatW0;
      skinMatrix0 = bindMatrixInverse0 * skinMatrix0 * bindMatrix0;

      #include <skinbase_vertex>  // boneMat
      #include <skinnormal_vertex>  // skinMatrix, using normal
      #include <defaultnormal_vertex>  // ?
      #include <skinning_vertex>
      objectNormal = ( meshMatrixWorld * vec4(objectNormal, 1.0) ).xyz;

      // vec3 splatCenter = ( meshMatrixWorld * vec4(transformed + relativePos, 1.0) ).xyz;

      vec3 skinnedRelativePos = vec4( skinMatrix * inverse(skinMatrix0) * vec4( relativePos, 0.0 ) ).xyz;
      vec3 splatCenter = ( meshMatrixWorld * vec4(transformed + skinnedRelativePos, 1.0) ).xyz;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      'vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0);',
      'vec4 viewCenter = viewMatrix * vec4(splatCenter, 1.0);'
    );
    shader.vertexShader = shader.vertexShader.replace(
      'mat3 W = transpose(mat3(transformModelViewMatrix));',
      'mat3 W = transpose(mat3(viewMatrix * transform));'
    );
    shader.vertexShader = shader.vertexShader.replace(
      'mat3 cov2Dm = transpose(T) * Vrk * T;',
      `
      mat3 transformR = mat3(transform);
      transformR[0] = normalize(transformR[0]);
      transformR[1] = normalize(transformR[1]);
      transformR[2] = normalize(transformR[2]);

      // transformModelViewMatrix にした場合、x: NG, y:OK, z:OK, scale: OK, t=0: OK (いったんこれ？)
      mat3 skinRotationMatrix = mat3(skinMatrix * inverse(skinMatrix0));
      mat3 cov2Dm = transpose(T) * transpose(skinRotationMatrix) * Vrk * skinRotationMatrix * T;
      `
    );
  };
  gs.splatMesh.material.needsUpdate = true;
}
