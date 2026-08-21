import 'package:flutter_test/flutter_test.dart';
import 'package:mytube_mobile/player_recovery.dart';

void main() {
  test('recovery uses quick retries followed by a bounded cadence', () {
    expect(recoveryDelayForAttempt(1), const Duration(seconds: 1));
    expect(recoveryDelayForAttempt(2), const Duration(seconds: 2));
    expect(recoveryDelayForAttempt(3), const Duration(seconds: 4));
    expect(recoveryDelayForAttempt(4), const Duration(seconds: 8));
    expect(recoveryDelayForAttempt(5), const Duration(seconds: 10));
    expect(recoveryDelayForAttempt(50), const Duration(seconds: 10));
  });

  test('recovery rewinds slightly and always stays inside the video', () {
    const duration = Duration(minutes: 10);
    expect(
      recoveryPositionFor(const Duration(minutes: 3), duration),
      const Duration(minutes: 2, seconds: 58),
    );
    expect(
      recoveryPositionFor(const Duration(seconds: 1), duration),
      Duration.zero,
    );
    expect(
      recoveryPositionFor(const Duration(minutes: 11), duration),
      const Duration(minutes: 9, seconds: 58),
    );
    expect(
      boundedRecoveryPosition(const Duration(minutes: 3), duration),
      const Duration(minutes: 3),
    );
  });
}
