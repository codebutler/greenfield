/*
 * gf-hello.c — a minimal "hello world" Wayland client in C, compiled to
 * WebAssembly with the Greenfield SDK and run directly in the browser inside
 * the in-browser Greenfield Wayland compositor. No remote server involved.
 *
 * It uses only libwayland-client + xdg-shell + raw wl_shm (no cairo/toolkit):
 * it allocates a shared-memory buffer, paints a recognizable pattern into it,
 * and presents it as an xdg_toplevel window.
 */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/mman.h>

#include <emscripten.h>
#include <wayland-client.h>
#include "xdg-shell-client-protocol.h"

#define WIDTH 300
#define HEIGHT 300

struct app {
	struct wl_display *display;
	struct wl_registry *registry;
	struct wl_compositor *compositor;
	struct wl_shm *shm;
	struct xdg_wm_base *wm_base;
	struct wl_seat *seat;
	struct wl_pointer *pointer;

	struct wl_surface *surface;
	struct xdg_surface *xdg_surface;
	struct xdg_toplevel *xdg_toplevel;

	struct wl_buffer *buffer;
	void *shm_data;
	bool configured;
	bool running;
};

/* Create an anonymous, sized file in the (in-memory) filesystem usable as a
 * wl_shm pool fd. The Greenfield unix-socket bridge maps the mmap'd region of
 * this fd into a SharedArrayBuffer for the compositor. */
static int create_shm_file(off_t size)
{
	char name[] = "/tmp/gf-hello-XXXXXX";
	int fd = mkstemp(name);
	if (fd < 0)
		return -1;
	unlink(name);
	if (ftruncate(fd, size) < 0) {
		close(fd);
		return -1;
	}
	return fd;
}

static void paint(uint32_t *pixels, int width, int height)
{
	for (int y = 0; y < height; y++) {
		for (int x = 0; x < width; x++) {
			uint8_t r = (uint8_t)(x * 255 / width);   /* gradient R */
			uint8_t b = (uint8_t)(y * 255 / height);  /* gradient B */
			uint8_t g = 0x20;
			/* a bright centered square so it's obviously our app */
			if (x > width / 4 && x < width * 3 / 4 &&
			    y > height / 4 && y < height * 3 / 4) {
				r = 0xff; g = 0x99; b = 0x00; /* orange */
			}
			/* white diagonal cross */
			if (x == y || x == (width - 1 - y)) {
				r = g = b = 0xff;
			}
			pixels[y * width + x] = (0xff << 24) | (r << 16) | (g << 8) | b;
		}
	}
}

static struct wl_buffer *create_buffer(struct app *app)
{
	int stride = WIDTH * 4;
	int size = stride * HEIGHT;

	int fd = create_shm_file(size);
	if (fd < 0) {
		fprintf(stderr, "create_shm_file failed\n");
		return NULL;
	}

	app->shm_data = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
	if (app->shm_data == MAP_FAILED) {
		fprintf(stderr, "mmap failed\n");
		close(fd);
		return NULL;
	}

	paint((uint32_t *)app->shm_data, WIDTH, HEIGHT);

	struct wl_shm_pool *pool = wl_shm_create_pool(app->shm, fd, size);
	struct wl_buffer *buffer = wl_shm_pool_create_buffer(
		pool, 0, WIDTH, HEIGHT, stride, WL_SHM_FORMAT_XRGB8888);
	wl_shm_pool_destroy(pool);
	close(fd);
	return buffer;
}

/* xdg_wm_base ping/pong keep-alive */
static void wm_base_ping(void *data, struct xdg_wm_base *wm_base, uint32_t serial)
{
	xdg_wm_base_pong(wm_base, serial);
}
static const struct xdg_wm_base_listener wm_base_listener = { .ping = wm_base_ping };

/* xdg_surface configure: ack, attach our buffer, commit */
static void xdg_surface_configure(void *data, struct xdg_surface *xdg_surface, uint32_t serial)
{
	struct app *app = data;
	xdg_surface_ack_configure(xdg_surface, serial);

	if (!app->buffer)
		app->buffer = create_buffer(app);

	wl_surface_attach(app->surface, app->buffer, 0, 0);
	wl_surface_damage(app->surface, 0, 0, WIDTH, HEIGHT);
	wl_surface_commit(app->surface);
	app->configured = true;
}
static const struct xdg_surface_listener xdg_surface_listener = {
	.configure = xdg_surface_configure,
};

/* xdg_toplevel close -> exit */
static void xdg_toplevel_configure(void *data, struct xdg_toplevel *t,
		int32_t w, int32_t h, struct wl_array *states) {}
static void xdg_toplevel_close(void *data, struct xdg_toplevel *t)
{
	struct app *app = data;
	app->running = false;
}
static const struct xdg_toplevel_listener xdg_toplevel_listener = {
	.configure = xdg_toplevel_configure,
	.close = xdg_toplevel_close,
};

