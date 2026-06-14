// Server-side window decoration: a titlebar (with title + close button) and a
// thin border, rasterized with Canvas2D and uploaded as a WebGL texture so it
// composites IN the scene (correct z-order per window, unlike a DOM overlay).
import type { Size } from '../math/Size'
import type { Scene } from './Scene'
import Texture from './Texture'

export const TITLEBAR_HEIGHT = 26
export const BORDER = 1
export const CLOSE_WIDTH = TITLEBAR_HEIGHT // square close button at the right of the titlebar

export default class Decoration {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D
  private readonly textures: Record<string, Texture> = {}
  private readonly uploadedKey: Record<string, string> = {}
  private renderedKey = ''
  private title = ''
  private active = false

  static create(): Decoration {
    return new Decoration()
  }

  setTitle(title: string): void {
    this.title = title
  }

  setActive(active: boolean): void {
    this.active = active
  }

  /** Texture for this scene framing a surface of `surfaceSize`, or undefined if too small. */
  textureFor(scene: Scene, surfaceSize: Size): Texture | undefined {
    const w = Math.round(surfaceSize.width)
    const h = Math.round(surfaceSize.height)
    if (w <= 1 || h <= 1) {
      return undefined
    }
    const fullW = w + 2 * BORDER
    const fullH = h + TITLEBAR_HEIGHT + BORDER
    const key = `${fullW}x${fullH}|${this.active ? 1 : 0}|${this.title}`

    if (key !== this.renderedKey) {
      this.renderCanvas(fullW, fullH, w, h)
      this.renderedKey = key
    }

    let texture = this.textures[scene.id]
    if (texture === undefined) {
      texture = Texture.create(scene.gl, scene.gl.RGBA)
      this.textures[scene.id] = texture
      this.uploadedKey[scene.id] = ''
    }
    if (this.uploadedKey[scene.id] !== key) {
      // Canvas alpha is straight; the scene blends premultiplied (ONE, 1-SRC_ALPHA).
      const gl = scene.gl
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      texture.setContent(this.canvas, { width: fullW, height: fullH })
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      this.uploadedKey[scene.id] = key
    }
    return texture
  }

  /** Hit-test a point in DECORATION-LOCAL coords (origin at the decoration top-left). */
  hitTest(localX: number, localY: number, fullW: number): 'close' | 'titlebar' | 'none' {
    if (localY < 0 || localY >= TITLEBAR_HEIGHT) {
      return 'none'
    }
    if (localX >= fullW - CLOSE_WIDTH) {
      return 'close'
    }
    return 'titlebar'
  }

  destroy(): void {
    for (const texture of Object.values(this.textures)) {
      texture.delete()
    }
  }

  private renderCanvas(fullW: number, fullH: number, w: number, h: number): void {
    this.canvas.width = fullW
    this.canvas.height = fullH
    const ctx = this.ctx
    const bg = this.active ? '#2d333b' : '#1b1f24'
    const fg = this.active ? '#e6edf3' : '#7d8590'

    ctx.clearRect(0, 0, fullW, fullH)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, fullW, TITLEBAR_HEIGHT) // titlebar
    ctx.fillRect(0, TITLEBAR_HEIGHT, BORDER, h) // left border
    ctx.fillRect(fullW - BORDER, TITLEBAR_HEIGHT, BORDER, h) // right border
    ctx.fillRect(0, fullH - BORDER, fullW, BORDER) // bottom border
    // the surface area (BORDER, TITLEBAR_HEIGHT, w, h) stays transparent

    // title
    ctx.fillStyle = fg
    ctx.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(this.title || 'untitled', 10, TITLEBAR_HEIGHT / 2 + 1, fullW - CLOSE_WIDTH - 16)

    // close button
    ctx.textAlign = 'center'
    ctx.font = '16px system-ui, sans-serif'
    ctx.fillText('×', fullW - CLOSE_WIDTH / 2, TITLEBAR_HEIGHT / 2)
  }
}
