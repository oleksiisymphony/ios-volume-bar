const DEFAULT_SRC = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const video = document.getElementById("video");
video.crossOrigin = "anonymous"; // needed for createMediaElementSource with cross-origin streams
// Force native media element to be muted so only WebAudio / audioFallback is used for audible output
video.muted = true;
video.defaultMuted = true;
console.log('Native video element forced muted to ensure WebAudio/audioFallback is used for audible output');

// Allow overriding video source via ?src=<url> — fallback to DEFAULT_SRC
const params = new URLSearchParams(window.location.search);
const srcParam = params.get('src');
const src = srcParam ? decodeURIComponent(srcParam) : DEFAULT_SRC;
video.src = src;
video.volume = 1;
video.muted = true;
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
let wired = false; // true when createMediaElementSource has been successfully created (and only once)
let usingWebAudio = false;

playBtn.addEventListener("click", async () => {
  setStatus('user Play pressed — ensuring wiring before playback');
  // Ensure wiring; if WebAudio wiring fails we will fall back to audioFallback below
  try {
    await ensureWiredToWebAudio();
  } catch (err) {
    console.warn('ensureWiredToWebAudio failed; will try audio-element fallback', err);
  }

  // Try to play the video (video is intentionally muted; audio will come from WebAudio if available)
  try {
    const p = video.play();
    console.log('video.play() returned', p);
    await p;
    if (usingWebAudio) setStatus('Playing with WebAudio routing (native audio forced muted)');
    else if (audioFallback) setStatus('Playing with audio element fallback (native video forced muted)');
    else setStatus('Playing with native element volume control');
  } catch (playErr) {
    console.error('Play failed after wiring attempt:', playErr);
    setStatus('Play failed — see console for details');
  }

  // Add a periodic diagnostic log to help debug iOS behavior
  setInterval(() => {
    logMediaSnapshot('periodic diagnostic');
    if (ctx) console.log('AudioContext periodic state:', { state: ctx.state, sampleRate: ctx.sampleRate });
  }, 3000);

}, { once: true });

// If the user manages to call the video's native play (e.g., via controls or other), ensure we wire first
video.addEventListener('play', async (e) => {
  if (wired) return; // already wired
  console.warn('video play event fired before WebAudio wiring — pausing to wire and prevent native audio route lock');
  try {
    video.pause();
  } catch (_) {}
  setStatus('Detected native play before wiring — pausing and setting up WebAudio');
  try {
    await ensureWiredToWebAudio();
    // after wiring, attempt play again (muted video; audio should come from WebAudio)
    await video.play();
    setStatus('Playback resumed after wiring');
  } catch (err) {
    console.error('Failed to wire on video.play:', err);
    setStatus('Failed to wire on video.play — see console');
  }
});

// Centralize wiring logic so createMediaElementSource is always created BEFORE any native playback and only once
async function ensureWiredToWebAudio() {
  if (wired) {
    console.log('ensureWiredToWebAudio: already wired');
    return;
  }

  setStatus('ensuring WebAudio wiring (create AudioContext + MediaElementSource)');
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    console.log('AudioContext created/resumed in ensureWiredToWebAudio', { state: ctx.state, sampleRate: ctx.sampleRate });
    await ctx.resume();
    console.log('AudioContext after resume', { state: ctx.state });

    if (forceAudioFallback) {
      console.log('forceAudioFallback requested — skipping video createMediaElementSource');
      throw new Error('forceAudioFallback');
    }

    // Create the MediaElementSource before any playback
    let source;
    try {
      source = ctx.createMediaElementSource(video);
      gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      console.log('createMediaElementSource succeeded in ensureWiredToWebAudio');
    } catch (createErr) {
      console.warn('createMediaElementSource failed in ensureWiredToWebAudio', createErr);
      throw createErr;
    }

    // Hook up UI to control gain if present
    volInput.addEventListener("input", e => {
      const v = Number(e.target.value);
      if (gain && gain.gain) {
        gain.gain.value = v;
        console.log('WebAudio gain set ->', v, { timestamp: Date.now() });
        setStatus(`WebAudio gain: ${gain.gain.value}`);
        updateDiagnostics(gain.gain.value);
      }
    });

    wired = true;
    usingWebAudio = true;
    setStatus('WebAudio routing established for video (native audio forced muted)');
    logMediaSnapshot('wired');
  } catch (err) {
    // If wiring failed, attempt the audio-element fallback as before
    console.warn('Wiring failed; attempting audioFallback in ensureWiredToWebAudio', err);
    setStatus('video WebAudio failed; trying audio-element fallback');

    try {
      audioFallback = document.createElement('audio');
      audioFallback.crossOrigin = 'anonymous';
      audioFallback.src = src;
      audioFallback.preload = 'auto';
      audioFallback.style.display = 'none';
      audioFallback.playsInline = true;
      document.body.appendChild(audioFallback);

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

      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const aSource = ctx.createMediaElementSource(audioFallback);
      gain = ctx.createGain();
      aSource.connect(gain).connect(ctx.destination);

      volInput.addEventListener("input", e => {
        const v = Number(e.target.value);
        gain.gain.value = v;
        setStatus(`Audio fallback gain: ${gain.gain.value}`);
        updateDiagnostics(gain.gain.value);
      });

      // Keep native video muted; play the audio fallback
      video.muted = true;
      try {
        const p = audioFallback.play();
        console.log('audioFallback.play() returned', p);
        await p;
        setStatus('Playing audio fallback (native video forced muted)');
        wired = true; // consider wired if fallback is in use
      } catch (audioPlayErr) {
        console.error('Audio fallback play failed in ensureWiredToWebAudio', audioPlayErr);
        setStatus('Audio fallback play failed');
        throw audioPlayErr;
      }
    } catch (audioErr) {
      console.warn('Audio-element fallback failed in ensureWiredToWebAudio, falling back to element.volume control', audioErr);
      setStatus('Fallback to native element.volume control');
      volInput.addEventListener("input", e => {
        video.volume = Number(e.target.value);
        setStatus(`video.volume set: ${video.volume}`);
        updateDiagnostics(null);
      });
      throw audioErr;
    }
  }
}
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
      setStatus('WebAudio routing established for video (native audio forced muted)');
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
        setStatus('Playing audio fallback (native video forced muted)');
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
//   if (!audioFallback) video.muted = false;
  try {
    const p = video.play();
    console.log('video.play() returned', p);
    await p;
    if (usingWebAudio) setStatus('Playing with WebAudio routing (native audio forced muted)');
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
