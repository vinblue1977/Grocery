import { describe, expect, it } from 'vitest';
import { emojiFor } from './emoji';

describe('emojiFor', () => {
  it('matches whole words, ignoring case', () => {
    expect(emojiFor('Cilantro')).toBe('🌿');
    expect(emojiFor('GHEE')).toBe('🧈');
    expect(emojiFor('Toor dal')).toBe('🫘');
    expect(emojiFor('Paneer')).toBe('🧀');
  });
  it('handles simple plurals', () => {
    expect(emojiFor('Tomatoes')).toBe('🍅');
    expect(emojiFor('Bananas')).toBe('🍌');
    expect(emojiFor('Strawberries')).toBe('🍓');
    expect(emojiFor('Eggs')).toBe('🥚');
  });
  it('prefers the last known word and ignores partial words', () => {
    expect(emojiFor('Basmati rice')).toBe('🍚');
    expect(emojiFor('Cumin seeds')).toBe('🧆');
    expect(emojiFor('Ghee jar')).toBe('🧈');
    expect(emojiFor('Licensed')).toBe('🧺'); // "ice" is not inside the word
    expect(emojiFor('Spiced')).toBe('🧺');
  });
  it('handles es and ies plurals', () => {
    expect(emojiFor('Peaches')).toBe('🍑');
    expect(emojiFor('Chilies')).toBe('🌶️');
    expect(emojiFor('Green chillies')).toBe('🌶️');
    expect(emojiFor('Cheeses')).toBe('🧀');
    expect(emojiFor('Berries')).toBe('🍓');
  });
  it('gives pet food and litter a paw, not an animal', () => {
    expect(emojiFor('Dog food')).toBe('🐾');
    expect(emojiFor('Cat litter')).toBe('🐾');
  });
  it('knows phrases that differ from their last word', () => {
    expect(emojiFor('Black pepper')).toBe('🧂');
    expect(emojiFor('Peanut butter')).toBe('🥜');
    expect(emojiFor('Coconut milk')).toBe('🥥');
    expect(emojiFor('Egg noodles')).toBe('🍜');
    expect(emojiFor('Chicken stock')).toBe('🍲');
    expect(emojiFor('Hot sauce')).toBe('🌶️');
    expect(emojiFor('Ice cream')).toBe('🍨');
    expect(emojiFor('Sweet potatoes')).toBe('🍠');
    expect(emojiFor('Butter')).toBe('🧈'); // single words are unchanged
    expect(emojiFor('Pepper')).toBe('🫑');
  });
  it('falls back to a basket', () => {
    expect(emojiFor('Mystery thing')).toBe('🧺');
    expect(emojiFor('')).toBe('🧺');
  });
});
