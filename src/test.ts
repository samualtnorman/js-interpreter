import { promises as fsPromises } from "fs"
import { evaluate } from "."
import { findFiles, is } from "./lib"

const { readFile } = fsPromises

for (const path of await findFiles("tests", [ "LICENSE" ])) {
	console.log(`\n${path}`)

	evaluate(await readFile(path, { encoding: "utf-8" }), {
		test(name: string, callback: () => void) {
			console.log(`\t${name}:`)
			callback()
		},

		expect(a: any) {
			return {
				toBe(b: any) {
					if (a == b)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toEval() {
					try {
						evaluate(a)
					} catch {
						console.error("\t\tfail")
						return
					}

					console.log("\t\tpass")
				},

				toEvalTo(b: any) {
					if (evaluate(a) == b)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				not: {
					toEval() {
						try {
							evaluate(a)
						} catch {
							console.log("\t\tpass")
							return
						}

						console.error("\t\tfail")
					},

					toBe(b: any) {
						if (a != b)
							console.log("\t\tpass")
						else
							console.error("\t\tfail")
					}
				},

				toThrowWithMessage(constructor: Function, message: string) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return console.log("\t\tpass")
					}

					console.error("\t\tfail")
				},

				toHaveLength(length: number) {
					if (a.length == length)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toBeFalse() {
					if (a == false)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toBeTrue() {
					if (a == true)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toBeInstanceOf(constructor: Function) {
					if (a instanceof constructor)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toEqual(b: any) {
					if (a == b)
						console.log("\t\tpass")
					else
						console.error("\t\tfail")
				},

				toThrow(constructor: Function) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return console.log("\t\tpass")
					}

					console.error("\t\tfail")
				}
			}
		},

		describe(name: string, callback: () => void) {
			console.log(`${name}:`)

			try {
				callback()
			} catch (error) {
				console.error(error)
			}
		}
	})
}
