#!/usr/bin/env node
import { Node, parse } from "acorn"
import { promises as fsPromises } from "fs"
import { Context, evaluate, run } from ".."
import { assert, isRecord } from "../lib"

const { readFile } = fsPromises

const context: Context = {
	variables: [
		new Map(),
		new Map(
			Object.getOwnPropertyNames(globalThis)
				.map(key => [ key, (globalThis as any)[key] ])
		)
	],

	constants: new Map,
	statementLabel: undefined,
	this: undefined,
	callSuper: null,
	getSuperProperty: null,
	signal: null
}

if (process.argv[2])
	evaluate(await readFile(process.argv[2], { encoding: "utf-8" }))
else {
	main:
	while (true) {
		let code = await prompt()
		let node: Node | undefined

		do {
			try {
				node = parse(code, { ecmaVersion: "latest" })
			} catch (error) {
				assert(isRecord(error))
				assert(typeof error.pos == "number")

				if (error.pos != code.length) {
					console.error("Uncaught", error.message)
					continue main
				}

				code += `\n${await prompt("... ")}`
			}
		} while (!node)

		let returnValue

		try {
			returnValue = run(node, context)
		} catch (error) {
			console.error("Uncaught", error)
			continue
		}

		if (typeof returnValue == "string")
			console.log(JSON.stringify(returnValue))
		else
			console.log(returnValue)
	}
}

function prompt(prompt = "> ") {
	return new Promise<string>(resolve => {
		process.stdout.write(prompt)
		process.stdin.once("data", data => resolve(data.toString().trim()))
	})
}
