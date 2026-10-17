const THREE = window.THREE;

const ROOT = document.querySelector("#scene");
const MAX_NEURONS = 1800;
const MAX_CAPSULES = 24;
const MAX_ACTIVE_REQUESTS = 3;
const INITIAL_NEURONS = 1200;
const EDGE_CAPACITY = 14000;
const CATEGORIES = ["coding", "reasoning", "math", "vision", "tool_use", "science", "history", "language", "general_chat"];
const REQUEST_COLORS = [0x83a8ca, 0xc78185, 0x8daf92, 0xb5a776, 0x9b8ab8, 0xb88da9, 0x7eafb0];
const CATEGORY_COLORS = {
  coding: 0x779b84,
  reasoning: 0x8979a1,
  math: 0xb08b68,
  vision: 0x718ba8,
  tool_use: 0x779b84,
  science: 0x7293a9,
  history: 0xa28c71,
  language: 0x67999b,
  general_chat: 0xa7afb7
};
const REGION_COLORS = {
  input: 0x6483a7,
  language: 0x5d9294,
  reasoning: 0x83759c,
  memory: 0xa4896d,
  tools: 0x72917b,
  output: 0xaeb6bf
};
const REGION_CATEGORIES = {
  input: ["vision"],
  language: ["language", "general_chat"],
  reasoning: ["reasoning", "math", "science"],
  memory: ["history", "science"],
  tools: ["coding", "tool_use"],
  output: ["general_chat", "language"]
};
const CATEGORY_REGIONS = {
  coding: ["tools", "reasoning"],
  reasoning: ["reasoning"],
  math: ["reasoning", "memory"],
  vision: ["input"],
  tool_use: ["tools"],
  science: ["memory", "reasoning"],
  history: ["memory"],
  language: ["language"],
  general_chat: ["language", "output"]
};
const SUBSYSTEMS = ["input", "language", "reasoning", "memory", "tools", "output"];
const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b10);
scene.fog = new THREE.FogExp2(0x080b10, 0.018);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 220);
camera.position.set(0, 1.7, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
ROOT.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.enablePan = false;
controls.minDistance = 11;
controls.maxDistance = 34;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.08;

const composer = new THREE.EffectComposer(renderer);
composer.addPass(new THREE.RenderPass(scene, camera));
const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.45, 0.72);
bloom.threshold = 0.72;
bloom.strength = 0.18;
bloom.radius = 0.35;
composer.addPass(bloom);

const neurons = [];
const edges = [];
const edgeKeys = new Set();
const requests = [];
const capsules = [];
const sparks = [];
const knowledge = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
const recentRequests = [];
const growthCooldowns = new Map();
const discoveredClusters = new Set(["coding", "reasoning", "math", "vision", "tool_use", "general_chat"]);
const regionCenters = {
  input: new THREE.Vector3(-3.1, 1.4, 0.4),
  language: new THREE.Vector3(0.5, 3.25, 0.2),
  reasoning: new THREE.Vector3(3.1, 1.25, -0.5),
  memory: new THREE.Vector3(2.3, -2.4, 0.6),
  tools: new THREE.Vector3(-1.1, -3.1, -0.3),
  output: new THREE.Vector3(-3.45, -1.35, 0.5)
};
const clusterCenters = new Map();
let elapsed = 0;
let nextRequestAt = 2.5;
let nextAmbientPulse = 5;
let lastUiUpdate = 0;
let lastPruneCheck = 0;
let toastTimeout;
let requestSequence = 0;

for (const [region, center] of Object.entries(regionCenters)) clusterCenters.set(region, center.clone());

const nodeGeometry = new THREE.SphereGeometry(0.035, 8, 6);
const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, MAX_NEURONS);
nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEURONS * 3), 3);
nodeMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
nodeMesh.count = 0;
nodeMesh.frustumCulled = false;
scene.add(nodeMesh);

