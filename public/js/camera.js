const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.88;

export function isLiveCameraSupported() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function',
  );
}

function canvasToDataUrl(source, width, height) {
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, outW, outH);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
    width: outW,
    height: outH,
  };
}

export async function fileToResizedDataUrl(file) {
  if (!file) throw new Error('No image file selected.');

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      return canvasToDataUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close?.();
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve(canvasToDataUrl(img, img.naturalWidth, img.naturalHeight));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function createCameraController(videoEl) {
  let stream = null;
  let torchEnabled = false;

  function getVideoTrack() {
    return stream?.getVideoTracks?.()[0] || null;
  }

  function hasTorchSupport() {
    const track = getVideoTrack();
    if (!track || typeof track.getCapabilities !== 'function') return false;
    try {
      const caps = track.getCapabilities();
      return Boolean(caps && 'torch' in caps && caps.torch);
    } catch {
      return false;
    }
  }

  async function start() {
    if (!isLiveCameraSupported()) {
      throw new Error(
        'Live camera preview requires HTTPS (Tailscale Serve / Cloudflare Tunnel) or localhost. Use "Take Photo / Upload" instead.',
      );
    }
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    torchEnabled = false;
    return { torchSupported: hasTorchSupport() };
  }

  async function toggleTorch() {
    const track = getVideoTrack();
    if (!track || !hasTorchSupport()) return false;
    const next = !torchEnabled;
    await track.applyConstraints({
      advanced: [{ torch: next }],
    });
    torchEnabled = next;
    return torchEnabled;
  }

  function captureFrame() {
    if (!stream || !videoEl.videoWidth || !videoEl.videoHeight) {
      throw new Error('Camera stream is not ready yet.');
    }
    return canvasToDataUrl(videoEl, videoEl.videoWidth, videoEl.videoHeight);
  }

  function stop() {
    torchEnabled = false;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  return {
    start,
    stop,
    toggleTorch,
    captureFrame,
    isActive: () => Boolean(stream),
    isTorchEnabled: () => torchEnabled,
  };
}
