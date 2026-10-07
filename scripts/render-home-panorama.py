"""Build the original voxel castle environment and render coherent native cubemap faces.

Blender 5.2: blender --background --factory-startup --python-exit-code 1 --python scripts/render-home-panorama.py -- --preview --pathtrace
Remove --preview for the six 2048px source assets. No game assets or runtime data are used.
"""
import bpy
import math
import random
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = '--preview' in sys.argv
OUT = ROOT / ('build/panorama-art' if PREVIEW else 'src/renderer/assets/castle-cubemap')
OUT.mkdir(parents=True, exist_ok=True)
random.seed(42171)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES' if '--pathtrace' in sys.argv else 'BLENDER_EEVEE'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.use_compositing = False
scene.render.use_sequencer = False
scene.render.fps = 30
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.25
if scene.render.engine == 'BLENDER_EEVEE':
    scene.eevee.taa_render_samples = 32 if PREVIEW else 64
    scene.eevee.use_raytracing = False
else:
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 3
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    preferences=bpy.context.preferences.addons['cycles'].preferences
    try:
        preferences.compute_device_type='HIP';preferences.get_devices()
        for device in preferences.devices:device.use=device.type=='HIP'
        if any(d.type=='HIP' for d in preferences.devices):scene.cycles.device='GPU'
    except Exception:pass


def material(name, color, brick=False, texture=True, roughness=0.82):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    if texture:
        tex = nodes.new('ShaderNodeTexCoord')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 4.5
        noise.inputs['Detail'].default_value = 2
        links.new(tex.outputs['Object'], noise.inputs['Vector'])
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.12
        ramp.color_ramp.elements[1].position = 0.9
        ramp.color_ramp.elements[0].color = (*(c * 0.72 for c in color), 1)
        ramp.color_ramp.elements[1].color = (*(min(1, c * 1.13) for c in color), 1)
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.24
        bump.inputs['Distance'].default_value = 0.11
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        if brick:
            bricks = nodes.new('ShaderNodeTexBrick')
            bricks.inputs['Color1'].default_value = (*color, 1)
            bricks.inputs['Color2'].default_value = (*(c * 0.83 for c in color), 1)
            bricks.inputs['Mortar'].default_value = (*(c * 0.48 for c in color), 1)
            bricks.inputs['Scale'].default_value = 1.3
            bricks.inputs['Mortar Size'].default_value = 0.024
            bricks.inputs['Mortar Smooth'].default_value = 0
            links.new(tex.outputs['UV'], bricks.inputs['Vector'])
            links.new(bricks.outputs['Color'], bsdf.inputs['Base Color'])
            links.new(bricks.outputs['Fac'], bump.inputs['Height'])
    return m


