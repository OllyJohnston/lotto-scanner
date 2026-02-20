// Register the Service Worker (required for PWAs to be installable and work offline)
if ('serviceWorker' in navigator) {
    // We will create an empty sw.js later to satisfy the PWA requirements
    // navigator.serviceWorker.register('./sw.js');
}

// DOM Elements
const video = document.getElementById('camera-feed');
const canvas = document.getElementById('snapshot-canvas');
const scanBtn = document.getElementById('scan-btn');
const statusText = document.getElementById('status-text');
const overlay = document.getElementById('scanner-overlay');
const resultsArea = document.getElementById('results-area');
const scannedText = document.getElementById('scanned-text');
const torchBtn = document.getElementById('torch-btn');
const nativeCamBtn = document.getElementById('native-cam-btn');
const nativeCameraInput = document.getElementById('native-camera');

let stream = null;
let videoTrack = null;
let isScanning = false;
let isTorchOn = false;

// 1. Initialize the Camera
async function setupCamera() {
    try {
        // Request the rear camera specifically, preferring high resolution if available
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                advanced: [{ focusMode: "continuous" }]
            },
            audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        videoTrack = stream.getVideoTracks()[0];

        // Torch button is always shown now, errors are handled on click.

        // Once video is ready to play, enable the UI
        video.onloadedmetadata = () => {
            statusText.textContent = "Ready";
            scanBtn.disabled = false;
        };

    } catch (err) {
        console.error("Camera access error:", err);
        statusText.style.color = "var(--danger)";
        statusText.textContent = "Camera access denied or unavailable.";
        // Check if the protocol is HTTP (not HTTPS/localhost) which restricts camera
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            statusText.textContent = "Camera requires HTTPS. Please deploy or run locally.";
        }
    }
}

// 2. Capture and Process Image via WebRTC
async function captureAndScan() {
    if (isScanning || !stream) return;

    isScanning = true;
    scanBtn.disabled = true;
    const laser = document.getElementById('laser-line');
    if (laser) laser.style.display = 'block'; // Show laser
    statusText.textContent = "Processing image...";
    statusText.classList.add('pulse');

    try {
        const cw = video.videoWidth;
        const ch = video.videoHeight;

        // Match the target-box CSS dimensions for cropping (80% width, 30% height)
        const cropWidth = cw * 0.8;
        const cropHeight = ch * 0.3;
        const startX = (cw - cropWidth) / 2;
        const startY = (ch - cropHeight) / 2;

        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext('2d');
        ctx.filter = 'grayscale(100%) contrast(180%) brightness(120%)';
        ctx.drawImage(video, startX, startY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        const imageData = canvas.toDataURL('image/jpeg', 1.0);
        await processImageData(imageData);

    } catch (err) {
        console.error("Camera Capture Error:", err);
    } finally {
        resetScanState();
    }
}

// 3. Capture via Native OS Camera
nativeCamBtn.addEventListener('click', () => {
    nativeCameraInput.click();
});

nativeCameraInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    isScanning = true;
    statusText.textContent = "Loading native photo...";
    statusText.classList.add('pulse');

    const reader = new FileReader();
    reader.onload = async (event) => {
        const img = new Image();
        img.onload = async () => {
            // Draw full res native image to canvas
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            // Basic cleanup on the HD photo
            ctx.filter = 'grayscale(100%) contrast(150%)';
            ctx.drawImage(img, 0, 0);

            statusText.textContent = "Analyzing HD Photo...";
            const imageData = canvas.toDataURL('image/jpeg', 1.0);
            await processImageData(imageData);
            resetScanState();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// Common OCR Processing logic
async function processImageData(imageData) {
    try {
        statusText.textContent = "Booting AI Engine...";

        // We create a worker to set specific parameters (whitelist)
        const worker = await Tesseract.createWorker("eng", 1, {
            logger: m => {
                if (m.status === "recognizing text") {
                    const pct = Math.round(m.progress * 100);
                    statusText.textContent = `Extracting numbers... ${pct}%`;
                }
            }
        });

        // CRITICAL FOR LOTTO: Add Brackets and Uppercase letters because
        // Euromillions tickets have layout like: A 23 24 29 36 45 [06 09]
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ[]-',
        });

        const result = await worker.recognize(imageData);
        await worker.terminate(); // Clean up memory

        // Processing complete
        const text = result.data.text;

        // Show results
        resultsArea.classList.add('active');

        // Let's do some smart parsing to find lines that look like ticket draws
        // EuroMillions: 5 numbers then [2 numbers]
        const lines = text.split('\n');
        let parsedDraws = [];

        lines.forEach(line => {
            // Very loose regex: looks for sequence of digits and brackets
            // e.g. "A 23 24 29 36 45 [06 09]"
            if (line.includes('[') && line.includes(']')) {
                parsedDraws.push("⭐ " + line.trim());
            } else if (line.match(/(?:\d{1,2}\s+){4,}/)) {
                // At least 5 numbers in a row
                parsedDraws.push("🎟️ " + line.trim());
            }
        });

        if (parsedDraws.length > 0) {
            scannedText.style.color = "var(--accent)";
            scannedText.innerHTML = `<strong>Lines detected:</strong><br><br>` + parsedDraws.join('<br>') + `<br><br><span style="color:var(--text-secondary);font-size:0.8em;opacity:0.7;">Raw OCR Output:</span><br><span style="opacity:0.6;font-size:0.8em;">${text}</span>`;
        } else if (text.trim() === "") {
            scannedText.style.color = "var(--danger)";
            scannedText.textContent = "No text found. Try moving closer or adjusting the lighting.";
        } else {
            scannedText.style.color = "white";
            scannedText.textContent = "Could not find ticket layout. Raw output:\n\n" + text;
        }

        statusText.textContent = "Scan Complete";

    } catch (err) {
        console.error("OCR Error:", err);
        statusText.style.color = "var(--danger)";
        statusText.textContent = "Failed to process image.";
    }
}

function resetScanState() {
    isScanning = false;
    scanBtn.disabled = false;
    const laser = document.getElementById('laser-line');
    if (laser) laser.style.display = 'none'; // Hide laser
    statusText.classList.remove('pulse');

    // Reset status color if it was red
    setTimeout(() => {
        if (!isScanning) {
            statusText.style.color = "var(--accent)";
            statusText.textContent = "Ready for next scan";
        }
    }, 3000);
}

// Event Listeners
scanBtn.addEventListener('click', captureAndScan);

torchBtn.addEventListener('click', async () => {
    if (!videoTrack) {
        alert("Camera isn't ready yet!");
        return;
    }
    try {
        isTorchOn = !isTorchOn;
        // Apply the torch constraint
        await videoTrack.applyConstraints({
            advanced: [{ torch: isTorchOn }]
        });

        // Android 15/16 Bug Check:
        // On modern Chromium, if the OS overrides the flag, the capability might fail silently.
        // We can double check if the setting actually applied:
        const settings = videoTrack.getSettings();
        if (settings.torch !== isTorchOn && isTorchOn) {
            console.warn("Torch constraint applied but hardware refused.");
            // Throw to trigger catch block warning
            throw new Error("Hardware locked.");
        }

        torchBtn.classList.toggle('active', isTorchOn);
    } catch (err) {
        console.error("Torch error:", err);
        isTorchOn = !isTorchOn; // Revert state
        alert("Torch unavailable: Your device might lock the flashlight to native apps only, or WebTorch is not fully supported on this OS version.");
    }
});

// Start camera on load
window.addEventListener('load', setupCamera);
