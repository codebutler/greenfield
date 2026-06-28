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

import { WlSurfaceResource } from '@gfld/compositor-protocol'
import { addInputOutput } from './browser/input'
import { ButtonCode } from './ButtonEvent'
import { createKeyEventFromKeyboardEvent } from './KeyEvent'
import { DesktopSurface } from './desktop/Desktop'
import { CompositorClient, CompositorConfiguration, CompositorSurface } from './index'
import Session from './Session'
import Surface from './Surface'

export interface UserShellApiEvents {
  clientCreated?: (applicationClient: CompositorClient) => void
  clientDestroyed?: (applicationClient: CompositorClient) => void
  clientUnresponsiveUpdated?: (applicationClient: CompositorClient, unresponse: boolean) => void

  surfaceCreated?: (compositorSurface: CompositorSurface) => void
  surfaceDestroyed?: (compositorSurface: CompositorSurface) => void
  surfaceTitleUpdated?: (compositorSurface: CompositorSurface, title: string) => void
  surfaceAppIdUpdated?: (compositorSurface: CompositorSurface, appId: string) => void
  surfaceActivationUpdated?: (compositorSurface: CompositorSurface, active: boolean) => void
  // Fired when a surface's pixel content updates, with the current frame as an
  // ImageBitmap. Used by the DOM-windows shell to paint each window's own canvas.
  surfaceContentUpdated?: (
    compositorSurface: CompositorSurface,
    content: {
      bitmap: ImageBitmap
      width: number
      height: number
      // Present for a child surface (xdg_popup / subsurface): the parent surface
      // id + the child's offset relative to the parent (scene pixels). Lets a
      // DOM-windows shell render the popup as a positioned overlay. Undefined for
      // toplevels.
      parent?: { id: number; client: string; dx: number; dy: number }
    },
  ) => void

  // Fired when a toplevel's decoration mode is negotiated via xdg-decoration.
  // 'client' = the client draws its own decorations (CSD, e.g. a GTK headerbar);
  // the DOM-windows shell should then SUPPRESS its own titlebar to avoid a double
  // decoration. 'server' = the client expects the compositor/shell to decorate, so
  // the shell keeps its titlebar. Non-decoration-aware clients never trigger this
  // and default to server-side (shell-drawn) decoration.
  surfaceDecorationModeUpdated?: (compositorSurface: CompositorSurface, mode: 'client' | 'server') => void
  // Fired when a client asks to interactively move its own toplevel (xdg_toplevel.move,
  // e.g. the user grabbed a CSD headerbar). In DOM-windows mode the window position is
  // owned by the shell's <div>, so the shell starts following the pointer to drag it.
  surfaceMoveRequested?: (compositorSurface: CompositorSurface) => void
  // Fired when a client asks to (un)maximize its own toplevel (xdg_toplevel.set_maximized /
  // unset_maximized). In DOM-windows mode the scene "canvas" is a hidden 1×1 driver, so the
  // compositor can't size a maximized window itself (the usual maximizedScene.canvas sizing
  // would tell the client to become 1×1). The shell owns window geometry: it resizes its
  // window to the work area (or restores it) and calls configureSurfaceSize so the client
  // repaints at the new size; the compositor still sends the maximized STATE so the client
  // adapts its decorations.
  surfaceMaximizeRequested?: (compositorSurface: CompositorSurface, maximized: boolean) => void
  // Fired when a client asks to minimize its own toplevel (xdg_toplevel.set_minimized). In
  // DOM-windows mode the shell hides its window (e.g. to a taskbar); the scene-side `mapped`
  // flag the compositor would clear is meaningless when each surface is its own DOM window.
  surfaceMinimizeRequested?: (compositorSurface: CompositorSurface) => void

  notify?: (variant: 'warn' | 'info' | 'error', message: string) => void

  sceneRefreshed?: (sceneId: string) => void
}

export interface UserShellApiActions {
  initScene(canvasCreator: () => { canvas: HTMLCanvasElement; id: string }): void
  refreshScene(): void
  destroyScene(sceneId: string): void

  setUserConfiguration(userConfiguration: Partial<CompositorConfiguration>): void

  closeClient(applicationClient: Pick<CompositorClient, 'id'>): void

  activateSurface(compositorSurface: CompositorSurface): void

  // Gracefully ask a surface's toplevel to close — sends the xdg_toplevel.close
  // protocol event to the client (vs closeClient, which tears down the server
  // side of the connection). Alternative shells (DOM-windows mode) call this when
  // their own window chrome's close button is clicked so the client can run its
  // own shutdown (save prompts, etc.) and exit cleanly.
  requestSurfaceClose(compositorSurface: CompositorSurface): void

