/**
 * touch.js — commandes tactiles, sans connaissance de la scène.
 *
 * main.js décide seul ce que font saut/caméra/pause et fournit l'API du shiba.
 * Ce module ne traduit que les pointer events en intentions analogiques : le
 * repère caméra reste donc, comme au clavier, la responsabilité de shiba.js.
 */

const STICK_RADIUS = 56;
const DEAD_ZONE = STICK_RADIUS * 0.15;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createTouchControls({ shiba, onJump, onCamera, onPause }) {
  const root = document.getElementById('touch-ui');
  const stick = document.getElementById('touch-stick');
  const base = stick?.querySelector('.stick-base');
  const nub = stick?.querySelector('.stick-nub');
  const hint = document.getElementById('touch-hint');
  const runButton = document.getElementById('touch-run');

  if (!root || !stick || !base || !nub || !runButton) return null;
  root.hidden = false;

  let stickPointer = null;
  let runPointer = null;
  let centreX = 0;
  let centreY = 0;
  let fwd = 0;
  let side = 0;
  let running = false;

  const sendStick = () => shiba.setStick(fwd, side, running);

  function placePart(part, x, y) {
    part.style.left = `${x}px`;
    part.style.top = `${y}px`;
  }

  function updateStick(e) {
    const rect = stick.getBoundingClientRect();
    const dx = e.clientX - rect.left - centreX;
    const dy = e.clientY - rect.top - centreY;
    const length = Math.hypot(dx, dy);
    const visualScale = length > STICK_RADIUS ? STICK_RADIUS / length : 1;

    placePart(nub, centreX + dx * visualScale, centreY + dy * visualScale);

    // La zone morte retire le tremblement du pouce sans créer un palier : la
    // force restante est remappée sur 0..1, direction inchangée.
    const strength = length <= DEAD_ZONE
      ? 0
      : clamp((length - DEAD_ZONE) / (STICK_RADIUS - DEAD_ZONE), 0, 1);
    fwd = length > 0 ? -dy / length * strength : 0;
    side = length > 0 ? dx / length * strength : 0;
    sendStick();
  }

  function beginStick(e) {
    if (stickPointer !== null) return;
    e.preventDefault();
    const rect = stick.getBoundingClientRect();
    stickPointer = e.pointerId;
    centreX = e.clientX - rect.left;
    centreY = e.clientY - rect.top;
    fwd = 0;
    side = 0;
    placePart(base, centreX, centreY);
    placePart(nub, centreX, centreY);
    stick.classList.add('active');
    hint?.classList.add('gone');
    stick.setPointerCapture(e.pointerId);
    sendStick();
  }

  function moveStick(e) {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    updateStick(e);
  }

  function endStick(e) {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    fwd = 0;
    side = 0;
    stick.classList.remove('active');
    sendStick();
  }

  function beginRun(e) {
    if (runPointer !== null) return;
    e.preventDefault();
    runPointer = e.pointerId;
    running = true;
    runButton.setAttribute('aria-pressed', 'true');
    runButton.setPointerCapture(e.pointerId);
    sendStick();
  }

  function endRun(e) {
    if (e.pointerId !== runPointer) return;
    runPointer = null;
    running = false;
    runButton.setAttribute('aria-pressed', 'false');
    sendStick();
  }

  function bindAction(id, action) {
    const button = document.getElementById(id);
    button?.addEventListener('click', () => {
      const pressed = action();
      if (typeof pressed === 'boolean') {
        button.setAttribute('aria-pressed', String(pressed));
      }
    });
  }

  stick.addEventListener('pointerdown', beginStick);
  stick.addEventListener('pointermove', moveStick);
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  stick.addEventListener('lostpointercapture', endStick);

  runButton.addEventListener('pointerdown', beginRun);
  runButton.addEventListener('pointerup', endRun);
  runButton.addEventListener('pointercancel', endRun);
  runButton.addEventListener('lostpointercapture', endRun);

  bindAction('touch-jump', onJump);
  bindAction('touch-camera', onCamera);
  bindAction('touch-pause', onPause);

  // Un changement d'application ne doit jamais laisser une course maintenue
  // ni un stick fantôme : les pointerup mobiles ne sont pas garantis au blur.
  addEventListener('blur', () => {
    stickPointer = null;
    runPointer = null;
    fwd = 0;
    side = 0;
    running = false;
    stick.classList.remove('active');
    runButton.setAttribute('aria-pressed', 'false');
    sendStick();
  });

  return { root, stick };
}

export default createTouchControls;