grass = [material('Grass '+str(i), c) for i, c in enumerate([(0.24,0.39,0.065),(0.29,0.43,0.08),(0.20,0.33,0.055),(0.33,0.44,0.11)])]
stone = [material('Natural stone '+str(i), c) for i, c in enumerate([(0.29,0.31,0.32),(0.36,0.37,0.37),(0.23,0.26,0.29)])]
dirt = material('Exposed soil', (0.25,0.145,0.08))
snow = material('Snow', (0.76,0.85,0.88))
leaves = [material('Leaves '+str(i),c) for i,c in enumerate([(0.055,0.16,0.035),(0.11,0.23,0.045),(0.18,0.29,0.055),(0.095,0.20,0.075)])]
trunk = material('Pine bark',(0.21,0.115,0.055))
castle = material('Warm limestone bricks',(0.53,0.51,0.40),brick=True)
trim = material('Pale dressed stone',(0.69,0.64,0.47),brick=True)
roof = material('Blue slate tiles',(0.10,0.16,0.22),brick=True)
window = material('Recessed windows',(0.022,0.026,0.025),texture=False)
gold = material('Roof finials',(0.51,0.35,0.09),roughness=0.38)
flower_white = material('White flowers',(0.81,0.82,0.63),texture=False)
flower_yellow = material('Yellow flowers',(0.9,0.56,0.045),texture=False)
banner = material('Forest green flags',(0.11,0.30,0.13),texture=False)
water = material('Clear lake',(0.075,0.20,0.26),texture=False,roughness=0.22)
wn = water.node_tree.nodes
wl = water.node_tree.links
wt = wn.new('ShaderNodeTexNoise')
wt.inputs['Scale'].default_value = 0.7
wt.inputs['Detail'].default_value = 2
wt.inputs['Roughness'].default_value = 0.5
wc = wn.new('ShaderNodeTexCoord')
wm = wn.new('ShaderNodeVectorMath'); wm.operation='MULTIPLY'; wm.inputs[1].default_value=(0.45,1.2,0.2)
wl.new(wc.outputs['Object'],wm.inputs[0]);wl.new(wm.outputs['Vector'],wt.inputs['Vector'])
wb = wn.new('ShaderNodeBump');wb.inputs['Strength'].default_value=0.22;wb.inputs['Distance'].default_value=0.28
wl.new(wt.outputs['Fac'],wb.inputs['Height']);wl.new(wb.outputs['Normal'],wn.get('Principled BSDF').inputs['Normal'])
wn.get('Principled BSDF').inputs['Metallic'].default_value=0.32


class Geometry:
    def __init__(self, name):
        self.name=name;self.vertices=[];self.faces=[];self.material_ids=[];self.materials=[];self.uv=[]

    def face(self, points, mat, axis='xy'):
        start=len(self.vertices);self.vertices.extend(points)
        self.faces.append(tuple(range(start,start+len(points))))
        if mat not in self.materials:self.materials.append(mat)
        self.material_ids.append(self.materials.index(mat))
        a,b={'xy':(0,1),'xz':(0,2),'yz':(1,2)}[axis]
        self.uv.extend((p[a],p[b]) for p in points)

    def box(self,x,y,z,sx,sy,sz,mat):
        a=x-sx/2;b=x+sx/2;c=y-sy/2;d=y+sy/2;e=z;f=z+sz
        self.face([(a,c,f),(b,c,f),(b,d,f),(a,d,f)],mat)
        self.face([(a,d,e),(b,d,e),(b,c,e),(a,c,e)],mat)
        self.face([(a,c,e),(b,c,e),(b,c,f),(a,c,f)],mat,'xz')
        self.face([(b,d,e),(a,d,e),(a,d,f),(b,d,f)],mat,'xz')
        self.face([(a,d,e),(a,c,e),(a,c,f),(a,d,f)],mat,'yz')
        self.face([(b,c,e),(b,d,e),(b,d,f),(b,c,f)],mat,'yz')

    def finish(self):
        mesh=bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices,[],self.faces);mesh.materials.clear()
        for m in self.materials:mesh.materials.append(m)
        for poly,index in zip(mesh.polygons,self.material_ids):poly.material_index=index
        uv=mesh.uv_layers.new(name='World scale block texture')
        for loop,coord in zip(uv.data,self.uv):loop.uv=coord
        mesh.update()
        obj=bpy.data.objects.new(self.name,mesh);scene.collection.objects.link(obj)
        return obj


def hash_noise(x,y):
    return (math.sin(x*127.1+y*311.7)*43758.5453123)%1


def noise(x,y):
    ix=math.floor(x);iy=math.floor(y);fx=x-ix;fy=y-iy
    fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
    a=hash_noise(ix,iy)*(1-fx)+hash_noise(ix+1,iy)*fx
    b=hash_noise(ix,iy+1)*(1-fx)+hash_noise(ix+1,iy+1)*fx
    return a*(1-fy)+b*fy


peaks=[(math.cos(a)*r,math.sin(a)*r,hh,ww) for a,r,hh,ww in [(i*math.tau/18,random.uniform(460,650),random.uniform(80,185),random.uniform(70,115)) for i in range(18)]]


