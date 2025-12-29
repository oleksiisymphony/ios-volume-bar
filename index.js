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
// If a display element exists, show the chosen src for easier testing
const srcDisplay = document.getElementById('srcDisplay');
if (srcDisplay) srcDisplay.textContent = src;

const playBtn = document.getElementById("play");
const volInput = document.getElementById("vol");

// User gesture required on iOS to unlock audio — bind to the Play button
playBtn.addEventListener("click", async () => {
  let ctx;
  let gain;
  let usingWebAudio = false;

  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Wait for user gesture to resume the context
    await ctx.resume();

    // Try to route the video through WebAudio — may fail for some cross-origin codecs/platforms
    const source = ctx.createMediaElementSource(video);
    gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);

    // Hook up UI to control gain
    volInput.addEventListener("input", e => {
      gain.gain.value = Number(e.target.value);
    });

    usingWebAudio = true;
  } catch (err) {
    // WebAudio routing failed (common on iOS with some HLS streams); fallback to native volume control
    console.warn('WebAudio unavailable for media element, falling back to element.volume', err);
    volInput.addEventListener("input", e => {
      video.volume = Number(e.target.value);
    });
  }

  // Ensure the element is unmuted and play
  video.muted = false;
  try {
    await video.play();
    if (usingWebAudio) console.log('Playing with WebAudio routing');
    else console.log('Playing with native element volume control');
  } catch (playErr) {
    console.error('Play failed:', playErr);
  }
}, { once: true });
