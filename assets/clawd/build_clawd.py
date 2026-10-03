"""Build the Clawd model with Blender's Python API, render it and export it.

Run with Blender 4.2+ (or the `bpy` pip module):
    blender -b -P build_clawd.py -- [--preview] [--stage export|stills|turntable]
    python build_clawd.py [--preview] [--stage export|stills|turntable]

Without --stage every stage runs. Renders that already exist are skipped, so
an interrupted run picks up where it stopped (delete a file to redo it).

The shape follows the pixel sprite: a 12x8 body, two tall eyes, arms on the
sides and four short legs. One grid unit (U) is 1 cm.
"""

import math
import os
import shutil
import subprocess
import sys

import bpy  # must come first when running as the bpy pip module
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_DIR = os.path.join(HERE, "renders")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
PREVIEW = "--preview" in argv
STAGES = ("export", "stills", "turntable")
if "--stage" in argv:
    STAGES = (argv[argv.index("--stage") + 1],)

STILL_SAMPLES = 48
STILL_RES = (1600, 1200)
TURNTABLE_SAMPLES = 24
TURNTABLE_RES = (640, 480)
TURNTABLE_FRAMES = 36

U = 0.01          # one grid unit in metres
RES = 0.5         # voxel resolution in grid units
DEPTH = 6.0       # body depth in grid units

CLAWD_ORANGE = "#D97757"
EYE_COLOR = "#1F1A17"
BACKDROP_COLOR = "#F2ECE3"


def srgb_to_linear(hex_color):
    hex_color = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hex_color[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# --------------------------------------------------------------------------
# Shape definition (grid units, x = width, y = depth, z = height)
# --------------------------------------------------------------------------

BOXES = [
    # body
    ((-6, -DEPTH / 2, 2), (6, DEPTH / 2, 10)),
    # arms
    ((-8, -1, 4), (-6, 1, 6)),
    ((6, -1, 4), (8, 1, 6)),
    # legs
    ((-5, -1, 0), (-4, 1, 2)),
    ((-3, -1, 0), (-2, 1, 2)),
    ((2, -1, 0), (3, 1, 2)),
    ((4, -1, 0), (5, 1, 2)),
]

EYE_DEPTH = 0.5
EYES = [
    ((-4, -DEPTH / 2, 6), (-3, -DEPTH / 2 + EYE_DEPTH, 8)),
    ((3, -DEPTH / 2, 6), (4, -DEPTH / 2 + EYE_DEPTH, 8)),
]


def box_cells(lo, hi):
    """Voxel indices covering an axis-aligned box given in grid units."""
    rng = [range(round(lo[a] / RES), round(hi[a] / RES)) for a in range(3)]
    return {(i, j, k) for i in rng[0] for j in rng[1] for k in rng[2]}


def build_voxels():
    cells = set()
    for lo, hi in BOXES:
        cells |= box_cells(lo, hi)
    eye_cells = set()
    for lo, hi in EYES:
        eye_cells |= box_cells(lo, hi)
    return cells - eye_cells, eye_cells


DIRS = [
    ((1, 0, 0), 0), ((-1, 0, 0), 0),
    ((0, 1, 0), 1), ((0, -1, 0), 1),
    ((0, 0, 1), 2), ((0, 0, -1), 2),
]


def face_corners(cell, d, axis):
    """Four corners (in voxel-index space) of the face of `cell` facing `d`."""
    base = list(cell)
    if d[axis] > 0:
        base[axis] += 1
    a1, a2 = [a for a in range(3) if a != axis]
    corners = []
    for o1, o2 in ((0, 0), (1, 0), (1, 1), (0, 1)):
        c = list(base)
        c[a1] += o1
        c[a2] += o2
        corners.append(tuple(c))
    return corners


def build_clawd_mesh():
    cells, eye_cells = build_voxels()
    bm = bmesh.new()
    verts = {}

    def vert(idx):
        if idx not in verts:
            verts[idx] = bm.verts.new(tuple(i * RES * U for i in idx))
        return verts[idx]

    for cell in cells:
        for d, axis in DIRS:
            nb = (cell[0] + d[0], cell[1] + d[1], cell[2] + d[2])
            if nb in cells:
                continue
            f = bm.faces.new([vert(c) for c in face_corners(cell, d, axis)])
            # Every wall of the eye sockets gets the eye material.
            f.material_index = 1 if nb in eye_cells else 0

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.dissolve_limit(
        bm, angle_limit=math.radians(1), verts=bm.verts[:], edges=bm.edges[:],
        delimit={'MATERIAL'},
    )
    for f in bm.faces:
        f.smooth = True

    mesh = bpy.data.meshes.new("Clawd")
    bm.to_mesh(mesh)
    bm.free()
    return mesh


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def principled(name, color, roughness, **inputs):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb_to_linear(color)
    bsdf.inputs["Roughness"].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key].default_value = value
    mat.diffuse_color = srgb_to_linear(color)
    return mat


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def make_clawd():
    obj = bpy.data.objects.new("Clawd", build_clawd_mesh())
    bpy.context.collection.objects.link(obj)

    obj.data.materials.append(principled("Clawd_Orange", CLAWD_ORANGE, 0.42,
                                         **{"Coat Weight": 0.15,
                                            "Coat Roughness": 0.25}))
    obj.data.materials.append(principled("Clawd_Eye", EYE_COLOR, 0.18))

    bevel = obj.modifiers.new("Bevel", 'BEVEL')
    bevel.width = 0.16 * U
    bevel.segments = 4
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = math.radians(30)
    bevel.harden_normals = True
    bevel.use_clamp_overlap = True
    return obj


