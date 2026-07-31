const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, parentPort } = require('worker_threads');

const AUDIO_DIR = path.join(__dirname, '../data/audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

class AudioCollector {
  constructor() {
    this.workers = new Map();
  }

  startCollection(roomId, url) {
    if (this.workers.has(roomId)) {
      console.log(`[Audio] Room ${roomId} already collecting`);
      return;
    }

    const worker = new Worker(__filename, { workerData: { roomId } });
    this.workers.set(roomId, worker);

    console.log(`[Audio] Started multi-thread low-resource audio collection for ${roomId}`);
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

  // For Electron IPC
  module.exports = {
    startAudio: (roomId, url) => {
      collector.startCollection(roomId, url);
    },
    stopAudio: (roomId) => {
      collector.stopCollection(roomId);
    }
  };
} else {
  // Worker thread for each room
  const { roomId } = workerData;

  const audioFile = `${AUDIO_DIR}/audio_${roomId}_${Date.now()}.wav`;

  // Low-priority ffmpeg for system audio (macOS): capture with minimal CPU
  const cmd = `nice -n 19 ffmpeg -f avfoundation -i :0 -ar 16000 -ac 1 -f wav -t 3600 "${audioFile}"`;

  const ffmpeg = spawn('sh', ['-c', cmd], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });

  ffmpeg.unref();

  console.log(`[Audio Worker ${roomId}] Started with low priority`);

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

module.exports = {
  AudioCollector
};
