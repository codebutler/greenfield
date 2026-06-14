import { createAppLauncher, createCompositorSession, initWasm, type AppLauncher } from '@gfld/compositor'

const statusEl = document.getElementById('status') as HTMLSpanElement
const hintEl = document.getElementById('hint') as HTMLDivElement
const canvas = document.getElementById('output') as HTMLCanvasElement

function setStatus(text: string) {
  statusEl.textContent = text
}

async function main() {
  setStatus('loading wasm…')
  await initWasm()

  // 'floating' mode = the built-in window manager: draggable / resizable /
  // stackable windows, click-to-focus, raise-on-click. Windows initiate a move
  // by issuing xdg_toplevel.move (the clients here do that on pointer press).
  const session = await createCompositorSession({ mode: 'floating' })
  session.userShell.events.notify = (_variant: string, message: string) => console.warn('[compositor]', message)

  // Fixed output resolution (the <canvas> width/height attributes); CSS scales
  // it to fill the stage. This mirrors the known-good compositor-shell setup.
  session.userShell.actions.initScene(() => ({ canvas, id: 'output' }))
  session.globals.register()

  const webAppLauncher: AppLauncher = createAppLauncher(session, 'web')

  // Wire the sample buttons. Each launches a web app from THIS same origin, so
  // there are no cross-origin worker / CORP issues.
  let launched = 0
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('button.sample'))) {
    btn.addEventListener('click', () => {
      const rel = btn.dataset.app!
      const url = new URL(rel, document.baseURI)
      setStatus(`launching ${btn.textContent?.trim()}…`)
      const app = webAppLauncher.launch(url)
      app.onStateChange = (state: string) => setStatus(`${rel.split('/').pop()} — ${state}`)
      if (++launched === 1 && hintEl) hintEl.style.display = 'none'
    })
  }

  setStatus('ready')
}

main().catch((e) => {
  console.error(e)
  setStatus('error: ' + (e?.message ?? e))
})
