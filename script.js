import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

const game = document.querySelector('#game');
const loading = document.querySelector('#loading');
const startButton = document.querySelector('#startButton');
const speedEl = document.querySelector('#speed');
const coinsEl = document.querySelector('#coins');
const distanceEl = document.querySelector('#distance');
const toast = document.querySelector('#toast');
const errorBox = document.querySelector('#error');

let scene, camera, renderer, bike;
let running = false, speed = 0, coins = 0, distance = 0, steer = 0;
let toastTimer;
const keys = new Set();
const controls = { left: false, right: false, accelerate: false, brake: false };
const roadSegments = [];
const coinObjects = [];
const sceneryObjects = [];
const clock = new THREE.Clock();
const bikeParts = {};
const ROAD_WIDTH = 10;

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}
function mat(color, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function box(parent, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
function cylinderBetween(parent, a, b, radius, material, radialSegments = 10) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function makeWheel(parent, x, y, z, radius = 0.48) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const tireMat = mat(0x171b1c, 0.65);
  const rimMat = mat(0xcbd7d5, 0.28, 0.72);
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.052, 10, 36), tireMat);
  tire.rotation.y = Math.PI / 2; tire.castShadow = true; group.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.075, 0.018, 8, 36), rimMat);
  rim.rotation.y = Math.PI / 2; group.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.15, 12), rimMat);
  hub.rotation.z = Math.PI / 2; group.add(hub);
  const spokeMat = mat(0xb8c9c6, 0.35, 0.5);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    cylinderBetween(group, [0, 0, 0], [0, Math.sin(angle) * (radius - 0.08), Math.cos(angle) * (radius - 0.08)], 0.007, spokeMat, 5);
  }
  // Small tire sidewall accent
  const accent = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.035, 0.009, 5, 36), mat(0x6c7775, 0.5));
  accent.rotation.y = Math.PI / 2; group.add(accent);
  parent.add(group); return group;
}

