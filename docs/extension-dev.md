# Chrome Extension — Load as Unpacked

## Development / personal install

The extension is in the `extension/` directory and is a Chrome MV3 extension.

### Steps

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` directory from this repository
5. The MyTube extension icon will appear in your toolbar

### First-time configuration

1. Click the extension icon → **Options** (or right-click → Options)
2. Set:
   - **API Base URL**: `https://api.mytube.elladali.com`
   - **Token**: your `MYTUBE_TOKEN` value
3. Click **Save**

### Usage

Navigate to a YouTube video page, then click the MyTube extension icon. The current tab URL is queued for download. You will see a brief notification (if notifications are enabled).

### Updating the extension

After pulling new code:

1. Go to `chrome://extensions`
2. Click the **↺ reload** button on the MyTube extension card

### Notes

- The token is stored in `chrome.storage.local` on your device only.
- The extension only sends requests to the API URL you configured.
