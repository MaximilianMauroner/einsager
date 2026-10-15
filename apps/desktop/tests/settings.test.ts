import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, mergeSettings, parseStoredSettings, serializeStoredSettings } from '../src/main/settings.ts';

test('an Electron edit preserves native microphone selection without making it panel-editable', () => {
  const stored = { nativeMicrophone: 'core-audio-uid', microphone: 'chromium-device-id', futureOption: { enabled: true } };
  const settings = mergeSettings(parseStoredSettings(stored), { showPill: false, nativeMicrophone: 'panel-attempt' });
  assert.equal('nativeMicrophone' in settings, false);
  const saved = JSON.parse(serializeStoredSettings(stored, settings));
  assert.equal(saved.nativeMicrophone, 'core-audio-uid');
  assert.equal(saved.microphone, 'chromium-device-id');
  assert.equal(saved.showPill, false);
  assert.deepEqual(saved.futureOption, { enabled: true });
});

test('resetting the Codex folder removes its stored override', () => {
  const stored = { codexHome: '/custom/codex', nativeMicrophone: 'core-audio-uid' };
  const settings = { ...parseStoredSettings(stored), codexHome: undefined };
  const saved = JSON.parse(serializeStoredSettings(stored, settings));
  assert.equal('codexHome' in saved, false);
  assert.equal(saved.nativeMicrophone, 'core-audio-uid');
});

test('invalid stored containers do not become settings fields', () => {
  for (const stored of [null, ['unexpected'], 'unexpected', 42]) {
    assert.deepEqual(JSON.parse(serializeStoredSettings(stored, defaultSettings)), defaultSettings);
  }
});
