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

        // Check if torch is supported
        const capabilities = videoTrack.getCapabilities();
        if (capabilities.torch) {
            torchBtn.style.display = 'flex';
        }

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
    overlay.style.display = 'block'; // Show laser
    statusText.textContent = "Processing image...";
    statusText.classList.add('pulse');

    try {
        // Set canvas dimensions to match video frame exactly
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');

        // Draw the current video frame onto the canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert canvas to a Base64 image data URL
        const imageData = canvas.toDataURL('image/jpeg', 0.9);

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
        overlay.style.display = 'none'; // Hide laser
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
    if (!videoTrack) return;
    try {
        isTorchOn = !isTorchOn;
        await videoTrack.applyConstraints({
            advanced: [{ torch: isTorchOn }]
        });
        torchBtn.classList.toggle('active', isTorchOn);
    } catch (err) {
        console.error("Torch error:", err);
        isTorchOn = !isTorchOn; // Revert state
    }
});

// Start camera on load
window.addEventListener('load', setupCamera);
