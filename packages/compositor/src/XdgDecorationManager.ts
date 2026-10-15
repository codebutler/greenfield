// Implements zxdg_decoration_manager_v1 / zxdg_toplevel_decoration_v1.
//
// We HONOR the client's decoration preference. A client that asks for client-side
// mode (CSD — e.g. a GTK app with its own GtkHeaderBar) draws its own titlebar, so
// the DOM-windows shell suppresses the titlebar it would otherwise add (issue #105:
// otherwise the GTK headerbar AND the shell titlebar both show — a double
// decoration). A client that asks for server-side mode (or never sets one) is
// decorated by the shell, which keeps its titlebar. Clients that never bind this
// global (our simple wl_shm apps) draw nothing themselves and stay shell-decorated.
//
// The negotiated mode is announced to the shell via surfaceDecorationModeUpdated so
// it can add/drop its window chrome accordingly.
import {
  Client,
  Global,
  Registry,
  XdgToplevelResource,
  ZxdgDecorationManagerV1Requests,
  ZxdgDecorationManagerV1Resource,
  ZxdgToplevelDecorationV1Mode,
  ZxdgToplevelDecorationV1Requests,
  ZxdgToplevelDecorationV1Resource,
} from '@gfld/compositor-protocol'

import Session from './Session'
import type XdgToplevel from './XdgToplevel'

class ToplevelDecoration implements ZxdgToplevelDecorationV1Requests {
  constructor(
    readonly resource: ZxdgToplevelDecorationV1Resource,
    readonly toplevel: XdgToplevelResource,
    private readonly session: Session,
  ) {}

  // Announce the negotiated mode to the DOM-windows shell. The compositorSurface is
  // derived directly from the toplevel's wl_surface so it works even before the
  // surface is mapped (decoration is negotiated before the first commit).
  announce(mode: 'client' | 'server'): void {
    const xdgToplevel = this.toplevel.implementation as XdgToplevel | undefined
    const surface = xdgToplevel?.xdgSurface?.surface
    if (!surface) {
      return
    }
    this.session.userShell.events.surfaceDecorationModeUpdated?.(
      { id: surface.resource.id, client: { id: surface.resource.client.id } },
      mode,
    )
  }

  setMode(resource: ZxdgToplevelDecorationV1Resource, mode: number): void {
    if (mode === ZxdgToplevelDecorationV1Mode.clientSide) {
      resource.configure(ZxdgToplevelDecorationV1Mode.clientSide)
      this.announce('client')
    } else {
      resource.configure(ZxdgToplevelDecorationV1Mode.serverSide)
      this.announce('server')
    }
  }

  unsetMode(resource: ZxdgToplevelDecorationV1Resource): void {
    // No preference → the compositor picks. We default to server-side (shell-drawn).
    resource.configure(ZxdgToplevelDecorationV1Mode.serverSide)
    this.announce('server')
  }

  destroy(resource: ZxdgToplevelDecorationV1Resource): void {
    resource.destroy()
  }
}

export default class XdgDecorationManager implements ZxdgDecorationManagerV1Requests {
  private global?: Global

  private constructor(private readonly session: Session) {}

  static create(session: Session): XdgDecorationManager {
    return new XdgDecorationManager(session)
  }

  registerGlobal(registry: Registry): void {
    if (this.global) {
      return
    }
    this.global = registry.createGlobal(
      this,
      ZxdgDecorationManagerV1Resource.protocolName,
      1,
      (client, id, version) => this.bindClient(client, id, version),
    )
  }

  unregisterGlobal(): void {
    if (!this.global) {
      return
    }
    this.global.destroy()
    this.global = undefined
  }

  bindClient(client: Client, id: number, version: number): void {
    const resource = new ZxdgDecorationManagerV1Resource(client, id, version)
    resource.implementation = this
  }

  destroy(resource: ZxdgDecorationManagerV1Resource): void {
    resource.destroy()
  }

  getToplevelDecoration(resource: ZxdgDecorationManagerV1Resource, id: number, toplevel: XdgToplevelResource): void {
    const decorationResource = new ZxdgToplevelDecorationV1Resource(resource.client, id, resource.version)
    const decoration = new ToplevelDecoration(decorationResource, toplevel, this.session)
    decorationResource.implementation = decoration
    // Clients that bind xdg-decoration are almost always CSD (GTK headerbar).
    // Announce client-side immediately so a DOM-windows shell can drop its
    // frame before the first commit. Silent X11 clients never bind, so they
    // never reach here. set_mode(server) still flips to SSD (wl-eyes).
    decorationResource.configure(ZxdgToplevelDecorationV1Mode.clientSide)
    decoration.announce('client')
  }
}
