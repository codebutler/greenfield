// Copyright 2020 Erik De Rijcke
//
// This file is part of Greenfield.
//
// Greenfield is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Greenfield is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with Greenfield.  If not, see <https://www.gnu.org/licenses/>.

import { hideBrowserCursor, resetBrowserCursor, setBrowserCursor } from '../browser/pointer'
import { clearBrowserDndImage, setBrowserDndImage } from '../browser/dnd'
import BufferImplementation from '../BufferImplementation'
import { Callback } from '../Callback'
import { queueCancellableMicrotask } from '../Loop'
import { ORIGIN, Point } from '../math/Point'
import { BORDER, TITLEBAR_HEIGHT } from './Decoration'
import Output from '../Output'
import { isDecodedFrame } from '../remote/DecodedFrame'
import Session from '../Session'
import Surface from '../Surface'
import View from '../View'
import { Scene } from './Scene'
import { isImageBitmapBufferContent } from '../ImageBitmapBuffer'

export function createRenderFrame(): Promise<number> {
  return new Promise<number>((resolve) => {
    requestAnimationFrame(resolve)
  })
}

function setupCanvasGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    depth: false,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    desynchronized: true,
  })
  if (gl === null) {
    throw new Error("This browser doesn't support WebGL!")
  }
  return gl
}

export default class Renderer {
  renderFrame?: Promise<void>
  private renderTaskRegistration?: () => void

  private constructor(
    public readonly session: Session,
    public scenes: { [key: string]: Scene } = {},
    public topLevelViews: View[] = [],
    private frameCallbacks: Callback[] = [],
    private viewStack: View[] = [],
  ) {}

  static create(session: Session): Renderer {
    return new Renderer(session)
  }

  private createAndStoreScene(sceneId: string, canvas: HTMLCanvasElement, output: Output) {
    const scene = Scene.create(this.session, setupCanvasGLContext(canvas), canvas, output, sceneId, () => {
      this.render()
    })
    this.scenes = { ...this.scenes, [sceneId]: scene }
    scene.onDestroy().then(() => {
      delete this.scenes[sceneId]
      this.session.globals.unregisterOutput(output)
    })
    return scene
  }

  initScene(canvasProvider: () => { canvas: HTMLCanvasElement; id: string }): Scene {
    const { canvas, id } = canvasProvider()
    let scene = this.scenes[id]
    if (scene === undefined) {
      const output = Output.create(canvas)
      this.session.globals.registerOutput(output)

      // TODO make sure this works well
      canvas.addEventListener('webglcontextlost', (event) => event.preventDefault(), false)
      canvas.addEventListener('webglcontextrestored', () => this.createAndStoreScene(id, canvas, output), false)

      // TODO sync output properties with scene
      // TODO notify client on which output their surfaces are being displayed
      scene = this.createAndStoreScene(id, canvas, output)
    }
    this.render()
    return scene
  }

  updateCursor(view: View, hotspot: Point): void {
    if (view.surface.state.bufferContents) {
      const cursorBufferContents = view.surface.state.bufferContents

      // wl_shm / canvas buffers expose the decoded ImageBitmap DIRECTLY as
      // pixelContent (updateRenderStatesPixelContent passes
      // `bitmap: bufferContents.pixelContent`); only decoded video frames wrap it
      // in a `.bitmap` field. Accept both — otherwise a wl_shm cursor (every GTK
      // app's cursor) has no `.bitmap`, updateCursor bails, and the pointer is
      // left hidden (cursor: none).
      const cursorImage = cursorBufferContents.pixelContent as
        | { bitmap: ImageBitmap | undefined }
        | ImageBitmap
        | undefined
      const bitmap =
        cursorImage && (cursorImage as { bitmap?: ImageBitmap }).bitmap !== undefined
          ? (cursorImage as { bitmap: ImageBitmap }).bitmap
          : (cursorImage as ImageBitmap | undefined)
      if (bitmap === undefined || bitmap === null) {
        return
      }

      setBrowserCursor(bitmap, hotspot)
    } else {
      this.hideCursor()
    }
    for (const callback of view.surface.state.frameCallbacks) {
      callback.done(Date.now())
    }
    view.surface.state.frameCallbacks = []
    this.session.flush()
  }

