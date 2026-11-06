import { describe, expect, it } from 'vitest';
import { avatarColor, firstWord, greeting, initial, samePerson } from './people';

describe('people', () => {
  it('takes the first word before a space or apostrophe', () => {
    expect(firstWord("Yara's iPhone")).toBe('Yara');
    expect(firstWord('Victor Stone')).toBe('Victor');
    expect(samePerson("Victor's phone", 'victor')).toBe(true);
    expect(samePerson('Victor', 'Yara')).toBe(false);
    expect(samePerson('', '')).toBe(false);
    expect(samePerson(' ', 'Victor')).toBe(false);
  });
  it('gives the initial in capitals', () => {
    expect(initial('yara')).toBe('Y');
    expect(initial('')).toBe('?');
  });
  it('colours Victor blue and Yara pink, whatever the device name', () => {
    expect(avatarColor('Victor')).toBe('#6aa9ff');
    expect(avatarColor("Yara's iPad")).toBe('#ff8fb1');
  });
  it('picks the same palette colour for the same other person', () => {
    expect(avatarColor('Maya')).toBe(avatarColor("maya's phone"));
    expect(avatarColor('Maya')).toMatch(/^#[0-9a-f]{6}$/);
    expect(['#6aa9ff', '#ff8fb1']).not.toContain(avatarColor('Maya'));
  });
  it('greets by time of day', () => {
    expect(greeting(8, "Victor's phone")).toEqual({ text: 'Good morning, Victor', emoji: '☀️' });
    expect(greeting(13, 'Yara').text).toBe('Good afternoon, Yara');
    expect(greeting(19, 'Yara').text).toBe('Good evening, Yara');
    expect(greeting(2, 'Yara')).toEqual({ text: 'Up late, Yara?', emoji: '🌙' });
    expect(greeting(0, '').text).toBe('Up late?');
    expect(greeting(4, 'Yara').text).toBe('Up late, Yara?');
    expect(greeting(23, 'Yara').text).toBe('Good evening, Yara');
    expect(greeting(5, 'Yara').text).toBe('Good morning, Yara');
    expect(greeting(12, 'Yara').text).toBe('Good afternoon, Yara');
    expect(greeting(17, 'Yara').text).toBe('Good evening, Yara');
  });
});
