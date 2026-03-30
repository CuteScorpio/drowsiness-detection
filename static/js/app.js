/**
 * DrowseGuard - Driver Drowsiness Detection System
 * Handles camera access, frame analysis, and UI updates.
 * 
 * KEY FIX: Uses getUserMedia with proper constraints for mobile compatibility.
 * Uses HTTPS-first strategy and handles permission errors gracefully.
 */

// ===================== STATE =====================
const state = {
  stream: null,
  analyzing: false,
  analyzeInterval: null,
  sessionStart: null,
  sessionTimer: null,
  frameRate: 5,        // Frames per second to send to backend
  currentDeviceId: null,
  audioUnlocked: false,
  alertSound: null,
  alertPlaying: false,
  alertTimeout: null,
  lastResult: null,
};

// ===================== DOM REFS =====================
const videoEl = () => document.getElementById('videoFeed');
const canvasEl = () => document.getElementById('overlayCanvas');
const placeholder = () => document.getElementById('cameraPlaceholder');
const startBtn = () => document.getElementById('startBtn');
const stopBtn = () => document.getElementById('stopBtn');
const cameraSelect = () => document.getElementById('cameraSelect');
const alertOverlay = () => document.getElementById('alertOverlay');
const permModal = () => document.getElementById('permissionModal');
const audioUnlockEl = () => document.getElementById('audioUnlock');
const eventLog = () => document.getElementById('eventLog');

// ===================== AUDIO =====================
function createAlertSound() {
  // Web Audio API siren — no external file needed
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  return {
    ctx: null,
    nodes: [],
    play() {
      if (!state.audioUnlocked) return;
      try {
        if (!this.ctx || this.ctx.state === 'closed') {
          this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        this._oscillate();
      } catch (e) {
        console.warn('Audio error:', e);
      }
    },
    _oscillate() {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.3);
      osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.7);
    },
    stop() { /* tone stops itself */ }
  };
}

function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) { state.audioUnlocked = true; return; }
  try {
    const ctx = new AudioCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().then(() => {
      state.audioUnlocked = true;
      audioUnlockEl().style.display = 'none';
      logEvent('Audio alerts enabled', 'safe');
    });
  } catch (e) {
    state.audioUnlocked = true;
    audioUnlockEl().style.display = 'none';
  }
}

function triggerAlert() {
  if (state.alertPlaying) return;
  state.alertPlaying = true;
  alertOverlay().classList.add('active');
  if (state.alertSound && state.audioUnlocked) {
    let count = 0;
    const beep = () => {
      if (!state.alertPlaying || count >= 6) {
        state.alertPlaying = false;
        return;
      }
      state.alertSound.play();
      count++;
      state.alertTimeout = setTimeout(beep, 700);
    };
    beep();
  }
  // Auto-clear after 4s
  setTimeout(clearAlert, 4000);
}

function clearAlert() {
  state.alertPlaying = false;
  if (state.alertTimeout) clearTimeout(state.alertTimeout);
  alertOverlay().classList.remove('active');
}

