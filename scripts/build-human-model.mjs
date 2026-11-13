#!/usr/bin/env node
/**
 * Builds public/models/human.glb and src/hologram/humanSkeleton.ts from the
 * CC0 MakeHuman base mesh (see docs/ASSETS.md for sources and licence).
 *
 *   node scripts/build-human-model.mjs <makehuman-download-dir>
 *
 * The input directory must contain (downloaded from the MakeHuman repository):
 *   base.obj, default.mhskel, default_weights.mhw,
 *   african-male-young.target, asian-male-young.target, caucasian-male-young.target,
 *   universal-male-young-maxmuscle-averageweight.target
 *
 * Output: a skinned mesh (body + eyes) with a simplified 33-bone skeleton in
 * metres (y up, facing +z, feet on y = 0). All bones have identity rest
 * rotations, so a pose is fully described by world-space bone rotations.
 * Vertex data uses KHR_mesh_quantization (int8 normals, uint8 joints/weights),
 * which three's GLTFLoader decodes natively (no WASM decoder needed).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/build-human-model.mjs <makehuman-download-dir>');
  process.exit(1);
}

/**
 * sha256 of every input file (MakeHuman commit a8bc2d54ff0a, see docs/ASSETS.md).
 * The build refuses to run on anything else, so the output is reproducible and
 * a tampered or truncated download is caught before it is parsed.
 */
const SOURCES = {
  'base.obj': '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
  'default.mhskel': '99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24',
  'default_weights.mhw': '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625',
  'african-male-young.target': '894abc1fbb3d28543a51fef16f89d5d4bdf9aa2e1534413339811a3d47818b7d',
  'asian-male-young.target': 'ed2e8c191cb6b87b4a2d97c80486acb2604fa549316c7aa2a738a5d5a14334dc',
  'caucasian-male-young.target': '70e228ba7164737dae664454394536fc5935fa48d333c1a97d77e2dc6eacc5f5',
  'universal-male-young-maxmuscle-averageweight.target':
    'c171ff9cc95e96273beb3e3b1969a01988c2d4982ebc6fe04bf81cf72ee3b295',
};
for (const [file, expected] of Object.entries(SOURCES)) {
  const actual = createHash('sha256')
    .update(readFileSync(join(SRC, file)))
    .digest('hex');
  if (actual !== expected) {
    console.error(`${file}: sha256 ${actual} does not match the pinned ${expected}`);
    process.exit(1);
  }
}

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_GLB = join(ROOT, 'public/models/human.glb');
const OUT_TS = join(ROOT, 'src/hologram/humanSkeleton.ts');

/** Body height after scaling, metres. */
const HEIGHT = 1.78;
/** Macro modifiers: male, young adult, mixed ethnicity, athletic (muscle 75 %). */
const TARGETS = [
  ['african-male-young.target', 1 / 3],
  ['asian-male-young.target', 1 / 3],
  ['caucasian-male-young.target', 1 / 3],
  ['universal-male-young-maxmuscle-averageweight.target', 0.5],
];
const MESH_GROUPS = ['body', 'helper-l-eye', 'helper-r-eye'];

// ------------------------------------------------------------------ parsing
const positions = [];
const faces = [];
{
  let group = '';
  for (const line of readFileSync(join(SRC, 'base.obj'), 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      positions.push(line.split(/\s+/).slice(1, 4).map(Number));
    } else if (line.startsWith('g ')) {
      group = line.slice(2).trim();
    } else if (line.startsWith('f ') && MESH_GROUPS.includes(group)) {
      faces.push(
        line
          .trim()
          .split(/\s+/)
          .slice(1)
          .map((t) => Number(t.split('/')[0]) - 1),
      );
    }
  }
}

