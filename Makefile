.PHONY: run dev test proof clean

# One command to a runnable artifact, per the hackathon rules.
run:
	bun src/server.js

dev:
	bun --watch src/server.js

test:
	bun test

# Regenerates deps-proof.txt from the actual manifest, so the proof file
# is never hand-edited out of sync with reality.
proof:
	@echo "== package.json dependencies ==" > deps-proof.txt
	@cat package.json | grep -A2 '"dependencies"' >> deps-proof.txt
	@echo "" >> deps-proof.txt
	@echo "== node_modules (should not exist) ==" >> deps-proof.txt
	@ls node_modules 2>&1 | tee -a deps-proof.txt || true
	@echo "" >> deps-proof.txt
	@echo "== bun.lock / bun.lockb (should not exist) ==" >> deps-proof.txt
	@ls bun.lock bun.lockb 2>&1 | tee -a deps-proof.txt || true
	@cat deps-proof.txt

clean:
	rm -rf data/*.sqlite data/*.sqlite-wal data/*.sqlite-shm data/uploads/* data/.session-secret