function makeBike() {
  const root = new THREE.Group();
  // Materials and main wheel geometry
  const frameMat = mat(0xf05b36, 0.32, 0.25);
  const darkMat = mat(0x17211f, 0.48);
  const metalMat = mat(0xc7d2d0, 0.24, 0.7);
  const rubberMat = mat(0x202625, 0.8);
  const wheelY = 0.52, rearZ = -0.98, frontZ = 0.98;
  const rear = [0, wheelY, rearZ], front = [0, wheelY, frontZ];
  const crank = [0, 0.62, -0.12], seatTubeTop = [0, 1.16, -0.52], headTop = [0, 1.05, 0.60], headBottom = [0, 0.76, 0.75];

  bikeParts.rearWheel = makeWheel(root, ...rear);
  bikeParts.frontWheel = makeWheel(root, ...front);
  // Frame: double-triangle silhouette, fork, and rear stays
  cylinderBetween(root, rear, crank, 0.032, frameMat);
  cylinderBetween(root, crank, seatTubeTop, 0.032, frameMat);
  cylinderBetween(root, seatTubeTop, rear, 0.032, frameMat);
  cylinderBetween(root, seatTubeTop, headTop, 0.034, frameMat);
  cylinderBetween(root, headTop, crank, 0.032, frameMat);
  cylinderBetween(root, headTop, headBottom, 0.045, metalMat);
  cylinderBetween(root, headBottom, front, 0.026, frameMat);
  cylinderBetween(root, rear, [0, 0.8, -0.7], 0.022, metalMat);
  // Seatpost, padded saddle and bar tape
  cylinderBetween(root, seatTubeTop, [0, 1.32, -0.56], 0.027, metalMat);
  const saddle = box(root, 0.30, 0.065, 0.16, darkMat, 0, 1.36, -0.58);
  saddle.rotation.y = 0.05;
  cylinderBetween(root, headTop, [0, 1.22, 0.63], 0.025, metalMat);
  cylinderBetween(root, [-0.38, 1.24, 0.65], [0.38, 1.24, 0.65], 0.032, darkMat);
  const gripL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10), rubberMat);
  gripL.rotation.z = Math.PI / 2; gripL.position.set(-0.36, 1.24, 0.65); root.add(gripL);
  const gripR = gripL.clone(); gripR.position.x = 0.36; root.add(gripR);
  // Pedals and crank arms rotate with rider's pedaling cadence
  bikeParts.crankGroup = new THREE.Group();
  bikeParts.crankGroup.position.set(...crank);
  root.add(bikeParts.crankGroup);
  cylinderBetween(bikeParts.crankGroup, [-0.11, 0, 0], [0.11, 0, 0], 0.035, metalMat);
  for (const side of [-1, 1]) {
    const arm = box(bikeParts.crankGroup, 0.045, 0.29, 0.045, metalMat, side * 0.12, -0.08, 0);
    arm.rotation.z = side * 0.2;
    const pedal = box(bikeParts.crankGroup, 0.16, 0.035, 0.09, darkMat, side * 0.12, -0.22, 0);
    pedal.name = `pedal-${side}`;
  }
  // Chainring, sprocket and a visible chain line
  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), metalMat);
  chainring.position.set(0.09, 0.62, -0.12); chainring.rotation.y = Math.PI / 2; root.add(chainring);
  const rearGear = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 6, 18), metalMat);
  rearGear.position.set(0.06, 0.52, -0.98); rearGear.rotation.y = Math.PI / 2; root.add(rearGear);
  cylinderBetween(root, [0.11, 0.62, -0.12], [0.11, 0.52, -0.98], 0.012, darkMat, 6);
  cylinderBetween(root, [0.11, 0.62, -0.12], [0.11, 0.52, -0.98], 0.012, darkMat, 6);
  // Front and rear mudguards: thin curved segmented strips
  const mudMat = mat(0x283b37, 0.35, 0.25);
  for (const [z, y] of [[rearZ, wheelY], [frontZ, wheelY]]) {
    const mudguard = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * (0.12 + i * 0.095);
      const segment = box(mudguard, 0.035, 0.018, 0.22, mudMat, 0, Math.cos(angle) * 0.56, Math.sin(angle) * 0.56);
      segment.rotation.x = -angle;
    }
    mudguard.position.set(0, y, z); root.add(mudguard);
  }
  // Front light and rear reflector
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), mat(0xfff1b4, 0.25, 0.2));
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 1.17, 0.78); root.add(lamp);
  box(root, 0.11, 0.07, 0.05, mat(0xf0443e), 0, 0.83, -0.93);

  // Rider pivot allows natural upper body sway while the legs pedal
  bikeParts.rider = new THREE.Group();
  bikeParts.rider.position.set(0, 0, 0);
  root.add(bikeParts.rider);
  const rider = bikeParts.rider;
  const shirt = mat(0x1aa477, 0.7);
  const skin = mat(0xb9794e, 0.8);
  const shorts = mat(0x253b68, 0.75);
  const helmetMat = mat(0xffd64a, 0.3);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.29, 5, 10), shirt);
  torso.position.set(0, 1.76, -0.16); torso.rotation.x = -0.38; torso.castShadow = true; rider.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.13, 10), skin);
  neck.position.set(0, 1.99, 0.015); neck.rotation.x = -0.3; rider.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), skin);
  head.position.set(0, 2.13, 0.04); head.castShadow = true; rider.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
  helmet.position.set(0, 2.2, 0.035); rider.add(helmet);
  // Helmet brim and small reflective strip
  box(rider, 0.27, 0.025, 0.11, helmetMat, 0, 2.14, 0.13);
  box(rider, 0.22, 0.018, 0.018, mat(0xffffff, 0.2), 0, 2.22, 0.19);
  // Shoulder joints and animated upper arms
  bikeParts.leftArm = new THREE.Group();
  bikeParts.leftArm.position.set(-0.16, 1.88, -0.08); rider.add(bikeParts.leftArm);
  cylinderBetween(bikeParts.leftArm, [0, 0, 0], [-0.08, -0.22, 0.34], 0.065, shirt);
  cylinderBetween(bikeParts.leftArm, [-0.08, -0.22, 0.34], [-0.24, -0.63, 0.72], 0.048, skin);
  bikeParts.rightArm = new THREE.Group();
  bikeParts.rightArm.position.set(0.16, 1.88, -0.08); rider.add(bikeParts.rightArm);
  cylinderBetween(bikeParts.rightArm, [0, 0, 0], [0.08, -0.22, 0.34], 0.065, shirt);
  cylinderBetween(bikeParts.rightArm, [0.08, -0.22, 0.34], [0.24, -0.63, 0.72], 0.048, skin);
  // Animated thighs and shins pivot at the hips/knees
  bikeParts.leftThigh = new THREE.Group();
  bikeParts.leftThigh.position.set(-0.105, 1.55, -0.18); rider.add(bikeParts.leftThigh);
  cylinderBetween(bikeParts.leftThigh, [0, 0, 0], [-0.025, -0.31, 0.02], 0.085, shorts);
  bikeParts.leftShin = new THREE.Group();
  bikeParts.leftShin.position.set(-0.025, -0.31, 0.02); bikeParts.leftThigh.add(bikeParts.leftShin);
  cylinderBetween(bikeParts.leftShin, [0, 0, 0], [0.025, -0.48, -0.01], 0.052, skin);
  bikeParts.rightThigh = new THREE.Group();
  bikeParts.rightThigh.position.set(0.105, 1.55, -0.18); rider.add(bikeParts.rightThigh);
  cylinderBetween(bikeParts.rightThigh, [0, 0, 0], [0.025, -0.31, -0.02], 0.085, shorts);
  bikeParts.rightShin = new THREE.Group();
  bikeParts.rightShin.position.set(0.025, -0.31, -0.02); bikeParts.rightThigh.add(bikeParts.rightShin);
  cylinderBetween(bikeParts.rightShin, [0, 0, 0], [-0.025, -0.48, 0.01], 0.052, skin);
  // Shoes move with the lower legs
  bikeParts.leftFoot = box(bikeParts.leftShin, 0.12, 0.08, 0.2, darkMat, 0, -0.48, 0.08);
  bikeParts.rightFoot = box(bikeParts.rightShin, 0.12, 0.08, 0.2, darkMat, 0, -0.48, 0.08);
  root.position.set(0, 0, 2.5);
  scene.add(root);
  return root;
}

