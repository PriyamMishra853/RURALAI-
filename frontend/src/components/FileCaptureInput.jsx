import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, FolderOpen, X, RotateCcw, Check, Loader2, FileText, Plus } from 'lucide-react';

/**
 * File capture with two sources: the device file manager, and the camera.
 *
 * The camera path opens `getUserMedia` and shows a live preview inside the
 * page rather than relying on `<input capture>`. Two reasons:
 *   - `capture` is ignored on desktop browsers entirely, so a laptop demo has
 *     no camera at all with that approach.
 *   - Even on mobile it hands off to the OS camera app and returns one photo,
 *     with no chance to check the shot before it is uploaded. A blurred
 *     prescription that has to be re-taken after the upload round-trip is the
 *     single most common failure in the field.
 *
 * Falls back to `<input capture="environment">` when getUserMedia is
 * unavailable (insecure origin, denied permission, no device).
 *
 * Multiple files are supported on both paths: the picker allows multi-select,
 * and the camera lets the assistant shoot page after page into one batch.
 */

const isImage = (f) => f.type?.startsWith('image/');

export default function FileCaptureInput({
  label,
  hint,
  accept = 'image/*,application/pdf',
  multiple = true,
  files = [],
  onChange,
  disabled = false,
  busy = false
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [starting, setStarting] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pickerRef = useRef(null);
  const fallbackRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Release the camera when the component unmounts — a stream left running
  // keeps the device light on and blocks other tabs from opening it.
  useEffect(() => stopCamera, [stopCamera]);

  const openCamera = async (mode = facingMode) => {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      // Insecure origin or an old browser: hand off to the OS camera app.
      fallbackRef.current?.click();
      return;
    }

    setStarting(true);
    setCameraOpen(true);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      const reason =
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site, or use "Choose files".'
          : err.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : `The camera could not be opened (${err.name}).`;
      setCameraError(reason);
    } finally {
      setStarting(false);
    }
  };

  const closeCamera = () => {
    stopCamera();
    setCameraOpen(false);
    setCameraError(null);
  };

  const flipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    openCamera(next);
  };

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const shot = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onChange(multiple ? [...files, shot] : [shot]);
        if (!multiple) closeCamera();
      },
      'image/jpeg',
      0.92   // high enough for OCR on handwriting; lower blurs thin strokes
    );
  };

  const addFromPicker = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) onChange(multiple ? [...files, ...picked] : [picked[0]]);
    e.target.value = '';   // re-selecting the same file must fire onChange again
  };

  const removeAt = (i) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="block text-xs font-semibold text-ink-muted">{label}</label>
        {files.length > 0 && (
          <span className="text-[11px] text-ink-muted">
            {files.length} file{files.length === 1 ? '' : 's'} ready
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openCamera()}
          disabled={disabled || busy}
          /*
            Primary action, and it must LOOK like one. The theme sweep turned
            the original bg-slate-900 into bg-surface-sunken while leaving
            text-white — near-white text on a near-white panel, invisible in
            light mode. Camera capture is the main way documents enter this
            system, so it gets the primary treatment, not a ghost button.
          */
          className="px-4 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 dark:bg-gov-500 dark:hover:bg-gov-400 dark:text-gov-950 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-sm min-h-[2.5rem]"
        >
          <Camera className="w-4 h-4" /> Open camera
        </button>
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          disabled={disabled || busy}
          className="px-4 py-2.5 rounded-field bg-surface-raised hover:bg-surface-sunken disabled:opacity-50 text-ink border border-line-strong text-xs font-semibold flex items-center gap-2 min-h-[2.5rem]"
        >
          <FolderOpen className="w-4 h-4" /> Choose files
        </button>

        <input
          ref={pickerRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={addFromPicker}
          className="hidden"
        />
        {/* OS camera app fallback for browsers without getUserMedia. */}
        <input
          ref={fallbackRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={addFromPicker}
          className="hidden"
        />
      </div>

      {hint && <p className="text-[11px] text-ink-subtle">{hint}</p>}

      {cameraError && (
        <div role="alert" className="p-2.5 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-[11px] text-tier-moderate">
          {cameraError}
        </div>
      )}

      {files.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative group">
              <div className="aspect-square rounded-field border border-line bg-surface-sunken overflow-hidden flex items-center justify-center">
                {isImage(f) ? (
                  <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center p-1">
                    <FileText className="w-5 h-5 text-ink-subtle mx-auto" />
                    <span className="text-[9px] text-ink-muted block mt-1">PDF</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={busy}
                aria-label={`Remove ${f.name}`}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-tier-emergency hover:opacity-90 text-white flex items-center justify-center shadow"
              >
                <X className="w-3 h-3" />
              </button>
              <p className="text-[9px] text-ink-muted truncate mt-1" title={f.name}>
                {multiple ? `${i + 1}. ` : ''}{f.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-2xl space-y-3">
            <div className="flex items-center justify-between text-white">
              <span className="text-sm font-semibold">{label}</span>
              <button type="button" onClick={closeCamera} aria-label="Close camera" className="p-2 hover:bg-surface-raised/10 rounded-field">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative bg-black rounded-field overflow-hidden aspect-video">
              <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center text-white text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Starting camera…
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-tier-moderate text-xs">
                  {cameraError}
                </div>
              )}
            </div>

            {multiple && files.length > 0 && (
              <p className="text-center text-[11px] text-white/70">
                {files.length} page{files.length === 1 ? '' : 's'} captured — keep shooting, then select Done.
              </p>
            )}

            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={flipCamera}
                aria-label="Switch camera"
                className="p-3 rounded-full bg-surface-raised/10 hover:bg-surface-raised/20 text-white"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={shoot}
                disabled={starting || !!cameraError}
                aria-label="Take photo"
                className="w-16 h-16 rounded-full bg-surface-raised hover:bg-surface-sunken disabled:opacity-40 border-4 border-white/40 flex items-center justify-center"
              >
                {multiple ? <Plus className="w-6 h-6 text-ink" /> : <Camera className="w-6 h-6 text-ink" />}
              </button>

              <button
                type="button"
                onClick={closeCamera}
                aria-label="Done"
                className="p-3 rounded-full bg-tier-low hover:opacity-90 text-white"
              >
                <Check className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
