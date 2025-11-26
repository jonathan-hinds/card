const playButton = document.getElementById('play-button');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');

let score = 0;
let best = 0;
let cooldown = false;

function bumpScore() {
  if (cooldown) return;
  cooldown = true;
  score += 1;
  scoreEl.textContent = score;

  if (score > best) {
    best = score;
    bestEl.textContent = best;
  }

  playButton.disabled = true;
  playButton.classList.add('active');

  setTimeout(() => {
    cooldown = false;
    playButton.disabled = false;
    playButton.classList.remove('active');
  }, 320);
}

function resetScore() {
  score = 0;
  scoreEl.textContent = score;
}

playButton.addEventListener('click', bumpScore);
playButton.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter') {
    bumpScore();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resetScore();
  }
});
