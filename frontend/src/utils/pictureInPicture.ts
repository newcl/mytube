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
  preferWebKit: boolean,
  doc: Document = document,
): boolean {
  const standardSupported = Boolean(
    doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function',
  );
  const webKitSupported = Boolean(
    typeof video.webkitSetPresentationMode === 'function'
      && video.webkitSupportsPresentationMode?.('picture-in-picture'),
  );

  return preferWebKit ? webKitSupported || standardSupported : standardSupported || webKitSupported;
}

export async function enterPictureInPicture(
  video: PictureInPictureVideo,
  preferWebKit: boolean,
  doc: Document = document,
): Promise<void> {
  const webKitSupported = Boolean(
    typeof video.webkitSetPresentationMode === 'function'
      && video.webkitSupportsPresentationMode?.('picture-in-picture'),
  );

  // iOS browsers share Apple's media stack. Invoke the WebKit presentation
  // API synchronously, before the tap's user activation can expire.
  if (preferWebKit && webKitSupported) {
    video.webkitSetPresentationMode?.('picture-in-picture');
    return;
  }

  if (doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    await video.requestPictureInPicture();
    return;
  }

  if (webKitSupported) {
    video.webkitSetPresentationMode?.('picture-in-picture');
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
