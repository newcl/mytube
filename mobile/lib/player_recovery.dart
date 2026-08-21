const int maximumAutomaticRecoveryAttempts = 12;
const Duration recoveryRewind = Duration(seconds: 2);
const Duration stalledPlaybackRecoveryDelay = Duration(seconds: 20);

Duration recoveryDelayForAttempt(int attempt) {
  if (attempt <= 1) return const Duration(seconds: 1);
  if (attempt == 2) return const Duration(seconds: 2);
  if (attempt == 3) return const Duration(seconds: 4);
  if (attempt == 4) return const Duration(seconds: 8);
  return const Duration(seconds: 10);
}

Duration recoveryPositionFor(Duration position, Duration duration) {
  final rewound = position > recoveryRewind
      ? position - recoveryRewind
      : Duration.zero;
  return boundedRecoveryPosition(rewound, duration);
}

Duration boundedRecoveryPosition(Duration position, Duration duration) {
  if (duration <= Duration.zero || position < duration) return position;
  return duration > recoveryRewind ? duration - recoveryRewind : Duration.zero;
}