  raiseSurface(surface: Surface): void {
    const raisedViews = this.topLevelViews.filter((topLevelView) => topLevelView.surface === surface)
    const rest = this.topLevelViews.filter((topLevelView) => topLevelView.surface !== surface)
    this.topLevelViews = [...rest, ...raisedViews]
  }

  render(afterUpdatePixelContent?: () => void): void {
    if (this.renderTaskRegistration) {
      return
    }
    this.renderTaskRegistration = queueCancellableMicrotask(() => {
      this.renderTaskRegistration = undefined
      const sceneList = Object.values(this.scenes)
      if (sceneList.length === 0) {
        return
      }
      this.updateViewStack()
      const viewStack = [...this.viewStack]
      for (const view of viewStack) {
        this.updateRenderStatesPixelContent(view)
        this.registerFrameCallbacks(view.surface.state.frameCallbacks)
        view.surface.state.frameCallbacks = []
      }

      afterUpdatePixelContent?.()
      // TODO we can check which views are damaged and filter out only those scenes that need a rerender
      if (this.renderFrame) {
        return
      }

      this.renderFrame = createRenderFrame().then((time) => {
        this.renderFrame = undefined
        // TODO we can further limit the visible region of each view by removing the area covered by other views
        const sceneList = Object.values(this.scenes)
        if (sceneList.length === 0) {
          return
        }
        for (const scene of sceneList) {
          scene.render(viewStack)
        }
        for (const callback of this.frameCallbacks) {
          callback.done(time)
        }
        this.frameCallbacks = []
        this.session.flush()
      })
    })
  }

  pickView(scenePoint: Point): View | undefined {
    // test views from front to back
    return [...this.viewStack].reverse().find((view) => {
      const surfacePoint = view.sceneToViewSpace(scenePoint)
      return view.surface.isWithinInputRegion(surfacePoint)
    })
  }

  /**
   * Front-to-back hit test for server-side decorations. Returns the topmost
   * titlebar hit, or undefined if the topmost thing at this point is a surface
   * (so the click belongs to the client) or empty space.
   */
  pickDecoration(scenePoint: Point): { view: View; region: 'close' | 'titlebar' } | undefined {
    for (const view of [...this.viewStack].reverse()) {
      if (!view.mapped) {
        continue
      }
      const surfacePoint = view.sceneToViewSpace(scenePoint)
      if (view.surface.isWithinInputRegion(surfacePoint)) {
        return undefined // a surface is the topmost thing here
      }
      const decoration = view.decoration
      const size = view.surface.size
      if (decoration && size) {
        const topLeft = view.viewToSceneSpace(ORIGIN)
        const decoLeft = topLeft.x - BORDER
        const decoTop = topLeft.y - TITLEBAR_HEIGHT
        const fullW = size.width + 2 * BORDER
        if (
          scenePoint.x >= decoLeft &&
          scenePoint.x < decoLeft + fullW &&
          scenePoint.y >= decoTop &&
          scenePoint.y < decoTop + TITLEBAR_HEIGHT
        ) {
          const region = decoration.hitTest(scenePoint.x - decoLeft, scenePoint.y - decoTop, fullW)
          if (region !== 'none') {
            return { view, region }
          }
        }
      }
    }
    return undefined
  }

  hideCursor(): void {
    hideBrowserCursor()
  }

  resetCursor(): void {
    resetBrowserCursor()
  }

  clearDndImage(): void {
    clearBrowserDndImage()
  }

  updateDndImage(view: View): void {
    if (view.surface.state.bufferContents) {
      setBrowserDndImage(view.surface.state.bufferContents, view.positionOffset)
    } else {
      this.clearDndImage()
    }
    for (const callback of view.surface.state.frameCallbacks) {
      callback.done(Date.now())
    }
    view.surface.state.frameCallbacks = []
    this.session.flush()
  }

