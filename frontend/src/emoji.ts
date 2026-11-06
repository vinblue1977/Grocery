/** A picture for a grocery item, picked from the words in its name. Purely decorative. */

const BASKET = '🧺';

const GROUPS: Record<string, string> = {
  '🍌': 'banana',
  '🍎': 'apple',
  '🍑': 'peach',
  '🍊': 'orange tangerine clementine',
  '🍋': 'lemon lime',
  '🍇': 'grape',
  '🍓': 'strawberry berry',
  '🍉': 'watermelon melon',
  '🥭': 'mango',
  '🍍': 'pineapple',
  '🥥': 'coconut',
  '🍅': 'tomato',
  '🥕': 'carrot',
  '🥔': 'potato',
  '🧅': 'onion',
  '🧄': 'garlic',
  '🫚': 'ginger',
  '🌶️': 'chili chilli',
  '🫑': 'pepper capsicum',
  '🥒': 'cucumber',
  '🥬': 'lettuce spinach kale cabbage palak',
  '🥦': 'broccoli cauliflower',
  '🌽': 'corn',
  '🍆': 'eggplant brinjal',
  '🥑': 'avocado',
  '🍄': 'mushroom',
  '🌿': 'cilantro coriander parsley mint basil herb curry',
  '🥛': 'milk',
  '🧀': 'cheese paneer',
  '🧈': 'butter ghee margarine',
  '🥚': 'egg',
  '🍦': 'yogurt yoghurt curd dahi',
  '🍞': 'bread bun pav toast',
  '🫓': 'roti naan chapati tortilla paratha',
  '🥐': 'croissant',
  '🍚': 'rice',
  '🌾': 'atta flour wheat oats',
  '🫘': 'dal lentil bean chickpea chana rajma',
  '🍝': 'pasta spaghetti noodle',
  '🥣': 'cereal',
  '🍗': 'chicken',
  '🥩': 'beef steak lamb mutton meat',
  '🥓': 'bacon sausage ham',
  '🐟': 'fish salmon tuna',
  '🍤': 'shrimp prawn',
  '🧂': 'salt',
  '🍬': 'sugar candy jaggery',
  '🍯': 'honey',
  '🫒': 'olive',
  '🥜': 'peanut almond cashew nut walnut pistachio',
  '🧆': 'cumin turmeric masala spice cardamom cinnamon clove',
  '🫙': 'jam sauce ketchup pickle',
  '🥫': 'soup',
  '☕': 'coffee',
  '🍵': 'tea chai',
  '🧃': 'juice',
  '💧': 'water',
  '🥤': 'soda cola',
  '🍺': 'beer',
  '🍷': 'wine',
  '🍪': 'cookie biscuit cracker',
  '🍫': 'chocolate',
  '🍿': 'popcorn',
  '🍟': 'chips fries',
  '🧻': 'towel tissue',
  '🧼': 'soap detergent shampoo',
  '🧽': 'sponge',
  '🪥': 'toothbrush toothpaste',
  '🍼': 'diaper formula',
  '🐾': 'dog cat pet litter', // pet food and litter get a paw, not an animal
  '🕯️': 'candle',
  '🔋': 'battery',
  '💡': 'bulb',
};

const WORDS = new Map<string, string>();
for (const [emoji, words] of Object.entries(GROUPS)) for (const word of words.split(' ')) WORDS.set(word, emoji);

/** "tomatoes" and "berries" down to a form the keyword list knows; unknown words come back unchanged. */
function singular(word: string): string {
  if (WORDS.has(word)) return word;
  const options = [word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')];
  return options.find((w) => w !== word && WORDS.has(w)) ?? word;
}

/** The emoji for an item name: whole words only (case-insensitive), the last matching word wins ("basmati rice"), else a basket. */
export function emojiFor(name: string): string {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const word of words.reverse()) {
    const emoji = WORDS.get(singular(word));
    if (emoji) return emoji;
  }
  return BASKET;
}
