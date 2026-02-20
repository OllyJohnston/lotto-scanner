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
                height: { ideal: 1080 }
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

// 2. Capture and Process Image
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

        // Set canvas to precisely the cropped zone
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext('2d');

        // Apply visual filters BEFORE OCR to massively improve number detection
        ctx.filter = 'grayscale(100%) contrast(180%) brightness(120%)';

        // Draw just the target box area onto the canvas
        ctx.drawImage(video, startX, startY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        // Convert canvas to a Base64 image data URL
        const imageData = canvas.toDataURL('image/jpeg', 1.0);

        // Send to Tesseract for OCR processing
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

        // CRITICAL FOR LOTTO: Only look for numbers and basic spacing.
        // This stops it guessing letters when it sees blurry digits
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789 ',
        });

        const result = await worker.recognize(imageData);
        await worker.terminate(); // Clean up memory

        // Processing complete
        const text = result.data.text;

        // Show results
        resultsArea.classList.add('active');

        if (text.trim() === "") {
            scannedText.style.color = "var(--danger)";
            scannedText.textContent = "No text found. Try getting closer or improving lighting.";
        } else {
            scannedText.style.color = "white";
            scannedText.textContent = text;
        }

        statusText.textContent = "Scan Complete";

    } catch (err) {
        console.error("OCR Error:", err);
        statusText.style.color = "var(--danger)";
        statusText.textContent = "Failed to process image.";
    } finally {
        // Reset state
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
        await videoTrack.applyConstraints({
            advanced: [{ torch: isTorchOn }]
        });
        torchBtn.classList.toggle('active', isTorchOn);
    } catch (err) {
        console.error("Torch error:", err);
        isTorchOn = !isTorchOn; // Revert state
        alert("Your browser or device does not support turning on the flashlight via the web. Try using Google Chrome!");
    }
});

// Start camera on load
window.addEventListener('load', setupCamera);
