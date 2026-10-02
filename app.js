(function () {
  'use strict';

  const MAX_FILE_SIZE = 512 * 1024 * 1024;
  const element = (id) => document.getElementById(id);
  const state = { video: null, music: null, videoUrl: '', musicUrl: '', downloadUrl: '', duration: 0, durationMode: 'preset', presetDuration: 25, durationNotice: '', busy: false, toastTimer: 0 };

  const videoInput = element('video-file');
  const audioInput = element('audio-file');
  const video = element('preview-video');
  const backgroundVideo = element('preview-video-bg');
  const audio = element('audio-preview');
  const stage = element('preview-stage');
  const caption = element('preview-caption');
  const dropZone = element('drop-zone');
  const exportButton = element('export-button');
  const downloadButton = element('download-button');

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const wholeSeconds = Math.floor(safeSeconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    const tenths = Math.floor((safeSeconds - wholeSeconds) * 10);
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}.${tenths}`;
  }

  function parseClipTime(value) {
    const text = String(value || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const parts = text.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}(?:\.\d+)?$/.test(parts[1])) {
      const seconds = Number(parts[1]);
      return seconds < 60 ? Number(parts[0]) * 60 + seconds : NaN;
    }
    if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}(?:\.\d+)?$/.test(parts[2])) {
      const minutes = Number(parts[1]);
      const seconds = Number(parts[2]);
      return minutes < 60 && seconds < 60 ? Number(parts[0]) * 3600 + minutes * 60 + seconds : NaN;
    }
    return NaN;
  }

  function formatClipInput(seconds) {
    const safeSeconds = Math.max(0, Math.floor((Number(seconds) || 0) * 100) / 100);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds - minutes * 60;
    const [wholeSeconds, fraction] = remainder.toFixed(2).replace(/\.?0+$/, '').split('.');
    const secondText = `${wholeSeconds.padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
    return `${String(minutes).padStart(2, '0')}:${secondText}`;
  }

  function describeDuration(seconds) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} seconds`;
  }

  function getSelectedQuality() {
    return document.querySelector('input[name="export-quality"]:checked').value;
  }

  function getClipRange() {
    if (state.durationMode === 'preset') {
      return { start: 0, end: state.duration ? Math.min(state.presetDuration, state.duration) : state.presetDuration };
    }
    return { start: parseClipTime(element('clip-start').value), end: parseClipTime(element('clip-end').value) };
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function showToast(message) {
    const toast = element('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2900);
  }

  function setProjectStatus(message, ready) {
    const status = element('project-status');
    status.textContent = message;
    status.classList.toggle('is-ready', Boolean(ready));
  }

  function setExportAvailability() {
    const hasEditableVideo = Boolean(
      state.video && video.readyState >= 1 && Number.isFinite(video.duration) && video.videoWidth > 0 && video.videoHeight > 0
    );
    exportButton.disabled = !hasEditableVideo || state.busy;
  }

  function validateVideoFile(file) {
    const extension = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
    const allowed = ['mp4', 'webm', 'mov', 'm4v'];
    if (!allowed.includes(String(extension || '').toLowerCase())) {
      showToast('Choose an MP4, WebM, or MOV video file.');
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast('This video is too large for your browser to process reliably. Try a smaller file.');
      return false;
    }
    return true;
  }

  function setVideoLinkMessage(message, isError) {
    const status = element('video-url-message');
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(isError));
  }

  function isKnownVideoPage(hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return ['youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'fb.watch', 'tiktok.com', 'vimeo.com']
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  }

  function getYouTubeVideoId(rawValue) {
    let url;
    try { url = new URL(rawValue); } catch (_) { return ''; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) return '';
    const shortLink = host === 'youtu.be' ? url.pathname.match(/^\/([A-Za-z0-9_-]{11})(?:\/|$)/) : null;
    const routeLink = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    const watchLink = /^\/watch\/?$/.test(url.pathname) ? url.searchParams.get('v') || '' : '';
    const videoId = shortLink ? shortLink[1] : routeLink ? routeLink[1] : watchLink;
    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : '';
  }

  function validateYouTubeImport(rawValue) {
    const status = element('youtube-url-message');
    const preview = element('youtube-preview');
    const previewWrap = element('youtube-preview-wrap');
    const openLink = element('youtube-open-link');
    const videoId = getYouTubeVideoId(rawValue);
    if (!videoId) {
      preview.removeAttribute('src');
      previewWrap.hidden = true;
      openLink.removeAttribute('href');
      openLink.hidden = true;
      status.textContent = 'Paste a valid YouTube video URL. Direct MP4/WebM/MOV links belong in Paste Video Link above.';
      status.classList.add('is-error');
      return;
    }
    preview.src = `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0`;
    previewWrap.hidden = false;
    openLink.href = `https://www.youtube.com/watch?v=${videoId}`;
    openLink.hidden = false;
    status.textContent = 'YouTube preview only. This embedded player is not an editable video file and cannot be exported in the browser. Upload a local video or load a direct MP4, WebM, or MOV link above to edit and export.';
    status.classList.remove('is-error');
  }

  function videoExtension(pathname) {
    const extension = (pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
    return ['mp4', 'webm', 'mov', 'm4v'].includes(String(extension || '').toLowerCase())
      ? String(extension).toLowerCase()
      : '';
  }

  async function readVideoResponse(response, extension, signal) {
    if (!response.ok) throw new Error('The video link could not be loaded. Check that it is public and try again.');
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      throw new Error('This link is not a directly playable video URL.');
    }

    const mimeExtensions = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v' };
    const mimeExtension = mimeExtensions[contentType] || '';
    if (contentType.startsWith('video/') && !mimeExtension) {
      throw new Error('This video format is not supported. Use MP4, WebM, or MOV.');
    }
    const responseExtension = videoExtension(new URL(response.url).pathname);
    const fileExtension = mimeExtension || responseExtension || extension;
    if (!fileExtension || (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream')) {
      throw new Error('This link is not a directly playable video URL.');
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_FILE_SIZE) throw new Error('This video is too large for your browser to process reliably. Try a smaller file.');
    const chunks = [];
    let size = 0;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          if (signal.aborted) throw new DOMException('The video link load timed out.', 'AbortError');
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_FILE_SIZE) {
            await reader.cancel();
            throw new Error('This video is too large for your browser to process reliably. Try a smaller file.');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      const blob = await response.blob();
      size = blob.size;
      if (size > MAX_FILE_SIZE) throw new Error('This video is too large for your browser to process reliably. Try a smaller file.');
      chunks.push(blob);
    }

    if (!size) throw new Error('The video link returned an empty file.');
    const pathname = new URL(response.url).pathname;
    let name = decodeURIComponent(pathname.split('/').pop() || 'video').replace(/[\\/:*?"<>|]/g, '_');
    if (videoExtension(name) !== fileExtension) name = `${name.replace(/\.[^.]*$/, '') || 'video'}.${fileExtension}`;
    const type = contentType.startsWith('video/') ? contentType : (mimeExtensions && Object.keys(mimeExtensions).find((mime) => mimeExtensions[mime] === fileExtension)) || 'video/mp4';
    return new File(chunks, name, { type });
  }

  async function importVideoLink(rawValue) {
    let url;
    try {
      url = new URL(rawValue);
    } catch (_) {
      setVideoLinkMessage('Enter a valid video URL.', true);
      return;
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      setVideoLinkMessage('Enter a valid HTTP or HTTPS video URL without sign-in details.', true);
      return;
    }
    const extension = videoExtension(url.pathname);
    if (isKnownVideoPage(url.hostname) && !extension) {
      setVideoLinkMessage('This link is not a directly playable video URL.', true);
      return;
    }

    const button = element('load-video-url');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000);
    button.disabled = true;
    setVideoLinkMessage('Loading video into this browser…', false);
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', signal: controller.signal });
      const file = await readVideoResponse(response, extension, controller.signal);
      if (acceptVideo(file)) setVideoLinkMessage('Video loaded. Editing stays in your browser.', false);
    } catch (error) {
      if (error.message === 'This link is not a directly playable video URL.' || error.message.includes('too large') || error.message.includes('not supported') || error.message.includes('empty file')) {
        setVideoLinkMessage(error.message, true);
      } else if (error.name === 'AbortError') {
        setVideoLinkMessage('Loading took too long. Check the link and try again.', true);
      } else {
        setVideoLinkMessage('Could not access this video. The host may block browser access (CORS), or the link may be unavailable.', true);
      }
    } finally {
      window.clearTimeout(timeout);
      button.disabled = false;
    }
  }

  function resetExport() {
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = '';
    downloadButton.removeAttribute('href');
    downloadButton.hidden = true;
    element('export-progress').hidden = true;
    element('export-error').hidden = true;
    element('export-button-label').textContent = 'Export Short';
  }

  function updateClipDisplay() {
    const { start, end } = getClipRange();
    const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
    const duration = valid ? end - start : 0;
    const durationLabel = valid ? describeDuration(duration) : 'Enter a valid range';
    element('clip-duration-label').textContent = durationLabel;
    element('summary-duration').textContent = durationLabel;
    if (state.durationMode === 'preset' && state.duration && state.presetDuration > state.duration + 0.001) {
      element('duration-source-note').textContent = `This source is ${describeDuration(state.duration)}; the selected length is limited to the available video.`;
      element('duration-source-note').hidden = false;
    } else if (state.durationMode === 'custom' && state.duration && Number.isFinite(end) && end > state.duration + 0.001) {
      element('duration-source-note').textContent = `End time cannot exceed the source duration of ${formatClipInput(state.duration)}.`;
      element('duration-source-note').hidden = false;
    } else if (state.durationNotice) {
      element('duration-source-note').textContent = state.durationNotice;
      element('duration-source-note').hidden = false;
    } else {
      element('duration-source-note').hidden = true;
    }
    element('timeline-range-text').textContent = valid ? `${formatTime(start)} — ${formatTime(end)}` : 'Check the selected range';
    element('preview-total').textContent = formatTime(duration);
    const seek = element('timeline-seek');
    seek.min = '0';
    seek.max = String(Math.max(0.1, duration));
    seek.value = String(Math.min(Number(seek.value) || 0, duration));
    if (valid && video.readyState >= 1 && (video.currentTime < start || video.currentTime > end)) {
      video.currentTime = start;
      backgroundVideo.currentTime = start;
    }
    if (valid) syncPreviewTime();
    updateExportSummary(start, duration, valid);
  }

  function updateExportSummary(start, duration, rangeValid) {
    const quality = getSelectedQuality();
    const label = quality[0].toUpperCase() + quality.slice(1);
    element('summary-quality').textContent = label;
    element('maximum-quality-warning').hidden = quality !== 'maximum';
    if (!rangeValid) return;
    const fitStyle = document.querySelector('input[name="fit-style"]:checked').value;
    const dimensions = window.TabhiFFmpeg.getOutputDimensions(video.videoWidth, video.videoHeight, element('aspect-ratio').value, fitStyle, quality);
    element('summary-resolution').textContent = `${dimensions.width} × ${dimensions.height}`;
    element('resolution-note').textContent = dimensions.sourceLimited
      ? 'Source-limited dimensions. The export preserves available detail and does not create native 1080p quality.'
      : 'Output is capped for browser performance; export cannot add detail that is not in your video.';
  }

  function syncDurationButtons() {
    document.querySelectorAll('[data-clip-duration]').forEach((button) => {
      const selected = state.durationMode === 'custom'
        ? button.dataset.clipDuration === 'custom'
        : Number(button.dataset.clipDuration) === state.presetDuration;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function chooseClipDuration(button) {
    const currentRange = getClipRange();
    const selection = button.dataset.clipDuration;
    state.durationNotice = '';
    if (selection === 'custom') {
      state.durationMode = 'custom';
      element('clip-start').value = formatClipInput(Number.isFinite(currentRange.start) ? currentRange.start : 0);
      element('clip-end').value = formatClipInput(Number.isFinite(currentRange.end) ? currentRange.end : state.presetDuration);
      element('custom-range-fields').hidden = false;
    } else {
      state.durationMode = 'preset';
      state.presetDuration = Number(selection);
      const end = state.duration ? Math.min(state.presetDuration, state.duration) : state.presetDuration;
      element('clip-start').value = '00:00';
      element('clip-end').value = formatClipInput(end);
      element('custom-range-fields').hidden = true;
      element('text-start').value = '0';
      element('text-end').value = Math.max(0.1, end).toFixed(1).replace(/\.0$/, '');
    }
    syncDurationButtons();
    updateClipDisplay();
    updateCaptionStyle(false);
    resetExport();
  }

  function applyDurationToSource() {
    if (state.durationMode === 'preset') {
      const end = Math.min(state.presetDuration, state.duration);
      element('clip-start').value = '00:00';
      element('clip-end').value = formatClipInput(end);
      element('text-start').value = '0';
      element('text-end').value = Math.max(0.1, end).toFixed(1).replace(/\.0$/, '');
    } else {
      const start = parseClipTime(element('clip-start').value);
      const end = parseClipTime(element('clip-end').value);
      const wasLimited = Number.isFinite(end) && end > state.duration;
      const safeStart = Number.isFinite(start) ? Math.max(0, Math.min(start, Math.max(0, state.duration - 0.01))) : 0;
      const safeEnd = Number.isFinite(end) ? Math.min(end, state.duration) : state.duration;
      element('clip-start').value = formatClipInput(safeStart);
      element('clip-end').value = formatClipInput(Math.max(safeStart + 0.01, safeEnd));
      state.durationNotice = wasLimited ? `End time was limited to the source duration (${formatClipInput(state.duration)}).` : '';
    }
    const range = getClipRange();
    const clipLength = Math.max(0, range.end - range.start);
    if (Number(element('text-end').value) > clipLength) element('text-end').value = Math.max(0.1, clipLength).toFixed(1).replace(/\.0$/, '');
    updateClipDisplay();
  }

  function normalizeCustomRange(changedId) {
    let start = parseClipTime(element('clip-start').value);
    let end = parseClipTime(element('clip-end').value);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      updateClipDisplay();
      return;
    }
    const wasLimited = Boolean(state.duration && end > state.duration);
    start = Math.max(0, start);
    if (state.duration) {
      start = Math.min(start, Math.max(0, state.duration - 0.01));
      end = Math.min(end, state.duration);
    }
    if (end <= start) {
      if (changedId === 'clip-start') end = Math.min(state.duration || Infinity, start + 0.01);
      else start = Math.max(0, end - 0.01);
    }
    element('clip-start').value = formatClipInput(start);
    element('clip-end').value = formatClipInput(end);
    state.durationNotice = wasLimited ? `End time was limited to the source duration (${formatClipInput(state.duration)}).` : '';
    const clipLength = Math.max(0, end - start);
    if (Number(element('text-end').value) > clipLength) element('text-end').value = Math.max(0.1, clipLength).toFixed(1).replace(/\.0$/, '');
    updateClipDisplay();
    updateCaptionStyle(false);
    resetExport();
  }

  function syncPreviewTime() {
    const { start, end } = getClipRange();
    const relativeTime = Math.max(0, (Number(video.currentTime) || start) - (Number(start) || 0));
    const clipDuration = Math.max(0, (Number(end) || 0) - (Number(start) || 0));
    element('preview-time').textContent = formatTime(relativeTime);
    element('preview-total').textContent = formatTime(clipDuration);
    element('timeline-seek').value = String(Math.min(relativeTime, clipDuration));
    const ratio = clipDuration ? Math.min(100, relativeTime / clipDuration * 100) : 0;
    element('preview-progress').style.width = `${ratio}%`;
    updateCaptionVisibility(relativeTime);
  }

  function updateCaptionVisibility(relativeTime) {
    const hasText = Boolean(element('overlay-text').value.trim());
    const textStart = Number(element('text-start').value) || 0;
    const textEnd = Number(element('text-end').value);
    const visible = hasText && relativeTime >= textStart && relativeTime <= textEnd;
    caption.hidden = !visible;
    caption.setAttribute('aria-hidden', String(!visible));
  }

  function resetCaptionAnimation() {
    const animation = element('text-animation').value;
    caption.className = 'preview-caption';
    caption.classList.add(`is-${animation}`);
    caption.classList.toggle('is-highlighted', element('text-highlight').checked);
    caption.classList.toggle('is-regular', !element('text-highlight').checked);
    void caption.offsetWidth;
  }

  function updateCaptionStyle(restartAnimation) {
    const text = element('overlay-text').value.trim();
    const size = Math.min(120, Math.max(24, Number(element('text-size').value) || 64));
    const ratio = stage.clientWidth / 720;
    element('caption-text').textContent = text || 'Your words go here';
    element('caption-text').style.fontSize = `${Math.max(11, size * ratio)}px`;
    element('caption-text').style.fontWeight = element('text-bold').checked ? '750' : '500';
    element('caption-text').style.fontFamily = `'${element('text-font-family').value}', sans-serif`;
    element('caption-text').style.color = element('text-color').value;
    element('caption-text').style.backgroundColor = element('text-highlight').checked ? element('text-background-color').value : 'transparent';
    caption.dataset.position = element('text-position').value;
    caption.classList.toggle('is-highlighted', element('text-highlight').checked);
    caption.classList.toggle('is-regular', !element('text-highlight').checked);
    caption.hidden = !text;
    if (restartAnimation) resetCaptionAnimation();
    updateCaptionVisibility(Math.max(0, (Number(video.currentTime) || 0) - (Number(element('clip-start').value) || 0)));
  }

  function updateVideoDetails() {
    const file = state.video;
    if (!file || !Number.isFinite(video.duration)) return;
    state.duration = video.duration;
    element('file-name').textContent = file.name;
    element('file-name').title = file.name;
    element('file-meta').textContent = `${formatFileSize(file.size)} · ${formatTime(video.duration)} · ${video.videoWidth} × ${video.videoHeight}`;
    element('file-summary').hidden = false;
    dropZone.hidden = true;
    element('empty-preview').hidden = true;
    element('large-file-warning').hidden = file.size <= 250 * 1024 * 1024;
    element('custom-range-fields').hidden = state.durationMode !== 'custom';
    syncDurationButtons();
    applyDurationToSource();
    setProjectStatus(`${video.videoWidth} × ${video.videoHeight} · READY`, true);
    setExportAvailability();
    updateCaptionStyle(false);
  }

  function removeVideo() {
    video.pause();
    backgroundVideo.pause();
    video.removeAttribute('src');
    backgroundVideo.removeAttribute('src');
    video.load();
    backgroundVideo.load();
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = '';
    state.video = null;
    state.duration = 0;
    state.durationNotice = '';
    videoInput.value = '';
    element('file-summary').hidden = true;
    dropZone.hidden = false;
    element('empty-preview').hidden = false;
    element('large-file-warning').hidden = true;
    state.durationMode = 'preset';
    state.presetDuration = 25;
    element('clip-start').value = '00:00';
    element('clip-end').value = '00:25';
    element('custom-range-fields').hidden = true;
    element('text-start').value = '0';
    element('text-end').value = '25';
    syncDurationButtons();
    setProjectStatus('No video loaded', false);
    resetExport();
    setExportAvailability();
    updateClipDisplay();
    updateCaptionStyle(false);
  }

  function acceptVideo(file) {
    if (!file || !validateVideoFile(file)) return false;
    resetExport();
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.video = file;
    state.duration = 0;
    state.videoUrl = URL.createObjectURL(file);
    video.src = state.videoUrl;
    backgroundVideo.src = state.videoUrl;
    video.load();
    backgroundVideo.load();
    element('file-name').textContent = file.name;
    element('file-name').title = file.name;
    element('file-meta').textContent = `${formatFileSize(file.size)} · Reading video…`;
    element('file-summary').hidden = false;
    dropZone.hidden = true;
    element('large-file-warning').hidden = file.size <= 250 * 1024 * 1024;
    setProjectStatus('Reading video…', false);
    setExportAvailability();
    return true;
  }

  function validateAudioFile(file) {
    if (!file || !file.size) {
      showToast('Choose a local audio file to use as music.');
      return false;
    }
    if (file.size > 128 * 1024 * 1024) {
      showToast('This audio file is too large to process reliably. Choose a smaller track.');
      return false;
    }
    return true;
  }

  function acceptAudio(file) {
    if (!validateAudioFile(file)) return;
    if (state.musicUrl) URL.revokeObjectURL(state.musicUrl);
    state.music = file;
    state.musicUrl = URL.createObjectURL(file);
    audio.src = state.musicUrl;
    audio.load();
    element('audio-name').textContent = file.name;
    element('audio-name').title = file.name;
    element('audio-details').hidden = false;
    element('audio-file-label').textContent = 'Replace audio file';
    element('music-enabled').checked = true;
    audioInput.value = '';
    showToast('Local music is ready to preview and export.');
  }

  function removeAudio() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (state.musicUrl) URL.revokeObjectURL(state.musicUrl);
    state.musicUrl = '';
    state.music = null;
    element('audio-details').hidden = true;
    element('audio-file-label').textContent = 'Choose an audio file';
    element('music-enabled').checked = false;
    element('preview-audio').textContent = '▶';
    element('preview-audio').setAttribute('aria-label', 'Play audio preview');
  }

  function setFrameOptions() {
    const ratio = element('aspect-ratio').value;
    stage.dataset.ratio = ratio;
    element('preview-ratio-label').textContent = ratio;
    element('preview-stage').querySelector('.preview-frame-label span').textContent = ratio;
    updateCaptionStyle(false);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('Copy is unavailable in this browser.');
  }

  function getMetadataText() {
    return [element('metadata-title').value, element('metadata-description').value, element('metadata-hashtags').value]
      .map((value) => value.trim()).filter(Boolean).join('\n\n');
  }

  function timestampForFilename(date) {
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll('.editor-grid input, .editor-grid select, .editor-grid textarea, .editor-grid button').forEach((control) => {
      if (busy) {
        control.dataset.wasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.wasDisabled !== undefined) {
        control.disabled = control.dataset.wasDisabled === 'true';
        delete control.dataset.wasDisabled;
      }
    });
    setExportAvailability();
  }

  function reportProgress(stageName, percent) {
    element('export-progress').hidden = false;
    element('export-stage').textContent = stageName;
    element('export-percent').textContent = `${Math.round(percent)}%`;
    element('export-progress-bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
    element('export-button-label').textContent = 'Rendering…';
    element('export-detail').textContent = percent >= 100
      ? 'Your Short is ready. Rendered locally; no upload.'
      : 'Keep this tab open while your video renders.';
  }

  function validateProject() {
    if (!state.video) return 'Choose a video before exporting your Short.';
    if (state.video.size > MAX_FILE_SIZE) return 'This video is too large for your browser to process reliably. Try a smaller file.';
    const { start, end } = getClipRange();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      return 'Set an end time that is after the start time.';
    }
    if (state.duration && end > state.duration + 0.001) return 'The clip end time is past the end of your video.';
    const clipDuration = end - start;
    if (element('overlay-text').value.trim()) {
      const textStart = Number(element('text-start').value);
      const textEnd = Number(element('text-end').value);
      if (!Number.isFinite(textStart) || !Number.isFinite(textEnd) || textStart < 0 || textEnd <= textStart || textEnd > clipDuration + 0.05) {
        return 'Set the text timing within the selected clip range.';
      }
    }
    if (element('music-enabled').checked && !state.music) return 'Choose a local audio track or turn background music off.';
    return '';
  }

  async function exportShort() {
    if (state.busy) return;
    const issue = validateProject();
    if (issue) {
      showToast(issue);
      element('export-error').textContent = issue;
      element('export-error').hidden = false;
      return;
    }

    resetExport();
    video.pause();
    backgroundVideo.pause();
    setBusy(true);
    element('export-error').hidden = true;
    element('export-progress').hidden = false;
    element('export-button-label').textContent = 'Preparing…';
    element('export-detail').textContent = 'FFmpeg loads only when you export. Your files stay in this tab.';
    reportProgress('Preparing…', 1);

    const clip = getClipRange();
    const clipDuration = clip.end - clip.start;
    const settings = {
      video: state.video,
      music: state.music,
      musicEnabled: element('music-enabled').checked,
      musicVolume: Number(element('music-volume').value),
      musicFadeIn: element('music-fade-in').checked,
      musicFadeOut: element('music-fade-out').checked,
      start: clip.start,
      end: clip.end,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      ratio: element('aspect-ratio').value,
      fitStyle: document.querySelector('input[name="fit-style"]:checked').value,
      quality: getSelectedQuality(),
      text: element('overlay-text').value,
      fontSize: Number(element('text-size').value),
      fontFamily: element('text-font-family').value,
      color: element('text-color').value,
      highlightColor: element('text-background-color').value,
      highlight: element('text-highlight').checked,
      bold: element('text-bold').checked,
      position: element('text-position').value,
      textStart: Math.min(clipDuration, Number(element('text-start').value) || 0),
      textEnd: Math.min(clipDuration, Number(element('text-end').value) || clipDuration)
    };

    let progressStage = 'Preparing…';
    try {
      const blob = await window.TabhiFFmpeg.exportVideo(settings, {
        onStage: (stageName, percent) => {
          progressStage = stageName;
          reportProgress(stageName, percent);
        },
        onProgress: (percent) => reportProgress(progressStage, percent)
      });
      if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = URL.createObjectURL(blob);
      downloadButton.href = state.downloadUrl;
      downloadButton.download = `TABHI_AI_Short_${timestampForFilename(new Date())}.mp4`;
      downloadButton.hidden = false;
      reportProgress('Complete!', 100);
      element('export-button-label').textContent = 'Short ready';
      setProjectStatus('SHORT READY', true);
      downloadButton.click();
    } catch (error) {
      const friendlyMessage = error instanceof Error ? error.message : 'The video could not be exported. Try a shorter clip.';
      element('export-error').textContent = friendlyMessage;
      element('export-error').hidden = false;
      element('export-detail').textContent = 'Your original file is unchanged.';
      element('export-button-label').textContent = 'Try export again';
      showToast(friendlyMessage);
    } finally {
      setBusy(false);
      if (!state.downloadUrl) element('export-button-label').textContent = 'Export Short';
    }
  }

  videoInput.addEventListener('change', () => acceptVideo(videoInput.files && videoInput.files[0]));
  element('choose-video-file').addEventListener('click', () => videoInput.click());
  element('video-url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    importVideoLink(element('video-url').value.trim());
  });
  element('youtube-url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    validateYouTubeImport(element('youtube-url').value.trim());
  });
  element('youtube-url').addEventListener('input', () => {
    element('youtube-preview').removeAttribute('src');
    element('youtube-preview-wrap').hidden = true;
    element('youtube-open-link').hidden = true;
    element('youtube-url-message').textContent = 'YouTube links provide an embedded preview only. The preview cannot be edited or exported in this browser; upload a video file or use a direct video link above.';
    element('youtube-url-message').classList.remove('is-error');
  });
  audioInput.addEventListener('change', () => acceptAudio(audioInput.files && audioInput.files[0]));
  element('remove-video').addEventListener('click', removeVideo);
  element('remove-audio').addEventListener('click', removeAudio);
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    acceptVideo(event.dataTransfer && event.dataTransfer.files[0]);
  });

  video.addEventListener('loadedmetadata', updateVideoDetails);
  video.addEventListener('error', () => {
    if (state.video) {
      setProjectStatus('Preview unavailable', false);
      setExportAvailability();
      showToast('This video could not be previewed by your browser. Try another supported file.');
    }
  });
  video.addEventListener('timeupdate', () => {
    const { start, end } = getClipRange();
    if (video.currentTime >= end && !video.paused) {
      video.pause();
      backgroundVideo.pause();
      video.currentTime = start;
      backgroundVideo.currentTime = start;
    }
    syncPreviewTime();
  });
  video.addEventListener('seeking', () => {
    if (state.video && backgroundVideo.readyState >= 1 && Math.abs(backgroundVideo.currentTime - video.currentTime) > 0.2) {
      backgroundVideo.currentTime = video.currentTime;
    }
  });
  video.addEventListener('play', () => {
    element('play-symbol').textContent = 'Ⅱ';
    element('preview-play').setAttribute('aria-label', 'Pause preview');
    backgroundVideo.play().catch(() => {});
  });
  video.addEventListener('pause', () => {
    element('play-symbol').textContent = '▶';
    element('preview-play').setAttribute('aria-label', 'Play preview');
    backgroundVideo.pause();
  });

  element('preview-play').addEventListener('click', async () => {
    if (!state.video) {
      showToast('Choose a video to preview it.');
      return;
    }
    const { start, end } = getClipRange();
    if (video.paused || video.currentTime < start || video.currentTime >= end) {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
      try { await video.play(); } catch (_) { showToast('Your browser could not play this video preview.'); }
    } else {
      video.pause();
    }
  });
  stage.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    element('preview-play').click();
  });
  element('timeline-seek').addEventListener('input', (event) => {
    const start = Number(element('clip-start').value) || 0;
    const nextTime = start + Number(event.target.value);
    if (state.video && video.readyState >= 1) {
      video.currentTime = nextTime;
      backgroundVideo.currentTime = nextTime;
      syncPreviewTime();
    }
  });

  document.querySelectorAll('[data-clip-duration]').forEach((button) => button.addEventListener('click', () => chooseClipDuration(button)));
  document.querySelectorAll('[data-mobile-toggle]').forEach((button) => button.addEventListener('click', () => {
    const panel = element(button.dataset.mobileToggle);
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.classList.toggle('is-collapsed', expanded);
    button.lastElementChild.textContent = expanded ? '+' : '−';
  }));
  ['clip-start', 'clip-end'].forEach((id) => {
    element(id).addEventListener('input', updateClipDisplay);
    element(id).addEventListener('change', () => normalizeCustomRange(id));
  });
  element('aspect-ratio').addEventListener('change', () => {
    setFrameOptions();
    updateClipDisplay();
    resetExport();
  });
  document.querySelectorAll('input[name="fit-style"]').forEach((input) => input.addEventListener('change', () => {
    stage.dataset.fit = input.value;
    updateClipDisplay();
    resetExport();
  }));
  document.querySelectorAll('input[name="export-quality"]').forEach((input) => input.addEventListener('change', () => {
    updateClipDisplay();
    resetExport();
  }));

  ['overlay-text', 'text-size', 'text-font-family', 'text-color', 'text-background-color', 'text-position', 'text-animation', 'text-bold', 'text-highlight', 'text-start', 'text-end'].forEach((id) => {
    element(id).addEventListener('input', () => updateCaptionStyle(id === 'text-animation'));
    element(id).addEventListener('change', () => {
      updateCaptionStyle(id === 'text-animation');
      resetExport();
    });
  });
  element('music-volume').addEventListener('input', () => {
    element('music-volume-label').value = `${element('music-volume').value}%`;
  });
  element('music-volume').addEventListener('change', resetExport);
  ['music-enabled', 'music-fade-in', 'music-fade-out'].forEach((id) => element(id).addEventListener('change', resetExport));
  element('preview-audio').addEventListener('click', async () => {
    if (!state.music) {
      showToast('Choose a local audio file to preview it.');
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
        element('preview-audio').textContent = 'Ⅱ';
        element('preview-audio').setAttribute('aria-label', 'Pause audio preview');
      } catch (_) { showToast('Your browser could not play this audio file.'); }
    } else {
      audio.pause();
    }
  });
  audio.addEventListener('pause', () => {
    element('preview-audio').textContent = '▶';
    element('preview-audio').setAttribute('aria-label', 'Play audio preview');
  });
  audio.addEventListener('ended', () => {
    element('preview-audio').textContent = '▶';
    element('preview-audio').setAttribute('aria-label', 'Play audio preview');
  });
  element('generate-metadata').addEventListener('click', () => {
    const result = window.TabhiMetadata.generate({
      topic: element('metadata-topic').value,
      category: element('metadata-category').value,
      filename: state.video ? state.video.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : ''
    });
    element('metadata-title').value = result.title;
    element('metadata-description').value = result.description;
    element('metadata-hashtags').value = result.hashtags;
    element('metadata-output').hidden = false;
  });
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    const field = element(button.dataset.copy);
    try {
      await copyText(field.value);
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1200);
    } catch (_) { showToast('Copy is unavailable. Select the text and copy it manually.'); }
  }));
  element('copy-all-metadata').addEventListener('click', async () => {
    try {
      await copyText(getMetadataText());
      element('copy-status').textContent = 'Copied';
      window.setTimeout(() => { element('copy-status').textContent = ''; }, 1500);
    } catch (_) { showToast('Copy is unavailable. Select the text and copy it manually.'); }
  });
  exportButton.addEventListener('click', exportShort);

  window.TabhiEditor = {
    importGeneratedVideo(file) {
      if (!(file instanceof File) || !validateVideoFile(file)) return false;
      acceptVideo(file);
      element('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
  };

  window.addEventListener('beforeunload', () => {
    [state.videoUrl, state.musicUrl, state.downloadUrl].forEach((url) => { if (url) URL.revokeObjectURL(url); });
  });

  setFrameOptions();
  updateClipDisplay();
  updateCaptionStyle(false);
  setExportAvailability();
})();
