// apps/web/src/features/landing/scenes/alarm-map-3d.tsx
import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import { Canvas, useFrame, useLoader } from "@react-three/fiber"
import { SVGLoader } from "three-stdlib"
import * as THREE from "three"

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
const TWO_PI = Math.PI * 2

const RED = "#ff3b30"
const BLUE = "#4da3ff"
const GREEN = "#37d67a"

/** Marker spots as fractions of the boundary bounding box (x rightward,
 *  y downward from the top edge), hand-tuned to sit inside the boundary. */
const INCIDENT = { x: 0.46, y: 0.37 }

/** Blue responder units revealed by the beat 2 radar sweep; each links back to
 *  the incident with a routed arc. */
const RESPONDERS = [
  { x: 0.63, y: 0.59, label: "RESPONDER" },
  { x: 0.34, y: 0.48, label: "RESPONDER" },
  { x: 0.55, y: 0.25, label: "RESPONDER" },
] as const

/** Green neighbor spots inside the beat 3 awareness dome. */
const NEIGHBORS = [
  { x: 0.4, y: 0.29 },
  { x: 0.53, y: 0.31 },
  { x: 0.38, y: 0.43 },
  { x: 0.52, y: 0.46 },
  { x: 0.46, y: 0.23 },
  { x: 0.58, y: 0.39 },
] as const

/** Radar tuning: sweep spin, in rad/s. */
const SWEEP_SPEED = 1.5

type Dims = { w: number; h: number; top: number }

const setOpacity = (o: THREE.Mesh | THREE.Sprite | THREE.LineSegments | null, v: number) => {
  if (o) (o.material as THREE.Material & { opacity: number }).opacity = v
}

/** Clean dome wireframe: latitude rings + meridian arcs only. A `wireframe`
 *  sphere would draw every triangle edge, which reads as a tangled web. */
