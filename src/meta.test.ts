import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TOOLS } from "./tools.js";

const read = (f: string) =>
	JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

describe("project metadata", () => {
	test("manifest.json version matches package.json", () => {
		expect(read("manifest.json").version).toBe(read("package.json").version);
	});

	test("manifest.json and glama.json list every registered tool", () => {
		const registered = TOOLS.map((t) => t.name).sort();
		for (const file of ["manifest.json", "glama.json"]) {
			const listed = read(file)
				.tools.map((t: { name: string }) => t.name)
				.sort();
			expect(listed).toEqual(registered);
		}
	});
});