// ===================== CAMERA =====================
async function enumerateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    const sel = cameraSelect();
    sel.innerHTML = '';
    videoDevices.forEach((dev, i) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Camera ${i + 1}`;
      // Prefer front/user camera by default
      if (dev.label.toLowerCase().includes('front') ||
          dev.label.toLowerCase().includes('user') ||
          dev.label.toLowerCase().includes('facetime')) {
        opt.textContent += ' (Front)';
      }
      if (dev.label.toLowerCase().includes('back') ||
          dev.label.toLowerCase().includes('rear') ||
          dev.label.toLowerCase().includes('environment')) {
        opt.textContent += ' (Rear)';
      }
      sel.appendChild(opt);
    });
    if (state.currentDeviceId) {
      sel.value = state.currentDeviceId;
    }
    logEvent(`Found ${videoDevices.length} camera(s)`, 'info');
  } catch (e) {
    logEvent('Could not enumerate cameras', 'warn');
  }
}

function buildConstraints(deviceId) {
  /**
   * CRITICAL: This function ensures camera works on both desktop and mobile.
   * - On mobile: facingMode 'user' = front camera, 'environment' = rear
   * - deviceId takes priority if explicitly selected
   * - We request lower resolution first (more compatible)
   */
  if (deviceId) {
    return {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 }
      },
      audio: false
    };
  }
  // Default: prefer front/user-facing camera (face detection works better)
  return {
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 15 }
    },
    audio: false
  };
}

async function requestCameraPermission() {
  permModal().classList.add('hidden');
  logEvent('Requesting camera permission...', 'info');

  try {
    // Step 1: Try with ideal constraints
    const constraints = buildConstraints(state.currentDeviceId);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (idealErr) {
      logEvent('Trying fallback camera constraints...', 'warn');
      // Step 2: Fallback - just any camera
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    await startStream(stream);
    await enumerateCameras(); // Enumerate after permission granted (labels now visible)

  } catch (err) {
    handleCameraError(err);
  }
}

async function startStream(stream) {
  state.stream = stream;
  const video = videoEl();
  video.srcObject = stream;

  // Get device ID from track for dropdown sync
  const track = stream.getVideoTracks()[0];
  if (track) {
    const settings = track.getSettings();
    if (settings.deviceId) state.currentDeviceId = settings.deviceId;
    logEvent(`Camera: ${track.label || 'Active'}`, 'info');
  }

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play().then(resolve).catch(resolve);
    };
    video.onerror = resolve; // Don't block on error
    setTimeout(resolve, 3000); // Timeout fallback
  });

  // Show video
  video.style.display = 'block';
  canvasEl().style.display = 'block';
  placeholder().classList.add('hidden');

  // Resize canvas to match video
  resizeCanvas();

  startMonitoringLoop();
  startSessionTimer();
  updateSystemStatus('active', 'MONITORING');
  logEvent('Camera started — monitoring active', 'safe');

  // Show audio unlock prompt on mobile (iOS requires gesture)
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !state.audioUnlocked) {
    audioUnlockEl().style.display = 'block';
  } else {
    state.audioUnlocked = true;
  }

  startBtn().classList.add('hidden');
  stopBtn().classList.remove('hidden');
}

function resizeCanvas() {
  const video = videoEl();
  const canvas = canvasEl();
  canvas.width = video.videoWidth || video.clientWidth;
  canvas.height = video.videoHeight || video.clientHeight;
}

async function switchCamera() {
  const sel = cameraSelect();
  const newDeviceId = sel.value;
  if (!newDeviceId || newDeviceId === state.currentDeviceId) return;
  state.currentDeviceId = newDeviceId;
  if (state.stream) {
    stopStream();
    await requestCameraPermission();
  }
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

function handleCameraError(err) {
  logEvent(`Camera error: ${err.name}`, 'danger');
  let msg = 'Could not access camera.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    msg = 'Camera permission denied. Please allow camera access in your browser settings.';
  } else if (err.name === 'NotFoundError') {
    msg = 'No camera found on this device.';
  } else if (err.name === 'NotReadableError') {
    msg = 'Camera is in use by another application.';
  } else if (err.name === 'OverconstrainedError') {
    msg = 'Camera does not support the requested settings.';
  }
  alert(msg);
  updateSystemStatus('', 'ERROR');
}

// ===================== MONITORING LOOP =====================
function startMonitoringLoop() {
  if (state.analyzeInterval) clearInterval(state.analyzeInterval);
  state.analyzing = true;
  const interval = Math.round(1000 / state.frameRate);
  state.analyzeInterval = setInterval(captureAndAnalyze, interval);
}

async function captureAndAnalyze() {
  if (!state.analyzing || !state.stream) return;
  const video = videoEl();
  if (video.readyState < 2) return;

  // Draw frame to canvas and extract base64
  const canvas = canvasEl();
  const ctx = canvas.getContext('2d');
  resizeCanvas();

  // Draw mirrored (match video display)
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  const imageData = canvas.toDataURL('image/jpeg', 0.7);

  try {
    const response = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    if (!response.ok) return;
    const result = await response.json();
    state.lastResult = result;
    updateUI(result);
    drawOverlay(result, ctx, canvas);
  } catch (e) {
    // Network error - don't spam log
  }
}

// ===================== UI UPDATES =====================
function updateUI(r) {
  if (!r) return;

  // HUD
  document.getElementById('hudEAR').textContent = r.ear ? r.ear.toFixed(2) : '--';
  document.getElementById('hudMAR').textContent = r.mar ? r.mar.toFixed(2) : '--';
  document.getElementById('hudYawns').textContent = r.yawn_count ?? 0;
  document.getElementById('hudFace').textContent = r.face_detected ? 'FACE: ✓' : 'FACE: ✗';
  document.getElementById('hudFace').className = 'hud-badge right ' + (r.face_detected ? '' : 'danger');

  // Score ring
  const score = r.drowsy_score || 0;
  const circumference = 314;
  const offset = circumference - (score / 100) * circumference;
  const ringEl = document.getElementById('scoreRing');
  ringEl.style.strokeDashoffset = offset;

  let scoreColor = 'var(--safe)';
  let statusText = 'SAFE';
  if (score >= 60) { scoreColor = 'var(--danger)'; statusText = 'DROWSY'; }
  else if (score >= 35) { scoreColor = 'var(--warn)'; statusText = 'WARNING'; }
  ringEl.style.stroke = scoreColor;

  document.getElementById('scoreNumber').textContent = score;
  document.getElementById('scoreNumber').style.color = scoreColor;
  document.getElementById('scoreStatus').textContent = statusText;
  document.getElementById('scoreStatus').style.color = scoreColor;

  // Eye status
  const eyeOpen = r.eye_status === 'OPEN';
  const eyeLabel = document.getElementById('eyeStatusLabel');
  eyeLabel.textContent = r.eye_status || 'OPEN';
  eyeLabel.className = 'eye-label' + (eyeOpen ? '' : ' closed');
  document.getElementById('eyeLeft').className = 'eye-icon' + (eyeOpen ? '' : ' closed');
  document.getElementById('eyeRight').className = 'eye-icon' + (eyeOpen ? '' : ' closed');

  // Eye closed bar
  const closedPct = Math.min(100, ((r.eye_closed_frames || 0) / 15) * 100);
  const eyeBar = document.getElementById('eyeClosedBar');
  eyeBar.style.width = closedPct + '%';
  eyeBar.className = 'bar-fill' + (closedPct > 66 ? ' danger' : closedPct > 33 ? ' warn' : '');

  // Yawn
  const yawning = r.yawn_status === 'YAWNING';
  const yawnStatus = document.getElementById('yawnStatus');
  yawnStatus.textContent = r.yawn_status || 'NO YAWN';
  yawnStatus.className = 'yawn-status' + (yawning ? ' active' : '');
  document.getElementById('yawnCount').textContent = r.yawn_count ?? 0;

  const marPct = Math.min(100, ((r.avg_mar || 0) / 1.0) * 100);
  document.getElementById('yawnBar').style.width = marPct + '%';

  // System status header
  if (r.status === 'DROWSY') {
    updateSystemStatus('danger', 'DROWSY ALERT');
  } else if (r.status === 'WARNING') {
    updateSystemStatus('warn', 'WARNING');
  } else if (r.face_detected) {
    updateSystemStatus('active', 'MONITORING');
  } else {
    updateSystemStatus('warn', 'NO FACE');
  }

  // Alert
  if (r.alert && !state.alertPlaying) {
    triggerAlert();
    logEvent('⚠ DROWSINESS DETECTED — ALERT TRIGGERED', 'danger');
  } else if (!r.alert && r.drowsy_score < 30) {
    clearAlert();
  }
}

function drawOverlay(result, ctx, canvas) {
  // Draw landmark dots
  if (!result.landmarks || !result.face_detected) return;
  ctx.save();
  result.landmarks.forEach(lm => {
    const x = (1 - lm.x) * canvas.width; // mirror correction
    const y = lm.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = result.status === 'DROWSY' ? '#ff3030' :
                    result.status === 'WARNING' ? '#ffb800' : '#00d4ff';
    ctx.fill();
  });
  ctx.restore();
}

function updateSystemStatus(type, label) {
  const dot = document.querySelector('.status-dot');
  const lbl = document.querySelector('.status-label');
  dot.className = 'status-dot' + (type ? ` ${type}` : '');
  lbl.textContent = label;
}

// ===================== SESSION TIMER =====================
function startSessionTimer() {
  state.sessionStart = Date.now();
  if (state.sessionTimer) clearInterval(state.sessionTimer);
  state.sessionTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('sessionTime').textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ===================== CONTROLS =====================
function startMonitoring() {
  // Show the permission modal - always ask cleanly
  permModal().classList.remove('hidden');
}

function stopMonitoring() {
  state.analyzing = false;
  if (state.analyzeInterval) clearInterval(state.analyzeInterval);
  if (state.sessionTimer) clearInterval(state.sessionTimer);
  stopStream();
  clearAlert();

  videoEl().style.display = 'none';
  canvasEl().style.display = 'none';
  placeholder().classList.remove('hidden');
  startBtn().classList.remove('hidden');
  stopBtn().classList.add('hidden');
  updateSystemStatus('', 'INACTIVE');
  logEvent('Monitoring stopped', 'info');
}

async function resetDetector() {
  try {
    await fetch('/reset', { method: 'POST' });
    logEvent('Detector state reset', 'info');
    clearAlert();
    updateUI({
      face_detected: false, status: 'ACTIVE', ear: 0, mar: 0,
      avg_mar: 0, drowsy_score: 0, eye_status: 'OPEN', yawn_status: 'NO YAWN',
      alert: false, eye_closed_frames: 0, yawn_count: 0, landmarks: []
    });
    document.getElementById('sessionTime').textContent = '00:00:00';
    if (state.sessionStart) startSessionTimer();
  } catch (e) {
    logEvent('Reset failed', 'warn');
  }
}

// ===================== LOG =====================
function logEvent(msg, type = 'info') {
  const log = eventLog();
  const entry = document.createElement('div');
  const time = new Date().toTimeString().slice(0, 8);
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${time}] ${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  // Keep max 50 entries
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

// ===================== INIT =====================
async function init() {
  // Check HTTPS (required for camera on most browsers/mobile)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    logEvent('WARNING: HTTPS required for camera on mobile!', 'warn');
  }

  // Check browser support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logEvent('Camera API not supported in this browser', 'danger');
    alert('Your browser does not support camera access. Please use Chrome, Firefox, or Safari.');
    return;
  }

  state.alertSound = createAlertSound();
  updateSystemStatus('', 'READY');
  logEvent('DrowseGuard system ready', 'safe');
  logEvent('Click START MONITORING to begin', 'info');

  // Check health
  try {
    const health = await fetch('/health');
    const data = await health.json();
    if (data.model) {
      logEvent('Deep learning model loaded ✓', 'safe');
    } else {
      logEvent('Model not available — check server', 'warn');
    }
  } catch (e) {
    logEvent('Backend connection failed', 'danger');
  }
}

// ===================== RESIZE HANDLER =====================
window.addEventListener('resize', () => {
  if (state.stream) resizeCanvas();
});

// ===================== VISIBILITY CHANGE =====================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause analysis when tab hidden (save battery)
    state.analyzing = false;
  } else if (state.stream) {
    state.analyzing = true;
  }
});

// Start
document.addEventListener('DOMContentLoaded', init);
