import { promises as fsPromises } from "fs"
import { evaluate } from "."
import { findFiles } from "@samual/lib/findFiles"
import { is } from "@samual/lib/is"
import { deeplyEquals } from "@samual/lib/deeplyEquals"

const { readFile } = fsPromises

for (const path of await findFiles(`tests`, [ `LICENSE` ])) {
	console.log(`\n${path}`)

	let fails: number[] = []
	let index = 0

	// TODO this might need fixing
	// eslint-disable-next-line no-await-in-loop
	evaluate(await readFile(path, { encoding: `utf-8` }), Object.assign(Object.create(globalThis), {
		test(name: string, callback: () => void) {
			console.log(`\t${name}`)
			fails = []
			callback()

			if (index) {
				if (fails.length)
					console.error(`\t\t${fails.join(`, `)}`)

				index = 0
			} else
				console.error(`\t\tno tests ran in "${name}"`)
		},

		expect(a: any) {
			index++

			return {
				toBe(b: any) {
					if (a != b)
						fails.push(index)
				},

				toEval() {
					try {
						evaluate(a)
					} catch {
						fails.push(index)
					}
				},

				toEvalTo(b: any) {
					if (evaluate(a) != b)
						fails.push(index)
				},

				not: {
					toEval() {
						try {
							evaluate(a)
						} catch {
							return
						}

						fails.push(index)
					},

					toBe(b: any) {
						if (a == b)
							fails.push(index)
					},

					toHaveProperty(name: string) {
						if (name in a)
							fails.push(index)
					},

					toBeNaN() {
						if (isNaN(a))
							fails.push(index)
					},

					toHaveGetterProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.get)
							fails.push(index)
					},

					toHaveSetterProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.set)
							fails.push(index)
					},

					toHaveWritableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.writable)
							fails.push(index)
					},

					toHaveValueProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.value)
							fails.push(index)
					},

					toHaveConfigurableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.configurable)
							fails.push(index)
					},

					toHaveEnumerableProperty(name: string) {
						if (Object.getOwnPropertyDescriptor(a, name)?.enumerable)
							fails.push(index)
					}
				},

				toThrowWithMessage(constructor: { prototype: any }, _message: string) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return
					}

					fails.push(index)
				},

				toHaveLength(length: number) {
					if (a.length != length)
						fails.push(index)
				},

				toBeFalse() {
					if (a !== false)
						fails.push(index)
				},

				toBeTrue() {
					if (a !== true)
						fails.push(index)
				},

				// eslint-disable-next-line @typescript-eslint/ban-types
				toBeInstanceOf(constructor: Function) {
					if (!(a instanceof constructor))
						fails.push(index)
				},

				toEqual(b: any) {
					if (!deeplyEquals(a, b))
						fails.push(index)
				},

				// eslint-disable-next-line @typescript-eslint/ban-types
				toThrow(constructor: Function) {
					try {
						a()
					} catch (error) {
						if (is(error as any, constructor))
							return
					}

					fails.push(index)
				},

				toBeUndefined() {
					if (a !== undefined)
						fails.push(index)
				},

				toBeGreaterThan(b: any) {
					if (a <= b)
						fails.push(index)
				},

				toBeLessThan(b: any) {
					if (a >= b)
						fails.push(index)
				},

				toBeGreaterThanOrEqual(b: any) {
					if (a < b)
						fails.push(index)
				},

				toBeLessThanOrEqual(b: any) {
					if (a > b)
						fails.push(index)
				},

				toHaveSize(size: number) {
					if (a.size != size)
						fails.push(index)
				},

				toBeNaN() {
					if (!isNaN(a))
						fails.push(index)
				},

				toBeCloseTo() {
					throw new Error(`Not implemented`)
				},

				toHaveConfigurableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.configurable)
						fails.push(index)
				},

				toHaveEnumerableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.enumerable)
						fails.push(index)
				},

				toHaveWritableProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.writable)
						fails.push(index)
				},

				toHaveValueProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.value)
						fails.push(index)
				},

				toHaveGetterProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.get)
						fails.push(index)
				},

				toHaveSetterProperty(name: string) {
					if (!Object.getOwnPropertyDescriptor(a, name)?.set)
						fails.push(index)
				},

				toBeNull() {
					if (a !== null)
						fails.push(index)
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
	}))
}