def make_backdrop():
    """Floor that sweeps up into a back wall (a photo-studio cyclorama)."""
    bm = bmesh.new()
    profile = [(-2.0, 0.0), (0.25, 0.0)]
    radius, cy = 0.45, 0.25
    for i in range(1, 17):
        t = math.radians(90 * i / 16)
        profile.append((cy + radius * math.sin(t), radius * (1 - math.cos(t))))
    profile.append((cy + radius, 2.0))
    width = 3.0
    rows = [[bm.verts.new((x, y, z)) for x in (-width, width)] for y, z in profile]
    for a, b in zip(rows, rows[1:]):
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < -0.01 or f.normal.y > 0.01:
            f.normal_flip()
    mesh = bpy.data.meshes.new("Backdrop")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Backdrop", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(principled("Backdrop", BACKDROP_COLOR, 0.85))
    return obj


def area_light(name, location, target, size, energy, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'DISK'
    data.size = size
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    look_at(obj, target)
    bpy.context.collection.objects.link(obj)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def setup_world():
    world = bpy.data.worlds.new("World")
    if hasattr(world, "use_nodes") and not world.use_nodes:
        world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb_to_linear("#FFF8F0")
    bg.inputs["Strength"].default_value = 0.25
    bpy.context.scene.world = world


def setup_render(samples, res):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = -1.0
    scene.render.use_stamp = False


def make_camera():
    data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


TARGET = (0, 0, 5.2 * U)

SHOTS = {
    # name: (Clawd turn in degrees, camera location, focal length mm).
    # The camera always stays in front of the backdrop; Clawd turns instead.
    "clawd_hero": (0, (0.30, -0.50, 0.20), 85),
    "clawd_front": (0, (0.0, -0.62, 0.07), 85),
    "clawd_side": (90, (0.16, -0.56, 0.12), 85),
    "clawd_back": (180, (0.30, -0.50, 0.20), 85),
}


def take_shot(clawd, cam, turn, location, lens, path):
    clawd.rotation_euler.z = math.radians(turn)
    place_camera(cam, location, lens)
    render(path)
    clawd.rotation_euler.z = 0


def place_camera(cam, location, lens):
    cam.location = location
    cam.data.lens = lens
    look_at(cam, TARGET)


def render(path):
    if os.path.exists(path):
        print(f"skip existing {os.path.basename(path)}", flush=True)
        return
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_turntable(clawd, cam, frames=TURNTABLE_FRAMES):
    frame_dir = os.path.join(HERE, "_turntable_frames")
    os.makedirs(frame_dir, exist_ok=True)
    place_camera(cam, (0.0, -0.70, 0.20), 70)
    setup_render(TURNTABLE_SAMPLES, TURNTABLE_RES)
    for i in range(frames):
        clawd.rotation_euler.z = 2 * math.pi * i / frames
        render(os.path.join(frame_dir, f"f{i:03d}.png"))
    clawd.rotation_euler.z = 0
    gif = os.path.join(RENDER_DIR, "clawd_turntable.gif")
    mp4 = os.path.join(RENDER_DIR, "clawd_turntable.mp4")
    pattern = os.path.join(frame_dir, "f%03d.png")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-i", pattern,
        "-vf", "scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];"
               "[b][p]paletteuse=dither=sierra2_4a",
        "-loop", "0", gif,
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-stream_loop", "2",
        "-i", pattern, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-movflags", "+faststart", mp4,
    ], check=True)
    shutil.rmtree(frame_dir)


def export_model(clawd):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    clawd.select_set(True)
    bpy.context.view_layer.objects.active = clawd
    base = os.path.join(HERE, "clawd")
    bpy.ops.export_scene.gltf(filepath=base + ".glb", export_format='GLB',
                              use_selection=True, export_apply=True,
                              export_cameras=False)
    bpy.ops.export_scene.fbx(filepath=base + ".fbx", use_selection=True,
                             use_mesh_modifiers=True, object_types={'MESH'},
                             apply_scale_options='FBX_SCALE_ALL',
                             use_metadata=False)
    bpy.ops.wm.obj_export(filepath=base + ".obj", export_selected_objects=True,
                          apply_modifiers=True, export_materials=True,
                          export_triangulated_mesh=False)
    # STL in millimetres for slicers: about 160 x 60 x 100 mm.
    bpy.ops.wm.stl_export(filepath=base + ".stl", export_selected_objects=True,
                          apply_modifiers=True, global_scale=1000.0)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'CENTIMETERS'

    clawd = make_clawd()
    make_backdrop()
    setup_world()
    area_light("Key", (-0.55, -0.55, 0.65), TARGET, 0.6, 14, (1.0, 0.97, 0.94))
    area_light("Fill", (0.65, -0.35, 0.25), TARGET, 0.8, 4, (0.94, 0.96, 1.0))
    area_light("Rim", (0.25, 0.60, 0.55), TARGET, 0.4, 10)
    cam = make_camera()

    os.makedirs(RENDER_DIR, exist_ok=True)
    if PREVIEW:
        setup_render(16, (800, 600))
        for name, shot in SHOTS.items():
            take_shot(clawd, cam, *shot,
                      os.path.join(RENDER_DIR, f"preview_{name}.png"))
        return

    if "export" in STAGES:
        place_camera(cam, *SHOTS["clawd_hero"][1:])
        setup_render(STILL_SAMPLES, STILL_RES)
        export_model(clawd)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "clawd.blend"),
                                    compress=True)
    if "stills" in STAGES:
        setup_render(STILL_SAMPLES, STILL_RES)
        for name, shot in SHOTS.items():
            take_shot(clawd, cam, *shot, os.path.join(RENDER_DIR, f"{name}.png"))
    if "turntable" in STAGES:
        render_turntable(clawd, cam)


if __name__ == "__main__":
    main()
