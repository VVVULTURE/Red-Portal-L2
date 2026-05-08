/* public/uv/uv.config.js
   This file is loaded in both:
     • the main page  (self = window) — so openViaProxy can call encodeUrl
     • the service worker (self = ServiceWorkerGlobalScope) — for routing
   It MUST load after uv.bundle.js so Ultraviolet is defined.
*/
self.__uv$config = {
  prefix:    '/uv/service/',
  bare:      '/api/bare/',
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler:   '/uv/uv.handler.js',
  bundle:    '/uv/uv.bundle.js',
  config:    '/uv/uv.config.js',
  sw:        '/uv/uv.sw.js',
};
