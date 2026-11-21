import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

describe('peer dependency floor', () => {
	// 2.0 calls the core's `utils.detectColorScheme` and `utils.isSafeHref`,
	// and setPlayingState()/setProgress() on external-mode players, without the
	// feature checks and local copies 1.x kept for older cores; it also passes
	// `duration` and compact `wp1:` peaks to loadTrack(), which only a 2.0 core
	// understands. (1.x needed >= 1.8.0.)
	it('requires @arraypress/waveform-player >= 2.0.0', () => {
		const range = pkg.peerDependencies['@arraypress/waveform-player'];
		const [major] = range.replace(/^[^\d]*/, '').split('.').map(Number);
		expect(major).toBeGreaterThanOrEqual(2);
	});
});
