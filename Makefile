dev-demo-client:
	cd demo-client && exec pnpm run dev

build-demo-server:
	cd demo-server && DEBUG='*' exec node build-node.mjs