function createCapsuleGeometry(radius, length, radialSegments, capSegments) {
  const rings = [];
  for (let i = 0; i <= capSegments; i++) {
    const angle = -Math.PI / 2 + (i / capSegments) * (Math.PI / 2);
    rings.push({ y: -length / 2 + Math.sin(angle) * radius, radius: Math.cos(angle) * radius });
  }
  rings.push({ y: length / 2, radius });
  for (let i = 1; i <= capSegments; i++) {
    const angle = (i / capSegments) * (Math.PI / 2);
    rings.push({ y: length / 2 + Math.sin(angle) * radius, radius: Math.cos(angle) * radius });
  }
  const positions = [];
  const indices = [];
  for (const ring of rings) {
    for (let i = 0; i < radialSegments; i++) {
      const angle = (i / radialSegments) * Math.PI * 2;
      positions.push(Math.cos(angle) * ring.radius, ring.y, Math.sin(angle) * ring.radius);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      const lower = ring * radialSegments + i;
      const lowerNext = ring * radialSegments + next;
      const upper = (ring + 1) * radialSegments + i;
      const upperNext = (ring + 1) * radialSegments + next;
      indices.push(lower, upper, lowerNext, upper, upperNext, lowerNext);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const capsuleGeometry = createCapsuleGeometry(0.023, 0.07, 8, 4);
const capsuleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
const capsuleMesh = new THREE.InstancedMesh(capsuleGeometry, capsuleMaterial, MAX_CAPSULES);
capsuleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
capsuleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CAPSULES * 3), 3);
capsuleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
capsuleMesh.count = 0;
capsuleMesh.frustumCulled = false;
scene.add(capsuleMesh);

const sparkGeometry = new THREE.SphereGeometry(0.018, 6, 5);
const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
const sparkMesh = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, 80);
sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3);
sparkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
sparkMesh.count = 0;
sparkMesh.frustumCulled = false;
scene.add(sparkMesh);

const edgePositions = new Float32Array(EDGE_CAPACITY * 18);
const edgeColors = new Float32Array(EDGE_CAPACITY * 18);
const edgeGeometry = new THREE.BufferGeometry();
edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
edgeGeometry.setAttribute("color", new THREE.BufferAttribute(edgeColors, 3).setUsage(THREE.DynamicDrawUsage));
const edgeMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.48,
  depthWrite: false,
  side: THREE.DoubleSide
});
const edgeMesh = new THREE.Mesh(edgeGeometry, edgeMaterial);
edgeMesh.frustumCulled = false;
scene.add(edgeMesh);

const dummy = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);
const edgeDirection = new THREE.Vector3();
const edgeSide = new THREE.Vector3();
const edgeMidpoint = new THREE.Vector3();
const tempColor = new THREE.Color();
const edgeColor = new THREE.Color();
const whiteColor = new THREE.Color(0xffffff);
const specializationColor = new THREE.Color();
const partialEnd = new THREE.Vector3();

