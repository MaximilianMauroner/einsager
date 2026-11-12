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

test('new profiles select the API; existing profiles keep Codex until the user chooses', () => {
  assert.equal(defaultSettings.provider, 'api-key');
  assert.equal(parseStoredSettings({}).provider, 'codex-login');
  assert.equal(parseStoredSettings({ codexHome: '/existing/login' }).codexLoginAcknowledged, false);
  assert.equal(parseStoredSettings({ provider: 'codex-login', codexLoginAcknowledged: true }).codexLoginAcknowledged, true);
  assert.equal(parseStoredSettings({ provider: 'api-key', codexLoginAcknowledged: true }).codexLoginAcknowledged, false);
  assert.equal(parseStoredSettings({ provider: 'invalid', codexLoginAcknowledged: true }).codexLoginAcknowledged, false);
});

test('generic panel updates cannot bypass provider consent or inject a secret into settings', () => {
  const settings = mergeSettings(defaultSettings, { provider: 'codex-login', codexLoginAcknowledged: true, apiKey: 'sk-do-not-store' });
  assert.equal(settings.provider, 'api-key');
  assert.equal(settings.codexLoginAcknowledged, false);
  assert.equal(JSON.stringify(settings).includes('sk-do-not-store'), false);
});


test('unreadable stored settings cannot enable charged API use without an explicit choice', () => {
  for (const value of [null, undefined, [], 42, 'broken']) {
    const settings = parseStoredSettings(value);
    assert.equal(settings.provider, 'codex-login');
    assert.equal(settings.codexLoginAcknowledged, false);
  }
  assert.equal(defaultSettings.provider, 'api-key');
});
