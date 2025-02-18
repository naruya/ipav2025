export class Rotator {
  constructor(camera, checkboxId='rotateCheckbox', rangeId='rotationSpeedRange') {
    this.camera = camera;
    this.angle = Math.PI / 2;
    this.rotationSpeed = 0.0;
    this.flagRotate = document.getElementById(checkboxId).checked;
    this.rotateRadius = 1.7;

    document.getElementById(checkboxId).addEventListener('change', () => {
      this.flagRotate = document.getElementById(checkboxId).checked;
    });

    document.getElementById(rangeId).addEventListener("input", () => {
      document.getElementById(checkboxId).checked = true;
      this.flagRotate = true;
      this.rotationSpeed = parseFloat(document.getElementById(rangeId).value);
    });
  }

  update () {
    if (this.flagRotate) {
      this.angle += this.rotationSpeed * 0.01;
      this.camera.position.x = this.rotateRadius * Math.cos(this.angle);
      this.camera.position.z = this.rotateRadius * Math.sin(this.angle);
    }
  }
}


export class RotatorRTC {
  constructor(pc, camera, checkboxId='rotateCheckbox') {
    this.camera = camera;
    this.angle = Math.PI / 2;
    this.flagRotate = document.getElementById(checkboxId).checked;
    this.rotateRadius = 1.7;

    document.getElementById(checkboxId).addEventListener('change', () => {
      this.flagRotate = document.getElementById(checkboxId).checked;
    });

    pc.addChannelListener('angle', (e) => {
      if (!this.flagRotate) {
        this.flagRotate = true;
        document.getElementById(checkboxId).checked = true;
        var event = new Event('change');
        document.getElementById(checkboxId).dispatchEvent(event);
      }
      this.angle = e.data * Math.PI / 180;
    });
  }

  update () {
    if (this.flagRotate) {
      this.camera.position.x = this.rotateRadius * Math.cos(this.angle);
      this.camera.position.z = this.rotateRadius * Math.sin(this.angle);
    }
  }
}