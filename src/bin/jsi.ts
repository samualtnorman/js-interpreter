#!/usr/bin/env node
import { Node, parse } from "acorn"
import { Context, run } from ".."

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

while (true) {
	let code = await prompt()
	let node: Node | undefined

	do {
		try {
			node = parse(code, { ecmaVersion: "latest" })
		} catch {
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

function prompt(prompt = "> ") {
	return new Promise<string>(resolve => {
		process.stdout.write(prompt)
		process.stdin.once("data", data => resolve(data.toString().trim()))
	})
}
