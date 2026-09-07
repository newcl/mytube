# Mytube patch

This package is vendored from `video_player_avfoundation` 2.9.4.

Mytube explicitly sets each iOS `AVPlayer` instance's
`audiovisualBackgroundPlaybackPolicy` to `continuesIfPossible`. The upstream
plugin leaves the policy on `automatic`, which allows newer iOS versions to
pause audiovisual playback when the app enters the background.

When updating the vendored package, preserve the patch in
`FVPVideoPlayer.m` and verify background playback on a physical iPhone.
