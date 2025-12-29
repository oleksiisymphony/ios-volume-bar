const DEFAULT_SRC = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const video = document.getElementById("video");
video.crossOrigin = "anonymous";

// Parse URL parameters
const params = new URLSearchParams(window.location.search);
const srcParam = params.get('src');
const forceAudioFallback = params.get('forceAudioFallback') === 'true';
const src = srcParam ? decodeURIComponent(srcParam) : DEFAULT_SRC;

// Display the source
const srcDisplay = document.getElementById('srcDisplay');
if (srcDisplay) srcDisplay.textContent = src;

// UI Elements
const playBtn = document.getElementById("play");
const volInput = document.getElementById("vol");
const statusText = document.getElementById('statusText');
const gainDisplay = document.getElementById('gainDisplay');
const videoVolDisplay = document.getElementById('videoVolDisplay');
const setVolBtn = document.getElementById('setVolBtn');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');

// State
let ctx = null;
let gain = null;
let sourceNode = null;
let wired = false;
let usingWebAudio = false;
let isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

console.log('Platform detection:', { isIOS, userAgent: navigator.userAgent });
console.log(`Using video src: ${src}`);
console.log('URL params:', { srcParam, forceAudioFallback });

// Log media capability hints
try {
  console.log('canPlayType video/mp4 ->', video.canPlayType('video/mp4'));
  console.log('canPlayType application/vnd.apple.mpegurl ->', video.canPlayType('application/vnd.apple.mpegurl'));
} catch (err) {
  console.warn('capability probe failed', err);
}

function setStatus(msg) {
  console.log('Status:', msg);
  if (statusText) statusText.textContent = msg;
}

function updateDiagnostics(gainValue) {
  if (gainDisplay) gainDisplay.textContent = gainValue !== null ? gainValue.toFixed(2) : '-';
  if (videoVolDisplay) videoVolDisplay.textContent = video.volume.toFixed(2);
}

function logMediaSnapshot(label) {
  console.log(`[${label}] Media snapshot:`, {
    videoPaused: video.paused,
    videoMuted: video.muted,
    videoVolume: video.volume,
    videoCurrentTime: video.currentTime,
    ctxState: ctx?.state,
    gainValue: gain?.gain?.value,
    wired,
    usingWebAudio,
  });
}

// Initialize AudioContext early (but need user gesture to resume)
function initAudioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    console.log('AudioContext created', { state: ctx.state, sampleRate: ctx.sampleRate });
  }
  return ctx;
}

// Attempt to wire video through Web Audio for volume control
async function wireVideoToWebAudio() {
  if (wired) {
    console.log('Already wired');
    return true;
  }

  setStatus('Attempting WebAudio wiring...');
  
  try {
    initAudioContext();
    
    // Resume context (requires user gesture on iOS)
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('AudioContext resumed', { state: ctx.state });
    }

    if (forceAudioFallback) {
      throw new Error('forceAudioFallback requested');
    }

    // CRITICAL: Create MediaElementSource BEFORE any playback
    // On iOS, this often fails for HLS streams
    sourceNode = ctx.createMediaElementSource(video);
    gain = ctx.createGain();
    sourceNode.connect(gain).connect(ctx.destination);
    
    console.log('createMediaElementSource succeeded');
    
    wired = true;
    usingWebAudio = true;
    setStatus('WebAudio routing established');
    
    return true;
  } catch (err) {
    console.warn('WebAudio wiring failed:', err.message);
    setStatus(`WebAudio failed: ${err.message}`);
    return false;
  }
}

// Fallback: Use native volume (won't work on iOS but works elsewhere)
function setupNativeVolumeControl() {
  setStatus('Using native volume control (limited on iOS)');
  video.muted = false;
  
  volInput.addEventListener("input", e => {
    const v = Number(e.target.value);
    video.volume = v;
    console.log('Native volume set ->', v);
    updateDiagnostics(null);
  });
}

// Setup volume slider for WebAudio gain
function setupGainControl() {
  volInput.addEventListener("input", e => {
    const v = Number(e.target.value);
    if (gain?.gain) {
      gain.gain.value = v;
      console.log('WebAudio gain set ->', v);
      updateDiagnostics(v);
    }
  });
}

// Main play handler
playBtn.addEventListener("click", async () => {
  setStatus('Play pressed - setting up audio...');
  
  // Set the source now (deferred loading)
  if (!video.src) {
    video.src = src;
  }
  
  // Attempt WebAudio wiring first
  const webAudioSuccess = await wireVideoToWebAudio();
  
  if (webAudioSuccess) {
    // WebAudio controls volume - keep video unmuted for audio routing
    video.muted = false;
    video.volume = 1; // Max volume, gain controls actual level
    setupGainControl();
    
    try {
      await video.play();
      setStatus('Playing via WebAudio (volume slider works)');
      logMediaSnapshot('playing-webaudio');
    } catch (playErr) {
      console.error('Play failed:', playErr);
      setStatus('Play failed: ' + playErr.message);
    }
  } else {
    // Fallback to native volume control
    console.warn('Falling back to native volume control');
    setupNativeVolumeControl();
    
    try {
      await video.play();
      if (isIOS) {
        setStatus('Playing (iOS: volume slider won\'t work - use device buttons)');
      } else {
        setStatus('Playing with native volume control');
      }
      logMediaSnapshot('playing-native');
    } catch (playErr) {
      console.error('Play failed:', playErr);
      setStatus('Play failed: ' + playErr.message);
    }
  }
  
  // Periodic diagnostics
  setInterval(() => {
    logMediaSnapshot('periodic');
  }, 5000);
  
}, { once: true });

// Set volume button
setVolBtn?.addEventListener('click', () => {
  if (gain?.gain) {
    gain.gain.value = 0.2;
    volInput.value = 0.2;
    updateDiagnostics(0.2);
    setStatus('Gain set to 0.2');
  } else {
    video.volume = 0.2;
    volInput.value = 0.2;
    updateDiagnostics(null);
    setStatus('Volume set to 0.2');
  }
});

// Toggle mute button
toggleMuteBtn?.addEventListener('click', () => {
  if (gain?.gain) {
    const newVal = gain.gain.value > 0 ? 0 : 1;
    gain.gain.value = newVal;
    volInput.value = newVal;
    updateDiagnostics(newVal);
    setStatus(newVal === 0 ? 'Muted via gain' : 'Unmuted via gain');
  } else {
    video.muted = !video.muted;
    setStatus(video.muted ? 'Muted' : 'Unmuted');
  }
});

// Initial diagnostics
updateDiagnostics(null);
console.log('Volume bar workaround initialized. Click Play to start.');
