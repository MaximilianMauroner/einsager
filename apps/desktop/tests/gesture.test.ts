import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldGesture } from '../src/renderer/gesture.ts';
import { parseHelperLine } from '../src/main/keyboard.ts';

test('holding the key talks; releasing it transcribes; a short tap discards', () => {
  const gesture = new HoldGesture();
  assert.equal(gesture.press(10, true, undefined), 'begin-hold');
  assert.equal(gesture.release(11, 'hold', false), 'finish');
  assert.equal(gesture.press(20, true, undefined), 'begin-hold');
  assert.equal(gesture.release(20.2, 'hold', false), 'cancel');
  assert.equal(gesture.press(30, true, undefined), 'begin-hold');
  assert.equal(gesture.release(31, 'hold', true), 'cancel', 'Release while the microphone starts cancels even after a long hold');
});

test('a double tap locks hands-free, and a third quick press cancels', () => {
  const gesture = new HoldGesture();
  assert.equal(gesture.press(10, true, undefined), 'begin-hold');
  assert.equal(gesture.release(10.1, 'hold', false), 'cancel');
  assert.equal(gesture.press(10.2, true, undefined), 'begin-hands-free', 'The second tap starts hands-free after the first was discarded');
  assert.equal(gesture.release(10.25, 'handsFree', false), 'none', 'Releasing a lock cannot stop it');
  assert.equal(gesture.press(10.3, false, 'handsFree'), 'cancel');
  const holding = new HoldGesture();
  assert.equal(holding.press(20, true, undefined), 'begin-hold');
  assert.equal(holding.press(20.4, false, 'hold'), 'lock', 'A second press during a hold locks it');
});

test('presses during transcription do nothing, and a hands-free start ends a tap sequence', () => {
  const gesture = new HoldGesture();
  assert.equal(gesture.press(10, false, undefined), 'none');
  assert.equal(gesture.release(10.6, undefined, false), 'none');
  assert.equal(gesture.press(20, true, undefined), 'begin-hold');
  gesture.restart();
  assert.equal(gesture.press(20.2, true, undefined), 'begin-hold', 'After a restart the next press is a first press');
});

test('helper lines become typed states and actions; anything else is ignored', () => {
  assert.deepEqual(parseHelperLine('{"event":"action","action":"holdPressed"}'), { event: 'action', action: 'holdPressed' });
  assert.deepEqual(parseHelperLine('{"event":"state","trusted":true,"hold":"Fn","handsFree":"Fn+Space","capturing":null,"error":null}'),
    { event: 'state', state: { trusted: true, hold: 'Fn', handsFree: 'Fn+Space', capturing: null, error: null } });
  assert.deepEqual(parseHelperLine('{"event":"state","trusted":false,"hold":"⌃⌥K","handsFree":"Fn+Space","capturing":"hold","error":"Use another key."}'),
    { event: 'state', state: { trusted: false, hold: '⌃⌥K', handsFree: 'Fn+Space', capturing: 'hold', error: 'Use another key.' } });
  for (const line of ['', 'not json', '{"event":"action","action":"rm -rf"}', '{"event":"state","trusted":"yes","hold":"Fn","handsFree":"Fn+Space"}', '[]']) {
    assert.equal(parseHelperLine(line), undefined, line);
  }
});
