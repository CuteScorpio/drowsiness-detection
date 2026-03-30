const video = document.getElementById("video");
const alarm = document.getElementById("alarm");

// Start camera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } }
    });
    video.srcObject = stream;
  } catch (e) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  }
}

// mobile fix (user interaction required)
document.body.addEventListener("click", () => {
  startCamera();
}, { once: true });

// enable audio
function enableAudio() {
  alarm.play().then(() => alarm.pause());
}

// send frames safely
async function sendFrame() {
  if (!video.videoWidth) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    if (!blob) return;

    const formData = new FormData();
    formData.append("frame", blob, "frame.jpg");

    try {
      const res = await fetch("/detect", {
        method: "POST",
        body: formData
      });

      if (!res.ok) return;

      const data = await res.json();

      if (data.drowsy) {
        alarm.play();
      }

    } catch (err) {
      console.error(err);
    }

  }, "image/jpeg");
}

// every 3 sec
setInterval(sendFrame, 3000);