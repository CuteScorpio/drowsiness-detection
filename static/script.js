const video = document.getElementById("video");
const alarm = document.getElementById("alarm");

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false
    });
    video.srcObject = stream;
  } catch (e) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  }
}

startCamera();

function enableAudio() {
  alarm.play().then(() => alarm.pause());
}

setInterval(async () => {
  const res = await fetch("/detect");
  const data = await res.json();

  if (data.drowsy) {
    alarm.play();
  }
}, 3000);
