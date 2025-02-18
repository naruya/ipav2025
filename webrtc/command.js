
export class relayCommander {
  constructor(signalingHost, signalingPort, scene, camera, renderer) {
    this.gvrm = undefined;
    this.run(signalingHost, signalingPort, scene, camera, renderer);
  }

  async run(signalingHost, signalingPort, scene, camera, renderer) {
    while (true) {
      try {
        if (!this.gvrm) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const res = await fetch(`${signalingHost}:${signalingPort}/command`);
        const data = await res.json();
        const cmd = data.cmd;
  
        if (cmd) {
          console.log("Received command:", cmd);
          const cmdArray = cmd.split(" ");
          switch (cmdArray[0]) {
            case "anim":
              await this.gvrm.changeFBX('./assets/' + cmdArray[1], scene);
              break;
            case "gvrm":
              await this.gvrm.removeGVRM(scene);
              await this.gvrm.loadGVRM('./assets/' + cmdArray[1], scene, camera, renderer);
              break;
            default:
              console.log("Unknown command:", cmd);
              break;
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (err) {
        console.error("Failed to fetch command:", err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  set(gvrm) {
    this.gvrm = gvrm;
  }
}