function makeDomeWire(radius: number, lats = 4, meridians = 12): THREE.BufferGeometry {
  const pos: number[] = []
  const SEG = 72
  const push = (t0: number, a0: number, t1: number, a1: number) => {
    pos.push(
      Math.cos(a0) * radius * Math.sin(t0),
      Math.sin(a0) * radius * Math.sin(t0),
      radius * Math.cos(t0),
      Math.cos(a1) * radius * Math.sin(t1),
      Math.sin(a1) * radius * Math.sin(t1),
      radius * Math.cos(t1),
    )
  }
  for (let i = 1; i <= lats; i++) {
    const t = (i / lats) * (Math.PI / 2)
    for (let s = 0; s < SEG; s++) {
      push(t, (s / SEG) * TWO_PI, t, ((s + 1) / SEG) * TWO_PI)
    }
  }
  const STEPS = 20
  for (let j = 0; j < meridians; j++) {
    const a = (j / meridians) * TWO_PI
    for (let s = 0; s < STEPS; s++) {
      push((s / STEPS) * (Math.PI / 2), a, ((s + 1) / STEPS) * (Math.PI / 2), a)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  return geo
}

/** Console-style label plate drawn to a canvas so it can ride the scene as a
 *  camera-facing sprite (no drei dependency). */
function makeLabel(text: string, accent: string): { texture: THREE.CanvasTexture; aspect: number } | null {
  const canvas = document.createElement("canvas")
  const probe = canvas.getContext("2d")
  if (!probe) return null
  const font = '700 44px ui-monospace, SFMono-Regular, Menlo, monospace'
  const applyFont = (c: CanvasRenderingContext2D) => {
    c.font = font
    if ("letterSpacing" in c) c.letterSpacing = "7px"
  }
  applyFont(probe)
  const padX = 34
  const padY = 26
  const barW = 16
  const textW = Math.ceil(probe.measureText(text).width)
  const w = textW + padX * 2 + barW + 14
  const h = 44 + padY * 2
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  applyFont(ctx)
  // Dark plate with a hairline border and a solid accent tab on the left
  ctx.fillStyle = "rgba(7,7,11,0.72)"
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = accent
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3)
  ctx.globalAlpha = 1
  ctx.fillStyle = accent
  ctx.fillRect(padX - 8, h / 2 - barW / 2, barW, barW)
  ctx.fillStyle = "rgba(245,242,236,0.94)"
  ctx.textBaseline = "middle"
  ctx.fillText(text, padX + barW + 6, h / 2 + 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: w / h }
}

/** Rotating radar gradient: bright leading edge fading around the sweep tail. */
function makeSweepTexture(color: string): THREE.CanvasTexture | null {
  const size = 512
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const c = size / 2
  // Thin angular slices approximate a conic falloff without needing
  // createConicGradient (kept for older engines), multiplied by a radial fade.
  const slices = 180
  for (let i = 0; i < slices; i++) {
    const a0 = (i / slices) * TWO_PI
    const a1 = ((i + 1.5) / slices) * TWO_PI
    const t = 1 - i / slices
    ctx.globalAlpha = Math.pow(t, 3.2) * 0.85
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.arc(c, c, c, a0, a1)
    ctx.closePath()
    ctx.fill()
  }
  // Radial fade so the wedge dissolves before the outer edge
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "destination-in"
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, "rgba(0,0,0,0.15)")
  grad.addColorStop(0.55, "rgba(0,0,0,0.85)")
  grad.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Beat graphics living on the map surface, in local map coordinates, so they
 *  inherit the hologram tilt + rotation of the parent boundary group. */
function BeatOverlays({ progress, dims }: { progress: MutableRefObject<number>; dims: Dims }) {
  const { w, h, top } = dims
  const u = Math.min(w, h)
  const px = (fx: number) => (fx - 0.5) * w
  const py = (fy: number) => (0.5 - fy) * h
  const ix = px(INCIDENT.x)
  const iy = py(INCIDENT.y)

  // --- Incident (beat 1)
  const sosWrap = useRef<THREE.Group>(null)
  const sosCore = useRef<THREE.Mesh>(null)
  const sosHalo = useRef<THREE.Mesh>(null)
  const sosLabel = useRef<THREE.Sprite>(null)
  const sosStem = useRef<THREE.Mesh>(null)
  const pulses = useRef<Array<THREE.Mesh | null>>([])

  // --- Scan (beats 2 and 3; the same rig, tinted blue then green)
  const sweep = useRef<THREE.Mesh>(null)
  const rangeRings = useRef<Array<THREE.Mesh | null>>([])
  const responders = useRef<Array<THREE.Mesh | null>>([])
  const respLabels = useRef<Array<THREE.Sprite | null>>([])
  const arcMeshes = useRef<Array<THREE.Mesh | null>>([])
  const revealed = useRef<number[]>(RESPONDERS.map(() => 0))

  // --- Scan dome wire (spans beats 2 and 3) + awareness dots
  const globeWrap = useRef<THREE.Group>(null)
  const globeGrid = useRef<THREE.LineSegments>(null)
  const neighbors = useRef<Array<THREE.Mesh | null>>([])

  /** Scratch colors for the blue -> green scan handover (no per-frame allocs). */
  const scanColor = useMemo(() => new THREE.Color(BLUE), [])
  const blueRef = useMemo(() => new THREE.Color(BLUE), [])
  const greenRef = useMemo(() => new THREE.Color(GREEN), [])

  /** Routed arcs from each responder to the incident, lifted off the surface. */
  const arcs = useMemo(() => {
    const target = new THREE.Vector3(ix, iy, top + u * 0.022)
    return RESPONDERS.map(({ x, y }) => {
      const from = new THREE.Vector3(px(x), py(y), top + u * 0.012)
      const mid = from.clone().lerp(target, 0.5)
      mid.z += from.distanceTo(target) * 0.42
      const curve = new THREE.QuadraticBezierCurve3(from, mid, target)
      const geometry = new THREE.TubeGeometry(curve, 64, u * 0.0038, 6, false)
      geometry.setDrawRange(0, 0)
      return { geometry, indexCount: geometry.index?.count ?? 0 }
    })
    // px/py are pure functions of w/h, so the box dims fully describe the arcs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, top, u, ix, iy])

  // Sized so the dome stays inside the barangay boundary around the incident.
  const domeWire = useMemo(() => makeDomeWire(u * 0.19), [u])
  const sweepTexture = useMemo(() => makeSweepTexture(BLUE), [])
  const sosLabelTex = useMemo(() => makeLabel("EMERGENCY", RED), [])
  const respLabelTex = useMemo(() => RESPONDERS.map((r) => makeLabel(r.label, BLUE)), [])

  /** Bearing of each responder around the incident, for the sweep-pass flash. */
  const bearings = useMemo(
    () => RESPONDERS.map(({ x, y }) => Math.atan2((INCIDENT.y - y) * h, (x - INCIDENT.x) * w)),
    [w, h],
  )

  useEffect(
    () => () => {
      arcs.forEach((a) => a.geometry.dispose())
      domeWire.dispose()
      sweepTexture?.dispose()
      sosLabelTex?.texture.dispose()
      respLabelTex.forEach((l) => l?.texture.dispose())
    },
    [arcs, domeWire, sweepTexture, sosLabelTex, respLabelTex],
  )

  useFrame((state) => {
    const now = state.clock.elapsedTime
    const p = progress.current
    const beat1 = clamp01(p / 0.33)
    const beat2 = clamp01((p - 0.33) / 0.33)
    const beat3 = clamp01((p - 0.66) / 0.34)

    // ---- Beat 1: incident beacon, leader line, label
    const sosIn = clamp01(beat1 * 3)
    if (sosWrap.current) {
      const s = 0.6 + sosIn * 0.4
      sosWrap.current.scale.set(s, s, s)
    }
    const breathe = 0.75 + 0.25 * Math.sin(now * 3.4)
    setOpacity(sosCore.current, sosIn)
    setOpacity(sosHalo.current, sosIn * 0.3 * breathe)
    setOpacity(sosStem.current, sosIn * 0.5)
    setOpacity(sosLabel.current, clamp01((beat1 - 0.22) / 0.18))

    const pulseStrength = sosIn * (1 - beat2 * 0.6)
    pulses.current.forEach((ring, k) => {
      if (!ring) return
      const phase = (now / 1.7 + k / 3) % 1
      const s = 0.25 + phase * 1.5
      ring.scale.set(s, s, 1)
      // Rings lift slightly as they spread so the pulse reads in 3D
      ring.position.z = top + u * (0.006 + phase * 0.02)
      setOpacity(ring, (1 - phase) * 0.55 * pulseStrength)
    })

    // ---- Beats 2 and 3 share one scan rig: the sweep, ripples and range rings
    // stay live and hand over from responder blue to neighbor green.
    // The globe holds to the end of beat 3 as the awareness radius; only the
    // spinning radar wedge retires once the scan has found everyone.
    const scanOn = clamp01(beat2 * 4)
    const green = clamp01((beat3 - 0.05) / 0.3)
    const sweepFade = 1 - clamp01((beat3 - 0.35) / 0.35)
    scanColor.copy(blueRef).lerp(greenRef, green)
    if (sweep.current) {
      sweep.current.rotation.z = -now * SWEEP_SPEED
      const mat = sweep.current.material as THREE.MeshBasicMaterial
      mat.color.copy(scanColor)
      mat.opacity = scanOn * 0.5 * sweepFade
    }

    // Scan dome wire: one dome across both beats, simply changing hue as the
    // alert hands over from responders to neighbors.
    if (globeWrap.current) {
      const s = 0.86 + clamp01(beat2 * 2) * 0.1 + green * 0.04
      globeWrap.current.scale.set(s, s, s)
      globeWrap.current.rotation.z = now * 0.14
    }
    if (globeGrid.current) {
      ;(globeGrid.current.material as THREE.LineBasicMaterial).color.copy(scanColor)
    }
    setOpacity(globeGrid.current, scanOn * (0.35 + green * 0.1))

    rangeRings.current.forEach((ring, k) => {
      if (!ring) return
      const mat = ring.material as THREE.MeshBasicMaterial
      mat.color.copy(scanColor)
      // The widest ring reads as the awareness radius once the scan goes green
      mat.opacity = scanOn * (0.2 - k * 0.05 + green * (k === 2 ? 0.28 : 0.06))
    })

    const rot = ((-now * SWEEP_SPEED) % TWO_PI + TWO_PI) % TWO_PI
    responders.current.forEach((dot, i) => {
      const gate = clamp01((beat2 - (0.08 + i * 0.15)) / 0.1)
      let a = ((bearings[i] ?? 0) - rot) % TWO_PI
      if (a < 0) a += TWO_PI
      const flash = scanOn > 0 && gate > 0 ? Math.max(0, 1 - a / 0.9) : 0
      if (beat2 <= 0.02) revealed.current[i] = 0
      else if (gate > 0 && flash > 0.7) revealed.current[i] = 1
      // A sweep pass reveals the unit; the late fallback covers fast scrubbing.
      // Once revealed the dot holds steady - no flicker or flash pulsing.
      const on = Math.max(revealed.current[i] ?? 0, clamp01((beat2 - 0.5) / 0.2)) * gate
      const live = clamp01(on * 0.9) * (1 - beat3 * 0.45)
      if (dot) {
        const s = 0.5 + on * 0.5
        dot.scale.set(s, s, s)
        setOpacity(dot, live)
      }
      setOpacity(respLabels.current[i] ?? null, clamp01(on * 1.2) * (1 - beat3 * 0.6))

      // Arc draws from the unit toward the incident once that unit is live
      const arc = arcs[i]
      const draw = clamp01((on - 0.15) / 0.5)
      if (arc) {
        const tri = Math.floor((arc.indexCount * draw) / 6) * 6
        arc.geometry.setDrawRange(0, tri)
      }
      setOpacity(arcMeshes.current[i] ?? null, draw * 0.75 * (1 - beat3 * 0.55))
    })

    // ---- Beat 3: neighbor dots inside the now-green scan radius
    neighbors.current.forEach((dot, i) => {
      if (!dot) return
      const f = clamp01((beat3 - (0.12 + i * 0.12)) / 0.12)
      const s = 0.6 + f * 0.4
      dot.scale.set(s, s, s)
      setOpacity(dot, f * 0.95)
    })
  })

  const labelH = u * 0.082

  return (
    <group>
      {/* Scan dome wire: lat/long lines only, tinted blue then green as the
          alert hands over from responders to neighbors. */}
      <group ref={globeWrap} position={[ix, iy, top + u * 0.002]}>
        <lineSegments ref={globeGrid} geometry={domeWire}>
          <lineBasicMaterial transparent opacity={0} depthWrite={false} />
        </lineSegments>
      </group>

      {/* Concentric range rings around the incident */}
      {[0.09, 0.14, 0.19].map((r, k) => (
        <mesh
          key={`rr${r}`}
          ref={(el: THREE.Mesh | null) => {
            rangeRings.current[k] = el
          }}
          position={[ix, iy, top + u * 0.003]}
        >
          <ringGeometry args={[u * (r - 0.0035), u * r, 72]} />
          <meshBasicMaterial color={BLUE} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Rotating radar gradient laid into the map plane */}
      {sweepTexture ? (
        <mesh ref={sweep} position={[ix, iy, top + u * 0.004]}>
          <planeGeometry args={[u * 0.5, u * 0.5]} />
          <meshBasicMaterial
            map={sweepTexture}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : null}

      {/* Beat 2: routed arcs, unit -> incident */}
      {arcs.map((arc, i) => (
        <mesh
          key={`arc${i}`}
          ref={(el: THREE.Mesh | null) => {
            arcMeshes.current[i] = el
          }}
          geometry={arc.geometry}
        >
          <meshBasicMaterial
            color={BLUE}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      {/* Beat 1: expanding pulse rings that lift as they spread */}
      {[0, 1, 2].map((k) => (
        <mesh
          key={k}
          ref={(el: THREE.Mesh | null) => {
            pulses.current[k] = el
          }}
          position={[ix, iy, top + u * 0.006]}
        >
          <ringGeometry args={[u * 0.072, u * 0.08, 56]} />
          <meshBasicMaterial color={RED} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Beat 1: incident beacon with its leader line and EMERGENCY plate */}
      <group ref={sosWrap} position={[ix, iy, top]}>
        <mesh ref={sosCore} position={[0, 0, u * 0.012]}>
          <sphereGeometry args={[u * 0.016, 16, 12]} />
          <meshBasicMaterial color={RED} transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh ref={sosHalo} position={[0, 0, u * 0.012]}>
          <sphereGeometry args={[u * 0.034, 16, 12]} />
          <meshBasicMaterial
            color={RED}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Leader stem tying the floating plate back down to the pin. The plate
            clears the unit labels below it so the two never collide. */}
        <mesh ref={sosStem} position={[0, 0, u * 0.23]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[u * 0.0015, u * 0.0015, u * 0.46, 6]} />
          <meshBasicMaterial color={RED} transparent opacity={0} depthWrite={false} />
        </mesh>
        {sosLabelTex ? (
          <sprite ref={sosLabel} position={[0, 0, u * 0.5]} scale={[labelH * sosLabelTex.aspect, labelH, 1]}>
            <spriteMaterial map={sosLabelTex.texture} transparent opacity={0} depthWrite={false} />
          </sprite>
        ) : null}
      </group>

      {/* Beat 2: responder units with their unit plates */}
      {RESPONDERS.map(({ x, y }, i) => {
        const lx = px(x)
        const ly = py(y)
        const tex = respLabelTex[i]
        return (
          <group key={`r${x}${y}`} position={[lx, ly, top]}>
            <mesh
              ref={(el: THREE.Mesh | null) => {
                responders.current[i] = el
              }}
              position={[0, 0, u * 0.01]}
            >
              <sphereGeometry args={[u * 0.013, 12, 10]} />
              <meshBasicMaterial color={BLUE} transparent opacity={0} depthWrite={false} />
            </mesh>
            {tex ? (
              // Each plate gets its own height so units never stack on one
              // another at any rotation angle.
              <sprite
                ref={(el: THREE.Sprite | null) => {
                  respLabels.current[i] = el
                }}
                position={[0, 0, u * (0.16 + i * 0.075)]}
                scale={[labelH * 0.8 * tex.aspect, labelH * 0.8, 1]}
              >
                <spriteMaterial map={tex.texture} transparent opacity={0} depthWrite={false} />
              </sprite>
            ) : null}
          </group>
        )
      })}

      {/* Beat 3: green neighbor dots on the surface */}
      {NEIGHBORS.map(({ x, y }, i) => (
        <mesh
          key={`n${x}${y}`}
          ref={(el: THREE.Mesh | null) => {
            neighbors.current[i] = el
          }}
          position={[px(x), py(y), top + u * 0.01]}
        >
          <sphereGeometry args={[u * 0.01, 12, 10]} />
          <meshBasicMaterial color={GREEN} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function BoundaryMesh({ progress }: { progress: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const svg = useLoader(SVGLoader, "/contents/marikina-heights.svg")

  const { geometry, edges, dims, scale } = useMemo(() => {
    const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p))
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: 24, bevelEnabled: false })
    geo.center()
    // SVG y-axis points down; flip so the map lies flat correctly
    geo.rotateX(Math.PI)
    geo.computeBoundingBox()
    const bb = geo.boundingBox as THREE.Box3
    const d: Dims = { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, top: bb.max.z }
    return {
      geometry: geo,
      edges: new THREE.EdgesGeometry(geo, 15),
      dims: d,
      // Fit by the DIAGONAL so the spinning map never crosses the camera
      // frustum and gets flat-cut at the canvas edges (visible on phones).
      scale: 2.5 / Math.hypot(d.w, d.h),
    }
  }, [svg])

  useFrame((state) => {
    if (!group.current) return
    const p = progress.current
    // Hologram-table tilt + slow rotation, slightly influenced by scroll
    group.current.rotation.x = -0.9 + p * 0.15
    group.current.rotation.z = state.clock.elapsedTime * 0.06 + p * 0.6
  })

  return (
    <group ref={group} scale={scale}>
      {/* Faint triangulated fill; the clean boundary silhouette comes from the
          EdgesGeometry pass so the shape reads as a map, not a crumpled mesh. */}
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#ff5003" wireframe transparent opacity={0.1} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#ff8133" transparent opacity={0.95} />
      </lineSegments>
      {/* Beat graphics share this rotating group so they transform with the map */}
      <BeatOverlays progress={progress} dims={dims} />
    </group>
  )
}

export default function AlarmMap3D({ progress }: { progress: MutableRefObject<number> }) {
  return (
    <Canvas
      className="!absolute inset-0 pointer-events-none"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      camera={{ position: [0, 0, 3], fov: 45 }}
    >
      <BoundaryMesh progress={progress} />
    </Canvas>
  )
}
