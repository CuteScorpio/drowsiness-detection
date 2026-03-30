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

// Start on user click (mobile fix)
document.body.addEventListener("click", () => {
  startCamera();
}, { once: true });

// Enable sound (required for iOS)
function enableAudio() {
  alarm.play().then(() => alarm.pause());
}

// Send frames to backend
setInterval(() => {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    const formData = new FormData();
    formData.append("frame", blob);

    const res = await fetch("/detect", {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (data.drowsy) {
      alarm.play();
    }
  }, "image/jpeg");
}, 3000);