for (const [file, weight] of TARGETS) {
  for (const line of readFileSync(join(SRC, file), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [i, dx, dy, dz] = line.trim().split(/\s+/).map(Number);
    const p = positions[i];
    p[0] += weight * dx;
    p[1] += weight * dy;
    p[2] += weight * dz;
  }
}

const mhSkel = JSON.parse(readFileSync(join(SRC, 'default.mhskel'), 'utf8'));
const mhWeights = JSON.parse(readFileSync(join(SRC, 'default_weights.mhw'), 'utf8')).weights;

// ------------------------------------------------------- unit conversion
const used = [...new Set(faces.flat())].sort((a, b) => a - b);
let minY = Infinity;
let maxY = -Infinity;
for (const i of used) {
  minY = Math.min(minY, positions[i][1]);
  maxY = Math.max(maxY, positions[i][1]);
}
const scale = HEIGHT / (maxY - minY);
const mhJoint = (name) => {
  const verts = mhSkel.joints[name];
  if (!verts) throw new Error(`unknown joint ${name}`);
  const out = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) out[k] += positions[v][k] / verts.length;
  return out;
};
const pelvisRaw = mhJoint('spine05____head');
const toMetres = (p) => [
  round((p[0] - 0) * scale),
  round((p[1] - minY) * scale),
  round((p[2] - pelvisRaw[2]) * scale),
];
function round(x, d = 5) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
const head = (bone) => toMetres(mhJoint(mhSkel.bones[bone].head));
const tail = (bone) => toMetres(mhJoint(mhSkel.bones[bone].tail));
const mean = (...pts) =>
  pts[0].map((_, k) => round(pts.reduce((s, p) => s + p[k], 0) / pts.length));

// ------------------------------------------------------------ skeleton
/**
 * Simplified skeleton. `mh` lists the MakeHuman bones whose skin weights are
 * merged into this bone; MakeHuman bones not listed fall back to `head`.
 */
