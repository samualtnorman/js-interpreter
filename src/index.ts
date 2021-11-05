import { Node, parse } from "acorn"
import { assert, AssertError } from "./lib"

const enum SignalType {
	Return, Break, Continue
}

export type Context = {
	variables: Map<string, any>[]
	constants: Map<string, any>
	statementLabel: string | undefined
	this: any
	callSuper: ((...args: any) => any) | null
	getSuperProperty: ((name: string) => any) | null

	signal: {
		type: SignalType.Break | SignalType.Continue
		label: string | undefined
	} | {
		type: SignalType.Return
		value: any
	} | null
}

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
		callSuper: null,
		getSuperProperty: null,
		signal: null
	})
}

export function run(node: Node, context: Context): any {
	switch (node.type) {
		case "Program": {
			hoist(node.body, context)

			let finalValue

			for (const childNode of node.body)
				finalValue = run(childNode, context)

			return finalValue
		}

		case "VariableDeclaration": {
			const variableMap = node.kind == "var" || node.kind == "let"
				? context.variables[0]
				: context.constants

			for (const childNode of node.declarations) {
				assert(childNode.type == "VariableDeclarator", `childNode.type was not "VariableDeclarator"`)

				const { id } = childNode

				assert(id.type == "Identifier", `id.type was not "Identifier"`)
				context.constants.delete(id.name)

				variableMap.set(
					id.name,

					childNode.init
						? childNode.init.type == "FunctionExpression"
							? createFunction(childNode.init, context, id.name)
							: run(childNode.init, context)
						: undefined
				)
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
					args.push(...run(argument.argument, context))
				else
					args.push(run(argument, context))
			}

			if (node.callee.type == "Super") {
				if (context.callSuper)
					return context.callSuper(...args)

				throw new TypeError("must call super in class constructor")
			}

			if (node.callee.type != "MemberExpression")
				return run(node.callee, context)(...args)

			if (node.callee.object.type == "Super") {
				if (!context.getSuperProperty)
					throw new TypeError("must call super in class constructor")

				if (node.callee.computed)
					return context.getSuperProperty(run(node.callee.property, context)).call(context.this, ...args)

				assert(node.callee.property.type == "Identifier", `node.callee.property.type was "${node.callee.property.type}"`)

				return context.getSuperProperty(node.callee.property.name).call(context.this, ...args)
			}

			const object = run(node.callee.object, context)

			if (node.callee.computed)
				return object[run(node.callee.property, context)](...args)

			assert(node.callee.property.type == "Identifier", `node.callee.property.type was "${node.callee.property.type}"`)

			if (typeof object[node.callee.property.name] == "function")
				return object[node.callee.property.name](...args)

			throw new TypeError(`property "${node.callee.property.name}" is not a function`)
		}

		case "MemberExpression": {
			const object = run(node.object, context)

			if (node.property.type == "Identifier" && !node.computed)
				return object[node.property.name]

			return object[run(node.property, context)]
		}

		case "Identifier":
			return getVariable(node.name, context)

		case "FunctionDeclaration":
		case "EmptyStatement":
			return

		case "FunctionExpression":
		case "ArrowFunctionExpression": {
			if (node.id) {
				assert(node.id.type == "Identifier", `node.id.type was "${node.id.type}"`)
				return createFunction(node, context, node.id.name)
			}

			return createFunction(node, context)
		}

		case "ForStatement": {
			const forContext = scopeContext(context)

			let finalValue

			for (node.init ? run(node.init, forContext) : undefined; node.test ? run(node.test, forContext) : true; node.update ? run(node.update, forContext) : undefined) {
				finalValue = run(node.body, forContext)

				if (!forContext.signal)
					continue

				if (forContext.signal.type == SignalType.Break) {
					if (forContext.signal.label)
						context.signal = forContext.signal

					return finalValue
				}

				if (forContext.signal.type == SignalType.Continue) {
					if (forContext.signal.label && forContext.signal.label != forContext.statementLabel) {
						context.signal = forContext.signal
						return finalValue
					}

					forContext.signal = null
				}
			}

			return finalValue
		}

		case "AssignmentExpression": {
			if (node.left.type == "Identifier") {
				let left: any = getVariable(node.left.name, context)

				switch (node.operator) {
					case "=":
						return setVariable(node.left.name, left = run(node.right, context), context)

					case "*=":
						return setVariable(node.left.name, left *= run(node.right, context), context)

					case "**=":
						return setVariable(node.left.name, left **= run(node.right, context), context)

					case "/=":
						return setVariable(node.left.name, left /= run(node.right, context), context)

					case "%=":
						return setVariable(node.left.name, left %= run(node.right, context), context)

					case "+=":
						return setVariable(node.left.name, left += run(node.right, context), context)

					case "-=":
						return setVariable(node.left.name, left -= run(node.right, context), context)

					case "<<=":
						return setVariable(node.left.name, left <<= run(node.right, context), context)

					case ">>=":
						return setVariable(node.left.name, left >>= run(node.right, context), context)

					case ">>>=":
						return setVariable(node.left.name, left >>>= run(node.right, context), context)

					case "&=":
						return setVariable(node.left.name, left &= run(node.right, context), context)

					case "^=":
						return setVariable(node.left.name, left ^= run(node.right, context), context)

					case "|=":
						return setVariable(node.left.name, left |= run(node.right, context), context)

					case "&&=":
						return setVariable(node.left.name, left &&= run(node.right, context), context)

					case "||=":
						return setVariable(node.left.name, left ||= run(node.right, context), context)

					case "??=":
						return setVariable(node.left.name, left ??= run(node.right, context), context)
				}
			}

			if (node.left.type != "MemberExpression")
				throw new AssertError(`node.left.type was "${node.left.type}"`)

			const object: any = run(node.left.object, context)

			const key = node.left.property.type == "Identifier" && !node.left.computed
				? node.left.property.name
				: run(node.left.property, context)

			switch (node.operator) {
				case "=":
					return object[key] = run(node.right, context)

				case "*=":
					return object[key] *= run(node.right, context)

				case "**=":
					return object[key] **= run(node.right, context)

				case "/=":
					return object[key] /= run(node.right, context)

				case "%=":
					return object[key] %= run(node.right, context)

				case "+=":
					return object[key] += run(node.right, context)

				case "-=":
					return object[key] -= run(node.right, context)

				case "<<=":
					return object[key] <<= run(node.right, context)

				case ">>=":
					return object[key] >>= run(node.right, context)

				case ">>>=":
					return object[key] >>>= run(node.right, context)

				case "&=":
					return object[key] &= run(node.right, context)

				case "^=":
					return object[key] ^= run(node.right, context)

				case "|=":
					return object[key] |= run(node.right, context)

				case "&&=":
					return object[key] &&= run(node.right, context)

				case "||=":
					return object[key] ||= run(node.right, context)

				case "??=":
					return object[key] ??= run(node.right, context)
			}
		}

		case "BinaryExpression": {
			switch (node.operator) {
				case "+":
					return run(node.left, context) + run(node.right, context)

				case "-":
					return run(node.left, context) - run(node.right, context)

				case "/":
					return run(node.left, context) / run(node.right, context)

				case "*":
					return run(node.left, context) * run(node.right, context)

				case "%":
					return run(node.left, context) % run(node.right, context)

				case "**":
					return run(node.left, context) ** run(node.right, context)

				case "in":
					return run(node.left, context) in run(node.right, context)

				case "instanceof":
					return run(node.left, context) instanceof run(node.right, context)

				case "<":
					return run(node.left, context) < run(node.right, context)

				case ">":
					return run(node.left, context) > run(node.right, context)

				case "<=":
					return run(node.left, context) <= run(node.right, context)

				case ">=":
					return run(node.left, context) >= run(node.right, context)

				case "==":
					return run(node.left, context) == run(node.right, context)

				case "!=":
					return run(node.left, context) != run(node.right, context)

				case "===":
					return run(node.left, context) === run(node.right, context)

				case "!==":
					return run(node.left, context) !== run(node.right, context)

				case "<<":
					return run(node.left, context) << run(node.right, context)

				case ">>":
					return run(node.left, context) >> run(node.right, context)

				case ">>>":
					return run(node.left, context) >>> run(node.right, context)

				case "&":
					return run(node.left, context) & run(node.right, context)

				case "|":
					return run(node.left, context) | run(node.right, context)

				case "^":
					return run(node.left, context) ^ run(node.right, context)
			}
		}

		case "BlockStatement": {
			const blockScope = scopeContext(context)

			hoist(node.body, blockScope)

			let finalValue

			for (const childNode of node.body) {
				finalValue = run(childNode, blockScope)

				if (blockScope.signal) {
					context.signal = blockScope.signal
					return finalValue
				}
			}

			return finalValue
		}

		case "UpdateExpression": {
			if (node.argument.type == "Identifier") {
				let value = run(node.argument, context)

				switch (node.operator) {
					case "++": {
						const returnValue = node.prefix ? ++value : value++
						setVariable(node.argument.name, value, context)
						return returnValue
					}

					case "--": {
						const returnValue = node.prefix ? --value : value--
						setVariable(node.argument.name, value, context)
						return returnValue
					}
				}
			}

			if (node.argument.type == "MemberExpression") {
				const object = run(node.argument.object, context)

				const key = node.argument.computed
					? run(node.argument.property, context)
					: node.argument.property.name

				if (node.operator == "++") {
					if (node.prefix)
						return ++object[key]

					return object[key]++
				}

				if (node.prefix)
					return --object[key]

				return object[key]--
			}

			// @ts-expect-error
			throw new AssertError(`node.argument.type was "${node.argument.type}"`)
		}

		case "ReturnStatement": {
			const value = node.argument
				? run(node.argument, context)
				: undefined

			context.signal = { type: SignalType.Return, value }

			return value
		}

		case "ArrayExpression": {
			const array = []

			for (const element of node.elements) {
				if (!element)
					array.length++
				else if (element.type == "SpreadElement")
					array.push(...run(element.argument, context))
				else
					array.push(run(element, context))
			}

			return array
		}

		case "ObjectExpression": {
			const object: any = {}

			for (const property of node.properties) {
				if (property.type == "SpreadElement")
					Object.assign(object, run(property.argument, context))
				else if (property.type == "Property") {
					switch (property.kind) {
						case "init": {
							let name: string

							if (property.computed)
								name = run(property.key, context)
							else if (property.key.type == "Identifier")
								name = property.key.name
							else if (property.key.type == "Literal")
								name = String(property.key.value)
							else
								// @ts-expect-error
								throw new AssertError(`property.key.type was "${property.key.type}"`)

							object[name] = property.value.type == "FunctionDeclaration" || property.value.type == "FunctionExpression" || property.value.type == "ArrowFunctionExpression"
								? createFunction(property.value, context, name)
								: run(property.value, context)
						} break

						case "get": {
							if (property.computed) {
								Object.defineProperty(object, run(property.key, context), {
									get: run(property.value, context),
									configurable: true,
									enumerable: true
								})

								continue
							}

							assert(property.key.type == "Identifier", `property.key.type was "${property.key.type}"`)

							Object.defineProperty(object, property.key.name, {
								get: run(property.value, context),
								configurable: true,
								enumerable: true
							})
						} break

						case "set": {
							if (property.computed) {
								Object.defineProperty(object, run(property.key, context), {
									set: run(property.value, context),
									configurable: true,
									enumerable: true
								})

								continue
							}

							assert(property.key.type == "Identifier", `property.key.type was "${property.key.type}"`)

							Object.defineProperty(object, property.key.name, {
								set: run(property.value, context),
								configurable: true,
								enumerable: true
							})
						} break

						default:
							// @ts-expect-error
							throw new AssertError(`property.kind was "${property.kind}"`)
					}
				} else
					throw new AssertError(`property.type was "${property.type}"`)
			}

			return object
		}

		case "TemplateLiteral": {
			assert(node.quasis[0].type == "TemplateElement", `node.quasis[0].type was "${node.quasis[0].type}"`)

			let string = node.quasis[0].value.cooked

			for (let i = 0; i < node.expressions.length; i++) {
				const templateElement = node.quasis[i + 1]
				assert(templateElement.type == "TemplateElement", `templateElement.type was "${templateElement.type}"`)
				string += run(node.expressions[i], context) + templateElement.value.cooked
			}

			return string
		}

		case "IfStatement": {
			const value = run(node.test, context)

			if (value)
				return run(node.consequent, context)

			if (node.alternate)
				return run(node.alternate, context)

			return value
		}

		case "LabeledStatement": {
			assert(node.label.type == "Identifier", `node.label.type was "${node.label.type}"`)

			context.statementLabel = node.label.name

			const value = run(node.body, context)

			if (context.signal && context.signal.type == SignalType.Break && context.signal.label == node.label.name)
				context.signal = null

			return value
		}

		case "BreakStatement": {
			if (node.label)
				assert(node.label.type == "Identifier", `node.label.type was "${node.label.type}"`)

			context.signal = { type: SignalType.Break, label: node.label?.name }
			return
		}

		case "DoWhileStatement": {
			const forContext = scopeContext(context)

			let finalValue

			do {
				finalValue = run(node.body, forContext)

				if (context.signal?.type == SignalType.Break) {
					if (!context.signal.label)
						context.signal = null

					return finalValue
				}
			} while (run(node.test, context))

			return finalValue
		}

		case "ContinueStatement": {
			if (node.label)
				assert(node.label.type == "Identifier", `node.label.type was "${node.label.type}"`)

			context.signal = { type: SignalType.Continue, label: node.label?.name }
			return
		}

		case "NewExpression": {
			const constructor = run(node.callee, context)

			const args = []

			for (const argument of node.arguments) {
				if (argument.type == "SpreadElement")
					args.push(...run(argument.argument, context))
				else
					args.push(run(argument, context))
			}

			if (typeof constructor == "function")
				return new constructor(...args)

			throw new TypeError("not a function")
		}

		case "ThrowStatement":
			throw run(node.argument, context)

		case "UnaryExpression": {
			assert(node.prefix, `node.prefix was false`)

			switch (node.operator) {
				case "delete": {
					if (node.argument.type != "MemberExpression")
						return true

					if (node.argument.computed)
						return delete run(node.argument.object, context)[run(node.argument.property, context)]

					assert(node.argument.property.type == "Identifier", `node.argument.property.type was "${node.argument.property.type}"`)
					return delete run(node.argument.object, context)[node.argument.property.name]
				}

				case "void":
					return void run(node.argument, context)

				case "typeof":
					return typeof run(node.argument, context)

				case "+":
					return +run(node.argument, context)

				case "-":
					return -run(node.argument, context)

				case "~":
					return ~run(node.argument, context)

				case "!":
					return !run(node.argument, context)
			}
		}

		case "ThisExpression": {
			if (context.this === null)
				throw new TypeError(`must call super first`)

			return context.this
		}

		case "LogicalExpression": {
			switch (node.operator) {
				case "&&":
					return run(node.left, context) && run(node.right, context)

				case "||":
					return run(node.left, context) || run(node.right, context)

				case "??":
					return run(node.left, context) ?? run(node.right, context)
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
				if (!node.handler)
					return

				assert(node.handler.type == "CatchClause", `node.handler.type was "${node.handler.type}"`)

				if (!node.handler.param)
					return run(node.handler.body, context)

				assert(node.handler.param.type == "Identifier", `node.handler.param.type was "${node.handler.param.type}"`)

				const catchScope = scopeContext(context)

				catchScope.variables[0].set(node.handler.param.name, error)

				return run(node.handler.body, catchScope)
			} finally {
				if (node.finalizer)
					return run(node.finalizer, context)
			}
		}

		case "ClassDeclaration": {
			assert(node.id.type == "Identifier", `node.id.type was "${node.id.type}"`)
			assert(node.body.type == "ClassBody", `node.body.type was "${node.body.type}"`)

			const propertyDefinitions = new Map<string, Node>()
			let constructorNode: Node | undefined
			const { superClass } = node

			const constructor = ({
				[node.id.name]: class extends (superClass ? run(superClass, context) : Object) {
					constructor(...args: any[]) {
						if (!constructorNode) {
							const this_: any = super(...args)

							for (const [ name, value ] of propertyDefinitions)
								this_[name] = run(value, context)

							return
						}

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

								constructorScope.variables[0].set(
									childNode.left.name,

									args[i] === undefined
										? run(childNode.right, context)
										: args[i]
								)
							} else
								throw new AssertError(`childNode.type was "${childNode.type}"`)
						}

						run(constructorNode.body, constructorScope)

						if (context.signal && context.signal.type == SignalType.Return) {
							const { value } = context.signal
							context.signal = null
							return value
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
							constructor[run(definition.key, context)] = run(definition.value, context)
						else {
							assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
							constructor[definition.key.name] = run(definition.value, context)
						}
					} else if (definition.computed)
						propertyDefinitions.set(run(definition.key, context), definition.value)
					else {
						assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
						propertyDefinitions.set(definition.key.name, definition.value)
					}
				} else if (definition.type == "MethodDefinition") {
					if (definition.kind == "constructor")
						constructorNode = definition.value
					else if (definition.kind == "method") {
						if (definition.static) {
							if (definition.computed) {
								const name: any = run(definition.key, context)
								constructor[name] = createFunction(definition.value, constructorContext, name)
							} else {
								assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
								constructor[definition.key.name] = createFunction(definition.value, constructorContext, definition.key.name)
							}
						} else if (definition.computed) {
							const name: any = run(definition.key, context)
							constructor.prototype[name] = createFunction(definition.value, constructorContext, name)
						} else {
							assert(definition.key.type == "Identifier", `definition.key.type was "${definition.key.type}"`)
							constructor.prototype[definition.key.name] = createFunction(definition.value, constructorContext, definition.key.name)
						}
					} else
						throw new AssertError(`definition.kind was "${definition.kind}"`)
				} else
					throw new AssertError(`definition.type was "${definition.type}"`)
			}

			context.variables[0].set(node.id.name, constructor)

			return
		}

		case "SequenceExpression": {
			let finalValue

			for (const expression of node.expressions)
				finalValue = run(expression, context)

			return finalValue
		}

		default: {
			console.error(node)
			throw new AssertError(`unknown node type "${node.type}"`)
		}
	}
}

