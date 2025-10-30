const WEB_APP_URL = 'https://tts-proxy.nokuchishimo.workers.dev/';

const DEFAULT_PRAYERS = {
    salmo23: {
        title: 'Salmo 23',
        text: `El Señor es mi pastor, nada me falta;
en verdes praderas me hace recostar.

Me conduce hacia fuentes tranquilas
y repara mis fuerzas;
me guía por el sendero justo,
por el honor de su nombre.

Aunque camine por cañadas oscuras,
nada temo, porque tú vas conmigo:
tu vara y tu cayado me sosiegan.

Preparas una mesa ante mí,
enfrente de mis enemigos;
me unges la cabeza con perfume,
y mi copa rebosa.

Tu bondad y tu misericordia me acompañan
todos los días de mi vida,
y habitaré en la casa del Señor
por años sin término.`
    }
};

class PrayerStorage {
    constructor() {
        this.storageKey = 'customPrayers';
    }
    getAll() {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : {};
    }
    save(id, title, text) {
        const prayers = this.getAll();
        prayers[id] = { title, text };
        localStorage.setItem(this.storageKey, JSON.stringify(prayers));
    }
    delete(id) {
        const prayers = this.getAll();
        delete prayers[id];
        localStorage.setItem(this.storageKey, JSON.stringify(prayers));
    }
    getAllCombined() {
        return { ...DEFAULT_PRAYERS, ...this.getAll() };
    }
}

const prayerStorage = new PrayerStorage();
let currentAudio = null;
let currentPrayerId = 'salmo23';
let audioQueue = [];
let currentChunkIndex = 0;
let isPlaying = false;

const prayerSelect = document.getElementById('prayer-select');
const prayerTitle = document.getElementById('prayer-title');
const prayerText = document.getElementById('prayer-text');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

const customTitle = document.getElementById('custom-title');
const customText = document.getElementById('custom-text');
const charCount = document.getElementById('char-count');
const addPrayerBtn = document.getElementById('addPrayerBtn');
const clearFormBtn = document.getElementById('clearFormBtn');
const formStatus = document.getElementById('form-status');
const customPrayersContainer = document.getElementById('custom-prayers-container');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

