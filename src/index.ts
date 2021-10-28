import { Node, parse } from "acorn"
import { promises as fsPromises } from "fs"
import { assert, findFiles } from "./lib"

const { readFile } = fsPromises

for (const path of await findFiles("tests")) {
	console.log(path)

	run(
		parse(await readFile(path, { encoding: "utf-8" }), { ecmaVersion: "latest" }),

		{
			scopeStack: [
				new Map(Object.entries({
					test(name: string, callback: () => void) {
						console.log(`${name}:`)
						callback()
					},
					expect(a: any) {
						return {
							toBe(b: any) {
								assert(a == b)
								console.log("\tpass")
							},
							toEval() {
								run(parse(a, { ecmaVersion: "latest" }), {
									scopeStack: [
										new Map(
											Object.getOwnPropertyNames(globalThis)
												.map(key => [ key, (globalThis as any)[key] ])
										)
									],
									returnValue: undefined
								})
								console.log("\tpass")
							},
							toEvalTo(b: any) {
								assert(run(parse(a, { ecmaVersion: "latest" }), {
									scopeStack: [
										new Map(
											Object.getOwnPropertyNames(globalThis)
												.map(key => [ key, (globalThis as any)[key] ])
										)
									],
									returnValue: undefined
								}) == b)
								console.log("\tpass")
							}
						}
					}
				})),
				new Map(
					Object.getOwnPropertyNames(globalThis)
						.map(key => [ key, (globalThis as any)[key] ])
				)
			],
			returnValue: undefined
		}
	)
}

// console.log(run(parse(`function foo() {
//     label:
//     for (var i = 0; i < 4; i++) {
//         break // semicolon inserted here
//         continue // semicolon inserted here

//         break label // semicolon inserted here
//         continue label // semicolon inserted here
//     }

//     var j // semicolon inserted here

//     do {
//     } while (1 === 2) // semicolon inserted here

//     return // semicolon inserted here
//     1;
// var curly/* semicolon inserted here */}

// foo();`, { ecmaVersion: "latest" }), {
// 	scopeStack: [
// 		new Map(
// 			Object.getOwnPropertyNames(globalThis)
// 				.map(key => [ key, (globalThis as any)[key] ])
// 		)
// 	],
// 	returnValue: undefined
// }))

