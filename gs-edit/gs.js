import * as THREE from 'three';
import { DropInViewer } from 'gaussian-splats-3d';


export class GaussianSplatting extends THREE.Group {
  constructor(urls, scale, quaternion) {
    super();
    this.loadGS(urls, scale, quaternion);
  }

  loadGS(urls, scale, quaternion=[0, 0, 1, 0]) {

    if (!Array.isArray(urls)) {
      urls = [urls];
    }

    this.loadingPromise = new Promise(async (resolve, reject) => {
      let viewer = new DropInViewer({
        'gpuAcceleratedSort': true,
        'sharedMemoryForWorkers': false,  // ?
        'dynamicScene': true,  // changed
        'sceneRevealMode': 2,
        // 'optimizeSplatData': false,  // not implemented at 8ef8abc
        // 'plyInMemoryCompressionLevel': 0,
      });

      const sceneOptions = urls.map(url => ({
        'path': url,
        'scale': [scale, scale, scale],
        'rotation': quaternion,  // z rot 180
        'splatAlphaRemovalThreshold': 0
      }));

      viewer.addSplatScenes(sceneOptions, true);

      this.add(viewer);  // THREE.Group
      this.viewer = viewer;

      const promise = new Promise((resolve) => {
        this.viewer.viewer.splatMesh.onSplatTreeReady(() => {
          resolve();
        });
      });
      await promise;

      resolve(this);
    }, undefined, function (error) {
      console.error(error);
    });
  }
}