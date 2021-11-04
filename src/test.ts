import { deepEqual as deepEquals } from "fast-equals"
import { promises as fsPromises } from "fs"
import { evaluate } from "."
import { findFiles, is } from "./lib"

const { readFile } = fsPromises

for (const path of await findFiles("tests", [ "LICENSE" ])) {
	console.log(`\n${path}`)

	let fails: number[] = []
	let i = 0

	evaluate(await readFile(path, { encoding: "utf-8" }), {
		test(name: string, callback: () => void) {
			console.log(`\t${name}`)
			fails = []

			callback()

			if (i) {
				if (fails.length)
					console.error(`\t\t${fails.join(", ")}`)

				i = 0
			} else
				console.error(`\t\tno tests ran in "${name}"`)
		},

		expect(a: any) {
			i++

			return {
				toBe(b: any) {
					if (a != b)
						fails.push(i)
				},

				toEval() {
					try {
						evaluate(a)
					} catch {
						fails.push(i)
					}
				},

				toEvalTo(b: any) {
					if (evaluate(a) != b)
						fails.push(i)
				},

				not: {
					toEval() {
						try {
							evaluate(a)
						} catch {
							return
						}

						fails.push(i)
					},

					toBe(b: any) {
						if (a == b)
							fails.push(i)
					},

					toHaveProperty(name: string) {
						if (name in a)
							fails.push(i)
					},

					toBeNaN() {
						if (isNaN(a))
							fails.push(i)
					},

					toHaveGetterProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.get)
							fails.push(i)
					},

					toHaveSetterProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.set)
							fails.push(i)
					},

					toHaveWritableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.writable)
							fails.push(i)
					},

					toHaveValueProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.value)
							fails.push(i)
					},

					toHaveConfigurableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.configurable)
							fails.push(i)
					},

					toHaveEnumerableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.enumerable)
							fails.push(i)
					}
				},

				toThrowWithMessage(constructor: Function, message: string) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return
					}

					fails.push(i)
				},

				toHaveLength(length: number) {
					if (a.length != length)
						fails.push(i)
				},

				toBeFalse() {
					if (a !== false)
						fails.push(i)
				},

				toBeTrue() {
					if (a !== true)
						fails.push(i)
				},

				toBeInstanceOf(constructor: Function) {
					if (!(a instanceof constructor))
						fails.push(i)
				},

				toEqual(b: any) {
					if (!deepEquals(a, b))
						fails.push(i)
				},

				toThrow(constructor: Function) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return
					}

					fails.push(i)
				},

				toBeUndefined() {
					if (a !== undefined)
						fails.push(i)
				},

				toBeGreaterThan(b: any) {
					if (a <= b)
						fails.push(i)
				},

				toBeLessThan(b: any) {
					if (a >= b)
						fails.push(i)
				},

				toBeGreaterThanOrEqual(b: any) {
					if (a < b)
						fails.push(i)
				},

				toBeLessThanOrEqual(b: any) {
					if (a > b)
						fails.push(i)
				},

				toHaveSize(size: number) {
					if (a.size != size)
						fails.push(i)
				},

				toBeNaN() {
					if (!isNaN(a))
						fails.push(i)
				},

				toBeCloseTo() {},

				toHaveConfigurableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.configurable)
						fails.push(i)
				},

				toHaveEnumerableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.enumerable)
						fails.push(i)
				},

				toHaveWritableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.writable)
						fails.push(i)
				},

				toHaveValueProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.value)
						fails.push(i)
				},

				toHaveGetterProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.get)
						fails.push(i)
				},

				toHaveSetterProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.set)
						fails.push(i)
				},

				toBeNull() {
					if (a !== null)
						fails.push(i)
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
