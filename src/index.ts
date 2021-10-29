import { Node, parse } from "acorn"
import { assert, AssertError, isRecord } from "./lib"

type Context = {
	variables: Map<string, unknown>[]
	constants: Map<string, unknown>
	statementLabel: string | undefined
}

const returnSignal = Symbol("returnSignal")
const breakSignal = Symbol("breakSignal")
const continueSignal = Symbol("continueSignal")

export function evaluate(code: string, environment = {}) {
	return run(
		parse(code, { ecmaVersion: "latest" }),

		{
			variables: [
				new Map(Object.entries(environment)),
				new Map(
					Object.getOwnPropertyNames(globalThis)
						.map(key => [ key, (globalThis as any)[key] ])
				)
			],
			constants: new Map,
			statementLabel: undefined
		}
	)
}

export function run(node: Node, context: Context): unknown {
	switch (node.type) {
		case "Program": {
			hoist(node.body, context)

			let finalValue

			for (const childNode of node.body)
				finalValue = run(childNode, context)

			return finalValue
		}

		case "VariableDeclaration": {
			let variableMap

			if (node.kind == "var" || node.kind == "let")
				variableMap = context.variables[0]
			else
				variableMap = context.constants

			for (const childNode of node.declarations) {
				assert(childNode.type == "VariableDeclarator", `childNode.type was not "VariableDeclarator"`)

				const { id } = childNode

				assert(id.type == "Identifier", `id.type was not "Identifier"`)

				context.constants.delete(id.name)

				if (childNode.init) {
					if (childNode.init.type == "FunctionExpression") {
						variableMap.set(id.name, createFunction(childNode.init, context, id.name))
					} else
						variableMap.set(id.name, run(childNode.init, context))
				} else
					variableMap.set(id.name, undefined)
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
			const function_ = run(node.callee, context) as any

			if (node.arguments.find(childNode => childNode.type == "SpreadElement")) {
				console.log(node)
				process.exit()
			}

			if (typeof function_ == "function")
				return function_(...node.arguments.map(childNode => run(childNode, context)))

			console.error(function_)
			throw new TypeError("not a function")
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
			return getVariable(node.name, context)
		}

		case "FunctionDeclaration": break

		case "FunctionExpression":
		case "ArrowFunctionExpression": {
			if (node.id) {
				assert(node.id.type == "Identifier", `node.id.type wasn't "Identifier"`)
				return createFunction(node, context, node.id.name)
			}

			return createFunction(node, context)
		}

		case "ForStatement": {
			const forContext = scopeContext(context)

			let finalValue

			for (run(node.init, forContext); run(node.test, forContext); run(node.update, forContext)) {
				finalValue = run(node.body, forContext)

				if (isRecord(finalValue)) {
					if (breakSignal in finalValue && !finalValue[breakSignal])
						return

					if (continueSignal in finalValue) {
						if (finalValue[continueSignal] != context.statementLabel)
							return finalValue

						finalValue = undefined

						continue
					}
				}
			}

			return finalValue
		}

		case "AssignmentExpression": {
			if (node.left.type == "Identifier")
				return setVariable(node.left.name, run(node.right, context), context)
			else if (node.left.type == "MemberExpression") {
				if (node.left.property.type == "Identifier")
					return (run(node.left.object, context) as any)[node.left.property.name] = run(node.right, context)

				return (run(node.left.object, context) as any)[run(node.left.property, context) as any] = run(node.right, context)
			} else
				throw new AssertError(`node.left.type was "${node.left.type}"`)
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

				case "===": {
					return (run(node.left, context) as any) === (run(node.right, context) as any)
				}

				case "instanceof": {
					return (run(node.left, context) as any) instanceof (run(node.right, context) as any)
				}

				case "-": {
					return (run(node.left, context) as any) - (run(node.right, context) as any)
				}

				default: {
					console.error(node)
					throw new AssertError(`unknown binary operator "${node.operator}"`)
				}
			}
		}

		case "BlockStatement": {
			const blockScope = scopeContext(context)

			hoist(node.body, blockScope)

			let finalValue

			for (const childNode of node.body) {
				finalValue = run(childNode, blockScope)

				if (isRecord(finalValue)) {
					if (breakSignal in finalValue)
						return finalValue

					if (continueSignal in finalValue)
						return finalValue
				}
			}

			return finalValue
		}

		case "UpdateExpression": {
			assert(node.argument.type == "Identifier", `node.argument.type was not "Identifier"`)

			switch (node.operator) {
				case "++": {
					let updatedValue: any = run(node.argument, context)

					const returnValue = node.prefix ? ++updatedValue : updatedValue++

					setVariable(node.argument.name, updatedValue, context)

					return returnValue
				}

				case "--": {
					let updatedValue: any = run(node.argument, context)

					const returnValue = node.prefix ? --updatedValue : updatedValue--

					setVariable(node.argument.name, updatedValue, context)

					return returnValue
				}

				default: {
					console.error(node)
					throw new AssertError(`unknown update operator "${node.operator}"`)
				}
			}
		}

		case "ReturnStatement": {
			return { [returnSignal]: node.argument ? run(node.argument, context) : undefined }
		}

		case "ArrayExpression": {
			return new Array(node.elements.length).map((_, i) => run(node.elements[i], context))
		}

		case "ObjectExpression": {
			return Object.fromEntries(node.properties.map(node => {
				assert(node.type == "Property")
				assert(node.kind == "init", `found node property node with "${node.kind}" as "kind" property`)

				// TODO function name

				if (node.key.type == "MemberExpression") {
					return [
						run(node.key, context),
						run(node.value, context)
					]
				} else if (node.key.type == "Identifier") {
					return [
						node.key.name,
						run(node.value, context)
					]
				} else
					throw new AssertError(`node.key.type was "${node.key.type}"`)
			}))
		}

		case "TemplateLiteral": {
			if (node.expressions.length || node.quasis.length != 1) {
				console.error(node)
				throw new AssertError("not implemented")
			}

			assert(node.quasis[0].type == "TemplateElement", `node.quasis[0].type was not "TemplateElement"`)

			return node.quasis[0].value.cooked
		}

		case "IfStatement": {
			if (run(node.test, context))
				return run(node.consequent, context)
			else if (node.alternate)
				return run(node.alternate, context)

			return
		}

		case "LabeledStatement": {
			assert(node.label.type == "Identifier")

			context.statementLabel = node.label.name

			const value = run(node.body, context)

			if (isRecord(value) && breakSignal in value && value[breakSignal] == node.label.name)
				return

			return value
		}

		case "BreakStatement": {
			if (node.label)
				assert(node.label.type == "Identifier")

			return { [breakSignal]: node.label?.name }
		}

		case "DoWhileStatement": {
			const forContext = scopeContext(context)

			let finalValue

			do {
				finalValue = run(node.body, forContext)

				if (isRecord(finalValue) && breakSignal in finalValue) {
					if (!finalValue[breakSignal])
						return

					return finalValue
				}
			} while (run(node.test, context))

			return finalValue
		}

		case "ContinueStatement": {
			if (node.label)
				assert(node.label.type == "Identifier")

			return { [continueSignal]: node.label?.name }
		}

		case "NewExpression": {
			const function_ = run(node.callee, context) as any

			if (typeof function_ == "function")
				return new function_(...node.arguments.map(childNode => run(childNode, context)))

			console.error(function_)
			throw new TypeError("not a function")
		}

		case "ThrowStatement": {
			throw run(node.argument, context)
		}

		case "UnaryExpression": {
			switch (node.operator) {
				case "typeof": {
					assert(node.prefix, `node.prefix was false`)
					return typeof run(node.argument, context)
				}

				case "-": {
					assert(node.prefix, `node.prefix was false`)
					return -(run(node.argument, context) as any)
				}

				default: {
					console.error(node)
					throw new AssertError(`unknown unary operator "${node.operator}"`)
				}
			}
		}

		default: {
			console.error(node)
			throw new AssertError(`unknown node type "${(node as any).type}"`)
		}
	}
}

