// Implements zxdg_decoration_manager_v1 / zxdg_toplevel_decoration_v1.
//
// The compositor draws server-side decorations (titlebars/frames) for ALL
// top-level surfaces. This protocol's job is to tell decoration-aware clients
// (GTK/Qt etc.) to use SERVER-side mode, so they suppress their own client-side
// decorations and we don't end up with double titlebars. Clients that never
// bind this global (our simple wl_shm apps) are decorated anyway and draw
// nothing themselves, so there is no conflict.
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

class ToplevelDecoration implements ZxdgToplevelDecorationV1Requests {
  constructor(
    readonly resource: ZxdgToplevelDecorationV1Resource,
    readonly toplevel: XdgToplevelResource,
  ) {}

  setMode(resource: ZxdgToplevelDecorationV1Resource, _mode: number): void {
    // we always provide server-side decorations, regardless of the client's preference
    resource.configure(ZxdgToplevelDecorationV1Mode.serverSide)
  }

  unsetMode(resource: ZxdgToplevelDecorationV1Resource): void {
    resource.configure(ZxdgToplevelDecorationV1Mode.serverSide)
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
    decorationResource.implementation = new ToplevelDecoration(decorationResource, toplevel)
    // Announce server-side mode up front so the client never draws its own decorations.
    decorationResource.configure(ZxdgToplevelDecorationV1Mode.serverSide)
  }
}