function makeTree(x, z, scale = 1) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.2 * scale, 1.5 * scale, 7), mat(0x795333));
  trunk.position.y = 0.75 * scale; trunk.castShadow = true; group.add(trunk);
  const leafMat = mat(0x247c48);
  for (let i = 0; i < 4; i++) {
    const leaves = new THREE.Mesh(new THREE.SphereGeometry((0.62 - i * 0.07) * scale, 9, 7), leafMat);
    leaves.position.set((i % 2 ? 0.18 : -0.12) * scale, (1.5 + i * 0.3) * scale, (i % 2 ? -0.12 : 0.1) * scale);
    leaves.castShadow = true; group.add(leaves);
  }
  group.position.set(x, 0, z); scene.add(group); sceneryObjects.push(group);
}
function makeHouse(x, z, variant = 0) {
  const group = new THREE.Group();
  const wallColors = [0xf2d5a0, 0xd8e9db, 0xe8b8a1, 0xc8d9e9];
  const wall = mat(wallColors[variant % wallColors.length]);
  const roof = mat(variant % 2 ? 0x536b70 : 0x8d4135);
  const trim = mat(0xffffff);
  box(group, 2.5, 1.8, 2.2, wall, 0, 0.9, 0);
  const roofLeft = box(group, 1.45, 0.13, 2.55, roof, -0.62, 1.92, 0); roofLeft.rotation.z = -0.24;
  const roofRight = box(group, 1.45, 0.13, 2.55, roof, 0.62, 1.92, 0); roofRight.rotation.z = 0.24;
  box(group, 0.55, 1.05, 0.08, mat(0x75472f), 0, 0.53, 1.14);
  box(group, 0.48, 0.42, 0.08, mat(0x8dd3e4), -0.72, 1.12, 1.14);
  box(group, 0.55, 0.07, 0.12, trim, -0.72, 1.12, 1.2);
  box(group, 0.07, 0.45, 0.12, trim, -0.72, 1.12, 1.2);
  group.position.set(x, 0, z); scene.add(group); sceneryObjects.push(group);
}
function makeSignText(text, color) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color; ctx.font = '900 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.7, 0.42, 1); return sprite;
}
function makeStore(x, z) {
  const group = new THREE.Group();
  box(group, 2.5, 1.9, 2.1, mat(0xe8c995), 0, 0.95, 0);
  box(group, 2.75, 0.18, 2.35, mat(0x168b61), 0, 1.98, 0);
  box(group, 1.9, 0.35, 0.08, mat(0xe33c35), 0, 2.2, 1.18);
  const sign = makeSignText('SARI-SARI', '#ffffff'); sign.position.set(0, 2.18, 1.235); group.add(sign);
  box(group, 1.6, 0.12, 0.65, mat(0x805536), 0, 0.72, 1.05);
  group.position.set(x, 0, z); scene.add(group); sceneryObjects.push(group);
}
function makeCoin(x, z) {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd43b, metalness: 0.65, roughness: 0.24, emissive: 0x704900 });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.09, 20), gold);
  coin.rotation.x = Math.PI / 2; coin.castShadow = true; group.add(coin);
  const center = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), mat(0xfff0a0));
  center.position.z = 0.06; group.add(center);
  group.position.set(x, 1.1, z); scene.add(group); coinObjects.push(group);
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bd7eb);
  scene.fog = new THREE.Fog(0x9bd7eb, 35, 150);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 250);
  camera.position.set(0, 5.7, 10.5); camera.lookAt(0, 1, -5);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  game.insertBefore(renderer.domElement, game.firstChild);
  scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x64734b, 2.1));
  const sun = new THREE.DirectionalLight(0xfff0d5, 2.7);
  sun.position.set(-8, 15, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
  scene.add(sun);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(0x6baf61));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.08; grass.receiveShadow = true; scene.add(grass);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 500), mat(0x42494b));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -120); road.receiveShadow = true; scene.add(road);
  const shoulderMat = mat(0xc9b98b);
  for (const x of [-5.5, 5.5]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 500), shoulderMat);
    shoulder.position.set(x, -0.015, -120); scene.add(shoulder);
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5e7b7, emissive: 0x302812 });
  for (let z = 20; z > -260; z -= 8) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 3.2), lineMat);
    dash.position.set(0, 0.015, z); scene.add(dash); roadSegments.push(dash);
  }
  for (let i = 0; i < 18; i++) {
    const z = 8 - i * 13;
    if (i % 3 === 0) makeStore(-8.1, z - 2); else makeHouse(-8.0, z, i);
    if (i % 2 === 0) makeHouse(8.0, z - 5, i + 1); else makeTree(7.9, z - 3, 1.1);
    if (i % 3 !== 1) makeTree(-6.1, z - 7, 0.85);
  }
  for (let i = 0; i < 14; i++) {
    const z = 6 - i * 17;
    for (const x of [-6.2, 6.2]) {
      const pole = new THREE.Group();
      cylinderBetween(pole, [0, 0, 0], [0, 4.1, 0], 0.07, mat(0x6b5a43));
      cylinderBetween(pole, [-0.65, 3.8, 0], [0.65, 3.8, 0], 0.055, mat(0x6b5a43));
      pole.position.set(x, 0, z); scene.add(pole); sceneryObjects.push(pole);
    }
  }
  for (let i = 0; i < 24; i++) makeCoin([-2.6, 0, 2.6][i % 3], -12 - i * 7);
  bike = makeBike();
}

