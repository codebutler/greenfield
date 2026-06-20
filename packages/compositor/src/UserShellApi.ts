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
    content: { bitmap: ImageBitmap; width: number; height: number },
  ) => void

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
  notifyKey(keyboardEvent: KeyboardEvent, pressed: boolean): void
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
      notifyKey: (keyboardEvent, pressed) => {
        const keyEvent = createKeyEventFromKeyboardEvent(keyboardEvent, pressed)
        if (keyEvent) {
          session.globals.seat.notifyKey(keyEvent)
          session.flush()
        }
      },
    },
  }
}
