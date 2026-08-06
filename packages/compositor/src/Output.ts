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

import {
  Client,
  Global,
  Registry,
  WlOutputRequests,
  WlOutputResource,
  WlOutputMode,
  WlOutputSubpixel,
  WlOutputTransform,
} from '@gfld/compositor-protocol'

import { capabilities } from './browser/capabilities'

export default class Output implements WlOutputRequests {
  private _global?: Global
  resources: WlOutputResource[] = []

  static create(canvas: HTMLCanvasElement): Output {
    return new Output(canvas)
  }

  private constructor(
    public readonly canvas: HTMLCanvasElement,
    private _x = 0,
    private _y = 0,
  ) {}

  // The size this output ADVERTISES, when it must differ from the scene
  // canvas's own dimensions. A canvas-rendering shell leaves this unset and
  // the canvas stays the source of truth (unchanged behaviour). A
  // DOM-windows shell renders each surface into its own element and drives
  // the compositor with a deliberately tiny off-screen "driver" canvas --
  // tiny because the scene canvas carries a GL context, so sizing it to the
  // real desktop would resurrect the full-scene compositing that shell
  // exists to avoid. Without this override the driver canvas's dimensions
  // leak out over wl_output as the display size.
  //
  // That is not cosmetic. Rootless Xwayland derives the X SCREEN from the
  // advertised output and X clamps windows to the screen, so a 1x1 driver
  // canvas made every X client a one-pixel window -- `xdpyinfo` reported
  // `dimensions: 1x1 pixels`, and neither a client-side -geometry nor
  // sommelier's --scale could widen it. Wayland clients never noticed
  // because they size from xdg_toplevel configure, but the output was
  // lying to them too (fullscreen/maximize extents, DPI heuristics).
  // Same class of bug as the mHz refresh-rate fix: a wl_output field that
  // clients legitimately consume, reporting an implementation detail
  // instead of reality.
  private _logicalWidth?: number
  private _logicalHeight?: number

  get width(): number {
    return this._logicalWidth ?? this.canvas.width
  }

  get height(): number {
    return this._logicalHeight ?? this.canvas.height
  }

  // Set the advertised size and tell everyone already bound. Clients cache
  // output geometry from bind time, so a resize MUST re-emit (mode+done) or
  // Xwayland keeps the stale X screen -- which is also why the shell should
  // call this on viewport changes, not just at startup.
  setLogicalSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return
    }
    if (this._logicalWidth === width && this._logicalHeight === height) {
      return
    }
    this._logicalWidth = width
    this._logicalHeight = height
    for (const resource of this.resources) {
      this.emitSpecs(resource)
    }
  }

  get x(): number {
    return this._x
  }

  get y(): number {
    return this._y
  }

  registerGlobal(registry: Registry): void {
    if (this._global) {
      return
    }
    this._global = registry.createGlobal(this, WlOutputResource.protocolName, 3, (client, id, version) => {
      this.bindClient(client, id, version)
    })
  }

  unregisterGlobal(): void {
    if (!this._global) {
      return
    }
    this._global.destroy()
    this._global = undefined
  }

  bindClient(client: Client, id: number, version: number): void {
    const wlOutputResource = new WlOutputResource(client, id, version)
    if (this._global) {
      this.resources = [...this.resources, wlOutputResource]
      wlOutputResource.implementation = this
      this.emitSpecs(wlOutputResource)
    } else {
      // no global present and still receiving a bind can happen when there is a race between the compositor
      // unregistering the global and a client binding to it. As such we handle it here.
      wlOutputResource.implementation = {
        release: () => wlOutputResource.destroy(),
      }
    }
  }

  update(location?: { x: number; y: number }): void {
    if (location) {
      this._x = location.x
      this._y = location.y
    }

    this.resources.forEach((resource) => this.emitSpecs(resource))
  }

  emitSpecs(wlOutputResource: WlOutputResource): void {
    if (!this._global) {
      return
    }
    // TODO we might want to listen for window/document size changes and emit on update
    this.emitGeometry(wlOutputResource)
    this.emitMode(wlOutputResource)
    // TODO scaling info using window.devicePixelRatio
    // TODO expose pixel scaling in config menu
    if (wlOutputResource.version >= 2) {
      wlOutputResource.done()
    }
  }

  private emitMode(wlOutputResource: WlOutputResource) {
    const flags = WlOutputMode.current
    // the refresh rate is impossible to query without manual measuring, which is error prone.
    const refresh = 60000
    wlOutputResource.mode(flags, this.width, this.height, refresh)
  }

  private emitGeometry(wlOutputResource: WlOutputResource) {
    // this is really just an approximation as browsers don't offer a way to get the physical width :(
    // A css pixel is roughly 1/96 of an inch, so ~0.2646 mm
    // TODO test this on high dpi devices
    const physicalWidth = Math.ceil(this.width * 0.2646)
    const physicalHeight = Math.ceil(this.height * 0.2646)
    const subpixel = WlOutputSubpixel.unknown
    const make = 'Greenfield'
    const model = capabilities.userAgent

    const orientation = capabilities.orientationType
    let transform = WlOutputTransform.normal

    // FIXME this requires some experimentation to get it right
    switch (orientation) {
      case 'portrait-primary': {
        transform = WlOutputTransform.normal
        break
      }
      case 'portrait-secondary': {
        transform = WlOutputTransform._180
        break
      }
      case 'landscape-primary': {
        transform = WlOutputTransform.normal
        break
      }
      case 'landscape-secondary': {
        transform = WlOutputTransform._180
        break
      }
    }

    wlOutputResource.geometry(this._x, this._y, physicalWidth, physicalHeight, subpixel, make, model, transform)
  }

  release(resource: WlOutputResource): void {
    resource.destroy()
    this.resources = this.resources.filter((otherResource) => otherResource !== resource)
  }
}
