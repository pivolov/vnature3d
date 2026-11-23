# Open in Blender's Scripting workspace and click Run Script.
import bpy
import json
from math import radians, atan, tan
from mathutils import Vector
from pathlib import Path

data = json.loads(VD3D_PAYLOAD)

def rgba(hex_color, alpha=1):
    def linear(component):
        return component / 12.92 if component <= 0.04045 else ((component + 0.055) / 1.055) ** 2.4
    return (*[linear(int(hex_color[i:i + 2], 16) / 255) for i in (1, 3, 5)], alpha)

scene = bpy.data.scenes.new(data["name"])
bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.fps = data["fps"]
scene.frame_end = data["count"]
aspect = data["aspect"]
scene.render.resolution_x = round(1920 * min(1, aspect))
scene.render.resolution_y = round(1920 / max(1, aspect))
scene.world = bpy.data.worlds.new("VD3D Studio")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4 * data["lights"]["fill"]

def add_object(name, block):
    obj = bpy.data.objects.new(name, block)
    scene.collection.objects.link(obj)
    return obj

for layer in data["layers"]:
    mesh = bpy.data.meshes.new(layer["name"])
    mesh.from_pydata(layer["vertices"], [], layer["faces"], shade_flat=False)
    mesh.normals_split_custom_set(layer["normals"])
    mesh.update()
    obj = add_object(layer["name"], mesh)
    obj.rotation_mode = 'QUATERNION'
    material = bpy.data.materials.new(layer["name"])
    material.use_nodes = True
    mesh.materials.append(material)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = layer["metalness"]
    shader.inputs["Coat Weight"].default_value = layer["coat"]
    shader.inputs["Transmission Weight"].default_value = float(layer["glass"])
    previous = None
    for frame, pose in enumerate(layer["frames"], 1):
        obj.location = pose["position"]
        obj.rotation_quaternion = pose["rotation"]
        if previous and previous.dot(obj.rotation_quaternion) < 0:
            obj.rotation_quaternion.negate()
        previous = obj.rotation_quaternion.copy()
        obj.scale = pose["scale"]
        if len(layer["frames"]) > 1:
            for prop in ("location", "rotation_quaternion", "scale"):
                obj.keyframe_insert(data_path=prop, frame=frame)
        values = {"Base Color": rgba(pose["color"]), "Alpha": pose["opacity"],
                  "Roughness": pose["roughness"], "Emission Color": rgba(pose["emissive"]),
                  "Emission Strength": 1}
        for name, value in values.items():
            socket = shader.inputs[name]
            socket.default_value = value
            if len(layer["frames"]) > 1:
                socket.keyframe_insert(data_path="default_value", frame=frame)

camera = bpy.data.cameras.new("VD3D Camera")
scene.camera = add_object(camera.name, camera)
scene.camera.rotation_mode = 'QUATERNION'
camera.sensor_fit = 'HORIZONTAL'
previous = None
for frame, pose in enumerate(data["cameras"], 1):
    scene.camera.location = pose["position"]
    scene.camera.rotation_quaternion = (Vector(pose["target"]) - scene.camera.location).to_track_quat('-Z', 'Y')
    if previous and previous.dot(scene.camera.rotation_quaternion) < 0:
        scene.camera.rotation_quaternion.negate()
    previous = scene.camera.rotation_quaternion.copy()
    camera.type = 'ORTHO' if pose["projection"] == 'orthographic' else 'PERSP'
    fov = 35 if aspect >= 1 else min(95, 35 / aspect)
    camera.angle = 2 * atan(tan(radians(fov) / 2) * aspect / pose["zoom"])
    camera.ortho_scale = 5.7 * max(1, aspect) / pose["zoom"]
    if len(data["cameras"]) > 1:
        for prop in ("location", "rotation_quaternion"):
            scene.camera.keyframe_insert(data_path=prop, frame=frame)
        camera.keyframe_insert(data_path="lens", frame=frame)
        camera.keyframe_insert(data_path="ortho_scale", frame=frame)

for name, direction, power, size in (
    ("Key", data["key"], 800 * data["lights"]["strength"], 4),
    ("Fill", [-4, -4, 2], 350 * data["lights"]["fill"], 5),
    ("Rim", [1, 5, 3], 550, 3),
):
    light = bpy.data.lights.new(name, 'AREA')
    light.energy = power
    light.shape = 'DISK'
    light.size = size
    obj = add_object(name, light)
    obj.location = Vector(direction).normalized() * 6
    obj.rotation_euler = (-obj.location).to_track_quat('-Z', 'Y').to_euler()

scene.frame_set(1)
if __file__ and Path(__file__).is_file():
    source = Path(__file__)
    destination = source.with_suffix('.blend')
    i = 2
    while destination.exists():
        destination = source.with_name(f"{source.stem}-{i}.blend")
        i += 1
    bpy.ops.wm.save_as_mainfile(filepath=str(destination.resolve()))
