.PHONY: run dev test proof check clean

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
	@echo "== package.json dependency maps ==" > deps-proof.txt
	@grep -E '  "(dependencies|devDependencies)": \{\},' package.json >> deps-proof.txt
	@echo "" >> deps-proof.txt
	@echo "== node_modules ==" >> deps-proof.txt
	@if [ -d node_modules ]; then echo "PRESENT (unexpected)"; else echo "absent"; fi | tee -a deps-proof.txt
	@echo "" >> deps-proof.txt
	@echo "== Bun lockfiles ==" >> deps-proof.txt
	@if [ -e bun.lock ] || [ -e bun.lockb ]; then echo "PRESENT (unexpected)"; else echo "absent"; fi | tee -a deps-proof.txt
	@cat deps-proof.txt

check: test proof

clean:
	rm -rf data/*.sqlite data/*.sqlite-wal data/*.sqlite-shm data/uploads/* data/.session-secret