def height(x,y):
    r=math.hypot(x,y)
    h=-9+max(0,r-160)*0.105+(noise(x/65,y/65)-0.5)*20+(noise(x/19,y/19)-0.5)*5
    h+=31*math.exp(-((x/55)**2+((y+140)/57)**2))
    island=math.hypot(x-70,y-90)
    h+=40*math.exp(-(island/52)**2)
    if island<32:h=max(h,22)
    for px,py,hh,ww in peaks:h+=hh*math.exp(-(((x-px)/ww)**2+((y-py)/ww)**2))
    h+=(noise(x/14,y/14)-0.5)*max(0,h-35)*0.22
    return math.floor(h/2.0)*2.0


terrain=Geometry('Continuous terraced voxel valley')
for x in range(-720,720,6):
    for y in range(-720,720,6):
        if -222<=x<222 and -222<=y<222:continue
        h=height(x+3,y+3)
        top=snow if h>185 else random.choice(stone) if h>125 else random.choice(grass)
        terrain.face([(x,y,h),(x+6,y,h),(x+6,y+6,h),(x,y+6,h)],top)
        for nx,ny,pts,axis in [(x+6,y,[(x+6,y,0),(x+6,y+6,0)],'yz'),(x,y+6,[(x+6,y+6,0),(x,y+6,0)],'xz')]:
            nh=height(nx+3,ny+3)
            if nh!=h:
                a,b=pts
                terrain.face([(a[0],a[1],h),(b[0],b[1],h),(b[0],b[1],nh),(a[0],a[1],nh)],random.choice(stone),axis)
for x in range(-222,222,3):
    for y in range(-222,222,3):
        h=height(x+1.5,y+1.5)
        terrain.face([(x,y,h),(x+3,y,h),(x+3,y+3,h),(x,y+3,h)],random.choice(grass))
        for nx,ny,pts,axis in [(x+3,y,[(x+3,y,0),(x+3,y+3,0)],'yz'),(x,y+3,[(x+3,y+3,0),(x,y+3,0)],'xz')]:
            nh=height(nx+1.5,ny+1.5)
            if nh!=h:
                a,b=pts
                terrain.face([(a[0],a[1],h),(b[0],b[1],h),(b[0],b[1],nh),(a[0],a[1],nh)],random.choice(stone) if max(h,nh)>10 else dirt,axis)
terrain.finish()
lake=Geometry('Reflective open water')
lake.face([(-900,-900,0),(900,-900,0),(900,900,0),(-900,900,0)],water)
lake.finish()

forest=Geometry('Voxel pine and oak forest')
for i in range(6000):
    x=random.uniform(-560,560);y=random.uniform(-560,560);z=height(x,y)
    if z<2 or z>135 or math.hypot(x-70,y-90)<56 or math.hypot(x,y+115)<65:continue
    if 115<x<240 and abs(y-90)<13:continue
    size=random.uniform(0.65,1.2);hh=random.uniform(9,18)*size
    forest.box(x,y,z,0.9*size,0.9*size,hh,trunk)
    mat=random.choice(leaves)
    for layer in range(5):
        w=(7.7-layer*1.25)*size
        forest.box(x,y,z+3*size+layer*2.3*size,w,w,2.5*size,mat)
        if layer<4:
            for corner in [-1,1]:
                forest.box(x+corner*w*0.38,y+random.choice([-1,1])*w*0.38,z+3*size+layer*2.3*size,1.7*size,1.7*size,2.5*size,random.choice(leaves))
    forest.box(x,y,z+hh,1.3*size,1.3*size,1.8*size,mat)
forest.finish()

