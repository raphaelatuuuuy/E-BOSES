declare module "three" {
  export class Material { opacity: number; color: Color }
  export class MeshBasicMaterial extends Material { constructor(params?: Record<string, unknown>) }
  export class LineBasicMaterial extends Material { constructor(params?: Record<string, unknown>) }
  export class BufferGeometry { setAttribute(name: string, attribute: unknown): this; setDrawRange(start: number, count: number): void; dispose(): void; boundingBox: Box3 | null; rotateX(angle: number): this; center(): this; computeBoundingBox(): void }
  export class Float32BufferAttribute { constructor(array: number[], itemSize: number) }
  export class CanvasTexture { constructor(canvas: HTMLCanvasElement); colorSpace: unknown; dispose(): void }
  export class Color { constructor(color?: string); copy(color: Color): this; lerp(color: Color, alpha: number): this }
  export class Vector3 { constructor(x?: number, y?: number, z?: number); x: number; y: number; z: number; clone(): Vector3; lerp(v: Vector3, alpha: number): this; distanceTo(v: Vector3): number }
  export class QuadraticBezierCurve3 { constructor(v0: Vector3, v1: Vector3, v2: Vector3) }
  export class TubeGeometry extends BufferGeometry { constructor(path: QuadraticBezierCurve3, tubularSegments?: number, radius?: number, radialSegments?: number, closed?: boolean); index?: { count: number } }
  export class ExtrudeGeometry extends BufferGeometry { constructor(shapes: unknown, options?: Record<string, unknown>) }
  export class EdgesGeometry extends BufferGeometry { constructor(geometry: BufferGeometry, thresholdAngle?: number) }
  export class Box3 { min: Vector3; max: Vector3 }
  export class Object3D { position: Vector3; rotation: Vector3; scale: { set(x: number, y: number, z: number): void } }
  export class Group extends Object3D {}
  export class Mesh extends Object3D { material: Material }
  export class Sprite extends Object3D { material: Material }
  export class LineSegments extends Object3D { material: Material }
  export const SRGBColorSpace: unknown
  export const DoubleSide: unknown
  export const AdditiveBlending: unknown
}
