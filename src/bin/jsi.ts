#!/usr/bin/env node
import { parseExpression } from "@babel/parser"
import type { Node } from "@babel/types"
import { promises as fsPromises } from "fs"
import { evaluate, run, type Context } from ".."
import { isRecord } from "@samual/lib/isRecord"
import { assert } from "@samual/lib/assert"

const { readFile } = fsPromises

const context: Context = {
	variables: Object.create(globalThis),
	constants: Object.create(null),
	statementLabel: undefined,
	this: undefined,
	callSuper: undefined,
	getSuperProperty: undefined,
	signal: undefined
}

if (process.argv[2])
	evaluate(await readFile(process.argv[2], { encoding: `utf-8` }))
else {
	main:
	while (true) {
		// eslint-disable-next-line no-await-in-loop
		let code = await prompt()
		let node: Node | undefined

		do {
			try {
				node = parseExpression(code)
			} catch (error) {
				assert(isRecord(error))
				assert(typeof error.pos == `number`)

				if (error.pos != code.length) {
					console.error(`Uncaught`, error.message)

					continue main
				}

				// eslint-disable-next-line no-await-in-loop
				code += `\n${await prompt(`... `)}`
			}
		} while (!node)

		let returnValue

		try {
			returnValue = run(node, context)
		} catch (error) {
			console.error(`Uncaught`, error)

			continue
		}

		if (typeof returnValue == `string`)
			console.log(JSON.stringify(returnValue))
		else
			console.log(returnValue)
	}
}

function prompt(prompt = `> `) {
	return new Promise<string>(resolve => {
		process.stdout.write(prompt)
		process.stdin.once(`data`, data => resolve(data.toString().trim()))
	})
}