export function run(node: Node, context: { scopeStack: Map<string, unknown>[], returnValue: unknown }): unknown {
	switch (node.type) {
		case "Program": {
			let finalValue

			for (const childNode of node.body)
				finalValue = run(childNode, context)

			return finalValue
		}

		case "VariableDeclaration": {
			for (const childNode of node.declarations) {
				assert(childNode.type == "VariableDeclarator", `childNode.type was not "VariableDeclarator"`)

				const { id } = childNode

				assert(id.type == "Identifier", `id.type was not "Identifier"`)

				if (childNode.init)
					context.scopeStack[0].set(id.name, run(childNode.init, context))
				else
					context.scopeStack[0].set(id.name, undefined)
			}

			return
		}

		case "Literal": {
			return node.value
		}

		case "ExpressionStatement": {
			return run(node.expression, context)
		}

		case "CallExpression": {
			return (run(node.callee, context) as any)(...node.arguments.map(childNode => run(childNode, context)))
		}

		case "MemberExpression": {
			const object = run(node.object, context)

			let value

			if (node.property.type == "Identifier")
				value = (object as any)[node.property.name]
			else
				value = (object as any)[run(node.property, context) as any]

			// BUG although this fixes `this`, it breaks function equality
			if (typeof value == "function")
				return value.bind(object)

			return value
		}

		case "Identifier": {
			return getVariable(context.scopeStack, node.name)
		}

		case "FunctionExpression":
		case "ArrowFunctionExpression":
		case "FunctionDeclaration": {
			const function_ = function (...args: any[]) {
				const functionScope = {
					scopeStack: [ new Map, ...context.scopeStack ],
					returnValue: undefined
				}

				functionScope.scopeStack[0].set("arguments", arguments)

				for (let i = 0; i < args.length && i < node.params.length; i++) {
					const childNode = node.params[i]
					assert(childNode.type == "Identifier", `childNode.type was "Identifier"`)
					functionScope.scopeStack[0].set(childNode.name, args[i])
				}

				assert(node.body.type == "BlockStatement")

				for (const childNode of node.body.body) {
					run(childNode, functionScope)
				}

				return functionScope.returnValue
			}

			if (node.expression || node.type == "ArrowFunctionExpression" || node.type == "FunctionExpression")
				return function_

			assert(node.id, `no "id" in node`)
			assert(node.id.type == "Identifier", `node.id.type was "Identifier"`)

			context.scopeStack[0].set(node.id.name, function_)

			return
		}

		case "ForStatement": {
			const forScope = {
				scopeStack: [ new Map, ...context.scopeStack ],
				returnValue: undefined
			}

			let finalValue

			for (run(node.init, forScope); run(node.test, forScope); run(node.update, forScope))
				finalValue = run(node.body, forScope)

			return finalValue
		}

		case "AssignmentExpression": {
			assert(node.left.type == "Identifier")

			const value = run(node.right, context)

			setVariable(context.scopeStack, node.left.name, value)

			return value
		}

		case "BinaryExpression": {
			switch (node.operator) {
				case "<": {
					return (run(node.left, context) as any) < (run(node.right, context) as any)
				}

				case "+": {
					return (run(node.left, context) as any) + (run(node.right, context) as any)
				}

				case "==": {
					return (run(node.left, context) as any) == (run(node.right, context) as any)
				}

				default: {
					console.error(node)
					throw new Error(`unknown operator "${node.operator}"`)
				}
			}
		}

		case "BlockStatement": {
			const blockScope = {
				scopeStack: [ new Map, ...context.scopeStack ],
				returnValue: undefined
			}

			let finalValue

			for (const childNode of node.body)
				finalValue = run(childNode, blockScope)

			return finalValue
		}

		case "UpdateExpression": {
			assert(node.argument.type == "Identifier", `node.argument.type was not "Identifier"`)

			switch (node.operator) {
				case "++": {
					let updatedValue: any = run(node.argument, context)

					const returnValue = node.prefix ? ++updatedValue : updatedValue++

					setVariable(context.scopeStack, node.argument.name, updatedValue)

					return returnValue
				}

				default: {
					console.error(node)
					throw new Error(`unknown operator "${node.operator}"`)
				}
			}
		}

		case "ReturnStatement": {
			return context.returnValue = run(node.argument, context)
		}

		case "ArrayExpression": {
			return new Array(node.elements.length).map((_, i) => run(node.elements[i], context))
		}

		case "ArrayExpression": {
			return new Array(node.elements.length).map((_, i) => run(node.elements[i], context))
		}

		case "ObjectExpression": {
			if (node.properties.length) {
				console.error(node)
				throw new Error("not implemented")
			}

			return {}
		}

		case "TemplateLiteral": {
			if (node.expressions.length || node.quasis.length != 1) {
				console.error(node)
				throw new Error("not implemented")
			}

			assert(node.quasis[0].type == "TemplateElement", `node.quasis[0].type was not "TemplateElement"`)

			return node.quasis[0].value.cooked
		}

		case "IfStatement": {
			if (!node.alternate)
				console.log(node)

			if (run(node.test, context))
				return run(node.consequent, context)
			else
				return run(node.alternate, context)
		}

		default: {
			console.error(node)
			throw new Error(`unknown node type "${(node as any).type}"`)
		}
	}
}

function getVariable(scopeStack: Map<string, unknown>[], name: string) {
	for (const scope of scopeStack) {
		if (scope.has(name))
			return scope.get(name)
	}

	throw new ReferenceError(`${name} is not defined`)
}

function setVariable(scopeStack: Map<string, unknown>[], name: string, value: any) {
	for (const scope of scopeStack) {
		if (scope.has(name)) {
			scope.set(name, value)
			return value
		}
	}

	throw new ReferenceError(`assignment to undeclared variable ${name}`)
}
