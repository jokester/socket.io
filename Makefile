dev-demo-client:
	cd demo-client && exec pnpm run dev

dev-demo-server:
	cd demo-server && exec node build-node.mjs