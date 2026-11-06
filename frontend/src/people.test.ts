import { describe, expect, it } from 'vitest';
import { avatarColor, firstWord, greeting, initial, samePerson } from './people';

describe('people', () => {
  it('takes the first word before a space or apostrophe', () => {
    expect(firstWord("Yaso's iPhone")).toBe('Yaso');
    expect(firstWord('Vinod Saravana')).toBe('Vinod');
    expect(samePerson("Vinod's phone", 'vinod')).toBe(true);
    expect(samePerson('Vinod', 'Yaso')).toBe(false);
    expect(samePerson('', '')).toBe(false);
    expect(samePerson(' ', 'Vinod')).toBe(false);
  });
  it('gives the initial in capitals', () => {
    expect(initial('yaso')).toBe('Y');
    expect(initial('')).toBe('?');
  });
  it('colours Vinod blue and Yaso pink, whatever the device name', () => {
    expect(avatarColor('Vinod')).toBe('#6aa9ff');
    expect(avatarColor("Yaso's iPad")).toBe('#ff8fb1');
  });
  it('picks the same palette colour for the same other person', () => {
    expect(avatarColor('Maya')).toBe(avatarColor("maya's phone"));
    expect(avatarColor('Maya')).toMatch(/^#[0-9a-f]{6}$/);
    expect(['#6aa9ff', '#ff8fb1']).not.toContain(avatarColor('Maya'));
  });
  it('greets by time of day', () => {
    expect(greeting(8, "Vinod's phone")).toEqual({ text: 'Good morning, Vinod', emoji: '☀️' });
    expect(greeting(13, 'Yaso').text).toBe('Good afternoon, Yaso');
    expect(greeting(19, 'Yaso').text).toBe('Good evening, Yaso');
    expect(greeting(2, 'Yaso')).toEqual({ text: 'Up late, Yaso?', emoji: '🌙' });
    expect(greeting(0, '').text).toBe('Up late?');
    expect(greeting(4, 'Yaso').text).toBe('Up late, Yaso?');
    expect(greeting(23, 'Yaso').text).toBe('Good evening, Yaso');
    expect(greeting(5, 'Yaso').text).toBe('Good morning, Yaso');
    expect(greeting(12, 'Yaso').text).toBe('Good afternoon, Yaso');
    expect(greeting(17, 'Yaso').text).toBe('Good evening, Yaso');
  });
});
