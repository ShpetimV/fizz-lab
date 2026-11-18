// Built-in narration script, in Vera's voice: dry, deadpan, faintly unimpressed.
// These lines are spoken as-is by the browser voice, and double as the verified
// facts handed to the LLM when the voice companion is running.

export function greeting(hour = new Date().getHours()) {
  const part = hour < 5 ? 'Up late. So am I, but I have no choice' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}. I am Vera, and this is Fizz. Build molecules from the dock at the top, or pick liquid metal, bubbles or water on the left.`;
}

export const LINES = {
  mouseMode: 'No camera, so the mouse will have to play the part of your hand. It has fewer fingers, but it rarely drops things.',
  firstAtom: 'An atom. Those small lights are its valence electrons, drawn Bohr-style so you can count them.',
  firstBond: 'A covalent bond. Watch the electrons move in to be shared. They are better at sharing than most people.',
  unnamed: 'A valid structure, though not one in my catalogue. Points for originality.',
  broken: ['Back to atoms. Nothing is lost; matter is conserved.', 'Dismantled. The atoms are none the worse for it.', 'Bonds broken. Shall we try that again?'],
  cleared: 'Bench cleared. A fresh start, which you may need.',
  allFound: 'That is all eighteen. The catalogue is complete. I am, against my better judgement, impressed.',
  coHint: 'Carbon still wants two more bonds. Add another oxygen, or leave it alone and watch.',
  dative: 'Left alone, oxygen donates a lone pair to close a third bond.',
  rejected: {
    full: [
      'That atom has all the bonds it can hold. Valence is not a suggestion.',
      'Full, I am afraid. Atoms are sticklers for their valence.',
      'No vacancy. Its outer shell is already complete.',
      'It declines. Every bonding position is taken.',
    ],
    H: ['Hydrogen forms one bond, and one only. It is quite firm on the matter.'],
    metallic: ['Two sodium atoms would rather form a metal, and that takes a good deal more than two.'],
    ion: ['Sodium had precisely one electron to give, and it has given it.'],
  },
  water: {
    enter: 'The water lab. Forty molecules. Open both palms and move your hands apart to add heat, together to remove it.',
    enterMouse: 'The water lab. Forty molecules. Scroll to change the temperature.',
    exit: 'Back to the bench.',
    freeze: 'Freezing. Each molecule now holds four neighbours at arm’s length, in an open hexagonal lattice. All that empty space is why ice is less dense than water, and floats.',
    melt: 'Melting. The lattice collapses and the molecules slide closer together, hydrogen bonds breaking and re-forming constantly. That is why liquid water is denser than ice.',
    boil: 'Boiling. The molecules now move too fast for hydrogen bonds to hold them, and fly apart as steam.',
    condense: 'Condensing. Slower molecules are caught again by hydrogen bonds, and gather into liquid.',
  },
  liquid: {
    enter: 'Liquid metal. Pinch it and pull, and a droplet comes away. Pick another liquid from the dock whenever you like.',
    enterMouse: 'Liquid metal. Drag it to pull droplets off, or double-click to splash it. Pick another liquid from the dock.',
  },
  bubbles: {
    enter: 'Soap bubbles. Pinch and hold to blow one, open your fingers to let it go. Poke them, if you must.',
    enterMouse: 'Soap bubbles. Hold the mouse button to blow one and let go to release it. Click one to pop it.',
  },
  back: 'Back to the molecules.',
};

export const pickLine = (list) => list[Math.floor(Math.random() * list.length)];

export const repeatLine = (entry) => `${entry.name}, once more.`;