function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 900);
}
function resetGame() {
  speed = 0; coins = 0; distance = 0; steer = 0; bike.position.x = 0;
  coinsEl.textContent = '0'; speedEl.textContent = '0'; distanceEl.textContent = '0';
  for (const coin of coinObjects) { coin.userData.collected = false; coin.visible = true; }
}
function startGame() {
  if (running) return;
  if (!renderer) {
    try { createWorld(); }
    catch (error) { console.error(error); showError('Could not start 3D graphics. Try an updated Chrome browser with internet access.'); return; }
  }
  resetGame(); running = true; loading.classList.add('hidden'); clock.start(); animate();
}
function setControl(name, pressed) { if (name in controls) controls[name] = pressed; }
function bindControls() {
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
    keys.add(key);
    if ((key === 'enter' || key === ' ') && !running) startGame();
  }, { passive: false });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); Object.keys(controls).forEach(key => controls[key] = false); });
  document.querySelectorAll('[data-control]').forEach(button => {
    const name = button.dataset.control;
    const down = event => { event.preventDefault(); setControl(name, true); if (button.setPointerCapture) button.setPointerCapture(event.pointerId); };
    const up = event => { event.preventDefault(); setControl(name, false); };
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  startButton.addEventListener('click', startGame);
  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  });
}

