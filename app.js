// ⚠️ ВАЖЛИВО: Замініть на ваш Web App URL з Apps Script
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzuWXSX2UDYY5XQJiITEDVbicGZGhwiJUIX_wm-ZPc1rS4LHviLfVJjmGCthrYz5JSY5A/exec';

// База даних молитов
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
    },
    salmo91: {
        title: 'Salmo 91',
        text: `El que habita al abrigo del Altísimo
morará bajo la sombra del Omnipotente.
Diré yo a Jehová: Esperanza mía, y castillo mío;
Mi Dios, en quien confiaré.

El te librará del lazo del cazador,
De la peste destructora.
Con sus plumas te cubrará,
Y debajo de sus alas estarás seguro;
Escudo y adarga es su verdad.

No temerás el terror nocturno,
Ni saeta que vuele de día,
Ni pestilencia que ande en oscuridad,
Ni mortandad que en medio del día destruya.`
    },
    salmo121: {
        title: 'Salmo 121',
        text: `Alzaré mis ojos a los montes;
¿De dónde vendrá mi socorro?
Mi socorro viene de Jehová,
Que hizo los cielos y la tierra.

No dará tu pie al resbaladero,
Ni se dormirá el que te guarda.
He aquí, no se adormecerá ni dormirá
El que guarda a Israel.`
    }
};

// ==================== IndexedDB для кешування ====================
class AudioCache {
    constructor() {
        this.dbName = 'OracionAudioCache';
        this.storeName = 'audioFiles';
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async saveAudio(id, title, mergedBlob) {
        const base64 = await this.blobToBase64(mergedBlob);
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const data = {
            id: id,
            title: title,
            audioData: base64,
            timestamp: Date.now(),
            size: mergedBlob.size
        };
        
        return new Promise((resolve, reject) => {
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAudio(id) {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteAudio(id) {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAllAudio() {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clearAll() {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}

// ==================== localStorage для молитов ====================
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

// ==================== Склеювання аудіо ====================
async function mergeAudioChunks(audioChunksBase64) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffers = [];
    
    for (const base64Audio of audioChunksBase64) {
        const audioBlob = base64ToBlob(base64Audio, 'audio/wav');
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioBuffers.push(audioBuffer);
    }
    
    const totalLength = audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const numberOfChannels = audioBuffers[0].numberOfChannels;
    const sampleRate = audioBuffers[0].sampleRate;
    
    const mergedBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate);
    
    let offset = 0;
    for (const buffer of audioBuffers) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            mergedBuffer.getChannelData(channel).set(channelData, offset);
        }
        offset += buffer.length;
    }
    
    return audioBufferToWav(mergedBuffer);
}

function audioBufferToWav(buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    
    let result;
    if (numberOfChannels === 2) {
        result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
        result = buffer.getChannelData(0);
    }
    
    const length = result.length * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + result.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * bitDepth / 8, true);
    view.setUint16(32, numberOfChannels * bitDepth / 8, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, result.length * 2, true);
    
    floatTo16BitPCM(view, 44, result);
    
    return new Blob([bufferArray], { type: 'audio/wav' });
}

function interleave(leftChannel, rightChannel) {
    const length = leftChannel.length + rightChannel.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    
    while (index < length) {
        result[index++] = leftChannel[inputIndex];
        result[index++] = rightChannel[inputIndex];
        inputIndex++;
    }
    return result;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(view, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// ==================== Ініціалізація ====================
const audioCache = new AudioCache();
const prayerStorage = new PrayerStorage();

let currentAudio = null;
let currentPrayerId = 'salmo23';
let mergedAudioBlob = null;

// DOM елементи
const prayerSelect = document.getElementById('prayer-select');
const prayerTitle = document.getElementById('prayer-title');
const prayerText = document.getElementById('prayer-text');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const downloadButton = document.getElementById('downloadButton');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const cacheStatus = document.getElementById('cache-status');

const customTitle = document.getElementById('custom-title');
const customText = document.getElementById('custom-text');
const charCount = document.getElementById('char-count');
const addPrayerBtn = document.getElementById('addPrayerBtn');
const clearFormBtn = document.getElementById('clearFormBtn');
const formStatus = document.getElementById('form-status');
const customPrayersContainer = document.getElementById('custom-prayers-container');

const cachedCount = document.getElementById('cached-count');
const cacheSize = document.getElementById('cache-size');
const cacheList = document.getElementById('cache-list');
const clearCacheBtn = document.getElementById('clearCacheBtn');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// ==================== Ініціалізація при завантаженні ====================
document.addEventListener('DOMContentLoaded', async () => {
    await audioCache.init();
    loadPrayerSelect();
    loadPrayer('salmo23');
    updateCustomPrayersList();
    updateCacheInfo();
});

// ==================== Вкладки ====================
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`${tabId}-tab`).classList.add('active');
        
        if (tabId === 'cache') {
            updateCacheInfo();
        }
    });
});

