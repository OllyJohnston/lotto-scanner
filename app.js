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
const stopCamBtn = document.getElementById('stop-cam-btn');
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
        video.style.display = 'block';

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
        // Mild contrast to keep digits sharp without blowing out the white receipt paper
        ctx.filter = 'grayscale(100%) contrast(120%)';
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
    alert("Tip: Before checking ok, use your camera to ZOOM IN so ONLY the numbers fill the screen. \n\nIf the ticket looks huge to the AI, it will fail to read it.");
    // Shut off live feed so user can use flash
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        videoTrack = null;
        video.style.display = 'none';
        scanBtn.disabled = true;
    }
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
            // Basic cleanup on the HD photo: lower contrast boost so we don't blind the AI
            ctx.filter = 'grayscale(100%) contrast(120%)';
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
        // Add PSM 6: Assume a single uniform block of text (perfect for receipts/invoices)
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ[]-',
            tessedit_pageseg_mode: '6',
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

stopCamBtn.addEventListener('click', () => {
    if (stream) {
        // Force kill the WebRTC camera stream
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        videoTrack = null;
        video.style.display = 'none';
        statusText.innerHTML = "Camera powered off.<br>Use your device's pull-down menu to turn on your flashlight, then turn the camera back on!";
        scanBtn.disabled = true;

        // Change icon to a 'Play' button
        stopCamBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
        `;
        stopCamBtn.title = "Turn Camera On";

    } else {
        // Restart the camera
        video.style.display = 'block';
        statusText.textContent = "Restarting camera...";
        setupCamera();

        // Revert icon to 'Power Off'
        stopCamBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
        `;
        stopCamBtn.title = "Stops the web camera so you can use your phone's native flashlight";
    }
});

// Start camera on load
window.addEventListener('load', setupCamera);
