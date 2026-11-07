# 3D hero assets (optional)

Checked Higgsfield (show_generations) on 2026-11-07: no completed 3D or image generations yet.
The voxel scene is complete without these; they are polish only. Generate in Higgsfield, then ask
an agent to pull them in (download to `public/models/`, compress with gltf-transform to ≤1024 px
textures, < 1.5 MB and < 5k tris each, load with `useGLTF` in `<Suspense>`, voxel version as fallback).

Settings for every asset: model `meshy_v6_text_to_3d`, model_type `lowpoly`, mode `full`,
target_polycount `3000`.

| # | File | Prompt |
|---|------|--------|
| 1 | `desk.glb` | low-poly voxel office desk with monitor and mug, chunky cubic blocks, warm cosy palette, isometric game asset |
| 2 | `sofa.glb` | low-poly voxel red three-seat sofa, chunky cubic blocks, warm cosy palette, isometric game asset |
| 3 | `coffee-machine.glb` | low-poly voxel espresso machine on a wooden counter, chunky cubic blocks, warm cosy palette, isometric game asset |
| 4 | `car.glb` | low-poly voxel small hatchback car, chunky cubic blocks, warm cosy palette, isometric game asset |
| 5 | `tree.glb` | low-poly voxel round leafy tree, chunky cubic blocks, warm cosy palette, isometric game asset |