document.addEventListener('DOMContentLoaded', () => {
    loadPrayerSelect();
    loadPrayer('salmo23');
    updateCustomPrayersList();
});

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${tabId}-tab`).classList.add('active');
    });
});

function loadPrayerSelect() {
    const allPrayers = prayerStorage.getAllCombined();
    prayerSelect.innerHTML = '';
    Object.keys(allPrayers).forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = allPrayers[id].title;
        prayerSelect.appendChild(option);
    });
}

function loadPrayer(id) {
    const allPrayers = prayerStorage.getAllCombined();
    const prayer = allPrayers[id];
    if (prayer) {
        currentPrayerId = id;
        prayerTitle.textContent = prayer.title;
        prayerText.textContent = prayer.text;
    }
}

prayerSelect.addEventListener('change', (e) => {
    loadPrayer(e.target.value);
    stopAudio();
});

playButton.addEventListener('click', async () => {
    if (isPlaying) {
        stopAudio();
        return;
    }

    const text = prayerText.textContent.trim();
    
    if (!text) {
        statusDiv.textContent = '⚠️ No hay texto para narrar';
        return;
    }
    
    playButton.disabled = true;
    playButton.textContent = '⏳ Generando...';
    progressContainer.classList.add('active');
    updateProgress(0);
    
    try {
        statusDiv.innerHTML = '<span class="loader"></span> Enviando al servidor...';
        
        const response = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Respuesta del servidor:', data);
        
        // Buscar audioChunks en diferentes posiciones
        let chunks = data.audioChunks || data.chunks || data.audio || [];
        
        if (!Array.isArray(chunks) || chunks.length === 0) {
            throw new Error('El servidor no devolvió audio válido');
        }
        
        audioQueue = chunks;
        currentChunkIndex = 0;
        isPlaying = true;
        
        statusDiv.textContent = `✅ Reproduciendo ${chunks.length} fragmentos...`;
        playButton.textContent = '⏸️ Pausar';
        playButton.disabled = false;
        stopButton.style.display = 'block';
        
        playNextChunk();
        
    } catch (error) {
        console.error('Error completo:', error);
        statusDiv.textContent = '❌ Error: ' + error.message;
        playButton.disabled = false;
        playButton.textContent = '🔊 Escuchar';
        progressContainer.classList.remove('active');
        isPlaying = false;
    }
});

function playNextChunk() {
    if (!isPlaying || currentChunkIndex >= audioQueue.length) {
        if (currentChunkIndex >= audioQueue.length) {
            statusDiv.textContent = '✅ ¡Listo!';
            playButton.textContent = '🔊 Escuchar';
            stopButton.style.display = 'none';
            progressContainer.classList.remove('active');
            isPlaying = false;
        }
        return;
    }
    
    try {
        const base64Audio = audioQueue[currentChunkIndex];
        const audioDataUrl = `data:audio/mpeg;base64,${base64Audio}`;
        
        currentAudio = new Audio(audioDataUrl);
        
        const progress = Math.round(((currentChunkIndex + 1) / audioQueue.length) * 100);
        updateProgress(progress);
        statusDiv.textContent = `▶️ Fragmento ${currentChunkIndex + 1}/${audioQueue.length}`;
        
        currentAudio.onended = () => {
            currentChunkIndex++;
            playNextChunk();
        };
        
        currentAudio.onerror = (e) => {
            console.error('Error de audio:', e);
            statusDiv.textContent = '❌ Error en fragmento ' + (currentChunkIndex + 1);
            stopAudio();
        };
        
        currentAudio.play().catch(err => {
            console.error('Error al reproducir:', err);
            statusDiv.textContent = '❌ Error al reproducir';
            stopAudio();
        });
        
    } catch (error) {
        console.error('Error procesando chunk:', error);
        statusDiv.textContent = '❌ Error: ' + error.message;
        stopAudio();
    }
}

stopButton.addEventListener('click', stopAudio);

function stopAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    audioQueue = [];
    currentChunkIndex = 0;
    isPlaying = false;
    statusDiv.textContent = '';
    playButton.disabled = false;
    playButton.textContent = '🔊 Escuchar';
    stopButton.style.display = 'none';
    progressContainer.classList.remove('active');
}

function updateProgress(percent) {
    progressBar.style.width = percent + '%';
    progressText.textContent = percent + '%';
}

customText.addEventListener('input', () => {
    charCount.textContent = `${customText.value.length} caracteres`;
});

addPrayerBtn.addEventListener('click', () => {
    const title = customTitle.value.trim();
    const text = customText.value.trim();
    
    if (!title || !text) {
        formStatus.textContent = '⚠️ Completa todos los campos';
        return;
    }
    
    const id = 'custom_' + Date.now();
    prayerStorage.save(id, title, text);
    
    customTitle.value = '';
    customText.value = '';
    charCount.textContent = '0 caracteres';
    formStatus.textContent = '✅ ¡Guardado!';
    
    loadPrayerSelect();
    updateCustomPrayersList();
    
    setTimeout(() => formStatus.textContent = '', 3000);
});

clearFormBtn.addEventListener('click', () => {
    customTitle.value = '';
    customText.value = '';
    charCount.textContent = '0 caracteres';
});

function updateCustomPrayersList() {
    const customPrayers = prayerStorage.getAll();
    customPrayersContainer.innerHTML = '';
    
    if (Object.keys(customPrayers).length === 0) {
        customPrayersContainer.innerHTML = '<p style="color: #666; text-align: center;">Sin oraciones guardadas</p>';
        return;
    }
    
    Object.keys(customPrayers).forEach(id => {
        const prayer = customPrayers[id];
        const div = document.createElement('div');
        div.className = 'prayer-item';
        div.innerHTML = `
            <span class="prayer-item-title">${prayer.title}</span>
            <div class="prayer-item-actions">
                <button class="btn-small btn-use" onclick="usePrayer('${id}')">Usar</button>
                <button class="btn-small btn-delete" onclick="deletePrayer('${id}')">🗑️</button>
            </div>
        `;
        customPrayersContainer.appendChild(div);
    });
}

window.usePrayer = (id) => {
    prayerSelect.value = id;
    loadPrayer(id);
    tabButtons[0].click();
};

window.deletePrayer = (id) => {
    if (confirm('¿Eliminar?')) {
        prayerStorage.delete(id);
        loadPrayerSelect();
        updateCustomPrayersList();
    }
};