plants=Geometry('Meadow grass flowers and stone details')
for i in range(1400):
    x=random.uniform(-160,160);y=random.uniform(-210,185);z=height(x,y)
    if z<2 or math.hypot(x-70,y-90)<38:continue
    if math.hypot(x,y+115)<12:continue
    m=random.choice(grass)
    for dx,dy in [(-0.27,0),(0.25,0.23),(0,-0.23)]:
        plants.box(x+dx,y+dy,z,0.13,0.12,random.uniform(0.35,0.9),m)
    if i%6==0:
        plants.box(x,y,z,0.09,0.09,0.9,leaves[1])
        plants.box(x,y,z+0.8,0.48,0.48,0.12,flower_white if i%12 else flower_yellow)
    if i%8==0:plants.box(x+0.7,y+0.3,z,0.9,0.7,0.5,random.choice(stone))
plants.finish()

build=Geometry('Distant limestone chateau with masonry and towers')
cx,cy,bz=70,90,22
build.box(cx,cy,bz,40,35,3,trim)
build.box(cx,cy,bz+3,31,27,29,castle)
build.box(cx,cy,bz+31,33,29,1.3,trim)
for i in range(11):
    build.box(cx-15+i*3,cy-14.5,bz+32,1.6,1.6,2.5,trim)
    build.box(cx-15+i*3,cy+14.5,bz+32,1.6,1.6,2.5,trim)


def roof_steps(x,y,z,width,depth,hh):
    count=12
    for i in range(count):
        f=1-i/(count+0.1)
        build.box(x,y,z+hh*i/count,width*f,depth*f,hh/count+0.06,roof)
    build.box(x,y,z+hh,0.5,0.5,2.4,gold)


roof_steps(cx,cy,bz+34,32,28,17)


def front_window(x,y,z,facing='y'):
    # Black recess plus stone ledges keep the rectangular voxel architecture readable.
    if facing=='y':
        build.box(x,y,z,1.8,0.12,3.2,window)
        build.box(x,y,z+3.2,1.2,0.12,0.7,window)
        build.box(x,y,z-0.22,2.5,0.6,0.35,trim)
        build.box(x,y-0.03,z+1.5,0.18,0.3,1.7,trim)
    else:
        build.box(x,y,z,0.12,1.8,3.2,window)
        build.box(x,y,z+3.2,0.12,1.2,0.7,window)
        build.box(x,y,z-0.22,0.6,2.5,0.35,trim)


for row in range(3):
    for col in range(5):
        front_window(cx-12+col*6,cy-13.58,bz+7+row*8)
        front_window(cx-12+col*6,cy+13.58,bz+7+row*8)
for tx,ty,th in [(-22,-19,40),(22,-19,44),(-22,19,43),(22,19,46),(0,2,62)]:
    x=cx+tx;y=cy+ty
    build.box(x,y,bz,9,9,th,castle)
    for zz in [8,20,th-3]:build.box(x,y,bz+zz,9.7,9.7,0.65,trim)
    for row in range(3):
        front_window(x,y-4.57,bz+9+row*9)
        front_window(x+4.57,y,bz+9+row*9,'x')
        front_window(x,y+4.57,bz+9+row*9)
    roof_steps(x,y,bz+th,12,12,14)
    build.box(x,y,bz+th+15,0.25,0.25,4,gold)
    build.box(x+1.5,y,bz+th+17,3,0.13,1.6,banner)

# An arched bridge joins the island to the eastern shore, with real open arches.
for i in range(7):
    x=104+i*19
    build.box(x,90,-4,3.5,9,29,castle)
    build.box(x+9.5,90,24,19,8,1.5,trim)
    build.box(x+9.5,85.8,25.5,19,0.75,2.1,trim)
    build.box(x+9.5,94.2,25.5,19,0.75,2.1,trim)
    for side in [-1,1]:
        yy=90+side*3.7
        for step in range(10):
            t=-1+2*(step+0.5)/10
            underside=13+math.sqrt(max(0,1-t*t))*9.7
            build.box(x+1.75+(step+0.5)*1.55,yy,underside,1.6,0.8,max(0.3,24-underside),castle)
