document.addEventListener('DOMContentLoaded', () => {
    // ─── UI ELEMENTS ─────────────────────────────────────────────────────────
    const statusBadge         = document.getElementById('status-badge');
    const btnVoice            = document.getElementById('btn-voice');
    const btnSimulate         = document.getElementById('btn-simulate');
    const btnSafe             = document.getElementById('btn-safe');
    const voiceStatus         = document.getElementById('voice-status');
    const transcriptText      = document.getElementById('transcript-text');
    const alertBox            = document.getElementById('alert-box');
    const alertIcon           = document.getElementById('alert-icon');
    const promptText          = document.getElementById('prompt-text');
    const promptStepLabel     = document.getElementById('prompt-step-label');
    const countdownContainer  = document.getElementById('countdown-container');
    const countdownTimer      = document.getElementById('countdown-timer');
    const countdownLabel      = document.getElementById('countdown-label');
    const alertSafeBtn        = document.getElementById('alert-safe-btn');
    const emergencyOverlay    = document.getElementById('emergency-overlay');
    const emergencyCountdown  = document.getElementById('emergency-countdown');
    const locationStatus      = document.getElementById('location-status');
    const btnCancelEmergency  = document.getElementById('btn-cancel-emergency');
    const progressBar         = document.getElementById('progress-bar');
    const btnReset            = document.getElementById('btn-reset');

    // ─── STATE ───────────────────────────────────────────────────────────────
    // States: 'SAFE' | 'CHECKING' | 'EMERGENCY'
    let systemState     = 'SAFE';
    let currentStep     = 0;       // 0=idle, 1=prompt1, 2=prompt2, 3=prompt3
    let stepTimer       = null;    // setTimeout for next step transition
    let tickInterval    = null;    // setInterval for countdown display
    let emgInterval     = null;    // setInterval for emergency 10-s countdown
    let recognition     = null;
    let isListening     = false;
    let capturedCoords  = null;    // { lat, lng } from Geolocation API

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    function clearAllTimers() {
        if (stepTimer)    { clearTimeout(stepTimer);    stepTimer    = null; }
        if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
        if (emgInterval)  { clearInterval(emgInterval);  emgInterval  = null; }
    }

    function speakPrompt(text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(text);
            utt.rate  = 1.0;
            utt.pitch = 1.0;
            window.speechSynthesis.speak(utt);
        }
    }

    // ─── STATE MANAGEMENT ────────────────────────────────────────────────────
    function setSystemState(state) {
        systemState = state;

        // Reset badge classes
        statusBadge.className = 'badge';

        if (state === 'SAFE') {
            statusBadge.classList.add('badge-safe');
            statusBadge.innerHTML = '<i class="fa-solid fa-shield-check"></i> <span>SAFE</span>';
            btnSimulate.classList.remove('hidden');
            btnVoice.classList.remove('hidden');
            btnSafe.classList.add('hidden');
            alertBox.classList.add('hidden');
            alertBox.classList.remove('active', 'warning-state', 'danger-state');
            emergencyOverlay.classList.add('hidden');

        } else if (state === 'CHECKING') {
            statusBadge.classList.add('badge-checking');
            statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>CHECKING</span>';
            btnSimulate.classList.add('hidden');
            btnVoice.classList.add('hidden');
            btnSafe.classList.add('hidden');     // "I'm Safe" is now INSIDE the alert box
            alertBox.classList.remove('hidden');

        } else if (state === 'EMERGENCY') {
            statusBadge.classList.add('badge-emergency');
            statusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation fa-fade"></i> <span>EMERGENCY</span>';
            btnSimulate.classList.add('hidden');
            btnVoice.classList.add('hidden');
            btnSafe.classList.add('hidden');
        }
    }

    // ─── COUNTDOWN DISPLAY ───────────────────────────────────────────────────
    /**
     * Shows an animated countdown inside the alert box.
     * @param {number}   seconds   - total seconds to count down
     * @param {string}   label     - text under the number (e.g. "seconds remaining")
     * @param {Function} onExpire  - called when countdown reaches 0
     */
    function startCountdown(seconds, label, onExpire) {
        clearAllTimers();

        let remaining = seconds;
        countdownContainer.classList.remove('hidden');
        countdownTimer.textContent  = remaining;
        countdownLabel.textContent  = label;

        tickInterval = setInterval(() => {
            remaining--;
            countdownTimer.textContent = remaining;

            if (remaining <= 0) {
                clearInterval(tickInterval);
                tickInterval = null;
                onExpire();
            }
        }, 1000);
    }

    // ─── ALERT BOX RENDERER ──────────────────────────────────────────────────
    function showAlertStep({ step, message, icon, stateClass, countdownSecs, countdownLabelText, showCountdown, onExpire }) {
        // Apply state classes to alert box
        alertBox.className = 'alert-box active';
        if (stateClass) alertBox.classList.add(stateClass);

        promptStepLabel.textContent = `STEP ${step} OF 3`;
        alertIcon.className         = `fa-solid ${icon} alert-icon`;
        promptText.textContent       = message;

        // "I'm Safe" button inside the alert
        alertSafeBtn.classList.remove('hidden');

        if (showCountdown) {
            startCountdown(countdownSecs, countdownLabelText, onExpire);
        } else {
            countdownContainer.classList.add('hidden');
            // Schedule next step after countdownSecs (no visual countdown for step 1)
            stepTimer = setTimeout(onExpire, countdownSecs * 1000);
        }
    }

    // ─── WORKFLOW ─────────────────────────────────────────────────────────────
    /**
     * Master inactivity workflow.
     * ┌─────────┬──────────────────────────────────────────────────────┐
     * │ Step 1  │ Show Prompt 1 → wait 20 s → Step 2                  │
     * │ Step 2  │ Show Prompt 2 → wait 20 s → Step 3                  │
     * │ Step 3  │ Show Prompt 3 → wait 20 s → triggerEmergency        │
     * │ Final   │ Emergency overlay + 10-second countdown before alert │
     * └─────────┴──────────────────────────────────────────────────────┘
     */
    function startInactivityWorkflow() {
        setSystemState('CHECKING');
        runStep1();
    }

    // ── STEP 1 ───────────────────────────────────────────────────────────────
    function runStep1() {
        currentStep = 1;
        const MSG = "Hey, are you okay?";
        speakPrompt(MSG);

        showAlertStep({
            step:              1,
            message:           MSG,
            icon:              'fa-circle-question',
            stateClass:        null,
            countdownSecs:     10,
            countdownLabelText:'seconds until next check',
            showCountdown:     true,
            onExpire:          runStep2
        });
    }

    // ── STEP 2 ───────────────────────────────────────────────────────────────
    function runStep2() {
        currentStep = 2;
        const MSG = "We haven't detected any activity. Please respond if you are safe.";
        speakPrompt(MSG);

        showAlertStep({
            step:              2,
            message:           MSG,
            icon:              'fa-triangle-exclamation',
            stateClass:        'warning-state',
            countdownSecs:     10,
            countdownLabelText:'seconds until final warning',
            showCountdown:     true,
            onExpire:          runStep3
        });
    }

    // ── STEP 3 ───────────────────────────────────────────────────────────────
    function runStep3() {
        currentStep = 3;
        const MSG = "No response detected. Sending emergency alert in 10 seconds.";
        speakPrompt(MSG);

        showAlertStep({
            step:              3,
            message:           MSG,
            icon:              'fa-circle-exclamation',
            stateClass:        'danger-state',
            countdownSecs:     10,
            countdownLabelText:'seconds until emergency alert',
            showCountdown:     true,
            onExpire:          triggerEmergency
        });
    }

    // ── EMERGENCY TRIGGER ────────────────────────────────────────────────────
    function triggerEmergency() {
        clearAllTimers();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        setSystemState('EMERGENCY');

        // Show overlay, reset UI
        emergencyOverlay.classList.remove('hidden');
        btnCancelEmergency.classList.remove('hidden');
        btnReset.classList.add('hidden');
        progressBar.style.animation = 'none';
        progressBar.offsetHeight;  // reflow
        progressBar.style.animation = '';

        // ── Get location, then send SMS ─────────────────────────────────────
        locationStatus.innerHTML = '<i class="fa-solid fa-location-dot fa-spin"></i> Fetching location...';
        locationStatus.classList.remove('hidden', 'loc-success', 'loc-error');

        function onLocationReady() {
            // SMS is sent here — after coords are captured (or failed)
            sendAlertRequest('sms');
        }

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    capturedCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    const mapsUrl = `https://maps.google.com/?q=${capturedCoords.lat},${capturedCoords.lng}`;
                    locationStatus.innerHTML = `<i class="fa-solid fa-location-dot"></i> Location captured: <a href="${mapsUrl}" target="_blank">View on Maps</a>`;
                    locationStatus.classList.add('loc-success');
                    onLocationReady();   // ✅ send SMS WITH location
                },
                (err) => {
                    console.warn('Geolocation error:', err.message);
                    capturedCoords = null;
                    locationStatus.innerHTML = '<i class="fa-solid fa-location-dot-slash"></i> Location unavailable';
                    locationStatus.classList.add('loc-error');
                    onLocationReady();   // ⚠️ send SMS WITHOUT location
                },
                { timeout: 8000, enableHighAccuracy: true }
            );
        } else {
            capturedCoords = null;
            locationStatus.innerHTML = '<i class="fa-solid fa-location-dot-slash"></i> Location not supported';
            locationStatus.classList.add('loc-error');
            onLocationReady();           // ⚠️ send SMS WITHOUT location
        }

        // ═══════════════════════════════════════════════════════
        //  PHASE 1 — 10 seconds: Cancel window (SMS already being sent above)
        // ═══════════════════════════════════════════════════════
        document.getElementById('emergency-title').textContent    = 'Emergency Detected';
        document.getElementById('emergency-subtitle').textContent = 'SMS sent to emergency contact. Cancel within 10s to stop the call.';
        speakPrompt("Emergency detected. SMS sent. You have 10 seconds to cancel the call.");

        // Kick off 10-second cancel window
        runEmergencyCountdown(10, () => {
            // No cancel — proceed to PHASE 2
            runCallPhase();
        });
    }


    // ── PHASE 2: Make the voice call ──────────────────────────────────────
    function runCallPhase() {
        document.getElementById('emergency-title').textContent    = 'Making Emergency Call...';
        document.getElementById('emergency-subtitle').textContent = 'Placing voice call to emergency contact.';
        speakPrompt("Placing emergency call now.");

        // Send voice call
        sendAlertRequest('call');

        // Show 10-second "call in progress" countdown, then finalize
        runEmergencyCountdown(10, finalizeAlert);
    }

    // ── Shared countdown helper for emergency phases ────────────────────────
    function runEmergencyCountdown(seconds, onExpire) {
        if (emgInterval) { clearInterval(emgInterval); emgInterval = null; }
        let sec = seconds;
        emergencyCountdown.textContent = sec;

        emgInterval = setInterval(() => {
            sec--;
            emergencyCountdown.textContent = sec;
            if (sec <= 0) {
                clearInterval(emgInterval);
                emgInterval = null;
                onExpire();
            }
        }, 1000);
    }

    // ── Backend call ──────────────────────────────────────────────────────
    function sendAlertRequest(type) {
        const payload = {
            type:   type,   // 'sms' or 'call'
            reason: 'Inactivity limit reached – no response after 3 prompts',
            lat:    capturedCoords ? capturedCoords.lat : null,
            lng:    capturedCoords ? capturedCoords.lng : null
        };
        fetch('/api/alert', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        }).then(r => r.json())
          .then(d => console.log(`[${type.toUpperCase()}] Backend:`, d))
          .catch(e => console.warn('Backend unreachable:', e));
    }

    function finalizeAlert() {
        // Hide cancel, show reset
        btnCancelEmergency.classList.add('hidden');
        btnReset.classList.remove('hidden');

        document.getElementById('emergency-title').textContent    = 'Alert Sent ✔';
        document.getElementById('emergency-subtitle').textContent  = 'Emergency contacts and services have been notified.';
        speakPrompt("Alert sent. Emergency contacts have been notified.");

        // Animate actions list into view
        document.querySelectorAll('.emergency-actions li').forEach((li, i) => {
            setTimeout(() => li.classList.add('action-visible'), i * 600);
        });
    }

    // ── RESET / SAFE ─────────────────────────────────────────────────────────
    function resetSystem() {
        clearAllTimers();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        currentStep    = 0;
        capturedCoords = null;
        setSystemState('SAFE');
        countdownContainer.classList.add('hidden');

        // Reset emergency actions
        document.querySelectorAll('.emergency-actions li').forEach(li => li.classList.remove('action-visible'));
        document.getElementById('emergency-title').textContent    = 'Emergency Detected';
        document.getElementById('emergency-subtitle').textContent  = '';
        emergencyCountdown.textContent = '10';
        locationStatus.innerHTML = '<i class="fa-solid fa-location-dot fa-spin"></i> Fetching location...';
        locationStatus.classList.add('hidden');
        btnCancelEmergency.classList.add('hidden');
        btnReset.classList.add('hidden');
    }

    function handleSafe() {
        resetSystem();
        speakPrompt("Glad you are safe. System reset.");
    }

    // ─── VOICE RECOGNITION ───────────────────────────────────────────────────
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR   = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SR();
        recognition.continuous      = true;
        recognition.interimResults  = true;
        recognition.lang            = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            voiceStatus.classList.remove('hidden');
            btnVoice.innerHTML           = '<i class="fa-solid fa-microphone-slash"></i> Stop Voice Detection';
            btnVoice.style.backgroundColor = 'var(--danger)';
        };

        recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript.toLowerCase();
                interim += t;
                if (t.includes('help') || t.includes('pain') || t.includes("can't breathe")) {
                    triggerEmergency();
                    stopVoice();
                    return;
                }
            }
            transcriptText.textContent = interim || '...';
        };

        recognition.onerror = (e) => console.error('SR error:', e.error);

        recognition.onend = () => {
            if (isListening) recognition.start(); // auto-restart
        };
    } else {
        btnVoice.disabled = true;
        btnVoice.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> Voice API Not Supported';
    }

    function startVoice() {
        if (!recognition) return;
        transcriptText.textContent = '...';
        recognition.start();
    }

    function stopVoice() {
        if (!recognition) return;
        isListening = false;
        recognition.stop();
        voiceStatus.classList.add('hidden');
        btnVoice.innerHTML             = '<i class="fa-solid fa-microphone"></i> Start Voice Detection';
        btnVoice.style.backgroundColor = '';
    }

    function toggleVoice() {
        isListening ? stopVoice() : startVoice();
    }

    // ─── EVENT LISTENERS ─────────────────────────────────────────────────────
    btnSimulate.addEventListener('click',  startInactivityWorkflow);
    btnSafe.addEventListener('click',      handleSafe);
    alertSafeBtn.addEventListener('click', handleSafe);
    btnCancelEmergency.addEventListener('click', () => {
        handleSafe();
        speakPrompt("Emergency cancelled. System reset to safe.");
    });
    btnReset.addEventListener('click',     resetSystem);
    btnVoice.addEventListener('click',     toggleVoice);
});
