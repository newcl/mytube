export type WebKitPresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture';

export type PictureInPictureVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: WebKitPresentationMode) => boolean;
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void;
  webkitPresentationMode?: WebKitPresentationMode;
};

export function isPictureInPictureActive(video: PictureInPictureVideo, doc: Document = document): boolean {
  return doc.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
}

export function supportsPictureInPicture(
  video: PictureInPictureVideo,
  doc: Document = document,
): boolean {
  const standardSupported = Boolean(
    doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function',
  );
  const webKitSupported = Boolean(
    typeof video.webkitSetPresentationMode === 'function'
      && video.webkitSupportsPresentationMode?.('picture-in-picture'),
  );

  return standardSupported || webKitSupported;
}

export async function enterPictureInPicture(
  video: PictureInPictureVideo,
  doc: Document = document,
): Promise<void> {
  const webKitSupported = Boolean(
    typeof video.webkitSetPresentationMode === 'function'
      && video.webkitSupportsPresentationMode?.('picture-in-picture'),
  );

  // Prefer the standards API on modern iOS because its promise resolves only
  // after PiP is established. The legacy WebKit setter returns immediately,
  // which creates a race when the user locks the phone right after tapping.
  if (doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    await video.requestPictureInPicture();
    return;
  }

  if (webKitSupported) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled || video.webkitPresentationMode !== 'picture-in-picture') return;
        settled = true;
        clearTimeout(timeout);
        video.removeEventListener('webkitpresentationmodechanged', finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        video.removeEventListener('webkitpresentationmodechanged', finish);
        reject(new Error('Picture-in-Picture did not finish starting.'));
      }, 2500);

      video.addEventListener('webkitpresentationmodechanged', finish);
      // This stays synchronous with the tap even though completion is awaited.
      video.webkitSetPresentationMode?.('picture-in-picture');
      finish();
    });
    return;
  }

  throw new Error('Picture-in-Picture is unavailable for this video.');
}

export async function exitPictureInPicture(
  video: PictureInPictureVideo,
  doc: Document = document,
): Promise<void> {
  if (video.webkitPresentationMode === 'picture-in-picture' && video.webkitSetPresentationMode) {
    video.webkitSetPresentationMode('inline');
    return;
  }

  if (doc.pictureInPictureElement === video && typeof doc.exitPictureInPicture === 'function') {
    await doc.exitPictureInPicture();
  }
}