/* Pointer: start an interactive move when the window body is left-pressed.
 * There are no server-side title bars in Wayland, so the client asks the
 * compositor (its window manager) to move the window via xdg_toplevel_move. */
#define BTN_LEFT 0x110

static void pointer_enter(void *data, struct wl_pointer *p, uint32_t serial,
		struct wl_surface *s, wl_fixed_t sx, wl_fixed_t sy) {}
static void pointer_leave(void *data, struct wl_pointer *p, uint32_t serial,
		struct wl_surface *s) {}
static void pointer_motion(void *data, struct wl_pointer *p, uint32_t time,
		wl_fixed_t sx, wl_fixed_t sy) {}
static void pointer_axis(void *data, struct wl_pointer *p, uint32_t time,
		uint32_t axis, wl_fixed_t value) {}
static void pointer_button(void *data, struct wl_pointer *p, uint32_t serial,
		uint32_t time, uint32_t button, uint32_t state)
{
	struct app *app = data;
	if (button == BTN_LEFT && state == WL_POINTER_BUTTON_STATE_PRESSED && app->xdg_toplevel) {
		xdg_toplevel_move(app->xdg_toplevel, app->seat, serial);
	}
}
static const struct wl_pointer_listener pointer_listener = {
	.enter = pointer_enter,
	.leave = pointer_leave,
	.motion = pointer_motion,
	.button = pointer_button,
	.axis = pointer_axis,
};

static void seat_capabilities(void *data, struct wl_seat *seat, uint32_t caps)
{
	struct app *app = data;
	if ((caps & WL_SEAT_CAPABILITY_POINTER) && app->pointer == NULL) {
		app->pointer = wl_seat_get_pointer(seat);
		wl_pointer_add_listener(app->pointer, &pointer_listener, app);
	}
}
static void seat_name(void *data, struct wl_seat *seat, const char *name) {}
static const struct wl_seat_listener seat_listener = {
	.capabilities = seat_capabilities,
	.name = seat_name,
};

static void registry_global(void *data, struct wl_registry *registry,
		uint32_t name, const char *interface, uint32_t version)
{
	struct app *app = data;
	if (strcmp(interface, wl_compositor_interface.name) == 0) {
		app->compositor = wl_registry_bind(registry, name, &wl_compositor_interface, 1);
	} else if (strcmp(interface, wl_shm_interface.name) == 0) {
		app->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
	} else if (strcmp(interface, xdg_wm_base_interface.name) == 0) {
		app->wm_base = wl_registry_bind(registry, name, &xdg_wm_base_interface, 1);
		xdg_wm_base_add_listener(app->wm_base, &wm_base_listener, app);
	} else if (strcmp(interface, wl_seat_interface.name) == 0) {
		app->seat = wl_registry_bind(registry, name, &wl_seat_interface, 1);
		wl_seat_add_listener(app->seat, &seat_listener, app);
	}
}
static void registry_global_remove(void *data, struct wl_registry *r, uint32_t name) {}
static const struct wl_registry_listener registry_listener = {
	.global = registry_global,
	.global_remove = registry_global_remove,
};

int main(void)
{
	struct app app = { 0 };
	app.running = true;

	app.display = wl_display_connect(NULL);
	if (!app.display) {
		fprintf(stderr, "failed to connect to wayland display\n");
		return 1;
	}
	printf("gf-hello: connected to compositor\n");

	app.registry = wl_display_get_registry(app.display);
	wl_registry_add_listener(app.registry, &registry_listener, &app);
	wl_display_roundtrip(app.display);

	if (!app.compositor || !app.shm || !app.wm_base) {
		fprintf(stderr, "missing required globals (compositor=%p shm=%p wm_base=%p)\n",
			(void *)app.compositor, (void *)app.shm, (void *)app.wm_base);
		return 1;
	}

	app.surface = wl_compositor_create_surface(app.compositor);
	app.xdg_surface = xdg_wm_base_get_xdg_surface(app.wm_base, app.surface);
	xdg_surface_add_listener(app.xdg_surface, &xdg_surface_listener, &app);
	app.xdg_toplevel = xdg_surface_get_toplevel(app.xdg_surface);
	xdg_toplevel_add_listener(app.xdg_toplevel, &xdg_toplevel_listener, &app);
	xdg_toplevel_set_title(app.xdg_toplevel, "gf-hello (C/WASM)");
	xdg_toplevel_set_app_id(app.xdg_toplevel, "be.udev.gf-hello");
	wl_surface_commit(app.surface);

	printf("gf-hello: entering event loop\n");
	while (app.running && wl_display_dispatch(app.display) != -1) {
		/* keep dispatching */
	}

	wl_display_disconnect(app.display);
	// Force the runtime to exit so the SDK's Module.onExit fires and the
	// compositor tears the window down (ASYNCIFY/pthreads keep it alive otherwise).
	emscripten_force_exit(0);
	return 0;
}
