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

Result: 13 524 vertices, 27 036 triangles, ~480 KB.

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
