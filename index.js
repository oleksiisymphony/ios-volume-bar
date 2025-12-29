const DEFAULT_SRC = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const video = document.getElementById("video");
video.crossOrigin = "anonymous"; // needed for createMediaElementSource with cross-origin streams

// Allow overriding video source via ?src=<url> — fallback to DEFAULT_SRC
const params = new URLSearchParams(window.location.search);
const srcParam = params.get('src');
const src = srcParam ? decodeURIComponent(srcParam) : DEFAULT_SRC;
video.src = src;
video.volume = 1;
console.log(`Using video src: ${src}`);
console.log('URL params:', { srcParam, forceAudioFallback: params.get('forceAudioFallback') });
// Log media capability hints
try {
  console.log('canPlayType video/mp4 ->', video.canPlayType('video/mp4'));
  console.log('canPlayType application/vnd.apple.mpegurl ->', video.canPlayType('application/vnd.apple.mpegurl'));
  if (typeof video.webkitDecodedFrameCount !== 'undefined') console.log('webkitDecodedFrameCount:', video.webkitDecodedFrameCount);
  if (typeof video.webkitAudioDecodedByteCount !== 'undefined') console.log('webkitAudioDecodedByteCount:', video.webkitAudioDecodedByteCount);
} catch (err) {
  console.warn('capability probe failed', err);
}
// If a display element exists, show the chosen src for easier testing
const srcDisplay = document.getElementById('srcDisplay');
if (srcDisplay) srcDisplay.textContent = src;

const playBtn = document.getElementById("play");
const volInput = document.getElementById("vol");
const statusText = document.getElementById('statusText');
const gainDisplay = document.getElementById('gainDisplay');
const videoVolDisplay = document.getElementById('videoVolDisplay');
const setVolBtn = document.getElementById('setVolBtn');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');

// Make AudioContext, gain and audioFallback visible for diagnostics and reuse
let ctx = null;
let gain = null;
let audioFallback = null;

// Helper: log video/audio state snapshot
function logMediaSnapshot(prefix = '') {
  try {
    console.log(prefix, {
      time: new Date().toISOString(),
      videoSrc: video.currentSrc || video.src,
      videoPaused: video.paused,
      videoMuted: video.muted,
      videoVolume: video.volume,
      videoReadyState: video.readyState,
      videoCurrentTime: video.currentTime,
      audioFallbackPresent: !!audioFallback,
      audioFallbackPaused: audioFallback ? audioFallback.paused : undefined,
      audioFallbackCurrentTime: audioFallback ? audioFallback.currentTime : undefined,
      audioContextState: ctx ? ctx.state : undefined,
      gainValue: gain ? (gain.gain && gain.gain.value) : undefined,
    });
  } catch (err) {
    console.warn('logMediaSnapshot failed', err);
  }
}

// Attach event listeners to the video element to capture runtime behavior
['play','playing','pause','volumechange','loadedmetadata','canplay','canplaythrough','waiting','stalled','error','suspend','emptied'].forEach(ev => {
  video.addEventListener(ev, e => {
    console.log(`video event: ${ev}`, {
      event: e.type,
      time: Date.now(),
      paused: video.paused,
      muted: video.muted,
      volume: video.volume,
      readyState: video.readyState,
      currentTime: video.currentTime,
    });
    logMediaSnapshot(`video event ${ev}`);
  });
});

// Force the audio-element fallback via ?forceAudioFallback=1 when testing
const forceAudioFallback = params.get('forceAudioFallback') === '1';

function setStatus(msg) {
  console.log(msg);
  if (statusText) statusText.textContent = msg;
}

function updateDiagnostics(currentGain) {
  if (gainDisplay) gainDisplay.textContent = (currentGain == null ? '-' : String(currentGain));
  if (videoVolDisplay) videoVolDisplay.textContent = String(video.volume);
}

// Global diagnostic listener: always log slider events and current values
volInput.addEventListener('input', e => {
  const v = Number(e.target.value);
  console.log('slider input fired ->', v, { timestamp: Date.now() });

  // If a WebAudio gain is present, show the intended gain and timestamp
  if (gain && gain.gain) {
    console.log('slider -> setting gain.gain.value (intended):', v, 'currentGain:', gain.gain.value);
  } else {
    console.log('slider -> no WebAudio gain present; intended video.volume:', v, 'currentVideoVolume:', video.volume);
  }

  // show the intended video.volume value as well (helpful when fallback is used)
  updateDiagnostics(null);
});

// Test helpers
setVolBtn && setVolBtn.addEventListener('click', () => {
  volInput.value = '0.2';
  // dispatch input event so listeners react the same way as user gesture
  volInput.dispatchEvent(new Event('input', { bubbles: true }));
  // Also explicitly apply to the active mechanism so we can observe results immediately
  if (gain && gain.gain) {
    gain.gain.value = 0.2;
    console.log('Test helper applied gain.gain.value = 0.2');
  } else {
    video.volume = 0.2;
    console.log('Test helper applied video.volume = 0.2');
  }
  updateDiagnostics(gain && gain.gain ? gain.gain.value : null);
  setStatus('Test: set volume slider to 0.2');
});