  removeTopLevelView(topLevelView: View): void {
    this.topLevelViews = this.topLevelViews.filter((view) => view !== topLevelView)
  }

  hasTopLevelView(topLevelView: View): boolean {
    return this.topLevelViews.includes(topLevelView)
  }

  addTopLevelView(topLevelView: View): void {
    this.topLevelViews = [...this.topLevelViews, topLevelView]
    topLevelView.onDestroy().then(() => {
      this.removeTopLevelView(topLevelView)
      this.render()
    })
  }

  /**
   * Update stack of all views of this scene, in-order from bottom to top.
   */
  private updateViewStack(): void {
    const stack: View[] = []
    for (const topLevelView of this.topLevelViews) {
      // toplevel surface with a parent will be added automatically by the parent so we filter them out here.
      this.addToViewStack(stack, topLevelView)
    }
    this.viewStack = stack
  }

  private addToViewStack(stack: View[], view: View) {
    for (const surfaceChild of view.surface.children) {
      const childViewOrParentView = surfaceChild.surface.role?.view
      if (childViewOrParentView) {
        stack.push(childViewOrParentView)
        if (childViewOrParentView !== view) {
          this.addToViewStack(stack, childViewOrParentView)
        }
      }
    }
  }

  private registerFrameCallbacks(frameCallbacks?: Callback[]): void {
    if (frameCallbacks) {
      this.frameCallbacks = [...this.frameCallbacks, ...frameCallbacks]
    }
  }

  private updateRenderStatesPixelContent(view: View): void {
    view.applyTransformations()
    const { buffer, bufferContents } = view.surface.state
    if (isDecodedFrame(bufferContents)) {
      if (view.mapped && buffer && view.surface.damaged) {
        const bufferImplementation = buffer.implementation as BufferImplementation<any>
        if (!bufferImplementation.released) {
          for (const renderState of Object.values(view.renderStates)) {
            renderState.scene[bufferContents.mimeType](bufferContents, renderState)
          }
          view.surface.damaged = false
          bufferImplementation.release()
        }
      }
    } else if (isImageBitmapBufferContent(bufferContents)) {
      for (const renderState of Object.values(view.renderStates)) {
        renderState.scene[bufferContents.mimeType](bufferContents, renderState)
      }
      // hand the current frame to a DOM-windows shell, if one is listening
      if (view.mapped && this.session.userShell.events.surfaceContentUpdated) {
        const { width, height } = bufferContents.size
        // For a child view (xdg_popup / subsurface) include its parent surface id +
        // offset relative to the parent (scene pixels) so the shell can render the
        // popup as a positioned overlay. Toplevels have no parent view → undefined.
        let parent: { id: number; client: string; dx: number; dy: number } | undefined
        const pv = view.parent
        if (pv) {
          const a = view.viewToSceneSpace({ x: 0, y: 0 })
          const b = pv.viewToSceneSpace({ x: 0, y: 0 })
          parent = {
            id: pv.surface.resource.id,
            client: pv.surface.resource.client.id,
            dx: a.x - b.x,
            dy: a.y - b.y,
          }
        }
        this.session.userShell.events.surfaceContentUpdated(
          { id: view.surface.resource.id, client: { id: view.surface.resource.client.id } },
          { bitmap: bufferContents.pixelContent, width, height, parent },
        )
      }
    } else if (buffer !== undefined && bufferContents === undefined) {
      if (view.mapped && buffer && view.surface.damaged) {
        const bufferImplementation = buffer.implementation as BufferImplementation<any>
        if (!bufferImplementation.released) {
          view.surface.damaged = false
          bufferImplementation.release()
        }
      }
    } else if (buffer !== undefined) {
      throw new Error(`BUG. Unsupported buffer type: ${typeof bufferContents}`)
    }
  }
}
