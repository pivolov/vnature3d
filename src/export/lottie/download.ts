import { strToU8, zipSync } from 'fflate';
import type { LottieOutput } from './model';

export function archiveLottie(json: string) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({ version: '2', generator: 'VD3D', animations: [{ id: 'main' }] })),
    'a/main.json': strToU8(json),
  }, { level: 6 });
}
export function downloadLottie(result: LottieOutput, format: 'json' | 'lottie' | 'report', width: number, height: number, fps: number) {
  const content = format === 'report' ? report(result, width, height, fps) : result.json;
  const data = format === 'lottie' ? Uint8Array.from(archiveLottie(content)) : content;
  const blob = new Blob([data], { type: format === 'lottie' ? 'application/zip' : format === 'json' ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = format === 'report' ? 'animation-report.txt' : 'animation.' + format;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function report(result: LottieOutput, width: number, height: number, fps: number) {
  return [
    'VD3D — Lottie', 'Mode: ' + result.mode, 'Composition: ' + width + ' × ' + height,
    'FPS: ' + fps, 'Duration: ' + result.duration.toFixed(2) + ' s', 'Size: ' + result.bytes + ' bytes',
    'Layers: ' + result.layers, 'Shape paths: ' + result.shapes, 'Keys: ' + result.keys, 'Frame step: ' + result.step,
    ...result.warnings,
  ].join('\n');
}

export const snippets = {
  'SwiftUI': 'import SwiftUI\nimport Lottie\n\nstruct LogoAnimation: View {\n    var body: some View {\n        LottieView(animation: .named("animation"))\n            .playing(loopMode: .loop)\n    }\n}',
  'Swift · UIKit': 'import Lottie\n\nlet animation = LottieAnimationView(name: "animation")\nanimation.contentMode = .scaleAspectFit\nanimation.loopMode = .loop\nview.addSubview(animation)\nanimation.frame = view.bounds\nanimation.play()',
  'Android · Compose': 'import androidx.compose.runtime.Composable\nimport androidx.compose.runtime.getValue\nimport com.airbnb.lottie.compose.*\n\n@Composable\nfun LogoAnimation() {\n    val composition by rememberLottieComposition(\n        LottieCompositionSpec.RawRes(R.raw.animation)\n    )\n    LottieAnimation(\n        composition = composition,\n        iterations = LottieConstants.IterateForever\n    )\n}',
  'Android · XML': '<com.airbnb.lottie.LottieAnimationView\n    xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:app="http://schemas.android.com/apk/res-auto"\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    app:lottie_rawRes="@raw/animation"\n    app:lottie_autoPlay="true"\n    app:lottie_loop="true" />',
  'React Native': "import LottieView from 'lottie-react-native';\n\nexport function LogoAnimation() {\n  return <LottieView source={require('./animation.json')} autoPlay loop\n    style={{ width: 160, height: 160 }} />;\n}",
  'Flutter': "import 'package:lottie/lottie.dart';\n\nLottie.asset('assets/animation.json', repeat: true, width: 160, height: 160);",
};
