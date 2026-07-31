const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const AUDIO_DIR = path.join(__dirname, '../data/audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

class AudioCollector {
  constructor() {
    this.workers = new Map();
    this.pool = [];
  }

  startCollection(roomId, url) {
    if (this.workers.has(roomId)) return;
    
    const worker = new Worker(__filename);
    this.workers.set(roomId, worker);
    
    worker.postMessage({ type: 'start', roomId, url });
    
    console.log(`[Audio] Started low-resource multi-thread collection for room ${roomId}`);
  }

  stopCollection(roomId) {
    const worker = this.workers.get(roomId);
    if (worker) {
      worker.postMessage({ type: 'stop' });
      this.workers.delete(roomId);
    }
  }
}

if (isMainThread) {
  const collector = new AudioCollector();
  
  // Expose for IPC
  module.exports = {
    start: (roomId, url) => {
      process.send({ type: 'startAudio', roomId, url });
    },
    stop: (roomId) => {
      process.send({ type: 'stopAudio', roomId });
    }
  };
} else {
  const { type } = workerData;
  
  if (type === 'start') {
    const { roomId, url } = workerData;
    const audioFile = `${AUDIO_DIR}/audio_${roomId}_${Date.now()}.wav`;
    
    // Low priority ffmpeg command for system audio capture (macOS avfoundation)
    const cmd = `nice -n 19 ffmpeg -f avfoundation -i :0 -ar 16000 -ac 1 -f wav -t 3600 "${audioFile}"`;
    
    const ffmpeg = spawn('sh', ['-c', cmd], {
      detached: true,
      stdio: 'ignore'
    });
    
    ffmpeg.unref();
    
    parentPort.postMessage(`Started audio collection for ${roomId} with low CPU priority`);
    
    parentPort.on('message', (msg) => {
      if (msg.type === 'stop') {
        if (ffmpeg.pid) {
          try {
            process.kill(ffmpeg.pid, 'SIGTERM');
          } catch (e) {}
        }
        process.exit(0);
      }
    });
  }
}

module.exports = {
  AudioCollector,
  startAudio: (roomId, url) => {
    if (isMainThread) {
      process.send({ type: 'startAudio', roomId, url });
    } else {
      process.send({ type: 'start', roomId, url });
    }
  },
  stopAudio: (roomId) => {
    process.send({ type: 'stopAudio', roomId });
  }
};
