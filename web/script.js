let audioContext = null;
let analyser = null;
let microphone = null;
let micStream = null;
let isRecording = false;

const WIN_MESSAGES = [
    "AMAZING! YOU NAILED IT!",
    "FANTASTIC! YOU'RE A PRO!",
    "INCREDIBLE! PERFECT PITCH!",
    "VICTORY! YOU FOUND IT!",
    "WOW! YOU ARE A GENIUS!"
];

let targetNumber = Math.floor(Math.random() * 11);
let currentMin = 0;
let currentMax = 10;
let attempts = 0;
const MAX_ATTEMPTS = 10;
let gameOver = false;

let recordedIntPitches = [];
let rollingBuffer = [];
const CONSENSUS_SIZE = 12;
let lastValidTime = 0;
const PERSISTENCE_MS = 350;
const C4_FREQ = 261.63;
const BUFSIZE = 2048;

const toggleBtn = document.getElementById('toggle-btn');
const resetBtn = document.getElementById('reset-btn');
const pitchDisplay = document.getElementById('pitch-value');
const feedbackDisplay = document.getElementById('game-feedback');
const hintDisplay = document.getElementById('hint-range');
const attemptsDisplay = document.getElementById('attempts-display');
const meterBar = document.getElementById('meter-bar');

toggleBtn.addEventListener('click', async () => {
    if (isRecording) {
        stopRecordingAndSubmit();
    }
    else {
        await startRecording();
    }
});

resetBtn.addEventListener('click', resetGame);

function resetGame() {
    targetNumber = Math.floor(Math.random() * 11);
    currentMin = 0;
    currentMax = 10;
    attempts = 0;
    gameOver = false;
    recordedIntPitches = [];
    rollingBuffer = [];
    lastValidTime = 0;

    hintDisplay.innerText = `Range: ${currentMin} - ${currentMax}`;
    feedbackDisplay.innerText = 'Sing to Start!';
    feedbackDisplay.className = 'game-status';
    attemptsDisplay.innerText = `0/${MAX_ATTEMPTS}`;
    pitchDisplay.innerText = '--';
    pitchDisplay.style.color = 'var(--text-primary)';
    meterBar.style.width = '0%';
    meterBar.parentElement.style.borderColor = 'var(--card-border)';
    document.body.style.background = 'var(--bg-color)';
    toggleBtn.disabled = false;
    toggleBtn.innerText = 'Start Mic';
    toggleBtn.classList.remove('recording');
}

async function startRecording() {
    try {
        if (!micStream) {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(micStream);

        analyser.fftSize = BUFSIZE;
        microphone.connect(analyser);

        isRecording = true;
        recordedIntPitches = [];
        rollingBuffer = [];
        toggleBtn.innerText = 'Submit';
        toggleBtn.classList.add('recording');
        feedbackDisplay.innerText = 'Singing...';

        requestAnimationFrame(update);
    }
    catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Could not access microphone.');
    }
}

function stopRecordingAndSubmit() {
    isRecording = false;

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    toggleBtn.innerText = 'Start Mic';
    toggleBtn.classList.remove('recording');

    if (recordedIntPitches.length > 0) {
        const freqMap = {};
        let modeGuess = recordedIntPitches[0];
        let maxFreq = 0;

        recordedIntPitches.forEach(p => {
            freqMap[p] = (freqMap[p] || 0) + 1;
            if (freqMap[p] > maxFreq) {
                maxFreq = freqMap[p];
                modeGuess = p;
            }
        });

        submitGuess(modeGuess);
    }
    else {
        feedbackDisplay.innerText = 'Nothing recorded!';
    }
}

