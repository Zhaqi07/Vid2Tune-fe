const API_BASE =
  window.VID2TUNE_API_BASE ||
  window.__VID2TUNE_API__ ||
  "http://localhost:4000";

const videoInput = document.getElementById("videoInput");
const audioInput = document.getElementById("audioInput");
const videoDropZone = document.querySelector('[data-dropzone="video"]');
const audioDropZone = document.querySelector('[data-dropzone="audio"]');
const videoConvertBtn = document.querySelector('[data-action="convert-video"]');
const audioConvertBtn = document.querySelector('[data-action="convert-audio"]');
const recordBtn = document.querySelector('[data-action="record-audio"]');
const videoStatus = document.getElementById("videoStatus");
const audioStatus = document.getElementById("audioStatus");
const transcriptResult = document.getElementById("transcriptResult");
const transcriptText = document.getElementById("transcriptText");

let recorder = null;
let recordedBlob = null;
let mediaStream = null;

[videoConvertBtn, audioConvertBtn].forEach((button) => {
  if (button) {
    button.dataset.originalText = button.textContent;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updateStatus = (element, message, type = "info") => {
  if (!element) return;
  const colorMap = {
    info: "text-gray-600",
    success: "text-green-600",
    error: "text-red-600",
  };
  element.className = `text-sm mt-4 ${colorMap[type] || colorMap.info}`;
  element.textContent = message;
};

const setButtonLoading = (button, isLoading, idleText) => {
  if (!button) return;
  button.dataset.originalText =
    button.dataset.originalText || button.textContent;
  button.disabled = isLoading;
  button.textContent = isLoading
    ? "Sedang diproses..."
    : idleText || button.dataset.originalText;
};

const resetTranscript = () => {
  if (!transcriptResult) return;
  transcriptResult.classList.add("hidden");
  transcriptText.textContent = "";
};

const syncAudioButtonState = () => {
  const hasFile = audioInput.files.length > 0 || recordedBlob;
  audioConvertBtn.disabled = !hasFile;
};

const handleFileSelection = (input, statusElement, button, label) => {
  if (input.files.length > 0) {
    const fileName = input.files[0].name;
    button.disabled = false;
    button.textContent = `${label} ${fileName}`;
    updateStatus(statusElement, `File siap diproses: ${fileName}`, "info");
  } else {
    button.disabled = true;
    button.textContent = button.dataset.originalText || button.textContent;
    updateStatus(statusElement, "");
  }
};

const wireDropZone = (dropZone, input) => {
  if (!dropZone || !input) return;

  dropZone.addEventListener("click", () => input.click());

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("ring-2", "ring-primary");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("ring-2", "ring-primary");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event("change"));
  });
};

const downloadFromUrl = (url, filename = "vid2tune-output.mp3") => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const convertVideoToAudio = async () => {
  const file = videoInput.files[0];
  if (!file) return;

  setButtonLoading(videoConvertBtn, true, `Mengonversi ${file.name} ...`);
  updateStatus(videoStatus, "Mengunggah video ke server…", "info");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${API_BASE}/api/video-to-audio`, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Konversi gagal dijalankan");
    }

    updateStatus(
      videoStatus,
      "Konversi selesai! Mengunduh file MP3…",
      "success"
    );
    downloadFromUrl(
      payload.downloadUrl,
      file.name.replace(/\.[^.]+$/, "") + ".mp3"
    );
  } catch (error) {
    updateStatus(videoStatus, error.message, "error");
  } finally {
    setButtonLoading(videoConvertBtn, false, `Konversi ${file.name}`);
  }
};

const convertAudioToText = async () => {
  const selectedFile = audioInput.files[0];
  const blobToUse = selectedFile || recordedBlob;

  if (!blobToUse) {
    updateStatus(
      audioStatus,
      "Silakan pilih atau rekam audio terlebih dahulu",
      "error"
    );
    return;
  }

  setButtonLoading(audioConvertBtn, true, "Mengubah audio ke teks…");
  updateStatus(audioStatus, "Mengunggah audio ke server…", "info");
  resetTranscript();

  const fileForUpload =
    blobToUse instanceof File
      ? blobToUse
      : new File([blobToUse], `rekaman-${Date.now()}.webm`, {
          type: blobToUse.type || "audio/webm",
        });

  const formData = new FormData();
  formData.append("file", fileForUpload);

  try {
    const response = await fetch(`${API_BASE}/api/audio-to-text`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Transkripsi gagal");
    }

    updateStatus(audioStatus, "Transkripsi selesai!", "success");
    transcriptText.textContent = payload.text || "(Tidak ada teks ditemukan)";
    transcriptResult.classList.remove("hidden");
  } catch (error) {
    updateStatus(audioStatus, error.message, "error");
  } finally {
    const label = audioInput.files[0]
      ? `Ubah ${audioInput.files[0].name}`
      : "Ubah ke Teks";
    setButtonLoading(audioConvertBtn, false, label);
  }
};

const stopRecording = () => {
  if (!recorder || recorder.state !== "recording") return;
  recorder.stop();
  recordBtn.disabled = true;
  mediaStream?.getTracks().forEach((track) => track.stop());
};

const startRecording = async () => {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    updateStatus(
      audioStatus,
      "Browser belum mendukung perekaman audio.",
      "error"
    );
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(mediaStream);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: "audio/webm" });
      audioInput.value = "";
      syncAudioButtonState();
      recordBtn.textContent = "Rekam Ulang";
      recordBtn.disabled = false;
      recorder = null;
      mediaStream = null;
      updateStatus(
        audioStatus,
        "Rekaman selesai, siap dikonversi ke teks.",
        "success"
      );
    };

    recorder.start();
    recordBtn.textContent = "Stop Rekaman";
    updateStatus(
      audioStatus,
      "Sedang merekam… klik sekali lagi untuk stop.",
      "info"
    );
  } catch (error) {
    updateStatus(
      audioStatus,
      "Tidak bisa mengakses mikrofon. Cek izin browser.",
      "error"
    );
  }
};

const toggleRecording = () => {
  if (!recordBtn) return;
  if (recorder && recorder.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
};

wireDropZone(videoDropZone, videoInput);
wireDropZone(audioDropZone, audioInput);

videoInput.addEventListener("change", () =>
  handleFileSelection(videoInput, videoStatus, videoConvertBtn, "Konversi")
);

audioInput.addEventListener("change", () => {
  recordedBlob = null;
  handleFileSelection(audioInput, audioStatus, audioConvertBtn, "Ubah");
  syncAudioButtonState();
});

videoConvertBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  convertVideoToAudio();
});

audioConvertBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  convertAudioToText();
});

recordBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  toggleRecording();
});

syncAudioButtonState();
