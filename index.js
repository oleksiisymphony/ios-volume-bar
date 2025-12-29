const video = document.getElementById("video");
video.src = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
video.volume = 1;

// Must be triggered by user interaction on iOS
document.body.addEventListener("click", async () => {
  const ctx = new AudioContext();

  const source = ctx.createMediaElementSource(video);
  const gain = ctx.createGain();

  source.connect(gain).connect(ctx.destination);

  document.getElementById("vol").addEventListener("input", e => {
    gain.gain.value = e.target.value;
  });


  await ctx.resume();
  video.muted = false;
  await video.play();
}, { once: true });