function gaussian() {
  const u = Math.max(Math.random(), 1e-8);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function randomInSphere(radius) {
  const direction = new THREE.Vector3(gaussian(), gaussian(), gaussian()).normalize();
  return direction.multiplyScalar(Math.cbrt(Math.random()) * radius);
}

function categoryForRegion(region) {
  const categories = REGION_CATEGORIES[region];
  return categories[Math.floor(Math.random() * categories.length)];
}

function addNeuron({ position, region, category, base = false, growth = 1, special = false }) {
  if (neurons.length >= MAX_NEURONS) return -1;
  const index = neurons.length;
  const fallbackRegion = region || "reasoning";
  const specialization = category || categoryForRegion(fallbackRegion);
  neurons.push({
    position: position.clone(),
    target: position.clone(),
    region: fallbackRegion,
    category: specialization,
    color: new THREE.Color(special ? CATEGORY_COLORS[specialization] : REGION_COLORS[fallbackRegion]),
    heat: 0,
    lastActive: elapsed,
    growth,
    base,
    special,
    active: true,
    pruning: false,
    pruneStarted: 0,
    pulse: Math.random() * Math.PI * 2,
    pulseAmount: Math.random() * 0.03
  });
  return index;
}

function addEdge(a, b, growth = 1) {
  if (a === b || edges.length >= EDGE_CAPACITY / 2) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = `${lo}:${hi}`;
  if (edgeKeys.has(key)) return null;
  edgeKeys.add(key);
  const edge = { a, b, origin: a, strength: growth ? 0.42 : 0.05, activity: 0, growth, active: true, lastUsed: elapsed };
  edges.push(edge);
  neurons[a].edges.push(edge);
  neurons[b].edges.push(edge);
  return edge;
}

for (let i = 0; i < INITIAL_NEURONS; i++) {
  const region = SUBSYSTEMS[i % SUBSYSTEMS.length];
  const center = regionCenters[region];
  const point = center.clone().add(randomInSphere(2.55));
  if (point.length() > 7.6) point.setLength(7.6);
  addNeuron({ position: point, region, base: true });
  neurons[i].edges = [];
}

for (let i = 0; i < neurons.length; i++) neurons[i].edges = [];

for (let i = 0; i < INITIAL_NEURONS; i++) {
  const point = neurons[i].position;
  const nearest = [];
  for (let j = 0; j < INITIAL_NEURONS; j++) {
    if (i === j) continue;
    const distance = point.distanceToSquared(neurons[j].position);
    if (nearest.length < 5 || distance < nearest[nearest.length - 1].distance) {
      let insertAt = nearest.findIndex(item => distance < item.distance);
      if (insertAt === -1) insertAt = nearest.length;
      nearest.splice(insertAt, 0, { index: j, distance });
      if (nearest.length > 5) nearest.pop();
    }
  }
  for (const neighbor of nearest) addEdge(i, neighbor.index, 1);
}
nodeMesh.count = neurons.length;

function chooseCategory() {
  const roll = Math.random();
  if (roll < 0.17) return "coding";
  if (roll < 0.32) return "reasoning";
  if (roll < 0.44) return "math";
  if (roll < 0.55) return "vision";
  if (roll < 0.68) return "tool_use";
  if (roll < 0.78) return "science";
  if (roll < 0.86) return "history";
  if (roll < 0.94) return "language";
  return "general_chat";
}

function chooseStart(category) {
  const desiredRegions = CATEGORY_REGIONS[category];
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < neurons.length; i++) {
    const node = neurons[i];
    if (!node.active || node.growth < 0.95) continue;
    const match = node.category === category ? 2.6 : desiredRegions.includes(node.region) ? 1 : 0;
    const score = match + Math.random() * 0.8 + node.heat * 0.025;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function chooseNextNode(current, previous, category) {
  const options = neurons[current].edges;
  let best = null;
  let bestScore = -Infinity;
  const desiredRegions = CATEGORY_REGIONS[category];
  for (const edge of options) {
    if (!edge.active || edge.growth < 0.9) continue;
    const candidate = edge.a === current ? edge.b : edge.a;
    const node = neurons[candidate];
    if (!node.active || node.pruning || candidate === previous && options.length > 1) continue;
    const affinity = node.category === category ? 1.8 : desiredRegions.includes(node.region) ? 0.8 : 0;
    const score = affinity + edge.strength * 1.3 + node.heat * 0.025 + Math.random() * 1.25;
    if (score > bestScore) {
      bestScore = score;
      best = { index: candidate, edge };
    }
  }
  return best || options.map(edge => ({ index: edge.a === current ? edge.b : edge.a, edge }))
    .find(item => item.index !== previous && neurons[item.index].active) || null;
}

function addCapsule(request, startNode) {
  if (capsules.length >= MAX_CAPSULES || startNode < 0) return;
  const next = chooseNextNode(startNode, -1, request.category);
  if (!next) return;
  capsules.push({
    request,
    from: startNode,
    to: next.index,
    previous: -1,
    edge: next.edge,
    progress: Math.random() * 0.55,
    speed: 1.8 + Math.random() * 1.45,
    color: request.color.clone(),
    splitCooldown: 0.7 + Math.random() * 1.8
  });
}

function createRequest() {
  const category = chooseCategory();
  const id = `REQ-${String(++requestSequence).padStart(4, "0")}`;
  const request = {
    id,
    category,
    color: new THREE.Color(REQUEST_COLORS[Math.floor(Math.random() * REQUEST_COLORS.length)]),
    age: 0,
    lifetime: 6 + Math.random() * 5,
    finished: false,
    fade: 1
  };
  requests.push(request);
  knowledge[category] += 1;
  recentRequests.push({ category, time: elapsed });
  const start = chooseStart(category);
  const count = 1 + Math.floor(Math.random() * 2);
  if (start >= 0) {
    for (let i = 0; i < count && capsules.length < MAX_CAPSULES; i++) addCapsule(request, start);
    neurons[start].heat += 0.7;
    neurons[start].lastActive = elapsed;
  }
  checkLearning(category);
}

function showToast(title, detail, duration = 3500) {
  document.querySelector("#toast-title").textContent = title;
  document.querySelector("#toast-detail").textContent = detail;
  const toast = document.querySelector("#event-toast");
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), duration);
}

