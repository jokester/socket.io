dev-demo-client:
	cd demo-client && exec pnpm run dev

build-demo-server:
	cd demo-server && DEBUG='*' exec node build-node.mjs

dev-demo-server-build:
	cd demo-server && exec node build-node.mjs --watch

dev-demo-server-run:
	cd demo-server && exec pnpm dev:cf
