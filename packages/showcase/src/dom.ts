// DOM-windows mode: the compositor runs as usual, but instead of compositing all
// surfaces into one WebGL canvas, each top-level surface becomes its OWN DOM window
// (a <div> with a real DOM titlebar + a <canvas> body). The browser does stacking;
// DOM handles drag / close / focus. This is an alternative display frontend.
//
// A hidden full-size "driver" canvas keeps the compositor's render loop and frame
// callbacks alive; we never look at its pixels — we read each surface's ImageBitmap
// via the surfaceContentUpdated event and paint it into that window's own canvas.
//
// NOTE (phase 1): input INTO apps (clicking/typing the app content) is not wired yet,
// so e.g. the eyes won't track. Drag/close/raise (DOM-side) all work.
import {
  createAppLauncher,
  createCompositorSession,
  initWasm,
  type AppLauncher,
  type CompositorSurface,
} from '@gfld/compositor'

const driver = document.getElementById('driver') as HTMLCanvasElement
const stage = document.getElementById('stage') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const hintEl = document.getElementById('hint') as HTMLDivElement

type Win = {
  el: HTMLDivElement
  label: HTMLSpanElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

const windows = new Map<string, Win>()
const pendingTitles = new Map<string, string>() // title set before the window exists
const surfaceKey = (s: CompositorSurface) => `${s.client.id}:${s.id}`
let cascade = 0
let zTop = 10

async function main() {
  statusEl.textContent = 'loading wasm…'
  await initWasm()

  const session = await createCompositorSession({ mode: 'floating' })
  session.userShell.events.notify = (_variant, message) => console.warn('[compositor]', message)
  // the driver scene drives the render loop; its output is never shown
  session.userShell.actions.initScene(() => ({ canvas: driver, id: 'driver' }))
  session.globals.register()

  const webAppLauncher: AppLauncher = createAppLauncher(session, 'web')

  let launched = 0
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('button.sample'))) {
    btn.addEventListener('click', () => {
      webAppLauncher.launch(new URL(btn.dataset.app!, document.baseURI))
      if (++launched === 1) hintEl.style.display = 'none'
    })
  }

  const events = session.userShell.events
  events.surfaceCreated = (s) => ensureWindow(session, webAppLauncher, s)
  events.surfaceDestroyed = (s) => {
    const w = windows.get(surfaceKey(s))
    if (w) {
      w.el.remove()
      windows.delete(surfaceKey(s))
    }
  }
  events.surfaceTitleUpdated = (s, title) => {
    const w = windows.get(surfaceKey(s))
    if (w) w.label.textContent = title || 'untitled'
    else pendingTitles.set(surfaceKey(s), title) // set before the window was created
  }
  events.surfaceActivationUpdated = (s, active) => {
    windows.get(surfaceKey(s))?.el.classList.toggle('active', active)
  }
  events.surfaceContentUpdated = (s, content) => {
    const w = ensureWindow(session, webAppLauncher, s)
    if (w.w !== content.width || w.h !== content.height) {
      w.canvas.width = content.width
      w.canvas.height = content.height
      w.w = content.width
      w.h = content.height
    }
    // ImageBitmap is read-only here (the WebGL driver scene also reads it); drawImage
    // copies, transferFromImageBitmap would consume it — so use 2D drawImage.
    w.ctx.drawImage(content.bitmap, 0, 0)
  }

  // PHASE 2 — forward keyboard to the focused surface. Clicking a window sets keyboard
  // focus (via activateSurface); these globals route keys to whichever surface has it.
  window.addEventListener('keydown', (e) => session.userShell.actions.notifyKey(e, true))
  window.addEventListener('keyup', (e) => session.userShell.actions.notifyKey(e, false))

  statusEl.textContent = 'ready'
}

function ensureWindow(session: any, launcher: AppLauncher, s: CompositorSurface): Win {
  const k = surfaceKey(s)
  const existing = windows.get(k)
  if (existing) return existing

  const el = document.createElement('div')
  el.className = 'window active'

  const titlebar = document.createElement('div')
  titlebar.className = 'titlebar'
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = pendingTitles.get(k) ?? 'untitled'
  pendingTitles.delete(k)
  const close = document.createElement('button')
  close.className = 'close'
  close.textContent = '×'
  titlebar.append(label, close)

  const canvas = document.createElement('canvas')
  canvas.className = 'surface'
  el.append(titlebar, canvas)

  const i = cascade++ % 8
  el.style.left = `${40 + i * 30}px`
  el.style.top = `${20 + i * 30}px`
  el.style.zIndex = String(++zTop)
  stage.appendChild(el)

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const win: Win = { el, label, canvas, ctx, w: 0, h: 0 }
  windows.set(k, win)

  // raise + focus on any press
  el.addEventListener('mousedown', () => {
    el.style.zIndex = String(++zTop)
    for (const other of windows.values()) other.el.classList.toggle('active', other === win)
    session.userShell.actions.activateSurface(s)
  })
  // drag by the titlebar
  titlebar.addEventListener('mousedown', (e) => startDrag(el, e))
  // close
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    session.userShell.actions.closeClient({ id: s.client.id })
  })

  // PHASE 2 — forward pointer motion into the app (the canvas is 1:1 with the surface,
  // so offsetX/Y are surface-local coords). The browser already hit-tested the window.
  canvas.addEventListener('pointermove', (e) => {
    session.userShell.actions.pointerMotion(s, Math.round(e.offsetX), Math.round(e.offsetY))
  })
  canvas.addEventListener('pointerleave', () => {
    session.userShell.actions.pointerLeave(s)
  })

  return win
}

function startDrag(el: HTMLDivElement, downEvent: MouseEvent) {
  downEvent.preventDefault()
  const startX = downEvent.clientX
  const startY = downEvent.clientY
  const origLeft = el.offsetLeft
  const origTop = el.offsetTop
  const onMove = (e: MouseEvent) => {
    el.style.left = `${origLeft + (e.clientX - startX)}px`
    el.style.top = `${Math.max(0, origTop + (e.clientY - startY))}px`
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

main().catch((e) => {
  console.error(e)
  statusEl.textContent = 'error: ' + (e?.message ?? e)
})