function clusterPosition(category) {
  if (clusterCenters.has(category)) return clusterCenters.get(category).clone();
  const index = CATEGORIES.indexOf(category);
  const angle = (index / CATEGORIES.length) * Math.PI * 2 + 0.3;
  const center = new THREE.Vector3(Math.cos(angle) * 4.6, Math.sin(angle * 1.7) * 2.8, Math.sin(angle) * 4.6);
  clusterCenters.set(category, center);
  return center.clone();
}

function createGrowthEvent(category, discovery = false) {
  const target = clusterPosition(category);
  const count = discovery ? 5 : 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count && neurons.length < MAX_NEURONS; i++) {
    const end = target.clone().add(randomInSphere(discovery ? 1.8 : 1.25));
    const seed = target.clone().add(randomInSphere(0.22));
    const region = (CATEGORY_REGIONS[category] || ["reasoning"])[0];
    const index = addNeuron({ position: seed, region, category, growth: 0, special: true });
    if (index < 0) break;
    const node = neurons[index];
    node.edges = [];
    node.target.copy(end);
    const candidates = [];
    for (let j = 0; j < index; j++) {
      if (!neurons[j].active || neurons[j].pruning) continue;
      const distance = neurons[j].position.distanceToSquared(end);
      if (candidates.length < (discovery ? 5 : 3) || distance < candidates[candidates.length - 1].distance) {
        let insertAt = candidates.findIndex(item => distance < item.distance);
        if (insertAt === -1) insertAt = candidates.length;
        candidates.splice(insertAt, 0, { index: j, distance });
        if (candidates.length > (discovery ? 5 : 3)) candidates.pop();
      }
    }
    for (const candidate of candidates) addEdge(candidate.index, index, 0);
  }
  if (discovery) {
    discoveredClusters.add(category);
    showToast("New knowledge cluster formed", `${category.replace("_", " ")} is taking shape`, 5000);
    bloom.strength = 0.32;
  }
}

function checkLearning(category) {
  const recent = recentRequests.filter(request => elapsed - request.time < 180);
  const matching = recent.filter(request => request.category === category).length;
  if (matching >= 3 && elapsed - (growthCooldowns.get(category) ?? -Infinity) > 75) {
    growthCooldowns.set(category, elapsed);
    const discovery = !discoveredClusters.has(category) && matching >= 5;
    createGrowthEvent(category, discovery);
    if (!discovery) showToast("Neural pathways strengthened", `${category.replace("_", " ")} cluster adapting`, 2600);
  }
}

function maybeSplit(capsule) {
  if (capsules.length >= MAX_CAPSULES - 1 || capsule.splitCooldown > 0 || Math.random() > 0.004) return;
  capsule.splitCooldown = 1.8 + Math.random() * 2;
  for (let i = 0; i < 1 && capsules.length < MAX_CAPSULES; i++) {
    const next = chooseNextNode(capsule.to, capsule.from, capsule.request.category);
    if (!next) break;
    capsules.push({
      request: capsule.request,
      from: capsule.to,
      to: next.index,
      previous: capsule.from,
      edge: next.edge,
      progress: 0,
      speed: capsule.speed * (0.87 + Math.random() * 0.32),
      color: capsule.color,
      splitCooldown: 1.5 + Math.random() * 2
    });
  }
}

function flashOutput(request) {
  const candidates = neurons.filter(node => node.active && (node.region === "output" || node.category === "general_chat" || node.category === "language"));
  for (let i = 0; i < Math.min(4, candidates.length); i++) {
    const node = candidates[Math.floor(Math.random() * candidates.length)];
    node.heat += 5 + Math.random() * 4;
    node.lastActive = elapsed;
  }
  const outputNodes = candidates.slice(0, 5);
  for (let i = 0; i < 4 && sparks.length < 80; i++) {
    const origin = outputNodes[Math.floor(Math.random() * outputNodes.length)];
    const position = origin ? origin.position.clone() : new THREE.Vector3();
    const direction = position.clone().normalize().add(randomInSphere(0.45)).normalize();
    sparks.push({
      position,
      velocity: direction.multiplyScalar(0.7 + Math.random() * 1.3),
      color: request.color.clone().lerp(new THREE.Color(0xf5f8ff), 0.45),
      age: 0,
      lifetime: 1 + Math.random() * 1.5
    });
  }
}