// ==================== Завантаження молитов ====================
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
        checkCache(id);
        downloadButton.style.display = 'none';
        mergedAudioBlob = null;
    }
}

async function checkCache(id) {
    const cached = await audioCache.getAudio(id);
    if (cached) {
        cacheStatus.textContent = `✅ Audio en caché (${new Date(cached.timestamp).toLocaleDateString()})`;
        cacheStatus.classList.add('show');
    } else {
        cacheStatus.classList.remove('show');
    }
}

prayerSelect.addEventListener('change', (e) => {
    loadPrayer(e.target.value);
    stopAudio();
});

// ==================== Відтворення з кешем та склеюванням ====================
playButton.addEventListener('click', async () => {
    const text = prayerText.textContent.trim();
    
    if (!text) {
        statusDiv.textContent = '⚠️ No hay texto para narrar';
        return;
    }
    
    playButton.disabled = true;
    playButton.textContent = '⏳ Cargando...';
    progressContainer.classList.add('active');
    updateProgress(0);
    
    try {
        const cached = await audioCache.getAudio(currentPrayerId);
        
        if (cached) {
            statusDiv.innerHTML = '<span class="loader"></span>Cargando desde caché...';
            const audioBlob = base64ToBlob(cached.audioData, 'audio/wav');
            mergedAudioBlob = audioBlob;
            playMergedAudio(audioBlob);
        } else {
            statusDiv.innerHTML = '<span class="loader"></span>Generando audio...';
            
            const response = await fetch(WEB_APP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });

            const data = await response.json();
            
            if (data.success) {
                statusDiv.textContent = `✅ Fusionando ${data.totalChunks} fragmentos...`;
                updateProgress(50);
                
                const mergedBlob = await mergeAudioChunks(data.audioChunks);
                mergedAudioBlob = mergedBlob;
                
                await audioCache.saveAudio(currentPrayerId, prayerTitle.textContent, mergedBlob);
                statusDiv.textContent = '✅ Audio fusionado y guardado';
                checkCache(currentPrayerId);
                updateProgress(100);
                
                playMergedAudio(mergedBlob);
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        }
        
    } catch (error) {
        console.error('Error:', error);
        statusDiv.textContent = '❌ Error: ' + error.message;
        playButton.disabled = false;
        playButton.textContent = '🔊 Escuchar Oración';
        progressContainer.classList.remove('active');
    }
});

function playMergedAudio(blob) {
    const audioUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(audioUrl);
    
    statusDiv.textContent = '🔊 Reproduciendo...';
    playButton.textContent = '⏸️ Reproduciendo';
    stopButton.style.display = 'block';
    downloadButton.style.display = 'block';
    
    currentAudio.onended = () => {
        statusDiv.textContent = '✅ Reproducción completada';
        playButton.disabled = false;
        playButton.textContent = '🔊 Escuchar Oración';
        stopButton.style.display = 'none';
        progressContainer.classList.remove('active');
        URL.revokeObjectURL(audioUrl);
    };
    
    currentAudio.onerror = () => {
        statusDiv.textContent = '❌ Error al reproducir';
        stopAudio();
    };
    
    currentAudio.play();
    progressContainer.classList.remove('active');
}

