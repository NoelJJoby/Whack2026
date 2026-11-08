import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daylightAt, daylightForTick, walksIn } from './three/daylight';
import { buildNav, seatNode } from './three/nav';
import { SEAT_LIST } from './three/layout';

test('the presented workday is light for arrivals, dark for departures and lit for overtime', () => {
  const dawn = daylightForTick(0), morning = daylightForTick(1), noon = daylightForTick(3);
  const closing = daylightForTick(5), overtime = daylightForTick(6), midnight = daylightForTick(8);
  assert.ok(dawn.sunlight < morning.sunlight);
  assert.ok(morning.sunlight < noon.sunlight);
  assert.ok(closing.sunlight < morning.sunlight / 3, 'staff leave at dusk at 17:00');
  assert.ok(closing.lamps >= 0.9, 'office and path lamps are on before staff leave');
  assert.ok(overtime.sunlight < closing.sunlight);
  assert.equal(overtime.lamps, 1);
  assert.equal(midnight.lamps, 1);
  assert.deepEqual(daylightForTick(9), morning, 'the next presented day returns to morning');
});

test('dawn and sunset transition continuously, including across midnight', () => {
  for (const hour of [7, 8, 9, 12, 15, 16, 17, 19, 24]) {
    const before = daylightAt(hour - 0.001), after = daylightAt(hour + 0.001);
    assert.ok(Math.abs(before.sunlight - after.sunlight) < 0.01);
    assert.ok(Math.abs(before.ambient - after.ambient) < 0.01);
    assert.ok(Math.abs(before.lamps - after.lamps) < 0.01);
  }
  assert.deepEqual(daylightAt(0), daylightAt(24));
});

test('the sun rises on the left, crosses the sky and sets before overtime', () => {
  const dawn = daylightForTick(0), morning = daylightForTick(1), afternoon = daylightForTick(4), sunset = daylightForTick(5);
  assert.equal(dawn.sunProgress, 0);
  assert.ok(dawn.sunProgress < morning.sunProgress);
  assert.ok(morning.sunProgress < afternoon.sunProgress);
  assert.equal(sunset.sunProgress, 1);
  for (const tick of [0, 1, 2, 3, 4, 5]) assert.equal(daylightForTick(tick).sunVisibility, 1);
  for (const tick of [6, 7, 8]) assert.equal(daylightForTick(tick).sunVisibility, 0);
  assert.equal(daylightForTick(9).sunProgress, morning.sunProgress, 'the sun returns to the east the next day');
});

test('walk-ins follow actual presence changes without replaying arrivals on reconnect', () => {
  assert.equal(walksIn(true, true, 0, 1), true, 'first workday');
  assert.equal(walksIn(false, true, 8, 9), true, 'returning next morning');
  assert.equal(walksIn(true, true, 9, 9), false, 'reconnect in the morning');
  assert.equal(walksIn(undefined, true, 9, 9), false, 'new cast loaded');
  assert.equal(walksIn(true, false, 4, 5), false, 'leaving at closing');
  assert.equal(walksIn(false, false, 5, 6), false, 'stays home during overtime');
  assert.equal(walksIn(true, true, 2, 3), false, 'ordinary work hour');
});

test('morning walk-ins use the pavement and front door to reach every desk', () => {
  const seats = SEAT_LIST.map((seat, i) => ({ id: `person${i}`, seat, ceo: i === 0 }));
  const nav = buildNav(seats);
  for (const { id } of seats) {
    const route = nav.route('exit', seatNode(id));
    assert.equal(route[0], 'exit');
    assert.equal(route.at(-1), seatNode(id));
    assert.ok(route.indexOf('doorOut') < route.indexOf('doorIn'));
    assert.ok(route.includes('doorOut'));
  }
});