function maybeStartPruning() {
  if (elapsed - lastPruneCheck < 6) return;
  lastPruneCheck = elapsed;
  if (neurons.length < INITIAL_NEURONS + 15 || Math.random() > 0.24) return;
  const candidates = neurons.filter(node => !node.base && node.active && !node.pruning && node.heat < 0.25 && elapsed - node.lastActive > 48);
  if (!candidates.length) return;
  const node = candidates[Math.floor(Math.random() * candidates.length)];
  node.pruning = true;
  node.pruneStarted = elapsed;
}

function updateNeurons(dt) {
  for (let i = 0; i < neurons.length; i++) {
    const node = neurons[i];
    node.heat = Math.max(0, node.heat - dt * 0.22);
    node.pulse += dt * (0.6 + node.pulseAmount * 3);
    if (node.growth < 1) {
      node.growth = Math.min(1, node.growth + dt * 0.55);
      node.position.lerp(node.target, Math.min(1, dt * 1.5));
    }
    if (node.pruning && elapsed - node.pruneStarted > 4) {
      node.active = false;
      node.pruning = false;
      for (const edge of node.edges) edge.active = false;
    }
    const pruneFade = node.pruning ? Math.max(0, 1 - (elapsed - node.pruneStarted) / 4) : 1;
    const pulse = 1 + Math.sin(node.pulse) * node.pulseAmount;
    const heat = Math.min(1, node.heat / 8);
    const scale = node.active ? (0.5 + node.growth * 0.5) * pruneFade * (1 + heat * 0.85) * pulse : 0;
    dummy.position.copy(node.position);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
    const specialization = CATEGORY_COLORS[node.category];
    const mastery = node.special ? 1 : Math.min(0.78, knowledge[node.category] * 0.019);
    specializationColor.setHex(specialization);
    tempColor.copy(node.color).lerp(specializationColor, mastery);
    tempColor.lerp(whiteColor, Math.min(0.96, heat * 0.86));
    tempColor.multiplyScalar(0.55 + heat * 0.85 + (1 - node.growth) * 0.2);
    nodeMesh.setColorAt(i, tempColor);
  }
  nodeMesh.count = neurons.length;
  nodeMesh.instanceMatrix.needsUpdate = true;
  nodeMesh.instanceColor.needsUpdate = true;
}

function markNeuron(index, intensity = 1) {
  const node = neurons[index];
  if (!node || !node.active) return;
  node.heat = Math.min(16, node.heat + intensity);
  node.lastActive = elapsed;
}

function updateCapsules(dt) {
  for (let i = capsules.length - 1; i >= 0; i--) {
    const capsule = capsules[i];
    capsule.splitCooldown -= dt;
    const request = capsule.request;
    const remaining = request.lifetime - request.age;
    if (remaining < 1.35) {
      request.fade = Math.max(0, remaining / 1.35);
      capsule.progress += dt * capsule.speed * 0.12;
    } else {
      const a = neurons[capsule.from];
      const b = neurons[capsule.to];
      if (!a?.active || !b?.active || !capsule.edge.active) {
        const next = a?.active ? chooseNextNode(capsule.from, capsule.previous, request.category) : null;
        if (!next) {
          capsules.splice(i, 1);
          continue;
        }
        capsule.to = next.index;
        capsule.edge = next.edge;
        capsule.progress = 0;
      } else {
        const length = Math.max(0.08, a.position.distanceTo(b.position));
        const strengthSpeed = 0.8 + capsule.edge.strength * 0.55;
        capsule.progress += dt * capsule.speed * strengthSpeed / length;
        if (capsule.progress >= 1) {
          const arrived = capsule.to;
          markNeuron(arrived, 1);
          capsule.previous = capsule.from;
          capsule.from = arrived;
          capsule.progress = 0;
          const next = chooseNextNode(arrived, capsule.previous, request.category);
          if (!next) {
            capsules.splice(i, 1);
            continue;
          }
          capsule.to = next.index;
          capsule.edge = next.edge;
          next.edge.strength = Math.min(1.8, next.edge.strength + 0.035);
          next.edge.activity = Math.min(1, next.edge.activity + 0.18);
          next.edge.lastUsed = elapsed;
          maybeSplit(capsule);
        }
      }
    }

    const from = neurons[capsule.from]?.position;
    const to = neurons[capsule.to]?.position;
    if (!from || !to) {
      capsules.splice(i, 1);
      continue;
    }
    const progress = THREE.MathUtils.clamp(capsule.progress, 0, 1);
    dummy.position.copy(from).lerp(to, progress);
    const direction = edgeDirection.copy(to).sub(from).normalize();
    dummy.quaternion.setFromUnitVectors(up, direction);
    const fade = Math.max(0, request.fade);
    dummy.scale.setScalar(fade);
    dummy.updateMatrix();
    capsuleMesh.setMatrixAt(i, dummy.matrix);
    tempColor.copy(capsule.color).multiplyScalar(0.75 + fade * 0.8);
    capsuleMesh.setColorAt(i, tempColor);
  }
  capsuleMesh.count = capsules.length;
  capsuleMesh.instanceMatrix.needsUpdate = true;
  capsuleMesh.instanceColor.needsUpdate = true;
}

