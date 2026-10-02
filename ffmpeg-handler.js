(function (global) {
  'use strict';

  const FFMPEG_SCRIPT = 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
  const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
  let ffmpegInstance = null;
  let loadPromise = null;
  let activeProgress = null;

  function loadScript() {
    if (global.FFmpeg && global.FFmpeg.createFFmpeg) return Promise.resolve(global.FFmpeg);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = FFMPEG_SCRIPT;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => {
        if (global.FFmpeg && global.FFmpeg.createFFmpeg) resolve(global.FFmpeg);
        else reject(new Error('The video renderer could not be initialized.'));
      };
      script.onerror = () => reject(new Error('The video renderer could not be downloaded. Check your internet connection and try again.'));
      document.head.append(script);
    }).catch((error) => {
      loadPromise = null;
      throw error;
    });

    return loadPromise;
  }

  async function getFFmpeg(onStage) {
    if (ffmpegInstance && ffmpegInstance.isLoaded()) return ffmpegInstance;
    onStage('Loading FFmpeg…', 3);
    const library = await loadScript();

    if (!ffmpegInstance) {
      ffmpegInstance = library.createFFmpeg({
        log: false,
        corePath: FFMPEG_CORE,
        progress: ({ ratio }) => {
          if (typeof activeProgress === 'function' && Number.isFinite(ratio)) {
            activeProgress(Math.min(94, Math.max(8, 8 + ratio * 86)));
          }
        }
      });
    }

    if (!ffmpegInstance.isLoaded()) await ffmpegInstance.load();
    return ffmpegInstance;
  }

  const QUALITY_PROFILES = {
    standard: { label: 'Standard', maxEdge: 1280, preset: 'ultrafast', crf: 30, audioBitrate: '96k' },
    high: { label: 'High', maxEdge: 1920, preset: 'medium', crf: 21, audioBitrate: '192k' },
    maximum: { label: 'Maximum', maxEdge: 2560, preset: 'slow', crf: 18, audioBitrate: '256k' }
  };

  function targetDimensions(ratio, maxEdge) {
    if (ratio === '1:1') return { width: maxEdge, height: maxEdge };
    if (ratio === '16:9') return { width: maxEdge, height: maxEdge * 9 / 16 };
    return { width: maxEdge * 9 / 16, height: maxEdge };
  }

  function evenDimension(value) {
    return Math.max(2, Math.floor(value / 2) * 2);
  }

  function nextFrame() {
    return new Promise((resolve) => global.requestAnimationFrame(() => global.requestAnimationFrame(resolve)));
  }

  function getOutputDimensions(sourceWidth, sourceHeight, ratio, fitStyle, quality) {
    const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES.high;
    const target = targetDimensions(ratio, profile.maxEdge);
    if (!(sourceWidth > 0 && sourceHeight > 0)) {
      return { width: evenDimension(target.width), height: evenDimension(target.height), sourceLimited: false };
    }

    let availableWidth = sourceWidth;
    let availableHeight = sourceHeight;
    if (fitStyle !== 'blur') {
      const targetAspect = target.width / target.height;
      if (sourceWidth / sourceHeight > targetAspect) {
        availableWidth = sourceHeight * targetAspect;
      } else {
        availableHeight = sourceWidth / targetAspect;
      }
    }

    const scale = fitStyle === 'blur'
      ? Math.min(1, Math.sqrt((sourceWidth * sourceHeight) / (target.width * target.height)))
      : Math.min(1, availableWidth / target.width, availableHeight / target.height);
    const width = evenDimension(target.width * scale);
    const height = evenDimension(target.height * scale);
    return {
      width,
      height,
      sourceLimited: width < evenDimension(target.width) || height < evenDimension(target.height)
    };
  }

  function makeOverlay(settings, width, height) {
    const text = String(settings.text || '').trim();
    if (!text) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const size = Math.min(120, Math.max(24, Number(settings.fontSize) || 64)) * (width / 720);
    const maxWidth = width * 0.86;
    const lineHeight = size * 1.18;
    const fontFamily = ['Arial', 'Georgia', 'Trebuchet MS', 'Verdana'].includes(settings.fontFamily) ? settings.fontFamily : 'Arial';
    context.font = `${settings.bold ? '700' : '500'} ${size}px "${fontFamily}", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const lines = [];
    text.split('\n').forEach((paragraph) => {
      let line = '';
      paragraph.split(/\s+/).forEach((word) => {
        const nextLine = line ? `${line} ${word}` : word;
        if (line && context.measureText(nextLine).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = nextLine;
        }
      });
      if (line) lines.push(line);
    });

    const blockHeight = lines.length * lineHeight;
    let centerY = height * 0.8;
    if (settings.position === 'top') centerY = height * 0.17 + blockHeight / 2;
    if (settings.position === 'middle') centerY = height / 2;
    const paddingX = size * 0.24;
    const paddingY = size * 0.13;

    lines.forEach((line, index) => {
      const lineY = centerY - blockHeight / 2 + lineHeight * index + lineHeight / 2;
      const textWidth = context.measureText(line).width;
      if (settings.highlight) {
        const boxWidth = Math.min(width * 0.94, textWidth + paddingX * 2);
        const boxHeight = lineHeight + paddingY * 2;
        const x = (width - boxWidth) / 2;
        const y = lineY - boxHeight / 2;
        const radius = Math.min(size * 0.12, boxHeight / 3);
        context.fillStyle = settings.highlightColor || '#d2f36b';
        context.beginPath();
        context.roundRect(x, y, boxWidth, boxHeight, radius);
        context.fill();
      }
      context.fillStyle = settings.color || '#ffffff';
      context.shadowColor = settings.highlight ? 'transparent' : 'rgba(0,0,0,.9)';
      context.shadowBlur = settings.highlight ? 0 : size * 0.1;
      context.fillText(line, width / 2, lineY, maxWidth);
    });

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Text could not be prepared for the video.'));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      }, 'image/png');
    });
  }

  function buildVideoFilter(style, width, height) {
    if (style === 'blur') {
      return {
        graph: `[0:v]split=2[bg0][fg0];[bg0]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},boxblur=18:2[bg];[fg0]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`,
        output: '[base]'
      };
    }

    return {
      graph: `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1[base]`,
      output: '[base]'
    };
  }

  function buildArguments(settings, fileNames, width, height, duration, includeSourceAudio) {
    const args = ['-ss', String(settings.start), '-i', fileNames.video];
    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.high;
    const musicIndex = settings.musicEnabled ? 1 : -1;
    if (settings.musicEnabled) args.push('-stream_loop', '-1', '-i', fileNames.music);

    let overlayIndex = -1;
    if (fileNames.overlay) {
      overlayIndex = settings.musicEnabled ? 2 : 1;
      args.push('-loop', '1', '-i', fileNames.overlay);
    }

    args.push('-t', String(duration));
    const videoFilter = buildVideoFilter(settings.fitStyle, width, height);
    const filters = [videoFilter.graph];
    let videoOutput = videoFilter.output;

    if (overlayIndex >= 0) {
      const start = Math.max(0, Number(settings.textStart) || 0);
      const end = Math.min(duration, Number(settings.textEnd) || duration);
      const enable = end > start ? `:enable='between(t,${start},${end})'` : ':enable=0';
      filters.push(`[base][${overlayIndex}:v]overlay=0:0${enable}[vout]`);
      videoOutput = '[vout]';
    }

    if (settings.musicEnabled) {
      const volume = (Math.min(100, Math.max(0, Number(settings.musicVolume) || 0)) / 100).toFixed(2);
      const musicFilter = `[${musicIndex}:a]volume=${volume}`;
      const fadeIn = settings.musicFadeIn ? ',afade=t=in:st=0:d=1' : '';
      const fadeOut = settings.musicFadeOut ? `,afade=t=out:st=${Math.max(0, duration - 1)}:d=1` : '';
      if (includeSourceAudio) {
        filters.push('[0:a]volume=1[a0]', `${musicFilter}[a1]`, `[a0][a1]amix=inputs=2:duration=first:dropout_transition=2${fadeIn}${fadeOut}[aout]`);
      } else {
        filters.push(`${musicFilter}${fadeIn}${fadeOut}[aout]`);
      }
      args.push('-filter_complex', filters.join(';'), '-map', videoOutput, '-map', '[aout]');
    } else {
      args.push('-filter_complex', filters.join(';'), '-map', videoOutput, '-map', '0:a?');
    }

    args.push('-c:v', 'libx264', '-preset', profile.preset, '-crf', String(profile.crf), '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', profile.audioBitrate, '-movflags', '+faststart', '-y', fileNames.output);
    return args;
  }

  async function exportVideo(settings, callbacks) {
    const onStage = callbacks.onStage || function () {};
    const onProgress = callbacks.onProgress || function () {};
    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.high;
    const videoExtension = (settings.video.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp4';
    const musicExtension = settings.music ? ((settings.music.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp3') : '';
    const fileNames = {
      video: `tabhi-source.${videoExtension}`,
      music: `tabhi-music.${musicExtension || 'mp3'}`,
      overlay: settings.text.trim() ? 'tabhi-overlay.png' : null,
      output: 'tabhi-short.mp4'
    };
    const duration = Number(settings.end) - Number(settings.start);
    const { width, height } = getOutputDimensions(
      settings.videoWidth,
      settings.videoHeight,
      settings.ratio,
      settings.fitStyle,
      settings.quality
    );
    let ffmpeg;
    let overlay;
    let complete = false;

    try {
      onStage('Preparing…', 1);
      await nextFrame();
      ffmpeg = await getFFmpeg(onStage);
      activeProgress = onProgress;
      onStage('Processing video…', 6);
      ffmpeg.FS('writeFile', fileNames.video, await global.FFmpeg.fetchFile(settings.video));
      if (settings.musicEnabled && settings.music) {
        ffmpeg.FS('writeFile', fileNames.music, await global.FFmpeg.fetchFile(settings.music));
      }
      if (fileNames.overlay) {
        onStage('Applying effects…', 9);
        overlay = await makeOverlay(settings, width, height);
        ffmpeg.FS('writeFile', fileNames.overlay, overlay);
      } else {
        onStage('Applying effects…', 9);
      }
      await nextFrame();
      const qualityStage = settings.quality === 'standard' ? 'standard-quality' : `${settings.quality || 'high'}-quality`;
      onStage(`Encoding ${qualityStage} video…`, 10);
      try {
        await ffmpeg.run(...buildArguments(settings, fileNames, width, height, duration, true));
      } catch (error) {
        if (!settings.musicEnabled) throw error;
        onStage('Retrying with music only…', 12);
        try { ffmpeg.FS('unlink', fileNames.output); } catch (_) {}
        await ffmpeg.run(...buildArguments(settings, fileNames, width, height, duration, false));
      }
      onStage('Finalizing…', 96);
      await nextFrame();
      const output = ffmpeg.FS('readFile', fileNames.output);
      const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
      complete = true;
      onProgress(100);
      onStage('Complete!', 100);
      return new Blob([bytes], { type: 'video/mp4' });
    } catch (error) {
      const message = String(error && error.message || error).toLowerCase();
      if (message.includes('memory') || message.includes('out of') || message.includes('allocation') || message.includes('oom')) {
        throw new Error('This video is too demanding for your browser to process at this quality. Try High or Standard quality.');
      }
      if (message.includes('drawtext') || message.includes('filter_complex') || message.includes('stream specifier')) {
        throw new Error('This video could not be rendered with the selected audio or framing options. Try disabling music or choosing center crop.');
      }
      if (message.includes('core') || message.includes('wasm') || message.includes('worker')) {
        throw new Error('The local video renderer could not start. Check your connection and browser support, then try again.');
      }
      throw new Error('The video could not be exported. Try a shorter clip or a smaller source file.');
    } finally {
      activeProgress = null;
      if (ffmpeg && ffmpeg.isLoaded()) {
        Object.values(fileNames).filter(Boolean).forEach((name) => {
          try { ffmpeg.FS('unlink', name); } catch (_) {}
        });
      }
      if (!complete && overlay) overlay = null;
    }
  }

  global.TabhiFFmpeg = { exportVideo, getOutputDimensions };
})(window);
