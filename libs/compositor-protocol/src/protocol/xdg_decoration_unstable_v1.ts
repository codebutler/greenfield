/*
 *
 *    Copyright © 2018 Simon Ser
 *
 *    Permission is hereby granted, free of charge, to any person obtaining a
 *    copy of this software and associated documentation files (the "Software"),
 *    to deal in the Software without restriction, including without limitation
 *    the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *    and/or sell copies of the Software, and to permit persons to whom the
 *    Software is furnished to do so, subject to the following conditions:
 *
 *    The above copyright notice and this permission notice (including the next
 *    paragraph) shall be included in all copies or substantial portions of the
 *    Software.
 *
 *    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
 *    THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *    DEALINGS IN THE SOFTWARE.
 *  
 */

import { WlMessage, fileDescriptor, uint, int, 
	fixed, object, objectOptional, newObject, string, stringOptional, 
	array, arrayOptional, u, i, f, oOptional, o, n, sOptional, s, aOptional, a, h,	FD, Fixed } from '@gfld/common'
import * as Westfield from '..'


/**
 *
 *      This interface allows a compositor to announce support for server-side
 *      decorations.
 *
 *      A window decoration is a set of window controls as deemed appropriate by
 *      the party managing them, such as user interface components used to move,
 *      resize and change a window's state.
 *
 *      A client can use this protocol to request being decorated by a supporting
 *      compositor.
 *
 *      If compositor and client do not negotiate the use of a server-side
 *      decoration using this protocol, clients continue to self-decorate as they
 *      see fit.
 *
 *      Warning! The protocol described in this file is experimental and
 *      backward incompatible changes may be made. Backward compatible changes
 *      may be added together with the corresponding interface version bump.
 *      Backward incompatible changes are done by bumping the version number in
 *      the protocol and interface names and resetting the interface version.
 *      Once the protocol is to be declared stable, the 'z' prefix and the
 *      version number in the protocol and interface names are removed and the
 *      interface version number is reset.
 *    
 */
export class ZxdgDecorationManagerV1Resource extends Westfield.Resource {
	static readonly protocolName = 'zxdg_decoration_manager_v1'

	//@ts-ignore Should always be set when resource is created.
	implementation: ZxdgDecorationManagerV1Requests

	constructor (client: Westfield.Client, id: number, version: number) {
		super(client, id, version)
	}

	[0] (message: WlMessage) {
		return this.implementation.destroy(this)
	}
	[1] (message: WlMessage) {
		return this.implementation.getToplevelDecoration(this, n(message), o<Westfield.XdgToplevelResource>(message, this.client.connection))
	}
}

export interface ZxdgDecorationManagerV1Requests {

	/**
	 *
	 *        Destroy the decoration manager. This doesn't destroy objects created
	 *        with the manager.
	 *      
	 *
	 * @param resource The protocol resource of this implementation.
	 *
	 * @since 1
	 *
	 */
	destroy(resource: ZxdgDecorationManagerV1Resource): void

	/**
	 *
	 *        Create a new decoration object associated with the given toplevel.
	 *
	 *        Creating an xdg_toplevel_decoration from an xdg_toplevel which has a
	 *        buffer attached or committed is a client error, and any attempts by a
	 *        client to attach or manipulate a buffer prior to the first
	 *        xdg_toplevel_decoration.configure event must also be treated as
	 *        errors.
	 *      
	 *
	 * @param resource The protocol resource of this implementation.
	 * @param id  
	 * @param toplevel  
	 *
	 * @since 1
	 *
	 */
	getToplevelDecoration(resource: ZxdgDecorationManagerV1Resource, id: number, toplevel: Westfield.XdgToplevelResource): void
}


/**
 *
 *      The decoration object allows the compositor to toggle server-side window
 *      decorations for a toplevel surface. The client can request to switch to
 *      another mode.
 *
 *      The xdg_toplevel_decoration object must be destroyed before its
 *      xdg_toplevel.
 *    
 */
export class ZxdgToplevelDecorationV1Resource extends Westfield.Resource {
	static readonly protocolName = 'zxdg_toplevel_decoration_v1'

	//@ts-ignore Should always be set when resource is created.
	implementation: ZxdgToplevelDecorationV1Requests


	/**
	 *
	 *        The configure event asks the client to change its decoration mode. The
	 *        configured state should not be applied immediately. Clients must send an
	 *        ack_configure in response to this event. See xdg_surface.configure and
	 *        xdg_surface.ack_configure for details.
	 *
	 *        A configure event can be sent at any time. The specified mode must be
	 *        obeyed by the client.
	 *      
	 *
	 * @param mode the decoration mode 
	 *
	 * @since 1
	 *
	 */
	configure (mode: number) {
		this.client.marshall(this.id, 0, [uint(mode)])
	}
	constructor (client: Westfield.Client, id: number, version: number) {
		super(client, id, version)
	}

	[0] (message: WlMessage) {
		return this.implementation.destroy(this)
	}
	[1] (message: WlMessage) {
		return this.implementation.setMode(this, u(message))
	}
	[2] (message: WlMessage) {
		return this.implementation.unsetMode(this)
	}
}

export interface ZxdgToplevelDecorationV1Requests {

	/**
	 *
	 *        Switch back to a mode without any server-side decorations at the next
	 *        commit.
	 *      
	 *
	 * @param resource The protocol resource of this implementation.
	 *
	 * @since 1
	 *
	 */
	destroy(resource: ZxdgToplevelDecorationV1Resource): void

	/**
	 *
	 *        Set the toplevel surface decoration mode. This informs the compositor
	 *        that the client prefers the provided decoration mode.
	 *
	 *        After requesting a decoration mode, the compositor will respond by
	 *        emitting an xdg_surface.configure event. The client should then update
	 *        its content, drawing it without decorations if the received mode is
	 *        server-side decorations. The client must also acknowledge the configure
	 *        when committing the new content (see xdg_surface.ack_configure).
	 *
	 *        The compositor can decide not to use the client's mode and enforce a
	 *        different mode instead.
	 *
	 *        Clients whose decoration mode depend on the xdg_toplevel state may send
	 *        a set_mode request in response to an xdg_surface.configure event and wait
	 *        for the next xdg_surface.configure event to prevent unwanted state.
	 *        Such clients are responsible for preventing configure loops and must
	 *        make sure not to send multiple successive set_mode requests with the
	 *        same decoration mode.
	 *      
	 *
	 * @param resource The protocol resource of this implementation.
	 * @param mode the decoration mode 
	 *
	 * @since 1
	 *
	 */
	setMode(resource: ZxdgToplevelDecorationV1Resource, mode: number): void

	/**
	 *
	 *        Unset the toplevel surface decoration mode. This informs the compositor
	 *        that the client doesn't prefer a particular decoration mode.
	 *
	 *        This request has the same semantics as set_mode.
	 *      
	 *
	 * @param resource The protocol resource of this implementation.
	 *
	 * @since 1
	 *
	 */
	unsetMode(resource: ZxdgToplevelDecorationV1Resource): void
}

export enum ZxdgToplevelDecorationV1Error {
  /**
   * xdg_toplevel has a buffer attached before configure
   */
  unconfiguredBuffer = 0,
  /**
   * xdg_toplevel already has a decoration object
   */
  alreadyConstructed = 1,
  /**
   * xdg_toplevel destroyed before the decoration object
   */
  orphaned = 2
}

export enum ZxdgToplevelDecorationV1Mode {
  /**
   * no server-side window decoration
   */
  clientSide = 1,
  /**
   * server-side window decoration
   */
  serverSide = 2
}

