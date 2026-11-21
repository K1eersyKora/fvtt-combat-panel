export const ORIGINAL_PLAYBACK_RATE = 2;

export function setVideoPlaybackRate(video) {
  video.defaultPlaybackRate = ORIGINAL_PLAYBACK_RATE;
  video.playbackRate = ORIGINAL_PLAYBACK_RATE;
}