function scopeContext({ variables, constants }: Context): Context {
	return {
		variables: [ new Map, ...variables ],
		constants: new Map(constants),
		statementLabel: undefined
	}
}

function getVariable(name: string, { variables, constants }: Context) {
	if (constants.has(name))
		return constants.get(name)

	for (const scope of variables) {
		if (scope.has(name)) {
			return scope.get(name)
		}
	}

	throw new ReferenceError(`${name} is not defined`)
}

function setVariable(name: string, value: any, { variables, constants }: Context) {
	if (constants.has(name))
		throw new TypeError("assignment to constant")

	for (const scope of variables) {
		if (scope.has(name)) {
			scope.set(name, value)
			return value
		}
	}

	throw new ReferenceError(`assignment to undeclared variable ${name}`)
}

function hoist(nodes: Node[], context: Context) {
	for (const childNode of nodes) {
		if (childNode.type == "VariableDeclaration" && childNode.kind == "var") {
			for (const declaration of childNode.declarations) {
				assert(declaration.type == "VariableDeclarator", `declaration.type wasn't "VariableDeclarator"`)
				assert(declaration.id.type == "Identifier", `declaration.id.type wasn't "Identifier"`)
				context.variables[0].set(declaration.id.name, undefined)
			}
		} else if (childNode.type == "ForStatement" && childNode.init.type == "VariableDeclaration" && childNode.init.kind == "var") {
			for (const declaration of childNode.init.declarations) {
				assert(declaration.type == "VariableDeclarator", `declaration.type wasn't "VariableDeclarator"`)
				assert(declaration.id.type == "Identifier", `declaration.id.type wasn't "Identifier"`)
				context.variables[0].set(declaration.id.name, undefined)
			}
		} else if (childNode.type == "FunctionDeclaration") {
			assert(childNode.id.type == "Identifier", `childNode.id.type wasn't "Identifier"`)
			assert(childNode.body.type == "BlockStatement", `childNode.body.type wasn't "BlockStatement"`)

			const functionDeclaration = childNode
			const { id } = childNode

			context.variables[0].set(id.name, createFunction(functionDeclaration, context, id.name))
		}
	}
}

export function createFunction(node: Node, context: Context, name = "") {
	assert(node.type == "FunctionDeclaration" || node.type == "FunctionExpression" || node.type == "ArrowFunctionExpression")

	return {
		[name](...args: any[]) {
			const functionContext = scopeContext(context)

			functionContext.constants.set("arguments", arguments)

			for (let i = 0; i < node.params.length; i++) {
				const childNode = node.params[i]

				if (childNode.type == "Identifier")
					functionContext.variables[0].set(childNode.name, args[i])
				else if (childNode.type == "AssignmentPattern") {
					assert(childNode.left.type == "Identifier", `childNode.left.type was ${childNode.left.type}`)

					if (args[i] === undefined)
						functionContext.variables[0].set(childNode.left.name, run(childNode.right, context))
					else
						functionContext.variables[0].set(childNode.left.name, args[i])
				} else
					throw new AssertError(`childNode.type was "${childNode.type}"`)
			}

			if (node.body.type == "BlockStatement") {
				hoist(node.body.body, functionContext)

				for (const childNode of node.body.body) {
					const value = run(childNode, functionContext)

					if (isRecord(value) && returnSignal in value)
						return value[returnSignal]
				}
			}

			return run(node.body, functionContext)
		}
	}[name]
}