const sides = [
  ['L', 'l'],
  ['R', 'r'],
];
const BONES = [
  {
    name: 'hips',
    parent: null,
    head: head('spine05'),
    tail: head('spine05'),
    mh: ['root', 'pelvis.L', 'pelvis.R'],
  },
  {
    name: 'spine1',
    parent: 'hips',
    head: head('spine05'),
    tail: head('spine03'),
    mh: ['spine05', 'spine04'],
  },
  {
    name: 'spine2',
    parent: 'spine1',
    head: head('spine03'),
    tail: head('spine02'),
    mh: ['spine03'],
  },
  {
    name: 'spine3',
    parent: 'spine2',
    head: head('spine02'),
    tail: head('spine01'),
    mh: ['spine02'],
  },
  {
    name: 'chest',
    parent: 'spine3',
    head: head('spine01'),
    tail: head('neck01'),
    mh: ['spine01', 'breast.L', 'breast.R'],
  },
  {
    name: 'neck',
    parent: 'chest',
    head: head('neck01'),
    tail: head('head'),
    mh: ['neck01', 'neck02', 'neck03'],
  },
  { name: 'head', parent: 'neck', head: head('head'), tail: tail('head'), mh: ['head'] },
];
for (const [S, s] of sides) {
  const fingerHeads = (seg) => [2, 3, 4, 5].map((f) => head(`finger${f}-${seg}.${S}`));
  const fingerTails = [2, 3, 4, 5].map((f) => tail(`finger${f}-3.${S}`));
  BONES.push(
    {
      name: `${s}Clavicle`,
      parent: 'chest',
      head: head(`clavicle.${S}`),
      tail: head(`upperarm01.${S}`),
      mh: [`clavicle.${S}`],
    },
    {
      name: `${s}UpperArm`,
      parent: `${s}Clavicle`,
      head: head(`upperarm01.${S}`),
      tail: head(`lowerarm01.${S}`),
      mh: [`shoulder01.${S}`, `upperarm01.${S}`, `upperarm02.${S}`],
    },
    {
      name: `${s}ForeArm`,
      parent: `${s}UpperArm`,
      head: head(`lowerarm01.${S}`),
      tail: head(`wrist.${S}`),
      mh: [`lowerarm01.${S}`],
    },
    {
      // Twist bone: carries most of the forearm pronation/supination.
      name: `${s}ForeArmTwist`,
      parent: `${s}ForeArm`,
      head: head(`lowerarm02.${S}`),
      tail: head(`wrist.${S}`),
      mh: [`lowerarm02.${S}`],
    },
    {
      name: `${s}Hand`,
      parent: `${s}ForeArmTwist`,
      head: head(`wrist.${S}`),
      tail: mean(...fingerHeads(1)),
      mh: [1, 2, 3, 4].map((m) => `metacarpal${m}.${S}`).concat(`wrist.${S}`),
    },
    {
      name: `${s}Thumb1`,
      parent: `${s}Hand`,
      head: head(`finger1-1.${S}`),
      tail: head(`finger1-2.${S}`),
      mh: [`finger1-1.${S}`],
    },
    {
      name: `${s}Thumb2`,
      parent: `${s}Thumb1`,
      head: head(`finger1-2.${S}`),
      tail: tail(`finger1-3.${S}`),
      mh: [`finger1-2.${S}`, `finger1-3.${S}`],
    },
    {
      name: `${s}Fingers1`,
      parent: `${s}Hand`,
      head: mean(...fingerHeads(1)),
      tail: mean(...fingerHeads(2)),
      mh: [2, 3, 4, 5].map((f) => `finger${f}-1.${S}`),
    },
    {
      name: `${s}Fingers2`,
      parent: `${s}Fingers1`,
      head: mean(...fingerHeads(2)),
      tail: mean(...fingerTails),
      mh: [2, 3, 4, 5].flatMap((f) => [`finger${f}-2.${S}`, `finger${f}-3.${S}`]),
    },
    {
      name: `${s}Thigh`,
      parent: 'hips',
      head: head(`upperleg01.${S}`),
      tail: head(`lowerleg01.${S}`),
      mh: [`upperleg01.${S}`, `upperleg02.${S}`],
    },
    {
      name: `${s}Shin`,
      parent: `${s}Thigh`,
      head: head(`lowerleg01.${S}`),
      tail: head(`foot.${S}`),
      mh: [`lowerleg01.${S}`, `lowerleg02.${S}`],
    },
    {
      name: `${s}Foot`,
      parent: `${s}Shin`,
      head: head(`foot.${S}`),
      tail: mean(...[1, 2, 3, 4, 5].map((t) => head(`toe${t}-1.${S}`))),
      mh: [`foot.${S}`],
    },
    {
      name: `${s}Toes`,
      parent: `${s}Foot`,
      head: mean(...[1, 2, 3, 4, 5].map((t) => head(`toe${t}-1.${S}`))),
      tail: mean(...[1, 2, 3, 4, 5].map((t) => tail(`toe${t}-${t === 1 ? 2 : 3}.${S}`))),
      mh: Object.keys(mhSkel.bones).filter((b) => b.startsWith('toe') && b.endsWith(`.${S}`)),
    },
  );
}
const boneIndex = new Map(BONES.map((b, i) => [b.name, i]));
const mhToBone = new Map();
for (const b of BONES) for (const m of b.mh) mhToBone.set(m, boneIndex.get(b.name));
/** Any other MakeHuman bone (face, eyes, tongue, jaw...) follows the head. */
const resolveBone = (mh) => {
  const direct = mhToBone.get(mh);
  if (direct !== undefined) return direct;
  let p = mh;
  while (p) {
    if (p === 'head') return boneIndex.get('head');
    if (mhToBone.has(p) && p !== mh) return mhToBone.get(p);
    p = mhSkel.bones[p]?.parent;
  }
  throw new Error(`cannot map MakeHuman bone ${mh}`);
};

