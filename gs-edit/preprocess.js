import * as THREE from 'three';
import {
  GVRM,
  initVRM,
  initGS,
  gsCustomizeMaterial,
} from './gvrm.js';
import { PLYParser } from './ply.js';
import * as Utils from './utils.js';
import { DropInViewer } from 'gaussian-splats-3d';


export function getPointsMeshCapsules(character) {
  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];

  const pointsMaterial = new THREE.PointsMaterial({
    color: 0xff0000,
    size: 0.02,
    opacity: 0.3,
    transparent: true
  });

  const meshMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    wireframe: true,
    opacity: 0.2,
    transparent: true
  });


  // points
  const pointsGeometry = new THREE.BufferGeometry();
  const vertices = [];

  const geometry = skinnedMesh.geometry;
  const position = geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  let skinnedVertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      skinnedVertex = skinnedMesh.applyBoneTransform(i, vertex);
      skinnedVertex.applyMatrix4(character.currentVrm.scene.matrixWorld);
      vertices.push(skinnedVertex.x, skinnedVertex.y, skinnedVertex.z);
  }

  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const points = new THREE.Points(pointsGeometry, pointsMaterial);


  // mesh
  const meshGeometry = new THREE.BufferGeometry();
  meshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

  const index = skinnedMesh.geometry.getIndex();
  meshGeometry.setIndex(index);

  const mesh = new THREE.Mesh(meshGeometry, meshMaterial);


  // capsules
  const capsules = new THREE.Group();
  const capsuleBoneIndex = [];

  let nodeCount = 0;

  function traverseNodes(node, depth=0) {
    nodeCount++;
    // console.log(String(nodeCount).padStart(2, ' '), "  ".repeat(depth)+"- " , node.name);
    const nodePosition = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);

    let capsuleMaterial;
    let hexColor;
    let r,g,b;

    node.children.forEach(function (childNode) {
      // make a capsule from parent to child
      if (childNode.isBone) {
        const childNodePosition = new THREE.Vector3().setFromMatrixPosition(childNode.matrixWorld);

        const distance = nodePosition.distanceTo(childNodePosition);
        const midPoint = new THREE.Vector3().addVectors(nodePosition, childNodePosition).multiplyScalar(0.5);
        let radius = 0.03;
        let scaleX = 1.0, scaleZ = 1.0;
        const type1 = ["HandL", "ForeArmL", "HandR", "ForeArmR",
          "J_Bip_L_Hand", "J_Bip_L_LowerArm", "J_Bip_R_Hand", "J_Bip_R_LowerArm"];
        const type2 = ["LegL", "FootL", "LegR", "FootR",
          "J_Bip_L_LowerLeg", "J_Bip_L_Foot", "J_Bip_R_LowerLeg", "J_Bip_R_Foot"
        ];
        const type3 = ["Neck", "Spine", "Spine1", "Spine2",
          "J_Bip_C_Neck", "J_Bip_C_Spine", "J_Bip_C_Chest", "J_Bip_C_UpperChest"
        ];
        const type4 = ["HeadTop_End",
          "J_Bip_C_HeadTop_End"
        ];
        const type5 = ["Head",
          "J_Bip_C_Head"
        ];
        if (type1.includes(childNode.name)) {
          radius = 0.06;
        } else if (type2.includes(childNode.name)) {
          radius = 0.08;
        } else if (type3.includes(childNode.name)) {
          radius = 0.03;
          scaleX = 6, scaleZ = 4;
        } else if (type4.includes(childNode.name)) {
          radius = 0.06;
          scaleX = 1.5, scaleZ = 2;
        } else if (type5.includes(childNode.name)) {
          radius = 0.03;
          scaleX = 2, scaleZ = 2;
        }
        if (type1.concat(type2, type3, type4, type5).includes(childNode.name)) {
          [r,g,b] = Utils.colors[capsules.children.length];
          hexColor = `0x${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

          capsuleMaterial = new THREE.MeshBasicMaterial({
            color: parseInt(hexColor),
            wireframe: true,
            opacity: 0.5,
            transparent: true
          });

          const capsuleGeometry = new THREE.CapsuleGeometry(radius, distance - radius*2, 1, 6);  // 長さを調整
          const capsule = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
          capsule.scale.set(scaleX, 1, scaleZ);
          capsule.position.copy(midPoint);

          const direction = new THREE.Vector3().subVectors(childNodePosition, nodePosition).normalize();
          const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
          capsule.setRotationFromQuaternion(quaternion);
          capsule.updateMatrixWorld();

          const nodeIndex = skinnedMesh.skeleton.bones.indexOf(childNode);
          // console.log(capsules.children.length, childNode.name, nodeIndex);
          capsules.add(capsule);
          capsuleBoneIndex.push(nodeIndex);
        }

        traverseNodes(childNode, depth+1);
      }
    });
  }

  const rootNode = character.currentVrm.scene.children[0].children[0];
  traverseNodes(rootNode, 1);

  const pmc = { points, mesh, capsules };
  return { pmc, capsuleBoneIndex };
}


async function assignSplatsToBones(gs, capsules, capsuleBoneIndex, fast=false) {
  gs.splatBoneIndices = [];
  let bestCi = 0;

  for (let i = 0; i < gs.splatCount; i++) {
    if (fast && i % 10 !== 0) {  // CHANGED
      bestCi = bestCi;
      gs.splatBoneIndices.push(capsuleBoneIndex[bestCi]);
      gs.colors[i * 4 + 0] = Utils.colors[bestCi][0];
      gs.colors[i * 4 + 1] = Utils.colors[bestCi][1];
      gs.colors[i * 4 + 2] = Utils.colors[bestCi][2];
      continue;
    }
    let targetPoint = new THREE.Vector3(gs.centers0[i * 3 + 0], gs.centers0[i * 3 + 1], gs.centers0[i * 3 + 2]);
    targetPoint.applyMatrix4(gs.viewer.viewer.splatMesh.scenes[0].matrixWorld);

    let minDistance = Infinity;
    bestCi = 0;

    for (let ci = 0; ci < capsules.children.length; ci++) {
      const capsule = capsules.children[ci];
      const geometry = capsule.geometry;
      const position = geometry.getAttribute('position');
      const index = geometry.index;

      const triangle = new THREE.Triangle();

      for (let ii = 0; ii < index.count; ii += 3) {
        let a = new THREE.Vector3().fromBufferAttribute(position, index.getX(ii));
        let b = new THREE.Vector3().fromBufferAttribute(position, index.getX(ii + 1));
        let c = new THREE.Vector3().fromBufferAttribute(position, index.getX(ii + 2));

        a.applyMatrix4(capsule.matrixWorld);
        b.applyMatrix4(capsule.matrixWorld);
        c.applyMatrix4(capsule.matrixWorld);

        triangle.set(a, b, c);

        let closestPoint = new THREE.Vector3();
        triangle.closestPointToPoint(targetPoint, closestPoint);

        let distance = targetPoint.distanceTo(closestPoint);

        if (distance < minDistance) {
          minDistance = distance;
          bestCi = ci;
        }
      }
    }

    gs.splatBoneIndices.push(capsuleBoneIndex[bestCi]);

    gs.colors[i * 4 + 0] = Utils.colors[bestCi][0];
    gs.colors[i * 4 + 1] = Utils.colors[bestCi][1];
    gs.colors[i * 4 + 2] = Utils.colors[bestCi][2];

    if (i % 100 == 0) {
      let progress = (i / gs.splatCount) * 100;
      document.getElementById('loaddisplay').innerHTML = progress.toFixed(1) + '% (1/3)';
      // allowing the browser to render asynchronously
      // don't call this for every splat
      gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);
  gs.colorsB = new Float32Array(gs.colors);
  document.getElementById('loaddisplay').innerHTML = (100).toFixed(1) + '% (1/3)';
}


async function assignSplatsToPoints(character, gs, capsules, capsuleBoneIndex, fast=false) {
  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
  gs.splatVertexIndices = [];

  const position = skinnedMesh.geometry.getAttribute('position');
  const boneVertexIndices = {};

  Object.values(capsuleBoneIndex).forEach(value => {
    boneVertexIndices[value] = [];
  });

  // ``vrm mesh の'' 各頂点がどのboneに一番近いかを確認 (not splats)
  // splatBoneIndices に含まれる bone の頂点だけ使う
  for (let i = 0; i < position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
    const skinnedVertex = skinnedMesh.applyBoneTransform(i, vertex);
    skinnedVertex.applyMatrix4(character.currentVrm.scene.matrixWorld);

    let minDistance = Infinity;
    let bestCi = undefined;

    // Find the nearest triangle in the capsule  // skinnedWeight might be used (?)
    for (let ci = 0; ci < capsules.children.length; ci++) {
      const capsule = capsules.children[ci];
      const capsuleGeometry = capsule.geometry;
      const capsulePosition = capsuleGeometry.getAttribute('position');
      const index = capsuleGeometry.index;

      const triangle = new THREE.Triangle();

      // For each triangle in the capsule, find the vertex of the VRM mesh that is closest to that triangle
      for (let ii = 0; ii < index.count; ii += 3) {
        let a = new THREE.Vector3().fromBufferAttribute(capsulePosition, index.getX(ii));
        let b = new THREE.Vector3().fromBufferAttribute(capsulePosition, index.getX(ii + 1));
        let c = new THREE.Vector3().fromBufferAttribute(capsulePosition, index.getX(ii + 2));

        a.applyMatrix4(capsule.matrixWorld);
        b.applyMatrix4(capsule.matrixWorld);
        c.applyMatrix4(capsule.matrixWorld);

        triangle.set(a, b, c);

        let closestPoint = new THREE.Vector3();
        triangle.closestPointToPoint(skinnedVertex, closestPoint);

        let distance = skinnedVertex.distanceTo(closestPoint);

        if (distance < minDistance) {
          minDistance = distance;
          bestCi = ci;
        }
      }
    }

    boneVertexIndices[capsuleBoneIndex[bestCi]].push(i);

    if (i % 100 == 0) {
      let progress = (i / position.count) * 100;
      document.getElementById('loaddisplay').innerHTML = progress.toFixed(1) + '% (2/3)';
      gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  document.getElementById('loaddisplay').innerHTML = (100).toFixed(1) + '% (2/3)';


  // 各 splat について、それが所属している bone を取得し、その bone にアサインされた vertices の中から一番近いものを探す。
  for (let i = 0; i < gs.splatCount; i++) {
    let targetPoint = new THREE.Vector3(gs.centers0[i * 3 + 0], gs.centers0[i * 3 + 1], gs.centers0[i * 3 + 2]);
    targetPoint.applyMatrix4(gs.viewer.viewer.splatMesh.scenes[0].matrixWorld);

    let minDistance = Infinity;
    let bestVi = 0;

    let boneIndex = gs.splatBoneIndices[i];
    let vertexIndices = boneVertexIndices[boneIndex];

    // fast なら3, not fast なら1
    let skip = fast ? 3 : 1;
    for (let vi = 0; vi < vertexIndices.length; vi+=skip) {  // CHANGED
      const vertexIndex = vertexIndices[vi];
      const vertex = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
      const skinnedVertex = skinnedMesh.applyBoneTransform(vertexIndex, vertex);
      skinnedVertex.applyMatrix4(character.currentVrm.scene.matrixWorld);

      let distance = skinnedVertex.distanceTo(targetPoint);

      if (distance < minDistance) {
        minDistance = distance;
        bestVi = vi;
      }
    }
    gs.splatVertexIndices.push(vertexIndices[bestVi]);

    if (i % 100 == 0) {
      let progress = (i / gs.splatCount) * 100;
      document.getElementById('loaddisplay').innerHTML = progress.toFixed(1) + '% (3/3)';
      gs.splatMesh.updateDataTexturesFromBaseData(0, gs.splatCount - 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  gs.splatRelativePoses = [];
  for (let i = 0; i < gs.splatCount; i++) {
    const vertexIndex = gs.splatVertexIndices[i];
    let vertex = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
    vertex = skinnedMesh.applyBoneTransform(vertexIndex, vertex);

    let center0 = new THREE.Vector3(gs.centers0[i * 3 + 0], gs.centers0[i * 3 + 1], gs.centers0[i * 3 + 2]);
    center0.applyMatrix4(gs.viewer.viewer.splatMesh.scenes[0].matrixWorld);
    center0.applyMatrix4(gs.matrixWorld);  // TODO: 要らない気がする
    center0.applyMatrix4(new THREE.Matrix4().copy(character.currentVrm.scene.matrixWorld).invert());

    let relativePos = new THREE.Vector3().subVectors(center0, vertex);
    gs.splatRelativePoses.push(relativePos.x, relativePos.y, relativePos.z);
  }

  document.getElementById('loaddisplay').innerHTML = (100).toFixed(1) + '% (3/3)';
}


async function cleanSplats(gsPath, loadingSpinner, dist1=1.0, dist2=15.0) {

  const task0 = loadingSpinner.addTask('Loading...');

  const parser = new PLYParser();
  const plyData = await parser.parsePLY(gsPath, true);

  loadingSpinner.removeTask(task0);
  const task1 = loadingSpinner.addTask('Cleaning splats...');

  const distxz0 = plyData.vertices.map(vertex =>
    Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z)
  );

  function calculateHeights(vertices) {
    const radiusFilteredVertices = vertices.filter((vertex, i) =>
      // distances[index] <= dist1
      distxz0[i] < dist1 && Math.abs(vertex.y) < (dist1*2)
    );

    // NOTE: gs rotation
    const yCoords = radiusFilteredVertices.map(vertex => Math.round(-vertex.y * 100));
    const minY = yCoords.reduce((min, y) => Math.min(min, y), yCoords[0]);
    const maxY = yCoords.reduce((max, y) => Math.max(max, y), yCoords[0]);

    const frequencyMap = new Map();
    for (let y = minY; y <= maxY; y += 1) {
      frequencyMap.set(y, 0);
    }

    radiusFilteredVertices.forEach(vertex => {
      const binKey = Math.round(-vertex.y * 100);
      frequencyMap.set(binKey, frequencyMap.get(binKey) + 1);
    });

    let floorY = null;
    let maxFrequency = 0;
    for (const [y, frequency] of frequencyMap) {
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        floorY = y;
      }
    }

    let emptySpaceY = null;
    const sortedYCoords = Array.from(frequencyMap.entries())
      .sort(([y1], [y2]) => y1 - y2);

    for (const [y, frequency] of sortedYCoords) {
      if (y > floorY && frequency === 0) {
        emptySpaceY = y;
        break;
      }
    }

    return { min: floorY /= 100, max: emptySpaceY /= 100 };
  }

  function calculateCentroid(vertices) {
    const ymin = (heights.max - heights.min) * 0.1 + heights.min;
    const ymax = (heights.max - heights.min) * 0.4 + heights.min;
    const vertices_ = vertices.filter((vertex, i) =>
      distxz0[i] < dist1 && Math.abs(vertex.y) < (dist1*2) &&
    // ( heights.min + 0.05 ) < -vertex.y  && -vertex.y < ( heights.max - 0.05 )
      ymin < -vertex.y && -vertex.y < ymax
    );

    const sumX = vertices_.reduce((sum, vertex) => sum + vertex.x, 0);
    const sumZ = vertices_.reduce((sum, vertex) => sum + vertex.z, 0);

    return { x: sumX / vertices_.length, z: sumZ / vertices_.length };
  }

  const heights = calculateHeights(plyData.vertices);
  const centroid = calculateCentroid(plyData.vertices);

  const pos = plyData.vertices.map( vertex => new THREE.Vector3(
    vertex.x - centroid.x, vertex.y, vertex.z - centroid.z
  ));

  const distxyz = pos.map(vertex =>
    Math.sqrt(vertex.x * vertex.x + vertex.y * vertex.y + vertex.z * vertex.z)
  );

  const distxz = pos.map(vertex =>
    Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z)
  );

  const disty = pos.map(vertex =>
    Math.abs(vertex.y)
  );

  const filteredVertices1 = plyData.vertices.filter((vertex, i) =>
    distxz[i] < dist1 && disty[i] < (dist1*2) &&
    heights.min < -pos[i].y && -pos[i].y < heights.max
  );

  const filteredVertices2 = plyData.vertices.filter((vertex, i) =>
    // (distances[index] >= dist1 && distances[index] < dist2) ||
    // (distances[index] < dist1 && (-vertex.y <= heights.min || -vertex.y >= heights.max))
    ( ( distxz[i] >= dist1 || disty[i] >= (dist1*2) ) && distxyz[i] < dist2 ) ||
    ( ( distxz[i] < dist1 && disty[i] < (dist1*2) ) && (-pos[i].y <= heights.min || heights.max <= -pos[i].y) )
  );

  function detectShoes(filteredVertices1, heights) {
    const ymin = (heights.max - heights.min) * 0.1 + heights.min;
    const vertices = filteredVertices1.filter(vertex =>
      -vertex.y < ymin &&
      Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z) < 0.5
    );

    // xy 平面を0.02m*0.02mのグリッドに切って、frequencyMap を作る
    // この frequencyMap では、y の合計値と個数をカウントして、あとで平均値を出す。
    const frequencyMap = new Map();
    for (let x = -26; x <= 26; x += 1) {
      for (let z = -26; z <= 26; z += 1) {
        frequencyMap.set(`${x},${z}`, { sum: 0, count: 0 });
      }
    }
    vertices.forEach(vertex => {
      const binKey = `${Math.round(vertex.x * 50)},${Math.round(vertex.z * 50)}`;
      frequencyMap.get(binKey).sum += (- vertex.y - heights.min);
      frequencyMap.get(binKey).count += 1;
    });

    // 各グリッドの平均値を計算して、{sum, count} に {mean} を追加
    for (const [key, value] of frequencyMap) {
      value.mean = value.count === 0 ? 0 : value.sum / value.count;
    }

    // 頻度のリストを作成
    const frequencyList = Array.from(frequencyMap.values());
    frequencyList.sort((a, b) => b.count - a.count);

    const countList = frequencyList.map(frequency => frequency.count);
    const meanCount = countList.reduce((sum, count) => sum + count, 0) / countList.length;

    // 個数が平均以上で、mean が 0.01 以上の場合、{sum, count, mean} に、{keep: true} を追加
    for (const frequency of frequencyList) {
      frequency.keep = frequency.count > meanCount && frequency.mean > 0.01;
    }

    // frequencyMap の 各グリッドにおいて、その前後左右のグリッドのうち keep が false なものが 2 つ以上ある場合、keep を false にする。
    for (let x = -26; x <= 26; x += 1) {
      for (let z = -26; z <= 26; z += 1) {
        const binKey = `${x},${z}`;
        const frequency = frequencyMap.get(binKey);
        if (!frequency.keep) {
          continue;
        }
        let count = 0;
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            if (dx === 0 && dz === 0) {
              continue;
            }
            const binKey2 = `${x + dx},${z + dz}`;
            const frequency2 = frequencyMap.get(binKey2);
            if (!frequency2 || !frequency2.keep) {
              count += 1;
            }
          }
        }
        if (count >= 6) {  // 8
          frequency.keep = false;
        }
      }
    }

    // filteredVertices1 のうち、
    // -vertex.y >= yminならキープ
    // -vertex.y < ymin の場合、Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z) < 0.5 で、かつ
    const filteredVertices3 = filteredVertices1.filter(vertex =>
      -vertex.y >= ymin ||
      ( -vertex.y < ymin && Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z) < 0.5 &&
       frequencyMap.get(`${Math.round(vertex.x * 50)},${Math.round(vertex.z * 50)}`).keep )
    );

    // 捨てた点群を filteredVertices4 に追加
    const filteredVertices4 = filteredVertices1.filter(vertex =>
      (-vertex.y < ymin && Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z) >= 0.5) ||
      (-vertex.y < ymin && Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z) < 0.5 &&
        !frequencyMap.get(`${Math.round(vertex.x * 50)},${Math.round(vertex.z * 50)}`).keep )
    );

    return { filteredVertices3: filteredVertices3, filteredVertices4: filteredVertices4 };
  }

  let urls = undefined;

  function createNewHeader(originalHeader, vertexCount) {
    return originalHeader.map(line => {
      if (line.startsWith('element vertex')) {
        return `element vertex ${vertexCount}`;
      }
      return line;
    });
  }

  if (filteredVertices2.length > 0) {
    const { filteredVertices3, filteredVertices4 } = detectShoes(filteredVertices1, heights);

    const filteredVertices5 = filteredVertices2.concat(filteredVertices4);

    const newHeader1 = createNewHeader(plyData.header, filteredVertices3.length);
    const newPlyData1 = parser.createPLYFile(newHeader1, filteredVertices3, plyData.vertexSize);
    const blob1 = new Blob([newPlyData1], { type: 'application/octet-stream' });
    const url1 = URL.createObjectURL(blob1);

    const newHeader2 = createNewHeader(plyData.header, filteredVertices5.length);
    const newPlyData2 = parser.createPLYFile(newHeader2, filteredVertices5, plyData.vertexSize);
    const blob2 = new Blob([newPlyData2], { type: 'application/octet-stream' });
    const url2 = URL.createObjectURL(blob2);

    urls = [url1, url2];

  } else {
    const newHeader1 = createNewHeader(plyData.header, filteredVertices1.length);
    const newPlyData1 = parser.createPLYFile(newHeader1, filteredVertices1, plyData.vertexSize);
    const blob1 = new Blob([newPlyData1], { type: 'application/octet-stream' });
    const url1 = URL.createObjectURL(blob1);
    urls = [url1];
  }

  console.log("cleanSplats", centroid, heights);
  loadingSpinner.removeTask(task1);

  return { urls: urls, centroid: centroid, heights: heights };
}


async function findBestAngleInRange(scene, camera, renderer, poseDetector, startAngle, endAngle, steps, radius) {
  let bestAngle = null;
  let bestScore = -Infinity;

  const angleStep = (endAngle - startAngle) / steps;
  for (let i = 0; i < steps; i++) {
    const angle = startAngle + angleStep * i;
    camera.position.x = radius * Math.sin(angle);
    camera.position.z = radius * Math.cos(angle);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const keypoints = await poseDetector.detect(dataURL, false);
    await new Promise(resolve => setTimeout(resolve, 30));  // wait for canvas
    let score  = -Infinity;

    if (keypoints && keypoints.length > 0) {
      // const left = keypoints[23];  // left_hip
      // const right = keypoints[24]; // right_hip
      const left = keypoints[15];  // left_wrist
      const right = keypoints[16]; // right_wrist
      if (left && right) {
        score = left.x - right.x;
      }
    }

    if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
    }
  }
  console.log("bestAngle", bestAngle, "bestScore", bestScore);

  return { angle: bestAngle , score: bestScore };
}


export async function preprocess(vrmPath, gsPath, scene, camera, renderer, vrmScale=null, vrmRotX=null, stage=null, fast=false) {
  if (stage === null) {
    stage = '0';
  }

  if (stage && !['0', '1', '2', '3'].includes(stage)) {
    console.error("stage must be '0', '1', '2', or '3'");
  }

  let loadingSpinner = new DropInViewer().viewer.loadingSpinner;
  let gs0, gsPaths, centroid, heights, circle, radius, boneOperations;

  // clean and show
  if (stage < 1) {
    ({ urls: gsPaths, centroid, heights } = await cleanSplats(gsPath, loadingSpinner));

    if (gsPaths.length === 1) {
      console.error("choose stage=2");
    }
    gsPath = gsPaths[0];

    // background gs
    ({ gs: gs0 } = await initGS(gsPaths.slice(1), undefined, scene, camera, renderer));

    for (let i = 0; i < gs0.splatCount; i++) {
      gs0.colors0[i * 4 + 3] /= 12.0;
      gs0.colors[i * 4 + 3] /= 12.0;
    }
    gs0.splatMesh.updateDataTexturesFromBaseData(0, gs0.splatCount - 1);
  }

  // main gs
  let { gs } = await initGS(gsPath, undefined, scene, camera, renderer);
  let { character } = await initVRM(vrmPath, scene, camera, renderer, vrmScale);


  // adjust pos of gs and vrm, adjust scale of vrm
  if (stage < 1) {
    if ( !vrmScale ) {
      vrmScale = ( heights.max - heights.min ) / ( - character.ground * 2 + 0.05 );
    }
    console.log("vrmScale", vrmScale);
    if ( !vrmRotX ) {
      vrmRotX = 1.0;
    }

    await character.leave(scene);
    ({ character } = await initVRM(vrmPath, scene, camera, renderer, vrmScale));
    character.currentVrm.scene.position.z = 0.02;
    character.currentVrm.scene.rotation.x = Math.PI / 180. * vrmRotX;

    const gsScene = gs.viewer.viewer.splatMesh.scenes[0];
    gsScene.position.y = character.ground - heights.min;
    gsScene.position.x += centroid.x;  // CAUTION
    gsScene.position.z -= centroid.z;
    gsScene.updateMatrixWorld();

    const gs0Scene = gs0.viewer.viewer.splatMesh.scenes[0];
    gs0Scene.position.copy(gsScene.position);
    gs0Scene.updateMatrixWorld();

    const circleGeometry = new THREE.CircleGeometry(1.5, 64);
    const circleMaterial = new THREE.MeshBasicMaterial(
      { color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.1 });
    circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.rotateX(-Math.PI / 2);
    circle.position.y = character.ground;
    scene.add(circle);
  }


  // adjust angle of gs
  if (stage < 1) {
    let poseDetector = window.poseDetector;
    const position0 = new THREE.Vector3().copy(camera.position);
    radius = Math.sqrt(position0.x * position0.x + position0.z * position0.z);

    const angle1 = 0, angle2 = Math.PI * 2;
    const coarseResult = await findBestAngleInRange(
      scene, camera, renderer, poseDetector, angle1, angle2, 36, radius);

    if (coarseResult.angle === null) {
      console.error('Failed to detect initial direction');
      return;
    }

    const angle3 = coarseResult.angle - Math.PI / 10;
    const angle4 = coarseResult.angle + Math.PI / 10;
    const fineResult = await findBestAngleInRange(
      scene, camera, renderer, poseDetector, angle3, angle4, 36, radius);

    camera.position.x = radius * Math.sin(0);
    camera.position.z = radius * Math.cos(0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const gsScene = gs.viewer.viewer.splatMesh.scenes[0];
    const originalPosition = gsScene.position.clone();
    gsScene.position.set(0, originalPosition.y, 0);
    gsScene.rotation.y = -fineResult.angle;
    const rotatedPosition = new THREE.Vector3(originalPosition.x, 0, originalPosition.z);
    rotatedPosition.applyAxisAngle(new THREE.Vector3(0, 1, 0), -fineResult.angle);
    gsScene.position.x = rotatedPosition.x;
    gsScene.position.z = rotatedPosition.z;
    gsScene.position.y = originalPosition.y;
    gsScene.updateMatrixWorld();

    const gs0Scene = gs0.viewer.viewer.splatMesh.scenes[0];
    gs0Scene.rotation.copy(gsScene.rotation);
    gs0Scene.position.copy(gsScene.position);
    gs0Scene.updateMatrixWorld();
  }

  // apply bone operations
  if (stage < 2) {
    // temp bone operations


    let response = await fetch("./assets/default.json");
    const params = await response.json();
    boneOperations = params.boneOperations;

    let poseDetector = window.poseDetector;

    // front camera
    camera.position.x = radius * Math.sin(0);
    camera.position.z = radius * Math.cos(0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    await poseDetector.loadingPromise;
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const keypoints = await poseDetector.detect(dataURL, true);
    // console.log(keypoints);

    {  // "left_shoulder" and "left_wrist"
      const point11 = poseDetector.keypointAxes.get(11).position;
      const point15 = poseDetector.keypointAxes.get(15).position;

      const dx = point15.x - point11.x;
      const dy = point15.y - point11.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      // console.log(angleDegrees, -180.0 - angleDegrees);
      boneOperations[2]["rotation"]["z"] = - angleDegrees;
    }

    {  // "right_shoulder" and "right_wrist"
      const point12 = poseDetector.keypointAxes.get(12).position;
      const point16 = poseDetector.keypointAxes.get(16).position;

      const dx = point16.x - point12.x;
      const dy = point16.y - point12.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      // console.log(angleDegrees, -180.0 - angleDegrees);
      // console.log(boneOperations);
      boneOperations[3]["rotation"]["z"] = -180.0 - angleDegrees;
    }

    {  // "left_hip" and "left_ankle"
      const point23 = poseDetector.keypointAxes.get(23).position;
      const point27 = poseDetector.keypointAxes.get(27).position;

      const dx = point27.x - point23.x * 0.8;
      const dy = point27.y - point23.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      // console.log(angleDegrees, -90.0 - angleDegrees);
      boneOperations[4]["rotation"]["z"] = -90.0 - angleDegrees;
    }

    {  // "right_hip" and "right_ankle"
      const point24 = poseDetector.keypointAxes.get(24).position;
      const point28 = poseDetector.keypointAxes.get(28).position;

      const dx = point28.x - point24.x * 0.8;
      const dy = point28.y - point24.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      // console.log(angleDegrees, -90.0 - angleDegrees);
      boneOperations[5]["rotation"]["z"] = -90.0 - angleDegrees;
    }

    // smooth camera move
    {
      camera.position.x = radius * 1.5 * Math.sin(-Math.PI/4.0);
      camera.position.z = radius * 1.5 * Math.cos(-Math.PI/4.0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      await poseDetector.loadingPromise;
      renderer.render(scene, camera);
      const dataURL7 = renderer.domElement.toDataURL('image/png');
      const keypoints7 = await poseDetector.detect(dataURL7, true);
    }

    // right camera
    camera.position.x = radius * 1.5 * Math.sin(-Math.PI/2.0);
    camera.position.z = radius * 1.5 * Math.cos(-Math.PI/2.0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    await poseDetector.loadingPromise;
    renderer.render(scene, camera);
    const dataURL3 = renderer.domElement.toDataURL('image/png');
    const keypoints3 = await poseDetector.detect(dataURL3, true);

    {  // "right_shoulder" and "right_wrist"
      const point12 = poseDetector.keypointAxes.get(12).position;
      const point16 = poseDetector.keypointAxes.get(16).position;

      const dx = point16.z - point12.z;
      const dy = point16.y - point12.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      boneOperations[3]["rotation"]["x"] = 90.0 + angleDegrees;
    }

    // smooth camera move
    {
      camera.position.x = radius * 1.5 * Math.sin(-Math.PI/4.0);
      camera.position.z = radius * 1.5 * Math.cos(-Math.PI/4.0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      await poseDetector.loadingPromise;
      renderer.render(scene, camera);
      const dataURL8 = renderer.domElement.toDataURL('image/png');
      const keypoints8 = await poseDetector.detect(dataURL8, true);
    }

    // smooth camera move
    {
      camera.position.x = radius * 1.5 * Math.sin(0);
      camera.position.z = radius * 1.5 * Math.cos(0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      await poseDetector.loadingPromise;
      renderer.render(scene, camera);
      const dataURL4 = renderer.domElement.toDataURL('image/png');
      const keypoints4 = await poseDetector.detect(dataURL4, true);
    }

    // smooth camera move
    {
      camera.position.x = radius * 1.5 * Math.sin(Math.PI/4.0);
      camera.position.z = radius * 1.5 * Math.cos(Math.PI/4.0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      await poseDetector.loadingPromise;
      renderer.render(scene, camera);
      const dataURL6 = renderer.domElement.toDataURL('image/png');
      const keypoints6 = await poseDetector.detect(dataURL6, true);
    }

    camera.position.x = radius * 1.5 * Math.sin(Math.PI/2.0);
    camera.position.z = radius * 1.5 * Math.cos(Math.PI/2.0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    await poseDetector.loadingPromise;
    renderer.render(scene, camera);
    const dataURL2 = renderer.domElement.toDataURL('image/png');
    const keypoints2 = await poseDetector.detect(dataURL2, true);

    {  // "left_shoulder" and "left_wrist"
      const point11 = poseDetector.keypointAxes.get(11).position;
      const point15 = poseDetector.keypointAxes.get(15).position;

      const dx = -point15.z + point11.z;
      const dy = point15.y - point11.y;

      const angleRadians = Math.atan2(dy, dx);

      const angleDegrees = angleRadians * (180 / Math.PI);
      boneOperations[2]["rotation"]["x"] = -90.0 - angleDegrees;
    }

    // front camera (natural view)
    camera.position.x = radius * Math.sin(0);
    camera.position.z = radius * Math.cos(0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    await poseDetector.loadingPromise;
    renderer.render(scene, camera);
    const dataURL5 = renderer.domElement.toDataURL('image/png');
    const keypoints5 = await poseDetector.detect(dataURL, true);

    keypoints.forEach((keypoint, index) => {
      const axes = poseDetector.keypointAxes.get(index);
      axes.visible = false;
    });


    Utils.resetPose(character, boneOperations);
    // TODO: refactor (merge with the above)
    character.currentVrm.scene.updateMatrixWorld(true);
  } else {
    // const jsonPath = gsPath.replace(".ply", ".json");
    // let response = await fetch(jsonPath);
    // use default bone operations
    let response = await fetch("./assets/default.json");
    const params = await response.json();
    boneOperations = params.boneOperations;
    Utils.resetPose(character, boneOperations);
    // TODO: refactor
    character.currentVrm.scene.updateMatrixWorld(true);
  }

  const gvrm = new GVRM(character, gs);
  gvrm.modelScale = vrmScale;
  gvrm.boneOperations = boneOperations;


  async function preprocess2() {
    const { pmc, capsuleBoneIndex } = getPointsMeshCapsules(character);
    gvrm.pmc = pmc;
  
    Utils.addPMC(scene, gvrm.pmc);
    renderer.render(scene, camera);
  
    await assignSplatsToBones(gs, pmc.capsules, capsuleBoneIndex, fast=fast);
    await assignSplatsToPoints(character, gs, pmc.capsules, capsuleBoneIndex, fast=fast);
    gsCustomizeMaterial(character, gs);
    Utils.visualizePMC(gvrm.pmc, false);
    Utils.changeColor(gs, "original");

    await gvrm.saveGVRM(vrmPath, gsPath, boneOperations, vrmScale);
    await gvrm.removeGVRM(scene);
    await gvrm.loadGVRM(gvrm.url, scene, camera, renderer);

    if (stage < 1) {
      scene.remove(circle);
      circle.geometry.dispose();
      circle.material.dispose();
    }
  }

  let promise = preprocess2();

  return { 'gvrm': gvrm, 'promise': promise };
}