stopButton.addEventListener('click', stopAudio);

function stopAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        URL.revokeObjectURL(currentAudio.src);
    }
    statusDiv.textContent = '';
    playButton.disabled = false;
    playButton.textContent = '🔊 Escuchar Oración';
    stopButton.style.display = 'none';
    progressContainer.classList.remove('active');
}

downloadButton.addEventListener('click', () => {
    if (!mergedAudioBlob) {
        statusDiv.textContent = '⚠️ Primero genera el audio';
        return;
    }
    
    const url = URL.createObjectURL(mergedAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prayerTitle.textContent}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    statusDiv.textContent = '✅ Audio descargado';
    setTimeout(() => statusDiv.textContent = '', 3000);
});

function updateProgress(percent) {
    progressBar.style.width = percent + '%';
    progressText.textContent = percent + '%';
}

// ==================== Додавання молитов ====================
customText.addEventListener('input', () => {
    charCount.textContent = `${customText.value.length} caracteres`;
});

addPrayerBtn.addEventListener('click', () => {
    const title = customTitle.value.trim();
    const text = customText.value.trim();
    
    if (!title || !text) {
        formStatus.textContent = '⚠️ Por favor completa todos los campos';
        return;
    }
    
    const id = 'custom_' + Date.now();
    prayerStorage.save(id, title, text);
    
    customTitle.value = '';
    customText.value = '';
    charCount.textContent = '0 caracteres';
    formStatus.textContent = '✅ Oración guardada exitosamente';
    
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
        customPrayersContainer.innerHTML = '<p style="color: #666; text-align: center;">No hay oraciones guardadas</p>';
        return;
    }
    
    Object.keys(customPrayers).forEach(id => {
        const prayer = customPrayers[id];
        const div = document.createElement('div');
        div.className = 'prayer-item';
        div.innerHTML = `
            <span class="prayer-item-title">${prayer.title}</span>
            <div class="prayer-item-actions">
                <button class="btn-small btn-use" onclick="usePrayer('${id}')">📖 Usar</button>
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

window.deletePrayer = async (id) => {
    if (confirm('¿Estás seguro de eliminar esta oración?')) {
        prayerStorage.delete(id);
        await audioCache.deleteAudio(id);
        loadPrayerSelect();
        updateCustomPrayersList();
        updateCacheInfo();
    }
};

// ==================== Управління кешем ====================
async function updateCacheInfo() {
    const allCached = await audioCache.getAllAudio();
    cachedCount.textContent = allCached.length;
    
    const totalSize = allCached.reduce((sum, item) => sum + (item.size || 0), 0);
    cacheSize.textContent = (totalSize / 1024).toFixed(2) + ' KB';
    
    cacheList.innerHTML = '';
    
    if (allCached.length === 0) {
        cacheList.innerHTML = '<p style="text-align: center; color: #666;">No hay audios en caché</p>';
        return;
    }
    
    allCached.forEach(item => {
        const div = document.createElement('div');
        div.className = 'cache-item';
        div.innerHTML = `
            <div class="cache-item-info">
                <div class="cache-item-title">${item.title}</div>
                <div class="cache-item-meta">
                    ${(item.size / 1024).toFixed(2)} KB • ${new Date(item.timestamp).toLocaleString()}
                </div>
            </div>
            <button class="btn-small btn-delete" onclick="deleteCachedAudio('${item.id}')">🗑️ Eliminar</button>
        `;
        cacheList.appendChild(div);
    });
}

window.deleteCachedAudio = async (id) => {
    await audioCache.deleteAudio(id);
    updateCacheInfo();
    checkCache(currentPrayerId);
};

clearCacheBtn.addEventListener('click', async () => {
    if (confirm('¿Estás seguro de eliminar TODOS los audios en caché?')) {
        await audioCache.clearAll();
        updateCacheInfo();
        checkCache(currentPrayerId);
    }
});