// ------------------------------------------------------------- weights
const remap = new Map(used.map((v, i) => [v, i]));
const vertexWeights = used.map(() => new Map());
for (const [mh, list] of Object.entries(mhWeights)) {
  const b = resolveBone(mh);
  for (const [v, w] of list) {
    const i = remap.get(v);
    if (i === undefined) continue;
    const m = vertexWeights[i];
    m.set(b, (m.get(b) ?? 0) + w);
  }
}
const vertexCount = used.length;
const joints = new Uint8Array(vertexCount * 4);
const weights = new Uint8Array(vertexCount * 4);
for (let i = 0; i < vertexCount; i++) {
  const top = [...vertexWeights[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (top.length === 0) throw new Error(`vertex ${used[i]} has no weights`);
  const sum = top.reduce((s, [, w]) => s + w, 0);
  const q = top.map(([, w]) => Math.round((w / sum) * 255));
  // Make the quantised weights sum to exactly 255.
  q[0] += 255 - q.reduce((s, w) => s + w, 0);
  top.forEach(([b], k) => {
    joints[i * 4 + k] = b;
    weights[i * 4 + k] = q[k];
  });
}

// ------------------------------------------------------- geometry
const pos = new Float32Array(vertexCount * 3);
used.forEach((v, i) => pos.set(toMetres(positions[v]), i * 3));
const tris = [];
for (const f of faces) {
  for (let k = 1; k + 1 < f.length; k++)
    tris.push(remap.get(f[0]), remap.get(f[k]), remap.get(f[k + 1]));
}
const indices = new Uint16Array(tris);
const nrm = new Float32Array(vertexCount * 3);
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
  const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
  const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  for (const v of [a, b, c]) for (let k = 0; k < 3; k++) nrm[v * 3 + k] += n[k];
}
const normals = new Int8Array(vertexCount * 4);
for (let i = 0; i < vertexCount; i++) {
  const n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
  const len = Math.hypot(...n) || 1;
  for (let k = 0; k < 3; k++) normals[i * 4 + k] = Math.round((n[k] / len) * 127);
}

// ------------------------------------------------------ contact points
/** Lowest skin points of the feet and the bar position inside a closed fist. */
function footContacts(s) {
  const foot = boneIndex.get(`${s}Foot`);
  const toes = boneIndex.get(`${s}Toes`);
  const pts = [];
  for (let i = 0; i < vertexCount; i++) {
    const b = joints[i * 4];
    if (b === foot || b === toes) pts.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
  }
  const sole = pts.filter((p) => p[1] < 0.012);
  const heel = sole.reduce((a, p) => (p[2] < a[2] ? p : a));
  const toe = pts.filter((p) => p[1] < 0.03).reduce((a, p) => (p[2] > a[2] ? p : a));
  const ballJoint = BONES[toes].head;
  return {
    heel: [round(heel[0], 4), 0, round(heel[2], 4)],
    ball: [round(ballJoint[0], 4), 0, round(ballJoint[2], 4)],
    toe: [round(toe[0], 4), 0, round(toe[2], 4)],
  };
}

const dominant = (i) => BONES[joints[i * 4]].name;
const vtx = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
/** Extreme skin point (max of `score`) among vertices matching `filter`. */
function extreme(filter, score) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const p = vtx(i);
    if (!filter(p, dominant(i))) continue;
    const sc = score(p);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  if (!best) throw new Error('no vertex matches landmark filter');
  return best.map((v) => round(v, 4));
}
const boneOf = (name) => BONES[boneIndex.get(name)];
const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a);
  return a.map((v) => round(v / l, 5));
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function handData(S, s) {
  const hand = boneOf(`${s}Hand`);
  const dir = norm(sub(hand.tail, hand.head));
  // Index -> little finger knuckle, i.e. the bar axis inside a closed fist.
  const across = norm(sub(head(`finger5-1.${S}`), head(`finger2-1.${S}`)));
  // Palmar normal (see anatomical position: palm forward, thumb lateral).
  const palm = norm(s === 'l' ? cross(across, dir) : cross(dir, across));
  const centre = hand.head.map((v, k) => (v + hand.tail[k]) / 2);
  const palmSkin = extreme(
    (p, b) => b === `${s}Hand` && Math.hypot(...sub(p, centre)) < 0.035,
    (p) => dot(sub(p, centre), palm),
  );
  const depth = dot(sub(palmSkin, centre), palm);
  // Palm skin at the knuckle line: the bar sits just beyond it, inside the fingers.
  const knuckleSkin = extreme(
    (p, b) =>
      (b === `${s}Hand` || b === `${s}Fingers1`) && Math.hypot(...sub(p, hand.tail)) < 0.025,
    (p) => dot(sub(p, hand.tail), palm),
  );
  const knuckleDepth = dot(sub(knuckleSkin, hand.tail), palm);
  return {
    across,
    palm,
    /** Bar axis position inside the closed fist (rest coordinates). */
    grip: hand.tail.map((v, k) => round(v + palm[k] * (knuckleDepth + 0.018) + dir[k] * 0.04, 4)),
    /** Palm skin centre for hands flat on the floor/bench. */
    palmSkin: centre.map((v, k) => round(v + palm[k] * depth, 4)),
  };
}