function updatePedaling(dt, accelerating) {
  const cadence = speed > 0.8 ? (2.8 + speed * 0.16) : 0;
  bikeParts.crankGroup.rotation.x += cadence * dt;
  const phase = bikeParts.crankGroup.rotation.x;
  // Opposite leg rotation and bending knees create a cycling motion.
  const pedalWave = Math.sin(phase);
  const oppositeWave = Math.sin(phase + Math.PI);
  bikeParts.leftThigh.rotation.x = pedalWave * 0.55;
  bikeParts.rightThigh.rotation.x = oppositeWave * 0.55;
  bikeParts.leftShin.rotation.x = -0.18 - Math.max(0, -pedalWave) * 0.65;
  bikeParts.rightShin.rotation.x = -0.18 - Math.max(0, -oppositeWave) * 0.65;
  bikeParts.leftFoot.rotation.x = -pedalWave * 0.15;
  bikeParts.rightFoot.rotation.x = -oppositeWave * 0.15;
  // Subtle upper-body sway increases slightly while pedaling hard.
  const effort = accelerating ? 1 : 0.45;
  bikeParts.rider.rotation.z = Math.sin(phase * 0.5) * 0.025 * effort;
  bikeParts.rider.rotation.x = Math.sin(phase) * 0.012;
  bikeParts.leftArm.rotation.x = Math.sin(phase) * 0.025;
  bikeParts.rightArm.rotation.x = -Math.sin(phase) * 0.025;
}

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  const accelerate = keys.has('w') || keys.has('arrowup') || controls.accelerate;
  const brake = keys.has('s') || keys.has('arrowdown') || controls.brake;
  const left = keys.has('a') || keys.has('arrowleft') || controls.left;
  const right = keys.has('d') || keys.has('arrowright') || controls.right;
  if (accelerate) speed += 22 * dt; else speed -= 5.5 * dt;
  if (brake) speed -= 32 * dt;
  speed = THREE.MathUtils.clamp(speed, 0, 48);
  const steerInput = (right ? 1 : 0) - (left ? 1 : 0);
  steer = THREE.MathUtils.lerp(steer, steerInput, Math.min(1, dt * 6));
  bike.position.x += steer * dt * (1.5 + speed * 0.105);
  bike.position.x = THREE.MathUtils.clamp(bike.position.x, -4.15, 4.15);
  bike.rotation.z = -steer * 0.12;
  bike.rotation.y = -steer * 0.09;
  const wheelRoll = speed * dt * 0.65;
  bikeParts.frontWheel.rotation.x -= wheelRoll;
  bikeParts.rearWheel.rotation.x -= wheelRoll;
  updatePedaling(dt, accelerate);

  const worldMove = speed * dt * 0.52;
  distance += worldMove;
  for (const dash of roadSegments) {
    dash.position.z += worldMove;
    if (dash.position.z > 15) dash.position.z -= 288;
  }
  for (const object of sceneryObjects) {
    object.position.z += worldMove;
    if (object.position.z > 18) object.position.z -= 250;
  }
  for (const coin of coinObjects) {
    coin.position.z += worldMove; coin.rotation.y += dt * 2.7;
    coin.position.y = 1.1 + Math.sin(performance.now() * 0.003 + coin.position.z) * 0.09;
    if (!coin.userData.collected && Math.abs(coin.position.z - bike.position.z) < 1.15 && Math.abs(coin.position.x - bike.position.x) < 0.85) {
      coin.userData.collected = true; coin.visible = false; coins++; coinsEl.textContent = String(coins); showToast('+1 COIN!');
    }
    if (coin.position.z > 8) {
      coin.position.z -= 168; coin.position.x = [-2.6, 0, 2.6][Math.floor(Math.random() * 3)];
      coin.userData.collected = false; coin.visible = true;
    }
  }
  speedEl.textContent = String(Math.round(speed * 2.2));
  distanceEl.textContent = String(Math.floor(distance));
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, bike.position.x * 0.42, dt * 2);
  camera.position.y = 5.6 + speed * 0.008; camera.position.z = 10.5;
  camera.lookAt(bike.position.x * 0.24, 1.05, -5);
  renderer.render(scene, camera);
}
bindControls();
