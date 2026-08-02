import { describe, expect, it, vi } from 'vitest';
import {
  enterPictureInPicture,
  exitPictureInPicture,
  isPictureInPictureActive,
  supportsPictureInPicture,
  type PictureInPictureVideo,
} from './pictureInPicture';

function videoStub(overrides: Partial<PictureInPictureVideo> = {}): PictureInPictureVideo {
  return overrides as PictureInPictureVideo;
}

function documentStub(overrides: Partial<Document> = {}): Document {
  return {
    pictureInPictureEnabled: false,
    pictureInPictureElement: null,
    ...overrides,
  } as Document;
}

describe('picture-in-picture helpers', () => {
  it('prefers the standards API when iOS exposes both APIs', async () => {
    const setMode = vi.fn();
    const requestStandard = vi.fn().mockResolvedValue(undefined);
    const video = videoStub({
      webkitSupportsPresentationMode: () => true,
      webkitSetPresentationMode: setMode,
      requestPictureInPicture: requestStandard,
    });
    const doc = documentStub({ pictureInPictureEnabled: true });

    await enterPictureInPicture(video, doc);

    expect(requestStandard).toHaveBeenCalledOnce();
    expect(setMode).not.toHaveBeenCalled();
  });

  it('uses the standard API outside iOS', async () => {
    const requestStandard = vi.fn().mockResolvedValue(undefined);
    const video = videoStub({ requestPictureInPicture: requestStandard });
    const doc = documentStub({ pictureInPictureEnabled: true });

    expect(supportsPictureInPicture(video, doc)).toBe(true);
    await enterPictureInPicture(video, doc);

    expect(requestStandard).toHaveBeenCalledOnce();
  });

  it('waits for the WebKit presentation mode fallback', async () => {
    const video = videoStub({
      webkitSupportsPresentationMode: () => true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    video.webkitSetPresentationMode = vi.fn((mode) => {
      video.webkitPresentationMode = mode;
    });

    await enterPictureInPicture(video, documentStub());

    expect(video.webkitSetPresentationMode).toHaveBeenCalledWith('picture-in-picture');
    expect(video.webkitPresentationMode).toBe('picture-in-picture');
  });

  it('recognizes and exits WebKit picture-in-picture', async () => {
    const setMode = vi.fn();
    const video = videoStub({
      webkitPresentationMode: 'picture-in-picture',
      webkitSetPresentationMode: setMode,
    });
    const doc = documentStub();

    expect(isPictureInPictureActive(video, doc)).toBe(true);
    await exitPictureInPicture(video, doc);

    expect(setMode).toHaveBeenCalledWith('inline');
  });
});
