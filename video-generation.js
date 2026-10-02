(function (global) {
  'use strict';

  const API = '/api/video-generation';
  const MAX_IMAGE_BYTES = 1024 * 1024;

  async function readResponse(response) {
    let payload;
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) {
      const message = payload.error || (response.status === 404
        ? 'The video generation API route was not found. Deploy the serverless API with the app.'
        : 'The video generation service could not complete this request.');
      const error = new Error(message);
      error.quota = payload.quota;
      error.limitMessage = payload.limitMessage;
      throw error;
    }
    return payload;
  }

  async function getProviderConfig() {
    const response = await fetch(`${API}?action=config`, { cache: 'no-store' });
    return readResponse(response);
  }

  async function createPrediction(payload) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return readResponse(response);
  }

  function generateVideo(prompt, options) {
    return createPrediction({
      mode: 'text',
      prompt,
      aspectRatio: options.aspectRatio,
      duration: Number(options.duration)
    });
  }

  function fileToDataUrl(file) {
    if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type)) {
      return Promise.reject(new Error('Choose a JPG or PNG starting image.'));
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error('Choose an image smaller than 1 MB for secure serverless upload.'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The starting image could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  async function generateVideoFromImage(image, prompt, options) {
    const imageDataUrl = await fileToDataUrl(image);
    return createPrediction({
      mode: 'image',
      prompt,
      imageDataUrl,
      aspectRatio: options.aspectRatio,
      duration: Number(options.duration)
    });
  }

  async function getGenerationStatus(id, signal) {
    const response = await fetch(`${API}?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
    return readResponse(response);
  }

  async function downloadGeneratedVideo(id, signal) {
    const response = await fetch(`${API}?action=download&id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
    if (!response.ok) {
      const payload = await readResponse(response);
      throw new Error(payload.error || 'The generated video could not be downloaded.');
    }
    return response.blob();
  }

  global.TabhiVideoGeneration = {
    getProviderConfig,
    generateVideo,
    generateVideoFromImage,
    getGenerationStatus,
    downloadGeneratedVideo
  };
})(window);
