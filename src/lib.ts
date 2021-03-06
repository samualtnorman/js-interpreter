import { promises as fsPromises } from "fs"

const { readdir: readDirectory } = fsPromises

export class CustomError extends Error {
	override name = this.constructor.name
}

export class AssertError extends Error {}

export function assert(value: any, message = "assertion failed"): asserts value {
	if (!value)
		throw new AssertError(message)
}

/**
 * @param path the directory to start recursively finding files in
 * @param filter either a blacklist or a filter function that returns false to ignore file name
 * @returns promise that resolves to array of found files
 */
export async function findFiles(path: string, filter: string[] | ((name: string) => boolean) = []) {
	const paths: string[] = []

	let filterFunction: (name: string) => boolean

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

async function findFilesSub(path: string, filterFunction: (name: string) => boolean, paths: string[]) {
	const promises: Promise<any>[] = []

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

export function isRecord(value: unknown): value is Record<string | symbol, unknown> {
	return !!value && typeof value == "object"
}

export function is<C extends Function>(object: {}, constructor: C): object is C["prototype"] {
	return Object.getPrototypeOf(object) == constructor.prototype
}