function submitGuess(guess) {
    if (gameOver) {
        return;
    }

    attempts++;
    attemptsDisplay.innerText = `${attempts}/${MAX_ATTEMPTS}`;

    if (guess == targetNumber) {
        gameOver = true;
        const msg = WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)];
        feedbackDisplay.innerText = msg;
        feedbackDisplay.className = 'game-status status-win';

        document.body.style.background =
            'radial-gradient(circle, #064e3b 0%, #0f172a 100%)';
        meterBar.parentElement.style.borderColor = '#10b981';
        pitchDisplay.style.color = '#10b981';
        pitchDisplay.innerText = guess;
        toggleBtn.disabled = true;
        toggleBtn.innerText = 'YOU WON!';
    }
    else {
        if (guess < targetNumber) {
            currentMin = Math.max(currentMin, guess + 1);
            feedbackDisplay.innerText = 'TOO SMALL ⬆️';
            feedbackDisplay.className = 'game-status status-higher';
        }
        else {
            currentMax = Math.min(currentMax, guess - 1);
            feedbackDisplay.innerText = 'TOO BIG ⬇️';
            feedbackDisplay.className = 'game-status status-lower';
        }
        pitchDisplay.innerText = guess;
        hintDisplay.innerText = `Range: ${currentMin} - ${currentMax}`;

        if (attempts >= MAX_ATTEMPTS) {
            gameOver = true;
            feedbackDisplay.innerText = `GAME OVER! Target was ${targetNumber}`;
            feedbackDisplay.className = 'game-status';
            feedbackDisplay.style.color = '#ef4444';
            document.body.style.background =
                'radial-gradient(circle, #450a0a 0%, #0f172a 100%)';
            meterBar.parentElement.style.borderColor = '#ef4444';
            toggleBtn.disabled = true;
            toggleBtn.innerText = 'NO TRIES LEFT';
        }
    }
}

function update() {
    if (!isRecording || !analyser || !audioContext) {
        return;
    }

    const buffer = new Float32Array(BUFSIZE);
    analyser.getFloatTimeDomainData(buffer);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);

    if (rms > 0.01) {
        const freq = autoCorrelate(buffer, audioContext.sampleRate);
        let frameValid = false;

        if (freq !== -1 && freq > 200 && freq < 700) {
            let logVal = 10 * Math.log2(freq / C4_FREQ);
            if (logVal >= -0.5 && logVal <= 10.5) {
                let pitchInt = Math.max(0, Math.min(10, Math.round(logVal)));

                rollingBuffer.push(pitchInt);
                if (rollingBuffer.length > CONSENSUS_SIZE) {
                    rollingBuffer.shift();
                }

                const counts = {};
                let mode = -1;
                let maxC = 0;
                rollingBuffer.forEach(p => {
                    counts[p] = (counts[p] || 0) + 1;
                    if (counts[p] > maxC) {
                        maxC = counts[p];
                        mode = p;
                    }
                });

                if (maxC >= 6) {
                    pitchDisplay.innerText = mode;
                    pitchDisplay.style.color = '#10b981';
                    meterBar.style.width = `${(mode / 10) * 100}%`;
                    recordedIntPitches.push(mode);
                    lastValidTime = Date.now();
                    frameValid = true;
                }
            }
        }

        if (!frameValid) {
            if (Date.now() - lastValidTime > PERSISTENCE_MS) {
                pitchDisplay.innerText = '--';
                pitchDisplay.style.color = 'var(--text-primary)';
                meterBar.style.width = '0%';
            }
        }
    }
    else {
        if (Date.now() - lastValidTime > PERSISTENCE_MS) {
            pitchDisplay.innerText = '--';
            pitchDisplay.style.color = 'var(--text-primary)';
            meterBar.style.width = '0%';
        }
    }

    requestAnimationFrame(update);
}

function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;
    let r1 = 0,
        r2 = SIZE - 1,
        thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buffer[i]) < thres) {
            r1 = i;
            break;
        }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buffer[SIZE - i]) < thres) {
            r2 = SIZE - i;
            break;
        }
    }

    buffer = buffer.slice(r1, r2);
    SIZE = buffer.length;

    const c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buffer[j] * buffer[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1,
        maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }

    let T0 = maxpos;
    let T0_interp = T0;
    if (T0 > 0 && T0 < SIZE - 1) {
        let x1 = c[T0 - 1],
            x2 = c[T0],
            x3 = c[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) {
            T0_interp = T0 - b / (2 * a);
        }
    }

    return sampleRate / T0_interp;
}