function landmarks() {
  const neckY = boneOf('neck').head[1];
  const out = {
    sternum: {
      bone: 'chest',
      pos: extreme(
        (p) => Math.abs(p[0]) < 0.02 && Math.abs(p[1] - 0.715 * HEIGHT) < 0.012,
        (p) => p[2],
      ),
    },
    traps: {
      bone: 'chest',
      pos: extreme(
        (p) => Math.abs(p[0]) < 0.02 && Math.abs(p[1] - (neckY - 0.06)) < 0.01,
        (p) => -p[2],
      ),
    },
    upperBack: {
      bone: 'chest',
      pos: extreme(
        (p) => Math.abs(p[0]) < 0.1 && Math.abs(p[1] - 0.73 * HEIGHT) < 0.02,
        (p) => -p[2],
      ),
    },
    glutes: {
      bone: 'hips',
      pos: extreme(
        (p, b) => b === 'hips' && Math.abs(p[0]) < 0.12,
        (p) => -p[2],
      ),
    },
    headBack: {
      bone: 'head',
      pos: extreme(
        (_, b) => b === 'head',
        (p) => -p[2],
      ),
    },
  };
  for (const s of ['l', 'r']) {
    const shin = boneOf(`${s}Shin`);
    out[`${s}KneeFront`] = {
      bone: `${s}Shin`,
      pos: extreme(
        (p) =>
          Math.abs(p[0] - shin.head[0]) < 0.03 && Math.abs(p[1] - (shin.head[1] - 0.04)) < 0.012,
        (p) => p[2],
      ),
    };
    const fore = boneOf(`${s}ForeArm`);
    out[`${s}Elbow`] = {
      bone: `${s}ForeArm`,
      pos: extreme(
        (p, b) =>
          b.startsWith(`${s}UpperArm`) || b.startsWith(`${s}ForeArm`)
            ? Math.hypot(...sub(p, fore.head)) < 0.05
            : false,
        (p) => -p[2],
      ),
    };
  }
  return out;
}

// --------------------------------------------------------------- GLB
const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
function addView(data, target, byteStride) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  bufferViews.push({
    buffer: 0,
    byteOffset: byteLength,
    byteLength: buf.length,
    ...(target ? { target } : {}),
    ...(byteStride ? { byteStride } : {}),
  });
  chunks.push(buf);
  byteLength += buf.length;
  return bufferViews.length - 1;
}
function addAccessor(spec) {
  accessors.push(spec);
  return accessors.length - 1;
}
const posMin = [0, 1, 2].map((k) => Math.min(...used.map((_, i) => pos[i * 3 + k])));
const posMax = [0, 1, 2].map((k) => Math.max(...used.map((_, i) => pos[i * 3 + k])));
const aPos = addAccessor({
  bufferView: addView(pos, 34962),
  componentType: 5126,
  count: vertexCount,
  type: 'VEC3',
  min: posMin,
  max: posMax,
});
const aNrm = addAccessor({
  bufferView: addView(normals, 34962, 4),
  componentType: 5120,
  normalized: true,
  count: vertexCount,
  type: 'VEC3',
});
const aJoints = addAccessor({
  bufferView: addView(joints, 34962),
  componentType: 5121,
  count: vertexCount,
  type: 'VEC4',
});
const aWeights = addAccessor({
  bufferView: addView(weights, 34962),
  componentType: 5121,
  normalized: true,
  count: vertexCount,
  type: 'VEC4',
});
const aIdx = addAccessor({
  bufferView: addView(indices, 34963),
  componentType: 5123,
  count: indices.length,
  type: 'SCALAR',
});
const ibm = new Float32Array(BONES.length * 16);
BONES.forEach((b, i) => {
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1], i * 16);
});
const aIbm = addAccessor({
  bufferView: addView(ibm),
  componentType: 5126,
  count: BONES.length,
  type: 'MAT4',
});

