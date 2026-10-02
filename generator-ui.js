(function () {
  'use strict';

  const IMAGE_LIMIT = 1024 * 1024;
  const HISTORY_LIMIT = 5;
  const HISTORY_BYTE_LIMIT = 120 * 1024 * 1024;
  const state = {
    mode: 'text',
    image: null,
    imageUrl: '',
    resultUrl: '',
    controller: null,
    configured: false,
    quotaConfigured: false,
    quotaUsed: 0,
    quotaLimit: 5,
    quotaRemaining: 5,
    quotaMaxDuration: 50,
    providerMaxDuration: 5,
    providerLabel: '',
    busy: false,
    lastRequest: null
  };
  const element = (id) => document.getElementById(id);
  const historyUrls = new Map();

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('[data-generation-mode]').forEach((button) => {
      const active = button.dataset.generationMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    element('generation-image-zone').hidden = mode !== 'image';
    element('generation-ratio').disabled = mode === 'image' || state.busy;
    element('generation-ratio-note').hidden = mode !== 'image';
    updateGenerateButton();
  }

  function updateGenerateButton() {
    const promptReady = element('generation-prompt').value.trim().length >= 3;
    const imageReady = state.mode !== 'image' || Boolean(state.image);
    element('generate-video').disabled = !state.configured || !state.quotaConfigured || state.quotaRemaining <= 0 || state.busy || !promptReady || !imageReady;
  }

  function updateQuota(quota, broadcast) {
    if (!quota || !Number.isFinite(Number(quota.limit)) || !Number.isFinite(Number(quota.remaining))) return;
    state.quotaLimit = Math.max(0, Number(quota.limit));
    state.quotaRemaining = Math.max(0, Math.min(state.quotaLimit, Number(quota.remaining)));
    state.quotaUsed = Math.max(0, Number(quota.used) || state.quotaLimit - state.quotaRemaining);
    state.quotaMaxDuration = Math.max(1, Number(quota.maxDuration) || 50);
    element('free-video-count').textContent = `AI Videos: ${state.quotaRemaining} / ${state.quotaLimit} remaining`;
    element('free-video-duration').textContent = `Maximum duration: ${state.quotaMaxDuration} seconds`;
    element('free-limit-title').textContent = `Your ${state.quotaLimit} free AI video generations have been used.`;
    element('free-limit-detail').textContent = `Free limit: ${state.quotaLimit} videos × up to ${state.quotaMaxDuration} seconds.`;
    element('free-limit-message').hidden = state.quotaRemaining > 0;
    if (state.configured && state.quotaConfigured) {
      const status = element('provider-status');
      status.textContent = state.quotaRemaining === 0 ? `All ${state.quotaLimit} free generations used.` : state.providerLabel;
      status.classList.toggle('is-error', state.quotaRemaining === 0);
    }
    if (broadcast && state.quotaChannel) state.quotaChannel.postMessage({ quota });
    updateGenerateButton();
  }

  async function checkProvider() {
    const status = element('provider-status');
    try {
      const config = await window.TabhiVideoGeneration.getProviderConfig();
      state.configured = Boolean(config.configured);
      state.quotaConfigured = Boolean(config.quotaConfigured);
      state.providerMaxDuration = Math.min(50, Math.max(1, Number(config.quota && config.quota.providerMaxDuration) || 5));
      Array.from(element('generation-duration').options).forEach((option) => {
        option.disabled = Number(option.value) > state.providerMaxDuration;
      });
      if (Number(element('generation-duration').value) > state.providerMaxDuration) element('generation-duration').value = '5';
      element('provider-duration-note').textContent = `Provider maximum: ${state.providerMaxDuration} seconds per generation. Plan maximum: ${state.quotaMaxDuration} seconds.`;
      state.providerLabel = `${config.provider || 'Video provider'} selected · ${config.model || 'model not set'}`;
      if (config.quota) updateQuota(config.quota, true);
      if (!state.quotaConfigured) {
        status.textContent = [config.providerMessage, config.quotaMessage || config.message].filter(Boolean).join(' ')
          || 'Server-side free-generation storage is not configured.';
      } else if (!state.configured) {
        status.textContent = config.providerMessage || config.message || 'AI generation is temporarily unavailable. Please try again later.';
      } else if (state.quotaRemaining === 0) {
        status.textContent = `All ${state.quotaLimit} free generations used.`;
      } else {
        status.textContent = `${state.providerLabel}. Endpoint connectivity will be checked when you generate.`;
      }
      status.classList.toggle('is-error', !state.configured || !state.quotaConfigured || state.quotaRemaining === 0);
    } catch (error) {
      state.configured = false;
      status.textContent = error && error.message && error.message.includes('API route was not found')
        ? error.message
        : 'Generation API is unreachable. Start the app with `npm run dev` and check the server-side provider setup.';
      status.classList.add('is-error');
    }
    updateGenerateButton();
  }

  function synchronizeQuota() {
    if (!state.quotaChannel) return;
    state.quotaChannel.postMessage({ quota: {
      used: state.quotaUsed,
      remaining: state.quotaRemaining,
      limit: state.quotaLimit,
      maxDuration: state.quotaMaxDuration
    } });
  }

  function setImage(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showError('Choose a JPG or PNG starting image.');
      return;
    }
    if (file.size > IMAGE_LIMIT) {
      showError('Choose an image smaller than 1 MB for secure serverless upload.');
      return;
    }
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.image = file;
    state.imageUrl = URL.createObjectURL(file);
    element('generation-image-preview').src = state.imageUrl;
    element('generation-image-preview').hidden = false;
    element('generation-image-label').textContent = file.name;
    element('remove-generation-image').hidden = false;
    element('generation-image').value = '';
    updateGenerateButton();
  }

  function removeImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = '';
    state.image = null;
    element('generation-image-preview').removeAttribute('src');
    element('generation-image-preview').hidden = true;
    element('generation-image-label').textContent = 'Choose a starting image';
    element('remove-generation-image').hidden = true;
    updateGenerateButton();
  }

  function showError(message) {
    const box = element('generation-error');
    box.textContent = message;
    box.hidden = false;
  }

  function showLimitError(message, limitMessage) {
    const box = element('generation-error');
    box.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = message;
    box.append(heading);
    if (limitMessage) {
      const detail = document.createElement('span');
      detail.textContent = limitMessage;
      box.append(document.createElement('br'), detail);
    }
    box.hidden = false;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll('#generation-form input, #generation-form select, #generation-form textarea, #generation-form button, .generator-mode, #remove-generation-image').forEach((control) => {
      control.disabled = busy;
    });
    element('generation-ratio').disabled = busy || state.mode === 'image';
    element('generation-progress').hidden = !busy;
    if (!busy) element('generation-progress-bar').removeAttribute('value');
    updateGenerateButton();
  }

  function updateProgress(status) {
    const statusText = {
      starting: 'Waiting for provider capacity…',
      processing: 'Generating video with the AI provider…',
      succeeded: 'Retrieving your generated video…'
    };
    element('generation-status').textContent = statusText[status] || 'Submitting request…';
    element('generation-progress-detail').textContent = status === 'processing'
      ? 'Rendering is running on the provider. The prompt and image are not processed locally.'
      : 'Waiting for the provider response. Keep this tab open.';
  }

  function sleep(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, milliseconds);
      if (signal) signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        reject(new DOMException('Generation canceled.', 'AbortError'));
      }, { once: true });
    });
  }

  function makeRecordId() {
    return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `tabhi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function saveGeneration(record) {
    if (record.blob.size > HISTORY_BYTE_LIMIT) {
      throw new Error('This video is too large to retain in browser history. Download it before leaving this page.');
    }
    record.thumbnail = await window.TabhiHistory.createThumbnail(record.blob);
    await window.TabhiHistory.save(record);
    let records = await window.TabhiHistory.list();
    let totalBytes = records.reduce((total, entry) => total + entry.blob.size, 0);
    while (records.length > HISTORY_LIMIT || totalBytes > HISTORY_BYTE_LIMIT) {
      const oldRecord = records.pop();
      if (!oldRecord) break;
      totalBytes -= oldRecord.blob.size;
      await window.TabhiHistory.remove(oldRecord.id);
    }
    await renderHistory();
  }

  function showRecord(record) {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(record.blob);
    element('generated-video').src = state.resultUrl;
    element('download-generated-video').href = state.resultUrl;
    element('download-generated-video').download = `TABHI_AI_Generated_${record.createdAt}.mp4`;
    element('generation-result').hidden = false;
    state.currentRecord = record;
  }

  async function pollPrediction(predictionId, signal) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const prediction = await window.TabhiVideoGeneration.getGenerationStatus(predictionId, signal);
      if (prediction.quota) updateQuota(prediction.quota, true);
      updateProgress(prediction.status);
      if (prediction.status === 'succeeded') return prediction;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(prediction.error || 'The provider could not generate this video. Adjust the prompt and try again.');
      }
      await sleep(1800, signal);
    }
    throw new Error('Generation timed out. AI generation is temporarily unavailable. Please try again later.');
  }

  async function runGeneration(request) {
    if (state.busy || !state.configured) return;
    if (request.mode === 'image' && !request.image) {
      showError('Choose a starting image for image-to-video.');
      return;
    }
    state.lastRequest = request;
    state.controller = new AbortController();
    setBusy(true);
    element('generation-error').hidden = true;
    element('generation-result').hidden = true;
    updateProgress('starting');
    try {
      const prediction = request.mode === 'image'
        ? await window.TabhiVideoGeneration.generateVideoFromImage(request.image, request.prompt, request)
        : await window.TabhiVideoGeneration.generateVideo(request.prompt, request);
      if (prediction.quota) updateQuota(prediction.quota, true);
      const predictionId = prediction.id;
      if (!predictionId) throw new Error('The provider did not return a generation ID. Check the provider dashboard before retrying.');
      await pollPrediction(predictionId, state.controller.signal);
      updateProgress('succeeded');
      const blob = await window.TabhiVideoGeneration.downloadGeneratedVideo(predictionId, state.controller.signal);
      if (!blob.size || !(blob.type.startsWith('video/') || blob.type === 'application/octet-stream')) {
        throw new Error('The provider returned an unsupported video format.');
      }
      const record = {
        id: makeRecordId(),
        blob,
        thumbnail: '',
        prompt: request.prompt,
        mode: request.mode,
        aspectRatio: request.aspectRatio,
        duration: Number(request.duration),
        createdAt: Date.now()
      };
      showRecord(record);
      element('generation-status').textContent = 'Complete';
      try {
        await saveGeneration(record);
        element('generation-progress-detail').textContent = 'Saved in this browser. The original provider URL may expire, but this local copy remains until deleted.';
      } catch (error) {
        element('generation-error').textContent = `Your video is ready, but local history could not save it. Download it before leaving this page. ${error.message}`;
        element('generation-error').hidden = false;
      }
    } catch (error) {
      if (error.quota) updateQuota(error.quota, true);
      if (error.name !== 'AbortError') {
        if (error.limitMessage) showLimitError(error.message, error.limitMessage);
        else showError(error instanceof Error ? error.message : 'Video generation failed. Please try again.');
      }
    } finally {
      state.controller = null;
      setBusy(false);
      if (element('generation-result').hidden) element('generation-progress').hidden = true;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const request = {
      mode: state.mode,
      prompt: element('generation-prompt').value.trim(),
      aspectRatio: element('generation-ratio').value,
      duration: element('generation-duration').value,
      image: state.image
    };
    await runGeneration(request);
  }

  async function renderHistory() {
    const container = element('generation-history');
    historyUrls.forEach((url) => URL.revokeObjectURL(url));
    historyUrls.clear();
    container.replaceChildren();
    try {
      const records = await window.TabhiHistory.list();
      element('history-count').textContent = `${records.length} saved`;
      if (!records.length) {
        const empty = document.createElement('p');
        empty.className = 'history-empty';
        empty.textContent = 'Your generated videos will appear here.';
        container.append(empty);
        return;
      }
      records.forEach((record) => {
        const card = document.createElement('article');
        card.className = 'history-item';
        const thumbnail = document.createElement('img');
        thumbnail.className = 'history-thumb';
        thumbnail.src = record.thumbnail;
        thumbnail.alt = '';
        const body = document.createElement('div');
        body.className = 'history-item-body';
        const prompt = document.createElement('p');
        prompt.className = 'history-item-prompt';
        prompt.textContent = record.prompt;
        const metadata = document.createElement('div');
        metadata.className = 'history-item-meta';
        metadata.textContent = `${new Date(record.createdAt).toLocaleString()} · ${record.duration}s · ${record.aspectRatio}`;
        const actions = document.createElement('div');
        actions.className = 'history-item-actions';
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.dataset.historyAction = 'preview';
        preview.dataset.historyId = record.id;
        preview.textContent = 'Preview';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.dataset.historyAction = 'edit';
        edit.dataset.historyId = record.id;
        edit.textContent = 'Edit';
        const download = document.createElement('a');
        const downloadUrl = URL.createObjectURL(record.blob);
        historyUrls.set(`${record.id}-download`, downloadUrl);
        download.href = downloadUrl;
        download.download = `TABHI_AI_Generated_${record.createdAt}.mp4`;
        download.textContent = 'Download';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'history-delete';
        remove.dataset.historyAction = 'delete';
        remove.dataset.historyId = record.id;
        remove.textContent = 'Delete';
        actions.append(preview, edit, download, remove);
        body.append(prompt, metadata, actions);
        card.append(thumbnail, body);
        container.append(card);
      });
    } catch (error) {
      element('history-count').textContent = 'Unavailable';
      const note = document.createElement('p');
      note.className = 'history-empty';
      note.textContent = error.message;
      container.append(note);
    }
  }

  async function historyAction(event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const id = button.dataset.historyId;
    try {
      const record = await window.TabhiHistory.get(id);
      if (!record) return;
      if (button.dataset.historyAction === 'preview') {
        showRecord(record);
        element('generation-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (button.dataset.historyAction === 'edit') {
        const file = new File([record.blob], `TABHI_AI_Generated_${record.createdAt}.mp4`, { type: 'video/mp4' });
        window.TabhiEditor.importGeneratedVideo(file);
      } else if (button.dataset.historyAction === 'delete') {
        await window.TabhiHistory.remove(id);
        if (state.currentRecord && state.currentRecord.id === id) {
          element('generated-video').pause();
          element('generated-video').removeAttribute('src');
          element('generated-video').load();
          element('generation-result').hidden = true;
          if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
          state.resultUrl = '';
        }
        await renderHistory();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  function repeatLast() {
    const request = state.lastRequest;
    if (!request) return;
    setMode(request.mode);
    element('generation-prompt').value = request.prompt;
    element('generation-ratio').value = request.aspectRatio;
    element('generation-duration').value = request.duration;
    if (request.mode === 'image' && request.image) setImage(request.image);
    updatePromptCount();
    updateGenerateButton();
    element('ai-generator').scrollIntoView({ behavior: 'smooth', block: 'start' });
    element('generation-prompt').focus({ preventScroll: true });
  }

  function updatePromptCount() {
    element('prompt-count').textContent = `${element('generation-prompt').value.length} / 1200`;
    updateGenerateButton();
  }

  document.querySelectorAll('[data-generation-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.generationMode)));
  element('generation-prompt').addEventListener('input', updatePromptCount);
  element('generation-form').addEventListener('submit', handleSubmit);
  element('generation-image').addEventListener('change', () => setImage(element('generation-image').files[0]));
  element('remove-generation-image').addEventListener('click', removeImage);
  element('image-drop-zone').addEventListener('dragover', (event) => {
    event.preventDefault();
    element('image-drop-zone').classList.add('is-dragging');
  });
  element('image-drop-zone').addEventListener('dragleave', () => element('image-drop-zone').classList.remove('is-dragging'));
  element('image-drop-zone').addEventListener('drop', (event) => {
    event.preventDefault();
    element('image-drop-zone').classList.remove('is-dragging');
    setImage(event.dataTransfer && event.dataTransfer.files[0]);
  });
  element('generate-again').addEventListener('click', repeatLast);
  element('regenerate-video').addEventListener('click', repeatLast);
  element('edit-generated-video').addEventListener('click', () => {
    if (!state.currentRecord) return;
    const record = state.currentRecord;
    const file = new File([record.blob], `TABHI_AI_Generated_${record.createdAt}.mp4`, { type: 'video/mp4' });
    window.TabhiEditor.importGeneratedVideo(file);
  });
  element('generation-history').addEventListener('click', historyAction);
  if ('BroadcastChannel' in window) {
    state.quotaChannel = new BroadcastChannel('tabhi-free-quota-v1');
    state.quotaChannel.addEventListener('message', (event) => updateQuota(event.data && event.data.quota, false));
  }
  window.addEventListener('focus', async () => {
    await checkProvider();
    synchronizeQuota();
  });
  window.addEventListener('beforeunload', () => {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    historyUrls.forEach((url) => URL.revokeObjectURL(url));
    if (state.quotaChannel) state.quotaChannel.close();
    if (state.controller) state.controller.abort();
  });

  setMode('text');
  updatePromptCount();
  renderHistory();
  checkProvider();
})();