build.finish()

# Crisp cuboid clouds in one common sky; no blur, bloom, screen-space effects or DOF.
cloud_mat=material('Golden white voxel clouds',(0.95,0.95,0.92),texture=False)
clouds=Geometry('Common block cloud sky')
for i in range(12):
    x=random.uniform(-950,950);y=random.uniform(-950,950)
    z=random.uniform(270,350)
    for j in range(random.randint(3,7)):
        clouds.box(x+random.randint(-3,3)*22,y+random.randint(-2,2)*22,z,random.choice([22,44,66]),random.choice([22,44]),6,cloud_mat)
clouds.finish()
world=bpy.data.worlds.new('One sunset sky shared by all six views');world.use_nodes=True;scene.world=world
sky=world.node_tree.nodes.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING';sky.sun_elevation=math.radians(25);sky.sun_rotation=math.radians(250);sky.sun_disc=False;sky.altitude=0.1;sky.air_density=1
world.node_tree.links.new(sky.outputs['Color'],world.node_tree.nodes.get('Background').inputs['Color'])
world.node_tree.nodes.get('Background').inputs['Strength'].default_value=0.20
sun_data=bpy.data.lights.new('Warm low sun','SUN');sun_data.energy=2.3;sun_data.angle=math.radians(0.6);sun_data.color=(1,0.82,0.62)
sun=bpy.data.objects.new('Warm low sun',sun_data);scene.collection.objects.link(sun)
sun_direction=Vector((math.cos(math.radians(250))*math.cos(math.radians(25)),math.sin(math.radians(250))*math.cos(math.radians(25)),math.sin(math.radians(25))))
sun.rotation_euler=(-sun_direction).to_track_quat('-Z','Y').to_euler()
fill_data=bpy.data.lights.new('Cool open-sky fill','SUN');fill_data.energy=0.16;fill_data.angle=0.1;fill_data.color=(0.52,0.7,1)
fill=bpy.data.objects.new('Cool open-sky fill',fill_data);scene.collection.objects.link(fill);fill.rotation_euler=(0.25,0,2.4)

camera_data=bpy.data.cameras.new('Fixed panorama origin');camera=bpy.data.objects.new('Fixed panorama origin',camera_data);scene.collection.objects.link(camera);scene.camera=camera
camera.location=(0,-115,height(0,-115)+18)
camera_data.clip_end=2600;camera_data.clip_start=0.15;camera_data.dof.use_dof=False;camera_data.sensor_fit='HORIZONTAL';camera_data.sensor_width=36


def orient(direction, up):
    forward=Vector(direction).normalized();up=Vector(up).normalized();right=forward.cross(up).normalized();up=right.cross(forward).normalized()
    from mathutils import Matrix
    camera.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()


faces=[('right',(1,0,0),(0,0,1)),('left',(-1,0,0),(0,0,1)),('up',(0,0,1),(0,-1,0)),('down',(0,0,-1),(0,1,0)),('front',(0,1,0),(0,0,1)),('back',(0,-1,0),(0,0,1))]
print('Scene created:',sum(len(o.data.polygons) for o in scene.objects if o.type=='MESH'),'faces',flush=True)
if '--save-scene' in sys.argv:
    source_file=ROOT/'build/panorama-art/castle-environment.blend'
    source_file.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_file))
scene.render.resolution_x=960 if PREVIEW else 1920;scene.render.resolution_y=540 if PREVIEW else 1080
camera_data.lens=18
orient((math.sin(0.12),math.cos(0.12),0.06),(0,0,1))
scene.render.filepath=str(OUT/'poster.png');bpy.ops.render.render(write_still=True)
if not PREVIEW:
    scene.render.resolution_x=scene.render.resolution_y=2048;camera_data.lens=18
    for name,direction,up in faces:
        orient(direction,up);scene.render.filepath=str(OUT/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        print('Saved native 2048px face:',name,flush=True)
