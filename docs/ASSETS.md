# Third-party assets

## Human model – `public/models/human.glb`

|             |                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | [MakeHuman 1.x](https://github.com/makehumancommunity/makehuman) (`makehuman/data`), commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`                                                                                                                                                                                                                    |
| Files used  | `3dobjs/base.obj` (base mesh hm08), `rigs/default.mhskel` (skeleton), `rigs/default_weights.mhw` (skin weights), `targets/macrodetails/{african,asian,caucasian}-male-young.target`, `targets/macrodetails/universal-male-young-maxmuscle-averageweight.target`                                                                                           |
| Licence     | **CC0 1.0 Universal** – the MakeHuman project released all bundled assets (base mesh, targets, skeletons, weights) under CC0; see `LICENSE.md` in the MakeHuman repository, section C ("The license for the bundled assets"), and the CC0 notice in every target/weights file. MakeHuman's AGPL covers only its program code, none of which is used here. |
| Attribution | Not required (CC0). Credit: MakeHuman team / Data Collection AB, original base mesh by Manuel Bastioni.                                                                                                                                                                                                                                                   |

### How the file is produced

`scripts/build-human-model.mjs` converts the downloaded MakeHuman files into a compact glTF
binary and generates `src/hologram/humanSkeleton.ts` (rest pose, hand/foot contact points and
skin landmarks used by the pose solver):

1. Applies the macro targets: male, young adult, averaged ethnicity, 75 % muscle.
2. Keeps the body skin and the eyes (no eyelashes, teeth, tongue, clothes helpers), scales the
   figure to 1.78 m with the feet on y = 0, facing +z.
3. Reduces MakeHuman's 163-bone skeleton to 33 bones (pelvis, 4 spine bones, neck, head,
   clavicles, upper arms, forearms + twist bones, hands, two finger segments, thumbs, thighs,
   shins, feet, toes) by merging the skin weights; every bone has an identity rest rotation.
4. Writes a skinned mesh with `KHR_mesh_quantization` (int8 normals, uint8 joints/weights) –
   decoded natively by three's `GLTFLoader`, so no WASM decoder and no CSP change is needed.

Result: 13 524 vertices, 27 036 triangles. Download size: 493 KB (`human.glb`, 492 896 bytes),
~314 KB if the server compresses it with gzip. It is loaded only when an exercise with a hologram
is opened, then cached as immutable.

The build checks the sha256 of every input and refuses to run on anything else, so the output is
reproducible byte for byte:

| File                                                  | sha256                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `base.obj`                                            | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| `default.mhskel`                                      | `99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24` |
| `default_weights.mhw`                                 | `0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625` |
| `african-male-young.target`                           | `894abc1fbb3d28543a51fef16f89d5d4bdf9aa2e1534413339811a3d47818b7d` |
| `asian-male-young.target`                             | `ed2e8c191cb6b87b4a2d97c80486acb2604fa549316c7aa2a738a5d5a14334dc` |
| `caucasian-male-young.target`                         | `70e228ba7164737dae664454394536fc5935fa48d333c1a97d77e2dc6eacc5f5` |
| `universal-male-young-maxmuscle-averageweight.target` | `c171ff9cc95e96273beb3e3b1969a01988c2d4982ebc6fe04bf81cf72ee3b295` |

To rebuild (the MakeHuman files are not committed):

```bash
mkdir -p /tmp/mh && cd /tmp/mh
B=https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data
curl -sSO $B/3dobjs/base.obj -sSO $B/rigs/default.mhskel -sSO $B/rigs/default_weights.mhw
for t in african-male-young asian-male-young caucasian-male-young universal-male-young-maxmuscle-averageweight; do
  curl -sSO $B/targets/macrodetails/$t.target
done
cd - && node scripts/build-human-model.mjs /tmp/mh
```

The URL carries the generated content hash (`?v=…`), so `public/_headers` can cache
`/models/*` as immutable.

## Everything else

Equipment (barbell, dumbbells, benches, rack, cable stations, treadmill, bike, mat) is built
procedurally from three.js primitives in `src/hologram/props.ts`; there are no other external
assets.
