import json from "@rollup/plugin-json"
import nodeResolve from "@rollup/plugin-node-resolve"
import typescript from "@rollup/plugin-typescript"
import { promises as fsPromises } from "fs"
import { terser } from "rollup-plugin-terser"
import module from "./package.json"

const { readdir: readDirectory } = fsPromises

/** @typedef {import("rollup").RollupOptions} RollupOptions */

const sourceDirectory = "src"
const outDir = "."

/** @type {(command: Record<string, unknown>) => Promise<RollupOptions>} */
export default async () => ({
	input: Object.fromEntries((await findFiles(sourceDirectory))
		.filter(path => path.endsWith(".js") || path.endsWith(".ts"))
		.map(path => [ path.slice(sourceDirectory.length + 1, -3), path ])
	),
	output: {
		dir: outDir,
		chunkFileNames: "[name]-.js",
		generatedCode: "es2015",
		interop: "auto",
		compact: true
	},
	plugins: [
		typescript({ tsconfig: `${sourceDirectory}/tsconfig.json`, outDir }),
		json(),
		nodeResolve(),
		terser()
	],
	external: [
		..."dependencies" in module ?
			Object.keys(module["dependencies"])
		:	[]
	],
	// preserveEntrySignatures: "allow-extension"
})

/**
 * @param path the directory to start recursively finding files in
 * @param filter either a blacklist or a filter function that returns false to ignore file name
 * @returns promise that resolves to array of found files
 * @type {(path: string, filter?: string[] | ((name: string) => boolean)) => Promise<string[]>}
 */
async function findFiles(path, filter = []) {
	const paths = []
	let /** @type {(name: string) => boolean} */ filterFunction

	if (Array.isArray(filter))
		filterFunction = name => !filter.includes(name)
	else
		filterFunction = filter

	for (const dirent of await readDirectory(path, { withFileTypes: true })) {
		if (!filterFunction(dirent.name))
			continue

		const direntPath = `${path}/${dirent.name}`

		if (dirent.isDirectory())
			await findFilesSub(direntPath, filterFunction, paths)
		else if (dirent.isFile())
			paths.push(direntPath)
	}

	return paths
}

async function findFilesSub(path, filterFunction, paths) {
	const promises = []

	for (const dirent of await readDirectory(path, { withFileTypes: true })) {
		if (!filterFunction(dirent.name))
			continue

		const direntPath = `${path}/${dirent.name}`

		if (dirent.isDirectory())
			promises.push(findFilesSub(direntPath, filterFunction, paths))
		else if (dirent.isFile())
			paths.push(direntPath)
	}

	await Promise.all(promises)
	return paths
}