function scopeContext({ variables, constants, this: this_, callSuper, getSuperProperty }: Context): Context {
	return {
		variables: [ new Map, ...variables ],
		constants: new Map(constants),
		statementLabel: undefined,
		this: this_,
		signal: null,
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

	if (node.id?.type == "Identifier")
		name = node.id.name

	if (node.async) {
		return {
			[name]: async function (...args: any[]) {
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

						functionContext.variables[0].set(
							childNode.left.name,

							args[i] === undefined
								? run(childNode.right, context)
								: args[i]
						)
					} else
						throw new AssertError(`childNode.type was "${childNode.type}"`)
				}

				if (node.body.type == "BlockStatement") {
					run(node.body, functionContext)

					if (functionContext.signal && functionContext.signal.type == SignalType.Return) {
						const { value } = functionContext.signal
						functionContext.signal = null
						return value
					}

					return
				}

				return run(node.body, functionContext)
			}
		}[name]
	}

	return {
		[name]: function (...args: any[]) {
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

					functionContext.variables[0].set(
						childNode.left.name,

						args[i] === undefined
							? run(childNode.right, context)
							: args[i]
					)
				} else
					throw new AssertError(`childNode.type was "${childNode.type}"`)
			}

			if (node.body.type == "BlockStatement") {
				run(node.body, functionContext)

				if (functionContext.signal && functionContext.signal.type == SignalType.Return) {
					const { value } = functionContext.signal
					functionContext.signal = null
					return value
				}

				return
			}

			return run(node.body, functionContext)
		}
	}[name]
}