toggleMuteBtn && toggleMuteBtn.addEventListener('click', () => {
  video.muted = !video.muted;
  setStatus(`Test: toggled video.muted -> ${video.muted}`);
  updateDiagnostics(null);
});

// User gesture required on iOS to unlock audio — bind to the Play button
playBtn.addEventListener("click", async () => {
  let ctx;
  let gain;
  let usingWebAudio = false;
  let audioFallback = null; // optional hidden audio element fallback

  setStatus('attempting audio unlock and WebAudio routing');

  try {
    // reuse global ctx when present
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    console.log('AudioContext created', { state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency });
    // Wait for user gesture to resume the context
    await ctx.resume();
    console.log('AudioContext after resume', { state: ctx.state });

    if (!forceAudioFallback) {
      // Try to route the video through WebAudio — may fail for some cross-origin codecs/platforms
      let source;
      try {
        source = ctx.createMediaElementSource(video);
        gain = ctx.createGain();
        source.connect(gain).connect(ctx.destination);
        console.log('createMediaElementSource succeeded', { source, gainNode: gain });
      } catch (createErr) {
        console.warn('createMediaElementSource threw', createErr);
        throw createErr;
      }

      // Hook up UI to control gain
      volInput.addEventListener("input", e => {
        const v = Number(e.target.value);
        gain.gain.value = v;
        console.log('WebAudio gain set ->', v, { timestamp: Date.now() });
        setStatus(`WebAudio gain: ${gain.gain.value}`);
        updateDiagnostics(gain.gain.value);
      });

      usingWebAudio = true;
      setStatus('WebAudio routing established for video');
    } else {
      setStatus('forceAudioFallback active — skipping video WebAudio routing');
      throw new Error('forceAudioFallback');
    }
  } catch (err) {
    // WebAudio routing failed (common on iOS with some HLS streams); try an audio-element fallback
    console.warn('Video WebAudio unavailable, trying audio-element fallback', err);
    setStatus('video WebAudio failed; trying audio-element fallback');

    try {
      // Create hidden audio element that we can route through WebAudio
      audioFallback = document.createElement('audio');
      audioFallback.crossOrigin = 'anonymous';
      audioFallback.src = src;
      audioFallback.preload = 'auto';
      audioFallback.style.display = 'none';
      audioFallback.playsInline = true;
      document.body.appendChild(audioFallback);

      // attach diagnostic listeners to the audio fallback
      ['play','playing','pause','volumechange','error','timeupdate','loadedmetadata','canplay'].forEach(ev => {
        audioFallback.addEventListener(ev, e => {
          console.log(`audioFallback event: ${ev}`, {
            event: e.type,
            paused: audioFallback.paused,
            currentTime: audioFallback.currentTime,
            volume: audioFallback.volume,
          });
          logMediaSnapshot(`audioFallback event ${ev}`);
        });
      });

      // Use the same AudioContext (or create a new one if absent)
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();

      const aSource = ctx.createMediaElementSource(audioFallback);
      gain = ctx.createGain();
      aSource.connect(gain).connect(ctx.destination);

      // Hook up UI to control gain for the audio fallback
      volInput.addEventListener("input", e => {
        gain.gain.value = Number(e.target.value);
        setStatus(`Audio fallback gain: ${gain.gain.value}`);
        updateDiagnostics(gain.gain.value);
      });

      // Mute video and play hidden audio in sync (best-effort)
      video.muted = true;
      try {
        const p = audioFallback.play();
        console.log('audioFallback.play() returned', p);
        await p;
        setStatus('Playing audio fallback (video muted)');
      } catch (audioPlayErr) {
        console.error('Audio fallback play failed', audioPlayErr);
        setStatus('Audio fallback play failed');
      }
    } catch (audioErr) {
      console.warn('Audio-element fallback failed, falling back to element.volume control', audioErr);
      setStatus('Fallback to native element.volume control');
      volInput.addEventListener("input", e => {
        video.volume = Number(e.target.value);
        setStatus(`video.volume set: ${video.volume}`);
        updateDiagnostics(null);
      });
    }
  }

  // Ensure the element is unmuted (unless audioFallback is used) and play video
  if (!audioFallback) video.muted = false;
  try {
    const p = video.play();
    console.log('video.play() returned', p);
    await p;
    if (usingWebAudio) setStatus('Playing with WebAudio routing');
    else if (audioFallback) setStatus('Playing with audio element fallback (video muted)');
    else setStatus('Playing with native element volume control');
  } catch (playErr) {
    console.error('Play failed:', playErr);
    setStatus('Play failed — see console for details');
  }

  // Add a periodic diagnostic log to help debug iOS behavior
  setInterval(() => {
    logMediaSnapshot('periodic diagnostic');
    if (ctx) console.log('AudioContext periodic state:', { state: ctx.state, sampleRate: ctx.sampleRate });
  }, 3000);

}, { once: true });