const nodes = BONES.map((b) => {
  const parent = b.parent ? BONES[boneIndex.get(b.parent)].head : [0, 0, 0];
  const children = BONES.map((c, i) => (c.parent === b.name ? i : -1)).filter((i) => i >= 0);
  return {
    name: b.name,
    translation: b.head.map((v, k) => round(v - parent[k], 6)),
    ...(children.length ? { children } : {}),
  };
});
nodes.push({ name: 'body', mesh: 0, skin: 0 });
const gltf = {
  asset: {
    version: '2.0',
    generator: 'scripts/build-human-model.mjs',
    copyright: 'CC0 1.0 - derived from the MakeHuman base mesh (makehumancommunity.org)',
  },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [0, BONES.length] }],
  nodes,
  meshes: [
    {
      name: 'human',
      primitives: [
        {
          attributes: { POSITION: aPos, NORMAL: aNrm, JOINTS_0: aJoints, WEIGHTS_0: aWeights },
          indices: aIdx,
        },
      ],
    },
  ],
  skins: [{ joints: BONES.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};
const bin = Buffer.concat(chunks);
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
const chunkHeader = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
const glb = Buffer.concat([
  header,
  chunkHeader(json.length, 0x4e4f534a),
  json,
  chunkHeader(binPadded.length, 0x004e4942),
  binPadded,
]);
writeFileSync(OUT_GLB, glb);
const modelHash = createHash('sha256').update(glb).digest('hex').slice(0, 12);

// ------------------------------------------------- skeleton constants
const skeletonData = BONES.map((b) => ({
  name: b.name,
  parent: b.parent,
  head: b.head,
  tail: b.tail,
}));
const ts = `// Generated by scripts/build-human-model.mjs - do not edit by hand.
// Rest pose of public/models/human.glb in metres (y up, facing +z, feet on y = 0).
// Every bone has an identity rest rotation.

export const HUMAN_MODEL_HEIGHT = ${HEIGHT};

/** Content hash of human.glb, used as a cache-busting query parameter. */
export const HUMAN_MODEL_HASH = '${modelHash}';

export const HUMAN_BONES = ${JSON.stringify(skeletonData)} as const;

export type HumanBoneName = (typeof HUMAN_BONES)[number]['name'];

/** Hand frames: bar axis (index -> little finger), palm normal, grip and palm points. */
export const HANDS = ${JSON.stringify({ l: handData('L', 'l'), r: handData('R', 'r') })} as const;

/** Skin landmarks (rest pose) for contacts: bar on the back/chest, bench, floor. */
export const LANDMARKS = ${JSON.stringify(landmarks())} as const;

/** Sole contact points (rest pose, on the floor) used for grounding. */
export const FOOT_CONTACTS = ${JSON.stringify({ l: footContacts('l'), r: footContacts('r') })} as const;
`;
writeFileSync(OUT_TS, ts);
execFileSync(join(ROOT, 'node_modules/.bin/prettier'), ['--write', OUT_TS], { stdio: 'inherit' });

console.log(
  `human.glb: ${vertexCount} vertices, ${indices.length / 3} triangles, ${BONES.length} bones, ` +
    `${(byteLength / 1024).toFixed(0)} KiB binary`,
);