  // Direct input delivery for alternative shells (DOM-windows mode), where the browser
  // has already hit-tested which window an event belongs to. Coords are surface-local.
  pointerMotion(compositorSurface: CompositorSurface, x: number, y: number): void
  pointerLeave(compositorSurface: CompositorSurface): void
  pointerButton(compositorSurface: CompositorSurface, buttonCode: ButtonCode, released: boolean): void
  notifyKey(keyboardEvent: KeyboardEvent, pressed: boolean): void

  // Configure a surface's toplevel to a specific size — the DOM-windows shell calls this so a
  // guest repaints crisply at a new window size (maximize, or a shell-driven window resize)
  // instead of the shell CSS-scaling a stale buffer. width/height of 0 lets the client pick.
  configureSurfaceSize(compositorSurface: CompositorSurface, width: number, height: number): void
}

export interface UserShellApi {
  events: UserShellApiEvents
  actions: UserShellApiActions
}

export function toCompositorSurface(desktopSurface: DesktopSurface): CompositorSurface {
  return { id: desktopSurface.surface.resource.id, client: { id: desktopSurface.surface.resource.client.id } }
}

function lookupSurface(session: Session, compositorSurface: CompositorSurface) {
  const resource = session.display.clients[compositorSurface.client.id].connection.wlObjects[
    compositorSurface.id
  ] as WlSurfaceResource
  return resource.implementation as Surface
}

export function createUserShellApi(session: Session): UserShellApi {
  return {
    events: {},
    actions: {
      activateSurface(compositorSurface: CompositorSurface) {
        const surface = lookupSurface(session, compositorSurface)
        surface.role?.desktopSurface?.activate()
      },
      requestSurfaceClose(compositorSurface: CompositorSurface) {
        const surface = lookupSurface(session, compositorSurface)
        surface.role?.desktopSurface?.requestClose()
        // Flush so the queued xdg_toplevel.close event is actually written to the
        // client's connection now (→ onFlush → the guest), the same way the input
        // actions flush. Without this the close sits in the outbound buffer until
        // some other event flushes it, and the client never sees it.
        session.flush()
      },
      initScene: (canvasCreator: () => { canvas: HTMLCanvasElement; id: string }) =>
        addInputOutput(session, canvasCreator),
      refreshScene: () => {
        session.renderer.render()
      },
      destroyScene: (sceneId) => session.renderer.scenes[sceneId].destroy(),
      setUserConfiguration: (userConfiguration) => {
        const { pointer, keyboard } = session.globals.seat
        pointer.scrollFactor = userConfiguration.scrollFactor ?? pointer.scrollFactor
        if (userConfiguration.keyboardLayoutName) {
          const foundNrmlvo = keyboard.nrmlvoEntries.find(
            (nrmlvo) => nrmlvo.name === userConfiguration.keyboardLayoutName,
          )
          if (foundNrmlvo) {
            session.globals.seat.notifyUpdateKeymap(foundNrmlvo)
          }
        }
      },
      closeClient: (applicationClient) => {
        const client = session.display.clients[applicationClient.id]
        if (client === undefined) {
          throw new Error(`Client with id ${applicationClient.id} does not exist.`)
        }
        client.close()
      },
      pointerMotion: (compositorSurface, x, y) => {
        const view = lookupSurface(session, compositorSurface)?.role?.view
        if (view) {
          session.globals.seat.pointer.forwardLocalMotion(view, Date.now(), x, y)
          session.flush()
        }
      },
      pointerLeave: (compositorSurface) => {
        const view = lookupSurface(session, compositorSurface)?.role?.view
        if (view) {
          session.globals.seat.pointer.forwardLocalLeave(view)
          session.flush()
        }
      },
      pointerButton: (compositorSurface, buttonCode, released) => {
        const view = lookupSurface(session, compositorSurface)?.role?.view
        if (view) {
          session.globals.seat.pointer.forwardLocalButton(view, Date.now(), buttonCode, released)
          session.flush()
        }
      },
      notifyKey: (keyboardEvent, pressed) => {
        const keyEvent = createKeyEventFromKeyboardEvent(keyboardEvent, pressed)
        if (keyEvent) {
          session.globals.seat.notifyKey(keyEvent)
          session.flush()
        }
      },
      configureSurfaceSize: (compositorSurface, width, height) => {
        // Reach the DesktopSurfaceRole (XdgToplevel) via the desktop surface and configure it.
        // A width/height of 0 is the protocol's "client picks its own size" (used on un-maximize).
        const role = lookupSurface(session, compositorSurface)?.role?.desktopSurface?.role
        role?.configureSize?.({ width, height })
        session.flush()
      },
    },
  }
}
