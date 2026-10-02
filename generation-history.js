(function (global) {
  'use strict';

  const DATABASE = 'tabhi-ai-generation-history';
  const STORE = 'videos';
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error('Local video history is unavailable in this browser.'));
        return;
      }
      const request = global.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Local video history could not be opened.'));
      request.onblocked = () => reject(new Error('Close another TABHI AI tab to open local video history.'));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function save(record) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(new Error('There is not enough browser storage to save this generation. Delete older videos and try again.'));
      transaction.onabort = () => reject(new Error('There is not enough browser storage to save this generation. Delete older videos and try again.'));
    });
  }

  async function list() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.sort((left, right) => right.createdAt - left.createdAt));
      request.onerror = () => reject(new Error('Local video history could not be loaded.'));
    });
  }

  async function get(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('This saved video could not be opened.'));
    });
  }

  async function remove(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error('This saved video could not be deleted.'));
    });
  }

  async function createThumbnail(blob) {
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = objectUrl;
    try {
      await new Promise((resolve, reject) => {
        const timeout = global.setTimeout(() => reject(new Error('Thumbnail creation timed out.')), 10000);
        video.onloadeddata = () => { global.clearTimeout(timeout); resolve(); };
        video.onerror = () => { global.clearTimeout(timeout); reject(new Error('The generated video preview could not be opened.')); };
      });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 320 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  global.TabhiHistory = { save, list, get, remove, createThumbnail };
})(window);