function updateEdges(dt) {
  let visibleEdges = 0;
  const viewDirection = camera.position;
  for (const edge of edges) {
    if (!edge.active) continue;
    edge.strength = Math.max(0.12, edge.strength - dt * 0.0018);
    edge.activity = Math.max(0, edge.activity - dt * 0.018);
    if (edge.growth < 1) edge.growth = Math.min(1, edge.growth + dt * 0.58);
    const a = neurons[edge.a];
    const b = neurons[edge.b];
    if (!a.active || !b.active) continue;
    const start = edge.origin === edge.a ? a.position : b.position;
    const end = edge.origin === edge.a ? b.position : a.position;
    edgeDirection.copy(end).sub(start);
    const length = edgeDirection.length();
    if (length < 1e-5) continue;
    edgeDirection.multiplyScalar(1 / length);
    edgeMidpoint.copy(start).add(end).multiplyScalar(0.5);
    edgeSide.subVectors(viewDirection, edgeMidpoint).normalize().cross(edgeDirection).normalize();
    if (edgeSide.lengthSq() < 0.01) edgeSide.set(0, 1, 0);
    const halfWidth = (0.0018 + edge.strength * 0.003 + edge.activity * 0.005) * edge.growth;
    const remaining = a.pruning ? Math.max(0, 1 - (elapsed - a.pruneStarted) / 4) : 1;
    const endRemaining = b.pruning ? Math.max(0, 1 - (elapsed - b.pruneStarted) / 4) : 1;
    const fade = Math.min(remaining, endRemaining);
    const brightness = (0.1 + edge.strength * 0.1 + edge.activity * 0.12) * edge.growth * fade;
    edgeColor.copy(a.color).lerp(b.color, 0.3).multiplyScalar(brightness);
    const offset = visibleEdges * 18;
    partialEnd.copy(start).lerp(end, edge.growth);
    const sx = start.x;
    const sy = start.y;
    const sz = start.z;
    const ex = partialEnd.x;
    const ey = partialEnd.y;
    const ez = partialEnd.z;
    const ox = edgeSide.x * halfWidth;
    const oy = edgeSide.y * halfWidth;
    const oz = edgeSide.z * halfWidth;
    const leftX = sx + ox;
    const leftY = sy + oy;
    const leftZ = sz + oz;
    const rightX = sx - ox;
    const rightY = sy - oy;
    const rightZ = sz - oz;
    const endLeftX = ex + ox;
    const endLeftY = ey + oy;
    const endLeftZ = ez + oz;
    const endRightX = ex - ox;
    const endRightY = ey - oy;
    const endRightZ = ez - oz;
    const red = edgeColor.r;
    const green = edgeColor.g;
    const blue = edgeColor.b;
    edgePositions[offset] = leftX;
    edgePositions[offset + 1] = leftY;
    edgePositions[offset + 2] = leftZ;
    edgePositions[offset + 3] = rightX;
    edgePositions[offset + 4] = rightY;
    edgePositions[offset + 5] = rightZ;
    edgePositions[offset + 6] = endLeftX;
    edgePositions[offset + 7] = endLeftY;
    edgePositions[offset + 8] = endLeftZ;
    edgePositions[offset + 9] = rightX;
    edgePositions[offset + 10] = rightY;
    edgePositions[offset + 11] = rightZ;
    edgePositions[offset + 12] = endRightX;
    edgePositions[offset + 13] = endRightY;
    edgePositions[offset + 14] = endRightZ;
    edgePositions[offset + 15] = endLeftX;
    edgePositions[offset + 16] = endLeftY;
    edgePositions[offset + 17] = endLeftZ;
    for (let j = 0; j < 18; j += 3) {
      edgeColors[offset + j] = red;
      edgeColors[offset + j + 1] = green;
      edgeColors[offset + j + 2] = blue;
    }
    visibleEdges++;
  }
  edgeGeometry.setDrawRange(0, visibleEdges * 6);
  edgeGeometry.attributes.position.needsUpdate = true;
  edgeGeometry.attributes.color.needsUpdate = true;
  for (let i = visibleEdges * 18; i < edgePositions.length && i < (visibleEdges + 1) * 18; i++) edgePositions[i] = 0;
}

