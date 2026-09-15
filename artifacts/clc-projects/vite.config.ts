import path from 'path';
import { readFile, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { renderPublicRouteBody } from './src/lib/public-page-content';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;
const browserTestMode = process.env.CLC_BROWSER_TEST === '1';
const publicSiteUrl = 'https://constructlifecycle.com';
const publicShareImageUrl = `${publicSiteUrl}/og-image.png`;
const publicRouteMetadata = {
  '/': {
    title: 'Construct Lifecycle',
    description: 'Construct Lifecycle helps construction teams manage work from bid through closeout in one connected workspace.',
    canonicalPath: '/',
  },
  '/pricing': {
    title: 'Plans & billing · Construct Lifecycle',
    description: 'Compare Construct Lifecycle plans for managing your construction lifecycle from bid through closeout.',
    canonicalPath: '/pricing',
  },
  '/subscribe': {
    title: 'Plans & billing · Construct Lifecycle',
    description: 'Compare Construct Lifecycle plans for managing your construction lifecycle from bid through closeout.',
    canonicalPath: '/pricing',
  },
} as const;

function replaceHeadTag(html: string, pattern: RegExp, tag: string) {
  return html.replace(pattern, tag);
}

function applyPublicRouteMetadata(html: string, pathname: string) {
  const route = publicRouteMetadata[pathname as keyof typeof publicRouteMetadata] ?? publicRouteMetadata['/'];
  const canonicalUrl = `${publicSiteUrl}${route.canonicalPath}`;
  const replacements: Array<[RegExp, string]> = [
    [/<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`],
    [/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonicalUrl}" />`],
    [/<meta name="description"[^>]*>/, `<meta name="description" content="${route.description}" />`],
    [/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${route.title}" />`],
    [/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${route.description}" />`],
    [/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${canonicalUrl}" />`],
    [/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${publicShareImageUrl}" />`],
    [/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${route.title}" />`],
    [/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${route.description}" />`],
    [/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${publicShareImageUrl}" />`],
    [/<meta property="og:site_name"[^>]*>/, '<meta property="og:site_name" content="Construct Lifecycle" />'],
    [/<meta property="og:image:alt"[^>]*>/, '<meta property="og:image:alt" content="Construct Lifecycle — From Bid to Closeout" />'],
  ];
  return replacements.reduce((result, [pattern, replacement]) => replaceHeadTag(result, pattern, replacement), html);
}

function replacePublicRoot(html: string, pathname: string) {
  const rootStart = html.indexOf('<div id="root">');
  const scriptStart = html.indexOf('<script type="module"', rootStart);
  const bodyEnd = html.indexOf('</body>', rootStart);
  const rootEnd = scriptStart === -1 ? bodyEnd : scriptStart;
  if (rootStart === -1 || rootEnd === -1) return html;
  const suffix = scriptStart === -1 ? html.slice(rootEnd) : `\n    ${html.slice(rootEnd)}`;
  return `${html.slice(0, rootStart)}<div id="root">${renderPublicRouteBody(pathname)}</div>${suffix}`;
}

function routeMetadataPlugin(): Plugin {
  return {
    name: 'clc-route-metadata',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const requestedUrl = req.originalUrl ?? req.url ?? '/';
        const pathname = new URL(requestedUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
        if (pathname !== '/' && pathname !== '/pricing' && pathname !== '/subscribe') {
          next();
          return;
        }

        try {
          const source = await readFile(path.join(import.meta.dirname, 'index.html'), 'utf8');
          const html = await server.transformIndexHtml(requestedUrl, source, requestedUrl);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
    transformIndexHtml(html, ctx) {
      const requestedUrl = ctx.originalUrl ?? ctx.path;
      const pathname = new URL(requestedUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
      return applyPublicRouteMetadata(replacePublicRoot(html, pathname), pathname);
    },
    async writeBundle(options) {
      if (!options.dir) return;
      const source = await readFile(path.join(options.dir, 'index.html'), 'utf8');
      for (const route of ['/pricing', '/subscribe'] as const) {
        const routeHtml = applyPublicRouteMetadata(replacePublicRoot(source, route), route);
        await writeFile(path.join(options.dir, route.slice(1)), routeHtml);
      }
    },
  };
}

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY': JSON.stringify(
      process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    ),
    'import.meta.env.VITE_STRIPE_PRICING_TABLE_ID': JSON.stringify(
      process.env.VITE_STRIPE_PRICING_TABLE_ID ?? process.env.STRIPE_PRICING_TABLE_ID ?? '',
    ),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    routeMetadataPlugin(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: [
      ...(browserTestMode
        ? [
            {
              find: '@clerk/react/internal',
              replacement: path.resolve(import.meta.dirname, 'src/lib/browser-test-clerk-internal.ts'),
            },
            {
              find: '@clerk/react',
              replacement: path.resolve(import.meta.dirname, 'src/lib/browser-test-clerk.tsx'),
            },
          ]
        : []),
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      {
        find: '@assets',
        replacement: path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
