import { Node, parse } from "acorn"
import { assert, AssertError, isRecord } from "./lib"

export type Context = {
	variables: Map<string, any>[]
	constants: Map<string, any>
	statementLabel: string | undefined
	this: any
	callSuper: ((...args: any) => unknown) | undefined
	getSuperProperty: ((name: string) => any) | undefined
}

const returnSignal = Symbol("returnSignal")
const breakSignal = Symbol("breakSignal")
const continueSignal = Symbol("continueSignal")

export function evaluate(code: string, environment = {}) {
	return run(parse(code, { ecmaVersion: "latest" }), {
		variables: [
			new Map(Object.entries(environment)),
			new Map(
				Object.getOwnPropertyNames(globalThis)
					.map(key => [ key, (globalThis as any)[key] ])
			)
		],
		constants: new Map,
		statementLabel: undefined,
		this: undefined,
		callSuper: undefined,
		getSuperProperty: undefined
	})
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
			const args = []

			for (const argument of node.arguments) {
				if (argument.type == "SpreadElement")
					args.push(...run(argument.argument, context) as any)
				else
					args.push(run(argument, context))
			}

			if (node.callee.type == "Super") {
				if (!context.callSuper)
					throw new TypeError("must call super in class constructor")

				return context.callSuper(...args)
			}

			if (node.callee.type == "MemberExpression") {
				if (node.callee.object.type == "Super") {
					if (!context.getSuperProperty)
						throw new TypeError("must call super in class constructor")

					if (node.callee.property.type == "Identifier" && !node.callee.computed)
						return context.getSuperProperty(node.callee.property.name).call(context.this, ...args)

					return context.getSuperProperty(run(node.callee.property, context) as any).call(context.this, ...args)
				}

				const object = run(node.callee.object, context)

				if (node.callee.property.type == "Identifier" && !node.callee.computed) {
					if (typeof (object as any)[node.callee.property.name] == "function")
						return (object as any)[node.callee.property.name](...args)

					throw new TypeError(`property "${node.callee.property.name}" is not a function`)
				}

				return (object as any)[run(node.callee.property, context) as any](...args)
			}

			return (run(node.callee, context) as any)(...args)
		}

		case "MemberExpression": {
			const object = run(node.object, context)

			if (node.property.type == "Identifier" && !node.computed)
				return (object as any)[node.property.name]

			return (object as any)[run(node.property, context) as any]
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

			for (node.init ? run(node.init, forContext) : undefined; node.test ? run(node.test, forContext) : true; node.update ? run(node.update, forContext) : undefined) {
				finalValue = run(node.body, forContext)

				if (isRecord(finalValue)) {
					if (breakSignal in finalValue) {
						if (finalValue[breakSignal])
							return finalValue

						return
					} else if (continueSignal in finalValue) {
						if (finalValue[continueSignal] != context.statementLabel)
							return finalValue

						finalValue = undefined
					}
				}
			}

			return finalValue
		}

		case "AssignmentExpression": {
			if (node.left.type == "Identifier") {
				let left: any = getVariable(node.left.name, context)
				const right = run(node.right, context)

				switch (node.operator) {
					case "=": {
						left = right
					} break

					case "+=": {
						left += right
					} break

					default: {
						// @ts-expect-error
						throw new AssertError(`unknown assignment operator "${node.operator}"`)
					}
				}

				return setVariable(node.left.name, left, context)
			}

			if (node.left.type == "MemberExpression") {
				const object: any = run(node.left.object, context)
				let key: any
				const value = run(node.right, context)

				if (node.left.property.type == "Identifier" && !node.left.computed)
					key = node.left.property.name
				else
					key = run(node.left.property, context)

				switch (node.operator) {
					case "=":
						return object[key] = value

					case "+=":
						return object[key] += value

					default: {
						// @ts-expect-error
						throw new AssertError(`unknown assignment operator "${node.operator}" (member)`)
					}
				}
			}

			throw new AssertError(`node.left.type was "${node.left.type}"`)
		}

		case "BinaryExpression": {
			switch (node.operator) {
				case "<":
					return (run(node.left, context) as any) < (run(node.right, context) as any)

				case "+":
					return (run(node.left, context) as any) + (run(node.right, context) as any)

				case "==":
					return (run(node.left, context) as any) == (run(node.right, context) as any)

				case "===":
					return (run(node.left, context) as any) === (run(node.right, context) as any)

				case "instanceof":
					return (run(node.left, context) as any) instanceof (run(node.right, context) as any)

				case "-":
					return (run(node.left, context) as any) - (run(node.right, context) as any)

				case ">=":
					return (run(node.left, context) as any) >= (run(node.right, context) as any)

				case ">":
					return (run(node.left, context) as any) > (run(node.right, context) as any)

				case "!==":
					return (run(node.left, context) as any) !== (run(node.right, context) as any)

				case "*":
					return (run(node.left, context) as any) * (run(node.right, context) as any)

				case "<=":
					return (run(node.left, context) as any) <= (run(node.right, context) as any)

				case "%":
					return (run(node.left, context) as any) % (run(node.right, context) as any)

				case "/":
					return (run(node.left, context) as any) / (run(node.right, context) as any)

				case "**":
					return (run(node.left, context) as any) ** (run(node.right, context) as any)

				case "|":
					return (run(node.left, context) as any) | (run(node.right, context) as any)

				case "&":
					return (run(node.left, context) as any) & (run(node.right, context) as any)

				case "^":
					return (run(node.left, context) as any) ^ (run(node.right, context) as any)

				case "<<":
					return (run(node.left, context) as any) << (run(node.right, context) as any)

				case ">>":
					return (run(node.left, context) as any) >> (run(node.right, context) as any)

				case ">>>":
					return (run(node.left, context) as any) >>> (run(node.right, context) as any)

				case "!=":
					return (run(node.left, context) as any) != (run(node.right, context) as any)

				default: {
					console.error(node)
					// @ts-expect-error
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
					// @ts-expect-error
					throw new AssertError(`unknown update operator "${node.operator}"`)
				}
			}
		}

		case "ReturnStatement": {
			return { [returnSignal]: node.argument ? run(node.argument, context) : undefined }
		}

		case "ArrayExpression": {
			const array = []

			for (const element of node.elements) {
				if (!element)
					array.length++
				else if (element.type == "SpreadElement")
					array.push(...run(element.argument, context) as any)
				else
					array.push(run(element, context))
			}

			return array
		}

		case "ObjectExpression": {
			return Object.fromEntries(node.properties.map(node => {
				assert(node.type == "Property")
				assert(node.kind == "init", `node.kind was "${node.kind}"`)

				// TODO function name

				if (node.key.type == "Identifier" && !node.computed)
					return [ node.key.name, run(node.value, context) ]

				return [ run(node.key, context), run(node.value, context) ]
			}))
		}

		case "TemplateLiteral": {
			assert(node.quasis[0].type == "TemplateElement")

			let o = node.quasis[0].value.cooked

			for (let i = 0; i < node.expressions.length; i++) {
				const templateElement = node.quasis[i + 1]
				assert(templateElement.type == "TemplateElement")
				o += run(node.expressions[i], context) + templateElement.value.cooked
			}

			return o
		}

		case "IfStatement": {
			if (run(node.test, context))
				return run(node.consequent, context)

			if (node.alternate)
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

			console.log(function_)

			if (typeof function_ == "function")
				return new function_(...node.arguments.map(childNode => run(childNode, context)))

			console.error(function_)
			throw new TypeError("not a function")
		}

		case "ThrowStatement": {
			throw run(node.argument, context)
		}

		case "UnaryExpression": {
			assert(node.prefix, `node.prefix was false`)

			switch (node.operator) {
				case "typeof":
					return typeof run(node.argument, context)

				case "-":
					return -(run(node.argument, context) as any)

				case "+":
					return +(run(node.argument, context) as any)

				case "delete": {
					if (node.argument.type == "MemberExpression") {
						const object = run(node.argument.object, context)

						if (node.argument.property.type == "Identifier" && !node.argument.computed)
							return delete (object as any)[node.argument.property.name]

						return delete (object as any)[run(node.argument.property, context) as any]
					}

					return true
				}

				case "~":
					return ~(run(node.argument, context) as any)

				default: {
					console.error(node)
					// @ts-expect-error
					throw new AssertError(`unknown unary operator "${node.operator}"`)
				}
			}
		}

		case "ThisExpression":
			return context.this

		case "EmptyStatement":
			return

		case "LogicalExpression": {
			switch (node.operator) {
				case "&&":
					return run(node.left, context) && run(node.right, context)

				case "||":
					return run(node.left, context) || run(node.right, context)

				default: {
					console.error(node)
					// @ts-expect-error
					throw new AssertError(`unknown logical operator "${node.operator}"`)
				}
			}
		}

		case "ConditionalExpression": {
			if (run(node.test, context))
				return run(node.consequent, context)

			return run(node.alternate, context)
		}

		case "TryStatement": {
			try {
				return run(node.block, context)
			} catch (error) {
				if (node.handler) {
					assert(node.handler.type == "CatchClause", `node.handler.type was "${node.handler.type}"`)

					if (node.handler.param) {
						const blockScope = scopeContext(context)

						assert(node.handler.param.type == "Identifier", `node.handler.param.type was "${node.handler.param.type}"`)

						blockScope.variables[0].set(node.handler.param.name, error)

						return run(node.handler.body, blockScope)
					}

					return run(node.handler, context)
				}
			} finally {
				if (node.finalizer)
					return run(node.finalizer, context)
			}

			throw new Error("unreachable")
		}

		case "ClassDeclaration": {
			assert(node.id.type == "Identifier", `node.id.type was "${node.id.type}"`)
			assert(node.body.type == "ClassBody", `node.body.type was "${node.body.type}"`)

			const propertyDefinitions = new Map<string, Node>()
			let constructorNode: Node | undefined
			const { superClass } = node

			const constructor = ({
				[node.id.name]: class extends (superClass ? run(superClass, context) as any : Object) {
					constructor(...args: any[]) {
						if (constructorNode) {
							assert(constructorNode.type == "FunctionExpression", `constructorNode.type was "${constructorNode.type}"`)
							assert(constructorNode.body.type == "BlockStatement")

							const constructorScope = scopeContext(context)

							constructorScope.this = null

							constructorScope.callSuper = (...args: any[]) => {
								// @ts-expect-error
								constructorScope.this = super(...args)

								for (const [ name, value ] of propertyDefinitions)
									constructorScope.this[name] = run(value, context)

								return constructorScope.this
							}

							if (superClass)
								constructorScope.getSuperProperty = name => super[name]
							else
								constructorScope.callSuper()

							for (let i = 0; i < constructorNode.params.length; i++) {
								const childNode = constructorNode.params[i]

								if (childNode.type == "Identifier")
									constructorScope.variables[0].set(childNode.name, args[i])
								else if (childNode.type == "AssignmentPattern") {
									assert(childNode.left.type == "Identifier", `childNode.left.type was ${childNode.left.type}`)

									if (args[i] === undefined)
										constructorScope.variables[0].set(childNode.left.name, run(childNode.right, context))
									else
										constructorScope.variables[0].set(childNode.left.name, args[i])
								} else
									throw new AssertError(`childNode.type was "${childNode.type}"`)
							}

							hoist(constructorNode.body.body, constructorScope)

							for (const childNode of constructorNode.body.body) {
								const value = run(childNode, constructorScope)

								if (isRecord(value) && returnSignal in value)
									return value[returnSignal] as any
							}
						} else {
							const this_: any = super(...args)

							for (const [ name, value ] of propertyDefinitions)
								this_[name] = run(value, context)
						}
					}

					getGetSuperProperty() {
						return (name: string) => super[name]
					}
				}
			})[node.id.name]

			const constructorContext: Context = {
				...context,
				getSuperProperty: constructor.prototype.getGetSuperProperty()
			}

			delete (constructor.prototype as any).getGetSuperProperty

			for (const definition of node.body.body) {
				if (definition.type == "PropertyDefinition") {
					if (definition.static) {
						if (definition.computed)
							(constructor as any)[run(definition.key, context) as any] = run(definition.value, context)
						else {
							assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
							;(constructor as any)[definition.key.name] = run(definition.value, context)
						}
					} else {
						if (definition.computed)
							propertyDefinitions.set(run(definition.key, context) as any, definition.value)
						else {
							assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
							propertyDefinitions.set(definition.key.name, definition.value)
						}
					}
				} else if (definition.type == "MethodDefinition") {
					if (definition.kind == "constructor")
						constructorNode = definition.value
					else if (definition.kind == "method") {
						if (definition.static) {
							if (definition.computed) {
								const name: any = run(definition.key, context)
								;(constructor as any)[name] = createFunction(definition.value, constructorContext, name)
							} else {
								assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
								;(constructor as any)[definition.key.name] = createFunction(definition.value, constructorContext, definition.key.name)
							}
						} else {
							if (definition.computed) {
								const name: any = run(definition.key, context)
								;(constructor as any).prototype[name] = createFunction(definition.value, constructorContext, name)
							} else {
								assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
								;(constructor as any).prototype[definition.key.name] = createFunction(definition.value, constructorContext, definition.key.name)
							}
						}
					} else
						throw new AssertError(`definition.kind was "${definition.kind}"`)
				} else
					throw new AssertError(`definition.type was "${definition.type}"`)
			}

			context.variables[0].set(node.id.name, constructor)

			return
		}

		default: {
			console.error(node)
			throw new AssertError(`unknown node type "${(node as any).type}"`)
		}
	}
}

function scopeContext({ variables, constants, this: this_, callSuper, getSuperProperty }: Context): Context {
	return {
		variables: [ new Map, ...variables ],
		constants: new Map(constants),
		statementLabel: undefined,
		this: this_,
		callSuper, getSuperProperty
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
		} else if (childNode.type == "ForStatement" && childNode.init && childNode.init.type == "VariableDeclaration" && childNode.init.kind == "var") {
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

			if (node.type != "ArrowFunctionExpression")
				functionContext.this = this

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

				return
			}

			return run(node.body, functionContext)
		}
	}[name]
}