function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.age += dt;
    if (spark.age >= spark.lifetime) {
      sparks.splice(i, 1);
      continue;
    }
    spark.position.addScaledVector(spark.velocity, dt);
    spark.velocity.multiplyScalar(Math.max(0.9, 1 - dt * 0.6));
    const fade = 1 - spark.age / spark.lifetime;
    dummy.position.copy(spark.position);
    dummy.scale.setScalar(fade);
    dummy.updateMatrix();
    sparkMesh.setMatrixAt(i, dummy.matrix);
    tempColor.copy(spark.color).multiplyScalar(fade * 1.6);
    sparkMesh.setColorAt(i, tempColor);
  }
  sparkMesh.count = sparks.length;
  sparkMesh.instanceMatrix.needsUpdate = true;
  sparkMesh.instanceColor.needsUpdate = true;
}

function updateRequests(dt) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const request = requests[i];
    request.age += dt;
    request.fade = Math.min(1, Math.max(0, (request.lifetime - request.age) / 1.35));
    if (request.age >= request.lifetime) {
      flashOutput(request);
      requests.splice(i, 1);
      for (let j = capsules.length - 1; j >= 0; j--) {
        if (capsules[j].request === request) capsules.splice(j, 1);
      }
    }
  }
}

function updateAmbient(dt) {
  if (elapsed >= nextAmbientPulse) {
    const start = Math.floor(Math.random() * neurons.length);
    const node = neurons[start];
    if (node.active && !node.pruning) {
      markNeuron(start, 1.2);
      const edge = node.edges[Math.floor(Math.random() * node.edges.length)];
      if (edge?.active) {
        edge.activity = Math.min(1, edge.activity + 0.4);
        const next = edge.a === start ? edge.b : edge.a;
        markNeuron(next, 0.65);
      }
    }
    nextAmbientPulse = elapsed + 2 + Math.random() * 4;
  }
  if (elapsed >= nextRequestAt && requests.length < MAX_ACTIVE_REQUESTS) {
    createRequest();
    nextRequestAt = elapsed + 8 + Math.random() * 8;
  }
  while (recentRequests.length && elapsed - recentRequests[0].time > 180) recentRequests.shift();
}

function updateStats() {
  document.querySelector("#active-requests").textContent = String(requests.length).padStart(2, "0");
  document.querySelector("#active-capsules").textContent = String(capsules.length).padStart(3, "0");
  document.querySelector("#neuron-count").textContent = neurons.filter(node => node.active).length.toLocaleString("en-US");
  const requestsPerMinute = recentRequests.filter(request => elapsed - request.time < 60).length;
  document.querySelector("#learning-count").textContent = `${requestsPerMinute} req / min`;
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const seconds = Math.floor(elapsed % 60).toString().padStart(2, "0");
  document.querySelector("#uptime").textContent = `${minutes}:${seconds}`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  elapsed += dt;
  updateAmbient(dt);
  updateRequests(dt);
  updateNeurons(dt);
  updateCapsules(dt);
  updateEdges(dt);
  updateSparks(dt);
  maybeStartPruning();
  controls.update();
  composer.render();
  if (elapsed - lastUiUpdate > 0.25) {
    lastUiUpdate = elapsed;
    updateStats();
  }
  if (Math.abs(bloom.strength - 0.18) > 0.01) bloom.strength = THREE.MathUtils.damp(bloom.strength, 0.18, 1.5, dt);
}

function handleResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}

window.addEventListener("resize", handleResize);
document.querySelector("#loading-state").classList.add("hidden");
setTimeout(() => document.querySelector("#loading-state")?.remove(), 700);
updateStats();
animate();
