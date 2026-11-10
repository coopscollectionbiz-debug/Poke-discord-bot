// ==========================================================
// utils/encounter/lines.js
// What encounter Trainers say. Every line is written for this game in the
// games' voice, not copied from them. A set's `intro` goes on the card;
// after the fight, `lost` is the Trainer losing and `won` the Trainer
// winning. Over-tier Trainers of any class but Ace Trainer say an
// OVER_INTRO line instead of their own: it's the only hint they're strong.
// RAN and LOST_INTEREST replace a card the player ran from or ignored.
// Lines stay within one line of the card's text box (64 characters).
// ==========================================================

const set = (intro, lost, won) => ({ intro, lost, won });

export const LINES = {
  youngster: set(
    ["Hey! You look strong. Let's find out!", "I've been waiting all day for someone to battle!", "Shorts keep me fast. Watch this!"],
    ["No way! I was this close!", "Aw, man. Back to training."],
    ["Ha! Told you I was tough!"],
  ),
  lass: set(
    ["You looked at me, so now we battle!", "My Pokémon are cute and tough. You'll see!", "I picked my team for style. Let's see yours!"],
    ["Ugh, and I just did my hair for this."],
    ["Cute wins again!"],
  ),
  bugcatcher: set(
    ["I caught these in the woods this morning!", "Bug Pokémon are the coolest. I'll prove it!", "Don't step on my bugs! Battle them instead!"],
    ["My bugs need a nap after that."],
    ["Bugs rule! I knew it!"],
  ),
  camper: set(
    ["I've been camping out here for days. Battle me!", "Nothing beats a battle by the campfire!", "You walked right into my campsite!"],
    ["I'm going back to my tent."],
    ["Camp life makes you tough!"],
  ),
  picnicker: set(
    ["Want to battle before lunch?", "I packed snacks for my Pokémon. They're ready!", "A battle on a sunny day is the best!"],
    ["Well, at least the weather's nice."],
    ["What a perfect afternoon!"],
  ),
  hiker: set(
    ["I've climbed every mountain around here!", "Rock solid! That's my team!", "Hold on! Let's battle before my next climb!"],
    ["Whew! You hit like a rockslide."],
    ["The mountains made me strong!"],
  ),
  fisherman: set(
    ["I hooked a Trainer! Let's battle!", "Nothing's biting today. You'll do!", "Patience wins at fishing and at battling."],
    ["The big one got away again."],
    ["Reeled you right in!"],
  ),
  swimmer: set(
    ["The water's great! So is battling!", "I swam all the way here to battle you!", "Don't splash me! Battle me!"],
    ["I need to dry off and think."],
    ["You got soaked!"],
  ),
  sailor: set(
    ["Ahoy! My sea legs are ready for a battle!", "I've battled on every ship in port!", "Stand fast! A sailor never backs down!"],
    ["Blast it! Sunk right in port!"],
    ["Anchors aweigh! I win!"],
  ),
  birdkeeper: set(
    ["My birds spotted you from way up there!", "Look up! My Pokémon rule the sky!", "Feathers fly when I battle!"],
    ["My birds need to rest their wings."],
    ["Flew right past you!"],
  ),
  blackbelt: set(
    ["Hyah! My training needs a real opponent!", "Focus. Breathe. Battle!", "I trained under a waterfall for this!"],
    ["I must train harder. Osu!"],
    ["Discipline wins every time!"],
  ),
  battlegirl: set(
    ["My fists are ready, and so are my Pokémon!", "Train hard, battle harder! Let's go!", "I never skip a workout. Watch!"],
    ["Okay, that one really stung."],
    ["Feel the burn!"],
  ),
  psychic: set(
    ["I saw this battle coming in a dream.", "I sense great power. Let's test it.", "Don't bother hiding your moves. I know them."],
    ["I did not foresee that."],
    ["Just as I predicted."],
  ),
  channeler: set(
    ["The spirits told me you'd come this way...", "Something is following you. Let's battle!", "Do you feel the chill? My Pokémon do."],
    ["The spirits are laughing at me."],
    ["The spirits chose me."],
  ),
  hexmaniac: set(
    ["Ehehe... you walked into my shadow.", "I've been watching you for a while.", "My curse is ready. Are you?"],
    ["Ehehe... I'll remember you."],
    ["Ehehe... another one."],
  ),
  juggler: set(
    ["Watch closely! Now you see my Pokémon...", "I juggle five balls at once. Battling is easy!", "Step right up for the greatest show around!"],
    ["I dropped the ball on that one."],
    ["And the crowd goes wild!"],
  ),
  engineer: set(
    ["I just finished tuning up my Pokémon!", "Let's see if my calculations hold up!", "Every circuit is charged. Ready?"],
    ["Back to the drawing board."],
    ["Built to win!"],
  ),
  supernerd: set(
    ["I've studied every type chart there is!", "My research says I'll win. Let's test it!", "Statistically, you should run. Want to battle?"],
    ["My numbers must have been off."],
    ["Science wins again!"],
  ),
  burglar: set(
    ["You didn't see me, okay? Let's just battle.", "Don't mind the bag. It's laundry. Battle!", "Quick, battle me before someone shows up!"],
    ["Rats. I'm making a run for it."],
    ["Smooth as a getaway!"],
  ),
  biker: set(
    ["Get off my road! Unless you want to battle!", "My engine's warm and so is my team!", "We ride fast and battle faster!"],
    ["Man, I need a tune-up."],
    ["Eat my dust!"],
  ),
  firebreather: set(
    ["Feel the heat! My Pokémon are fired up!", "I breathe fire for a living. Battle me!", "Things are about to get hot around here!"],
    ["Ouch. I burned out."],
    ["Too hot for you!"],
  ),
  pokemaniac: set(
    ["I collect rare Pokémon. Want to see?", "My team is worth more than your bike!", "Rare Pokémon only! Let me show you!"],
    ["My rare Pokémon... beaten?!"],
    ["Rare and strong. Told you!"],
  ),
  dragontamer: set(
    ["My dragons don't listen to just anyone.", "Taming dragons takes years. Beating you won't.", "Hear that roar? My dragons want to fight!"],
    ["My dragons are... impressed."],
    ["No one tames a dragon like me!"],
  ),
  skier: set(
    ["I just came down the slopes. Let's battle!", "Cold air keeps my Pokémon sharp!", "Race you to the bottom! After a battle!"],
    ["Wiped out on the last turn."],
    ["An ice-cold win!"],
  ),
  rocket: set(
    ["Team Rocket needs your Pokémon. Hand them over!", "You're not supposed to be here! Battle!", "The boss wants results. You'll be one!"],
    ["The boss is not going to like this."],
    ["Team Rocket wins again!"],
  ),
  gentleman: set(
    ["A fine day for a gentlemanly battle.", "Pardon me. Might I trouble you for a battle?", "My Pokémon were raised with proper manners."],
    ["Splendid battle. Here, as promised."],
    ["A good effort, young Trainer."],
  ),
  lady: set(
    ["Do you know how much my Pokémon's ribbons cost?", "Oh, a commoner! How charming. Let's battle.", "I'll battle you, but only briefly."],
    ["Oh my. That was quite rude of you."],
    ["Naturally."],
  ),
  richboy: set(
    ["My dad bought me the best Pokémon money can buy!", "I'll pay you to lose. Just kidding. Battle!", "Money can't buy a win? Let's find out!"],
    ["I'm telling my dad about this!"],
    ["See? Money works!"],
  ),
  beauty: set(
    ["Isn't my team just gorgeous?", "Beauty and power go together. Watch!", "Try not to stare during our battle."],
    ["My makeup is ruined!"],
    ["Beauty wins, as always."],
  ),
  ace: set(
    ["I don't lose. Let's get this over with.", "Only the strongest Trainers walk this way.", "You look ready. I hope you are."],
    ["Impressive. Very few people beat me."],
    ["Train more. Then come find me again."],
  ),
};

