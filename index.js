const video = document.getElementById("video");
video.src = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8";

// Must be triggered by user interaction on iOS
document.body.addEventListener("click", async () => {
  const ctx = new AudioContext();

  const source = ctx.createMediaElementSource(video);
  const gain = ctx.createGain();

  source.connect(gain).connect(ctx.destination);

  document.getElementById("vol").addEventListener("input", e => {
    gain.gain.value = e.target.value;
  });

  await video.play();
}, { once: true });
