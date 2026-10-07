import { useEffect, useRef, useState } from 'react'
import type { HeroSlide, PanoramaCube } from './hero-slides'

function Panorama({ image, initialYaw = 0 }: { image: string | PanoramaCube; initialYaw?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const surface = canvas.current!
    const gl = surface.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' })
    if (!gl) return
    let frame = 0, loaded = false, disposed = false, visible = !document.hidden, last = 0, yaw = initialYaw
    const shaders: WebGLShader[] = []
    const cube = Array.isArray(image)
    const faces = cube ? image : [image]
    const target = cube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D
    const program = gl.createProgram()!, buffer = gl.createBuffer()!, texture = gl.createTexture()!
    const cleanup = () => {
      disposed = true; cancelAnimationFrame(frame)
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader))
    }
    const shader = (type: number, source: string) => {
      const value = gl.createShader(type)!
      shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value)
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('Panorama shader')
      gl.attachShader(program, value)
    }
    try {
      shader(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 uv; void main(){uv=position;gl_Position=vec4(position,0.0,1.0);}')
      // Built-ins use native renders of one scene; custom images retain their full sphere projection.
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump'
      shader(gl.FRAGMENT_SHADER, `precision ${precision} float; varying vec2 uv; uniform ${cube ? 'samplerCube' : 'sampler2D'} panorama; uniform float aspect; uniform float yaw;
        void main(){vec3 ray=normalize(vec3(uv.x*aspect*0.55,uv.y*0.55,1.0));float c=cos(yaw),s=sin(yaw);
        ray=vec3(c*ray.x+s*ray.z,ray.y,-s*ray.x+c*ray.z);
        ${cube ? 'gl_FragColor=textureCube(panorama,ray);' : `vec2 sphere=vec2(fract(0.5+atan(ray.x,ray.z)/6.2831853),0.5-asin(clamp(ray.y,-1.0,1.0))/3.14159265);
        gl_FragColor=texture2D(panorama,sphere);`}}`)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Panorama program')
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
      gl.bindTexture(target, texture)
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.uniform1i(gl.getUniformLocation(program, 'panorama'), 0)
    } catch { cleanup(); return }
    const aspect = gl.getUniformLocation(program, 'aspect'), rotation = gl.getUniformLocation(program, 'yaw')
    const draw = (now: number) => {
      if (disposed || !visible || !loaded) return
      if (!last || now - last >= 1000 / 30) {
        // Always turn left; periodic sampling makes 360 -> 0 the same direction without a reversal.
        if (last) yaw = (yaw - Math.min(now - last, 100) * 0.000055) % (Math.PI * 2)
        last = now
        gl.uniform1f(rotation, yaw); gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
      frame = requestAnimationFrame(draw)
    }
    const resize = () => {
      const bounds = surface.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) / Math.max(1, bounds.width, bounds.height))
      surface.width = Math.max(1, Math.round(bounds.width * ratio)); surface.height = Math.max(1, Math.round(bounds.height * ratio))
      const screenAspect = surface.width / surface.height
      gl.viewport(0, 0, surface.width, surface.height); gl.uniform1f(aspect, screenAspect)
    }
    let remaining = faces.length, cubeSize = 0
    const sources = faces.map((face, index) => {
      const source = new Image()
      source.onload = () => {
        if (disposed) return
        const maxSize = gl.getParameter(cube ? gl.MAX_CUBE_MAP_TEXTURE_SIZE : gl.MAX_TEXTURE_SIZE)
        if (source.width > maxSize || source.height > maxSize) return
        if (cube && (source.width !== source.height || (cubeSize && source.width !== cubeSize))) return
        if (cube) cubeSize = source.width
        gl.bindTexture(target, texture)
        gl.texImage2D(cube ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + index : target, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source)
        if (--remaining !== 0) return
        loaded = true; resize(); gl.uniform1f(rotation, yaw); gl.drawArrays(gl.TRIANGLES, 0, 6)
        setReady(true); frame = requestAnimationFrame(draw)
      }
      source.src = face
      return source
    })
    const observer = new ResizeObserver(resize); observer.observe(surface)
    window.addEventListener('resize', resize)
    const visibility = () => { visible = !document.hidden; cancelAnimationFrame(frame); last = 0; if (visible && loaded) frame = requestAnimationFrame(draw) }
    const lost = (event: Event) => { event.preventDefault(); loaded = false; disposed = true; cancelAnimationFrame(frame); setReady(false) }
    document.addEventListener('visibilitychange', visibility); surface.addEventListener('webglcontextlost', lost)
    return () => { sources.forEach(source => { source.onload = null }); observer.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility); surface.removeEventListener('webglcontextlost', lost); cleanup() }
  }, [image, initialYaw])
  return <canvas ref={canvas} className={`hero-panorama ${ready ? 'ready' : ''}`} aria-hidden="true" />
}

export function HeroBackground({ slide, motion, active }: { slide: HeroSlide; motion: boolean; active: boolean }) {
  const [customImage, setCustomImage] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'), changed = () => setReducedMotion(media.matches)
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!slide.custom || !active) return
    let cancelled = false
    setCustomImage(null)
    void window.launcher.readHeroBackground(slide.id).then(image => { if (!cancelled) setCustomImage(image) }).catch(() => {})
    return () => { cancelled = true }
  }, [slide.id, slide.custom, active])
  const image = slide.custom ? customImage : slide.image
  const animate = motion && !reducedMotion && active
  const panorama = slide.custom ? slide.panorama && image : slide.panoramaCube ?? slide.panoramaImage
  return <div className={`hero-image ${active ? 'active' : ''} ${animate && !panorama ? 'hero-image-moving' : ''}`} data-background-id={slide.id} style={{ backgroundImage: image ? `url("${image}")` : undefined }}>
    {animate && panorama && <Panorama key={slide.id} image={panorama} initialYaw={slide.panoramaYaw} />}
  </div>
}