// Calm, too confident, or a little off, and right for any class.
export const OVER_INTRO = [
  "I don't usually battle here. Today I'll make an exception.",
  "You're the one I've been waiting for.",
  "Funny. Nobody's beaten me since I moved here.",
  "Don't worry. I'll go easy on you. At first.",
  "My Pokémon haven't had a real battle in a while.",
  "Everyone underestimates me. You will too.",
  "I only look new at this.",
  "Hm. You'll do.",
  "Relax. It'll be over quickly.",
  "I've beaten every Trainer on this route. Twice.",
  "Most people run when they see my team. Will you?",
  "Let's keep this short. I have places to be.",
];

export const RAN = [
  "{player} ran away from {trainer}.",
  "{player} scurried away from {trainer}.",
  "{player} slipped past {trainer}.",
  "{player} hid in the tall grass until {trainer} gave up.",
  "{player} pretended not to see {trainer}.",
  "{player} took the long way around {trainer}.",
];

export const LOST_INTEREST = [
  "{trainer} lost interest.",
  "{trainer} got bored and wandered off.",
  "{trainer} went back to training.",
  "{trainer} found someone else to battle.",
  "{trainer} gave up waiting.",
  "{trainer} shrugged and walked away.",
];

// A card from before a restart: the Trainer's name is gone with the open encounter.
export const STALE_LINE = "This Trainer lost interest.";

export const fill = (template, { player, trainer }) => template.replaceAll("{player}", player).replaceAll("{trainer}", trainer);
